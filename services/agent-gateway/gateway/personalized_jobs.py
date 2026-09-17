"""Job-bound, renewable execution leases for personalized web operations only.

Event delivery is at least once. A transaction claims the job and the player's
operation together; every later write is fenced by the attempt token. A crashed
attempt can be reclaimed after its lease expires. Native jobs keep their serving
handler and allowance semantics.
"""
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from threading import Event, Thread
from uuid import uuid4

from google.cloud import firestore
from google.cloud.firestore_v1.transaction import transactional

from gateway.ctx import Invocation
from gateway.errors import GatewayError
from gateway.personalized_access import CAPABILITIES
from gateway.workout_persistence import _read

LEASE_SECONDS = 120
MAX_ATTEMPT_SECONDS = 3600


class ExecutionLost(GatewayError):
    def __init__(self):
        super().__init__('context_unavailable', 'This planner attempt has ended. Reconnect to its saved request.')


def now(inv):
    return inv.context.get('_leaseNow') or datetime.now(timezone.utc)


def operation_ref(inv):
    return inv.player_ref().collection('personalizedPlanOperations').document('current')


def data(snapshot):
    return (snapshot.to_dict() or {}) if snapshot.exists else {}


def live(row, current):
    expiry = row.get('expiresAt')
    return row.get('status') == 'running' and isinstance(expiry, datetime) and expiry > current


def assert_execution(inv, read=None):
    execution = inv.context.get('_personalizedExecution')
    if not execution:
        return  # Pure domain calls in tests; the HTTP handler always installs it.
    ref = operation_ref(inv)
    row = data(read(ref) if read else ref.get())
    if (row.get('jobId') != inv.job_id or row.get('token') != execution['token']
            or not live(row, now(inv))):
        raise ExecutionLost()


def claim(inv):
    from gateway.personalized_access import authorize_personalized
    from gateway.personalized_plans import engine_for
    job_ref = inv.db.collection('llmJobs').document(inv.job_id)
    ref = operation_ref(inv)
    token = uuid4().hex

    @transactional
    def acquire(tx):
        read = lambda target: _read(target, tx)
        job = data(read(job_ref))
        if job.get('status') in ('complete', 'failed'):
            return 'terminal'
        if (job.get('requestedByUid') != inv.uid or job.get('playerId') != inv.player_id
                or job.get('capability') != inv.capability or job.get('params', {}) != inv.params):
            raise GatewayError('invalid_request', 'The saved request changed before acceptance')
        if job.get('status') not in ('pending', 'running'):
            raise GatewayError('invalid_request', 'The saved request is not pending')
        authorize_personalized(inv, read=read)
        current = now(inv)
        previous = data(read(ref))
        if live(previous, current):
            return 'busy'
        previous_job_ref = None
        previous_job = {}
        previous_id = previous.get('jobId')
        if isinstance(previous_id, str) and previous_id and '/' not in previous_id and previous_id != inv.job_id:
            previous_job_ref = inv.db.collection('llmJobs').document(previous_id)
            previous_job = data(read(previous_job_ref))
        version = engine_for(inv.capability, inv.params.get('engineVersion'))
        if job.get('engineVersion') not in (None, version):
            raise GatewayError('invalid_request', 'Pinned engine version is unavailable')
        expiry = current + timedelta(seconds=LEASE_SECONDS)
        tx.set(ref, {'schemaVersion': 1, 'jobId': inv.job_id, 'token': token,
            'requestedByUid': inv.uid, 'status': 'running', 'expiresAt': expiry,
            'deadline': current + timedelta(seconds=MAX_ATTEMPT_SECONDS), 'updatedAt': current})
        tx.update(job_ref, {'status': 'running', 'startedAt': current, 'engineVersion': version,
                           'personalizedExecution': {'token': token, 'expiresAt': expiry}})
        if (previous_job_ref and previous_job.get('status') == 'running'
                and (previous_job.get('personalizedExecution') or {}).get('token') == previous.get('token')):
            tx.update(previous_job_ref, {'status': 'failed', 'completedAt': current,
                'error': {'code': 'context_unavailable', 'message': 'The previous attempt stopped responding. Start a new request.'}})
        return 'claimed'

    result = acquire(inv.db.transaction())
    if result == 'claimed':
        inv.context['_personalizedExecution'] = {'token': token}
    return result


def renew(inv):
    ref = operation_ref(inv)
    job_ref = inv.db.collection('llmJobs').document(inv.job_id)

    @transactional
    def heartbeat(tx):
        read = lambda target: _read(target, tx)
        assert_execution(inv, read)
        row = data(read(ref))
        current = now(inv)
        expiry = min(current + timedelta(seconds=LEASE_SECONDS), row['deadline'])
        if expiry <= current:
            raise ExecutionLost()
        tx.update(ref, {'expiresAt': expiry, 'updatedAt': current})
        tx.update(job_ref, {'personalizedExecution': {'token': row['token'], 'expiresAt': expiry}})
    heartbeat(inv.db.transaction())


@contextmanager
def heartbeat(inv):
    stop = Event()

    def work():
        while not stop.wait(30):
            try:
                renew(inv)
            except Exception:
                # A transient renewal failure cannot extend ownership. Every
                # subsequent model call and commit checks the persisted lease.
                inv.log.warning('Personalized execution heartbeat unavailable')
    thread = Thread(target=work, daemon=True)
    thread.start()
    try:
        yield
    finally:
        stop.set()
        thread.join(timeout=1)


def update_owned(inv, fields, *, terminal=False):
    ref = operation_ref(inv)
    job_ref = inv.db.collection('llmJobs').document(inv.job_id)

    @transactional
    def update(tx):
        assert_execution(inv, lambda target: target.get(transaction=tx))
        tx.update(job_ref, fields)
        if terminal:
            tx.update(ref, {'status': 'idle', 'expiresAt': now(inv), 'updatedAt': now(inv)})
    update(inv.db.transaction())


def fail_unclaimed(db, job_id, error):
    ref = db.collection('llmJobs').document(job_id)

    @transactional
    def fail(tx):
        job = data(ref.get(transaction=tx))
        if job.get('status') == 'pending':
            tx.update(ref, {'status': 'failed', 'completedAt': firestore.SERVER_TIMESTAMP,
                            'error': error.to_dict()})
    fail(db.transaction())


def handle(db, job_id, job, *, storage_factory, resolve_identity, run_pipeline, persist_trace):
    """Return an HTTP payload/status; never call the legacy job handler."""
    from gateway.personalized_views import job_result, pick
    if job.get('status') in ('complete', 'failed'):
        return {'ok': True, 'skipped': True}, 200
    uid, player_id = job.get('requestedByUid'), job.get('playerId')
    if not all(isinstance(value, str) and value and '/' not in value for value in (uid, player_id, job_id)):
        fail_unclaimed(db, job_id, GatewayError('invalid_request', 'Invalid request identity'))
        return {'ok': False}, 200
    inv = None
    try:
        identity = resolve_identity(uid)
        inv = Invocation(capability=job['capability'], player_id=player_id, uid=uid,
            email=identity.email, trusted_claims=identity.claims, params=job.get('params') or {},
            job_id=job_id, client_version=job.get('clientVersion'), db=db, storage=storage_factory())
        state = claim(inv)
        if state != 'claimed':
            return {'ok': state == 'terminal', 'skipped': state == 'terminal', 'retry': state == 'busy'}, 200 if state == 'terminal' else 503
        def progress(value):
            update_owned(inv, {'progress': value})
        inv.context['_programProgressCallback'] = progress
        with heartbeat(inv):
            result, usage = run_pipeline(inv)
            # Authority may have changed during assessment/provider execution.
            from gateway.personalized_access import authorize_personalized
            authorize_personalized(inv)
            safe = job_result(inv.capability, result)
            update_owned(inv, {'status': 'complete', 'completedAt': firestore.SERVER_TIMESTAMP,
                'result': safe, 'usage': pick(usage, 'inputTokens outputTokens cachedInputTokens calls estimatedCostUsd wallClockMs')}, terminal=True)
        return {'ok': True}, 200
    except ExecutionLost:
        return {'ok': False, 'retry': True}, 503
    except Exception as exc:
        error = exc if isinstance(exc, GatewayError) else GatewayError('internal', 'The planner could not finish this request. Reconnect or try again.')
        if error.code in ('internal', 'provider_error'):
            error = GatewayError(error.code, 'The planner could not finish this request. Reconnect or try again.')
        try:
            if inv and inv.context.get('_personalizedExecution'):
                update_owned(inv, {'status': 'failed', 'completedAt': firestore.SERVER_TIMESTAMP,
                                  'error': error.to_dict()}, terminal=True)
                persist_trace(db.collection('llmJobs').document(job_id), job_id, inv)
            else:
                fail_unclaimed(db, job_id, error)
        except Exception:
            return {'ok': False, 'retry': True}, 503
        return {'ok': False, 'code': error.code}, 200
