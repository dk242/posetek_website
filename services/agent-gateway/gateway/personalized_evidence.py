"""Authenticated qualification and server-owned conditional evidence for v3.

The six-drill qualification and estimate checks mirror effective-results /
provisional-estimates v4. They never create a metric, score, or measured result.
Client estimate values and client-authored status fields confer no authority.
"""
from collections import Counter
import base64
from functools import lru_cache
import json
import math
from pathlib import Path
import re

from gateway.errors import invalid_request, context_unavailable
from gateway.program_profile import now_for, timestamp, _read

WINDOW_MS = 180 * 86400000
METHODS = {
    'dribbling': ('constant_return_pace_v1', 'ballControl', .75,
        'Maintains the observed return pace to the finish.',
        'Finish was not recorded. This is conditional support; its sensitivity range is not a confidence interval.'),
    'changeOfDirection': ('partial_shuttle_visual_start_v1', 'agility', .60,
        'Uses a visually bracketed start and constant observed pace through the unrecorded return.',
        'Most of the return and finish were not recorded. The wide sensitivity range is not a confidence interval.'),
}
DRILLS = ('shooting', 'sprint', 'jump', 'broadJump', 'changeOfDirection', 'dribbling')
METRICS = {'shooting': ('ballSpeed', 'velocity', 'striking'),
    'sprint': ('sprintCompletionTime', 'totalTime', 'speed'),
    'jump': ('verticalJumpHeight', 'jumpHeight', 'power'),
    'broadJump': ('broadJumpDistance', 'broadJumpDistance', 'power'),
    'changeOfDirection': ('codTotalTime', 'totalTime', 'agility'),
    'dribbling': ('dribbleTotalTime', 'totalTime', 'ballControl')}


def _authorize(inv, read=None):
    if inv.capability == 'generate_training_plan':
        from gateway.workout_persistence import authorize_v3
        return authorize_v3(inv, read=read)
    from gateway.personalized_access import authorize_personalized
    return authorize_personalized(inv, read=read)


def _number(value):
    return type(value) in (int, float) and math.isfinite(value)


def _object(value):
    return value if isinstance(value, dict) else {}


def _id(value, maximum=200):
    return isinstance(value, str) and bool(re.fullmatch(r'[A-Za-z0-9_-]{1,' + str(maximum) + '}', value))


def _millis(value):
    if _number(value):
        return value
    parsed = timestamp(value)
    return round(parsed.timestamp() * 1000) if parsed else None


def _drill(rep):
    value = rep.get('repType') or rep.get('drillType')
    return ('shooting' if value in ('deadballShot', 'side_kick') else value) if isinstance(value, str) else 'unknown'


def _agrees(a, b):
    return _number(a) and _number(b) and abs(a-b) <= max(1e-6, abs(a)*1e-5)


def _folders(player_id, rep, bucket):
    drill = _drill(rep)
    if drill not in DRILLS or not _id(player_id, 128):
        return []
    prefix = f'{player_id}/{"deadballShot" if drill == "shooting" else drill}/'
    path = rep.get('storagePath')
    folders = []
    if path:
        if not isinstance(path, str):
            return []
        if path.startswith('gs://'):
            expected = f'gs://{bucket}/'
            if not path.startswith(expected):
                return []
            path = path[len(expected):]
        if not path.startswith(prefix):
            return []
        match = re.fullmatch(r'(session[1-9]\d*(?:/kick[1-9]\d*(?:/capture_([a-f0-9]{32}))?)?)(?:/[A-Za-z0-9_.-]+\.(?:mov|mp4|json))?/?', path[len(prefix):], re.I)
        if not match or any(x in ('.', '..') for x in path.split('/')):
            return []
        folders.append(prefix + match[1])
        if match[2]:
            return folders if rep.get('captureId', match[2]) == match[2] else []
    if all(type(rep.get(key)) is int and rep[key] > 0 for key in ('sessionNumber', 'repNumber')):
        folders.append(f'{prefix}session{rep["sessionNumber"]}/kick{rep["repNumber"]}')
    return list(dict.fromkeys(folders))


def _identity(context, player_id, rep):
    identity = context.get('rep') if isinstance(context, dict) else None
    if not isinstance(identity, dict):
        return None
    for field, expected in (('repId', rep['id']), ('playerDocId', player_id),
                             ('sessionDocId', rep.get('sessionId')), ('captureId', rep.get('captureId'))):
        if identity.get(field) and expected and identity[field] != expected:
            return False
    return True if identity.get('repId') == rep['id'] and identity.get('playerDocId') == player_id else None


def _duplicates(reps, corrections):
    # Pathless jump mirrors cannot be estimate sources; only the authenticated
    # corrections map can mark a cross-drill movement attempt as a duplicate.
    groups = {}
    for rep in reps:
        if _drill(rep) == 'jump' and all(type(rep.get(k)) is int and rep[k] > 0 for k in ('sessionNumber', 'repNumber')):
            groups.setdefault((rep['sessionNumber'], rep['repNumber']), []).append(rep)
    output = {rep['id'] for group in groups.values() if any(r.get('storagePath') for r in group)
              for rep in group if not rep.get('storagePath')}
    if (not isinstance(corrections, dict) or corrections.get('schemaVersion') != 1
            or not _id(corrections.get('repairId')) or not _number(corrections.get('reviewedAtMillis'))
            or corrections['reviewedAtMillis'] <= 0 or not isinstance(corrections.get('duplicateReps'), dict)):
        return output
    by_id = {r['id']: r for r in reps}; mapping = corrections['duplicateReps']
    for ident, target_id in mapping.items():
        if not isinstance(target_id, str):
            continue
        rep, target = by_id.get(ident), by_id.get(target_id)
        if (rep and target and ident != target_id and rep.get('duplicateOf') == target_id
                and target_id not in mapping and target_id not in output and not target.get('duplicateOf')
                and not (rep.get('playerId') and target.get('playerId') and rep['playerId'] != target['playerId'])):
            output.add(ident)
    return output


def _failure_matches(failure, rep, folders):
    if failure.get('repId') not in (None, ''):
        return failure['repId'] == rep['id']
    if failure.get('sessionDocId') and rep.get('sessionId') and failure['sessionDocId'] != rep['sessionId']:
        return False
    folder = _object(failure.get('storage')).get('repArtifactFolder')
    if isinstance(folder, str) and folder.rstrip('/') in folders:
        return True
    return (_drill({'drillType': failure.get('drillType')}) == _drill(rep) and type(failure.get('repNumber')) is int
            and failure['repNumber'] == rep.get('repNumber') and bool(
                failure.get('sessionDocId') and failure['sessionDocId'] == rep.get('sessionId') or
                type(failure.get('sessionNumber')) is int and failure['sessionNumber'] > 0
                and failure['sessionNumber'] == rep.get('sessionNumber')))


def _primary(rep, drill):
    rep = _object(rep)
    keys = {'shooting': ('velocity',), 'sprint': ('max_velocity', 'maxVelocity'),
        'jump': ('jumpHeight', 'jump_height_m', 'jump_height_in', 'jump_height_inches'),
        'broadJump': ('broadJumpDistance',), 'changeOfDirection': ('totalTime',), 'dribbling': ('totalTime',)}.get(drill, ())
    for key in keys:
        value = rep.get(key)
        if _number(value) and value > 0:
            return value * (.0254 if key in ('jump_height_in', 'jump_height_inches') else 1), key
    return None, None


def _qualified(rep, metadata, context, revision, failures, identity):
    """Port of qualifyRep: accepted revisions, validity, failure chronology."""
    drill = _drill(rep); metric, source_field = _primary(rep, drill)
    if not _number(metric) or metric <= 0 or not isinstance(metadata, dict):
        return False
    meta_metric, _ = _primary(metadata, drill)
    meta_has = _number(meta_metric) and meta_metric > 0
    valid_meta = (metadata.get('resultsValid', True) is True
        and metadata.get('processingStatus', 'complete') == 'complete'
        and metadata.get('failedSteps', []) == [] and (not meta_has or _agrees(metric, meta_metric)))
    admin = _object(rep.get('adminRevision')); rid = admin.get('revisionId')
    revised = bool(rid and rid == _object(metadata.get('adminRevision')).get('revisionId')
        and revision.get('revisionId') == rid and not revision.get('restoredAtMillis')
        and _agrees(_primary(revision.get('fields') or {}, drill)[0], metric)
        and valid_meta and metadata.get('resultsValid') is True
        and metadata.get('processingStatus') == 'complete' and meta_has)
    revision_at = _millis(admin.get('atMillis'))
    for failure in failures:
        at = _millis(failure.get('createdAt') if failure.get('createdAt') is not None else failure.get('createdAtMillis'))
        resolved = failure.get('resolvedAt') or failure.get('resolvedAtMillis') or failure.get('status') in ('resolved', 'superseded', 'dismissed')
        if not resolved and not (revised and at is not None and revision_at is not None and at <= revision_at):
            return False
    result = context.get('result') if isinstance(context, dict) else None
    result = result if isinstance(result, dict) else {}
    side_metric = result.get('primaryMetric')
    root_valid = rep.get('resultsValid', True) is True and rep.get('processingStatus', 'complete') == 'complete' and rep.get('failedSteps', []) == []
    side_agrees = not _number(side_metric) or _agrees(metric, side_metric) or (
        source_field in ('jump_height_in', 'jump_height_inches') and _agrees(metric, side_metric*.0254))
    return valid_meta and (revised or (identity is not False and root_valid and result.get('resultsValid') is True and side_agrees))


def read_authoritative_results(inv, *, read=None):
    """Read current qualified identities and dates, never a client validity flag."""
    _authorize(inv, read)
    load = lambda ref: _read(ref, read)
    corrections = load(inv.player_ref().collection('insightMetadata').document('resultCorrections')).to_dict() or {}
    reps = sorted([{**(s.to_dict() or {}), 'id': s.id} for s in load(inv.player_ref().collection('reps'))], key=lambda r: r['id'])
    failures = sorted([{**(s.to_dict() or {}), 'id': s.id} for s in load(inv.db.collection('failureCases').where('playerDocumentID', '==', inv.player_id))], key=lambda r: r['id'])
    if len(reps) > 20000 or len(failures) > 5000:
        raise context_unavailable('Too much testing evidence to verify this assessment')
    duplicates = _duplicates(reps, corrections)
    cache = {}; rows = []; revisions = {}
    def json_at(path):
        if path not in cache:
            try:
                cache[path] = inv.storage.read_evidence_json(path)
            except FileNotFoundError:
                cache[path] = None
        return cache[path]
    for rep in reps:
        drill = _drill(rep)
        if drill not in DRILLS:
            continue
        row = {'id': rep['id'], 'drill': drill, 'qualified': False, 'duplicate': rep['id'] in duplicates,
               'createdAtMillis': _millis(rep.get('createdAt')), 'storageFolder': None, 'primaryValue': None, 'raw': rep}
        rows.append(row)
        if row['duplicate']:
            continue
        folders = _folders(inv.player_id, rep, inv.storage.bucket_name)
        folder = folders[0] if folders else None; meta = context = None
        for candidate in folders:
            m, c = json_at(candidate + '/metadata.json'), json_at(candidate + '/reprocess_context.json')
            if m or c:
                folder, meta, context = candidate, m, c
                break
        identity = _identity(context, inv.player_id, rep)
        collision = any(other['id'] != rep['id'] and other['id'] not in duplicates and _drill(other) == _drill(rep)
                        and folder in _folders(inv.player_id, other, inv.storage.bucket_name) for other in reps) if folder else False
        resolved = folder if identity is not False and (identity is True or not collision) else None
        revision = {}; rid = _object(rep.get('adminRevision')).get('revisionId')
        if _id(rid, 80):
            revision = load(inv.player_ref().collection('reps').document(rep['id']).collection('revisions').document(rid)).to_dict() or {}
            revisions[rep['id']] = revision
        valid = _qualified(rep, meta, context, revision, [f for f in failures if _failure_matches(f, rep, folders)], identity)
        field = METRICS[drill][1]
        # Match effectiveRep: an explicit null on the canonical rep stays null.
        value = (_primary(rep, drill)[0] if drill == 'jump' else
                 rep[field] if field in rep else _object(meta).get(field))
        row.update(qualified=valid, storageFolder=resolved,
                   primaryValue=value if valid and _number(value) and value > 0 else None)
    benchmark = load(inv.db.collection('benchmarks').document('d1')).to_dict() or {}
    _authorize(inv, read)
    return {'rows': rows, 'private': {'reps': reps, 'corrections': corrections, 'failures': failures,
            'artifacts': cache, 'revisions': revisions, 'benchmark': benchmark}}


def read_estimates(inv, *, read=None, evidence=None):
    """Read-only opt-in. Native v3 uses reviewed conditional evidence by default."""
    _authorize(inv, read)
    enabled = inv.params.get('useProvisionalEstimates', inv.capability == 'generate_training_plan')
    if type(enabled) is not bool:
        raise invalid_request('useProvisionalEstimates must be boolean')
    if not enabled:
        return [], {}
    load = lambda ref: _read(ref, read)
    doc = load(inv.player_ref().collection('insightMetadata').document('provisionalEstimates')).to_dict() or {}
    private = {'document': doc, 'sources': {}}
    entries = doc.get('entries')
    if doc.get('schemaVersion') != 1 or doc.get('playerId') != inv.player_id or not isinstance(entries, list) or len(entries) > 20:
        return [], private
    evidence = evidence or read_authoritative_results(inv, read=read)
    rows = evidence['rows']; by_id = {row['id']: row for row in rows}
    measured = {row['drill'] for row in rows if row['qualified'] and not row['duplicate']}
    duplicates = {row['id'] for row in rows if row['duplicate']}
    ids = Counter(e.get('id') for e in entries if isinstance(e, dict) and isinstance(e.get('id'), str))
    rep_ids = Counter(e.get('repId') for e in entries if isinstance(e, dict) and isinstance(e.get('repId'), str))
    now = round(now_for(inv).timestamp() * 1000); output = []
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        drill = entry.get('drill'); method = METHODS.get(drill) if isinstance(drill, str) else None
        if (not method or drill in measured or not _id(entry.get('id')) or not _id(entry.get('repId'))
                or ids[entry['id']] != 1 or rep_ids[entry['repId']] != 1 or entry['repId'] in duplicates
                or entry.get('status') != 'active' or entry.get('axis') != method[1]
                or entry.get('kind') != 'conditionalEstimate' or entry.get('method') != method[0]
                or entry.get('confidence') != 'low' or not _id(entry.get('reviewedByUid'))):
            continue
        if drill == 'changeOfDirection' and (entry.get('protocolConfirmed') is not True or entry.get('startBoundary') != 'visualBracket'):
            continue
        low, point, high, fraction = [entry.get(k) for k in ('lowerSeconds', 'estimatedTotalSeconds', 'upperSeconds', 'observedCourseFraction')]
        if (not all(_number(n) and 2 <= n <= 60 for n in (low, point, high)) or not low <= point <= high or low == high
                or not _number(fraction) or not method[2] <= fraction < 1):
            continue
        at, reviewed = entry.get('recordedAtMillis'), entry.get('reviewedAtMillis')
        if type(at) is not int or type(reviewed) is not int or not 0 < at <= reviewed <= now or at < now-WINDOW_MS:
            continue
        current = by_id.get(entry['repId']) or {}; rep = current.get('raw')
        valid, folder = current.get('qualified', True), current.get('storageFolder')
        if (not rep or valid or not folder or _drill(rep) != drill or rep.get('drillType', drill) != drill
                or _millis(rep.get('createdAt')) != at):
            continue
        source = entry.get('source')
        if (not isinstance(source, dict) or source.get('playerId') != inv.player_id or source.get('repId') != entry['repId']
                or source.get('drill') != drill or source.get('recordedAtMillis') != at
                or not isinstance(source.get('storagePath'), str) or source['storagePath'] != rep.get('storagePath')
                or not source['storagePath'].startswith(folder + '/')
                or not re.fullmatch(r'[A-Za-z0-9_.-]+\.(?:mov|mp4)', source['storagePath'][len(folder)+1:], re.I)
                or not isinstance(source.get('generation'), str) or not re.fullmatch(r'[1-9][0-9]{0,30}', source['generation'])
                or not isinstance(source.get('md5Hash'), str) or not re.fullmatch(r'[A-Za-z0-9+/]{22}==', source['md5Hash'])
                or base64.b64encode(base64.b64decode(source['md5Hash'])).decode() != source['md5Hash']
                or not isinstance(source.get('sha256'), str) or not re.fullmatch(r'[a-f0-9]{64}', source['sha256'])):
            continue
        try:
            meta = inv.storage.object_metadata(source['storagePath'])
        except FileNotFoundError:
            continue
        private['sources'][entry['id']] = meta
        if str(meta.get('generation')) != source['generation'] or meta.get('md5Hash') != source['md5Hash']:
            continue
        output.append({k: entry[k] for k in ('id', 'repId', 'drill', 'axis', 'kind', 'method', 'estimatedTotalSeconds',
                      'lowerSeconds', 'upperSeconds', 'observedCourseFraction', 'recordedAtMillis', 'reviewedAtMillis', 'confidence')})
        output[-1].update(assumption=method[3], limitation=method[4])
    output.sort(key=lambda e: (-e['reviewedAtMillis'], e['id']))
    private['accepted'] = output
    # Fresh source pointers are already read within a transaction at activation;
    # at assessment/generation, reauthorize again before retaining projections.
    _authorize(inv, read)
    return output, private


@lru_cache(maxsize=1)
def bundled_anchors():
    return json.loads((Path(__file__).resolve().parents[1] / 'knowledge/planner_primary_anchors_v2.json').read_text())


def reconcile_best_results(inv, profile, evidence):
    """Keep supplied scores only when current results and known anchors agree.

    Native serialization rounds raw values/anchors to four decimals and scores
    to two. The gateway does not rescore a stale or unknown client snapshot.
    """
    snapshot = inv.params.get('statsProfile') or {}; bp = snapshot.get('benchmarkProfile') or {}
    cell = f'{bp.get("ageBand")}|{bp.get("gender")}'
    bundled = bundled_anchors(); live = evidence['private'].get('benchmark') or {}
    dataset = live if live.get('schemaVersion') == 1 and type(live.get('generation')) is int and live['generation'] >= bundled['generation'] and isinstance(live.get('cells'), dict) else bundled
    anchors = _object(dataset.get('cells', {}).get(cell))
    original = {m.get('metric'): m for d in snapshot.get('drills', []) for m in d.get('metrics', [])}
    now = round(now_for(inv).timestamp()*1000); accepted = {}; dates = []
    for mid, value in profile.get('bestResults', {}).items():
        drill = next(d for d, spec in METRICS.items() if spec[0] == mid)
        eligible = [r for r in evidence['rows'] if r['drill'] == drill and r['qualified'] and not r['duplicate']
                    and r['primaryValue'] is not None and _number(r['createdAtMillis']) and now-WINDOW_MS <= r['createdAtMillis'] <= now]
        candidates = [r['primaryValue'] for r in eligible]
        best = (min(candidates) if mid.endswith('Time') else max(candidates)) if candidates else None
        anchor = anchors.get(mid)
        reference = _object(anchor.get('percentiles')).get('p50') if isinstance(anchor, dict) else anchor
        supplied = original.get(mid, {}).get('referenceCanonical')
        aligned = best is not None and abs(best-value['bestCanonical']) <= max(.000051, abs(best)*1e-5)
        score = min(400., 100*(reference/best if mid.endswith('Time') else best/reference)) if aligned and _number(reference) and reference > 0 else None
        if (not aligned or score is None or abs(score-value['score']) > .03
                or supplied is not None and (not _number(supplied) or abs(reference-supplied) > .000051)):
            profile['dataGaps'].append(f'{mid}: supplied best result or score could not be reconciled with recent qualified recordings and a known benchmark cell; no measured priority was inferred.')
            continue
        matching = [r for r in eligible if abs(r['primaryValue']-best) <= max(.000051, abs(best)*1e-5)]
        accepted[mid] = {**value, 'bestCanonical': best, 'repCount': len(eligible),
                         'source': 'qualified_server_result', 'referenceCanonical': reference,
                         'benchmarkGeneration': dataset['generation'], 'lastRecordedAtMillis': max(r['createdAtMillis'] for r in matching)}
        dates.extend(r['createdAtMillis'] for r in matching)
    profile['bestResults'] = accepted
    return dates
