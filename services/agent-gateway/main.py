# main.py — Cloud Run entry-point for the LLM agent gateway.
#
# Implements docs/LLM_GATEWAY_CONTRACT.md (PoseTek-mobile-app repo):
#   GET  /health          liveness/readiness
#   POST /v1/jobs/handle   Eventarc trigger for llmJobs/{jobId} document.created (Transport A)
#   POST /v1/chat/stream   ID-token + App-Check authenticated SSE chat (Transport B)
#
# Shape matches Services/Standard-processor/main.py in this repo: Flask app,
# `python main.py` entrypoint, PORT env var, no gunicorn — one backend
# toolchain across the Cloud Run processors (plan Part 9, batch B0).

from __future__ import annotations

import json
import logging
import os
import queue
import threading
from typing import Any, Optional

from flask import Flask, Response, jsonify, request, stream_with_context
from google.cloud import firestore

from gateway.authz import verify_request, resolve_job_identity
from gateway.ctx import Invocation
from gateway.errors import GatewayError
from gateway.pipeline import run_job_capability, run_stream_capability
from gateway.storage import ArtifactStore

logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"))
log = logging.getLogger("gateway.main")

app = Flask(__name__)

_INLINE_RESULT_LIMIT_BYTES = 400 * 1024  # contract §2: "Inline when < 400 KB"

_db = None
_storage = None
_artifact_store = None


def _firestore_client():
    global _db
    if _db is None:
        _db = firestore.Client()
    return _db


def _storage_client():
    global _storage
    if _storage is None:
        from google.cloud import storage

        _storage = storage.Client()
    return _storage


def _artifact_store_client():
    """What `Invocation.storage` is: a path-relative JSON reader, not a raw
    bucket client. Tools ask for an athlete's artifact by path and must not have
    to know which bucket it lives in."""
    global _artifact_store
    if _artifact_store is None:
        _artifact_store = ArtifactStore(_storage_client())
    return _artifact_store


# ---------------------------------------------------------------------------
# CORS (contract §11: ALLOWED_ORIGINS is for the web app "when it lands" —
# there is no web caller yet, so this is a minimal allowlist echo, not a full
# preflight implementation).
# ---------------------------------------------------------------------------


@app.after_request
def _apply_cors(response):
    allowed = os.environ.get("ALLOWED_ORIGINS", "")
    if not allowed:
        return response
    origin = request.headers.get("Origin")
    allowed_origins = {o.strip() for o in allowed.split(",") if o.strip()}
    if origin and origin in allowed_origins:
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Access-Control-Allow-Headers"] = "Authorization, X-Firebase-AppCheck, Content-Type"
        response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    return response


# ---------------------------------------------------------------------------
# GET /health
# ---------------------------------------------------------------------------


@app.route("/health", methods=["GET"])
def health():
    # NOT `/healthz`, however conventional that is: Google's frontend swallows
    # that exact path on *.run.app and answers it with its own branded 404, so
    # the request never reaches this process. Verified 2026-08-02 — `/healthz`
    # was intercepted while `/healthz2`, `/health`, and every other path
    # reached Flask normally. Renaming this back will silently break liveness
    # checks in a way the logs cannot show you, because nothing arrives.
    return jsonify({"ok": True, "version": os.environ.get("GATEWAY_VERSION", "dev")})


# ---------------------------------------------------------------------------
# POST /v1/jobs/handle — Transport A
# ---------------------------------------------------------------------------


def _extract_job_id(payload: dict, headers) -> Optional[str]:
    """Parses the Eventarc Firestore `document.created` payload defensively:

    - Local/manual testing: `{"jobId": "..."}`.
    - Eventarc "binary content mode" (the Cloud Run push default): the HTTP
      body *is* the protobuf-JSON `DocumentEventData`, i.e.
      `{"value": {"name": "projects/P/databases/(default)/documents/llmJobs/abc123", ...}}`.
    - Fallback: the `ce-subject` CloudEvent header, which Eventarc sets to
      `documents/llmJobs/{jobId}` regardless of body shape.

    We deliberately don't parse `value.fields` (protobuf-JSON's per-type
    wrapper encoding is easy to get subtly wrong) — the job id is all we need
    from the event; the handler re-reads the document fresh from Firestore.
    """
    if isinstance(payload, dict):
        if isinstance(payload.get("jobId"), str) and payload["jobId"]:
            return payload["jobId"]

        value = payload.get("value")
        if not isinstance(value, dict):
            data = payload.get("data")
            value = data.get("value") if isinstance(data, dict) else None
        name = value.get("name") if isinstance(value, dict) else payload.get("name")
        if isinstance(name, str) and name:
            return name.rstrip("/").split("/")[-1]

    subject = headers.get("ce-subject") or headers.get("Ce-Subject")
    if isinstance(subject, str) and subject:
        return subject.rstrip("/").split("/")[-1]

    return None


def _fail_job(job_ref, error: GatewayError) -> None:
    """Writes the terminal `failed` state. Wrapped in its own try/except so a
    Firestore write failure here doesn't propagate and somehow leave the
    caller thinking a retry is warranted — the job doc is the source of
    truth and we've done everything short of appending to Firestore itself.
    """
    try:
        job_ref.update(
            {
                "status": "failed",
                "completedAt": firestore.SERVER_TIMESTAMP,
                "error": error.to_dict(),
            }
        )
    except Exception:
        log.exception("failed to write failed-status update for job %s", getattr(job_ref, "id", "?"))


def _persist_trace(job_ref, job_id: str, inv: Invocation) -> None:
    """Best-effort upload of the job's decision trail (`inv.trace`: per-stage
    prompt/thoughts/output Q&A records) to the artifact bucket, with a
    `traceRef` pointer on the job doc. Debug-only and additive: any failure
    here is logged and swallowed — it must never change the job's outcome."""
    try:
        if not inv.trace:
            return
        is_v3 = inv.capability in {"apply_workout_draft", "workout_chat", "generate_personalized_plan", "activate_personalized_plan", "discard_personalized_plan", "assess_personalized_plan"} or (
            inv.capability == "generate_training_plan" and inv.params.get("planVersion") == 3)
        if is_v3:
            # Successful v3 calls are part of immutable private generation evidence.
            # Failed calls have no plan context, so preserve their diagnostic trace
            # under the same admin-only Storage prefix, never on a client job field.
            if (inv.context.get("_programResult") or {}).get("generationContextRef"):
                return
            import hashlib
            payload = {"jobId": job_id, "capability": inv.capability,
                       "playerId": inv.player_id, "records": inv.trace,
                       "salvage": inv.salvage}
            raw = json.dumps(payload, ensure_ascii=False, sort_keys=True,
                             separators=(",", ":"), default=_json_transport_default).encode("utf-8")
            digest = hashlib.sha256(raw).hexdigest()
            failure_id = "failed-" + hashlib.sha256(job_id.encode()).hexdigest()[:28]
            path = f"trainingPlanContexts/{inv.player_id}/{failure_id}/{digest}.json"
            inv.storage.upload_immutable_json(path, payload)
            return
        bucket_name = os.environ.get("LLM_ARTIFACT_BUCKET")
        if not bucket_name:
            log.warning("job %s: trace captured but LLM_ARTIFACT_BUCKET is not set", job_id)
            return
        payload = json.dumps(
            {
                "jobId": job_id,
                "capability": inv.capability,
                "playerId": inv.player_id,
                "records": inv.trace,
                "salvage": inv.salvage,
            },
            default=str,
        ).encode("utf-8")
        blob_path = f"llmJobs/{job_id}/trace.json"
        blob = _storage_client().bucket(bucket_name).blob(blob_path)
        blob.upload_from_string(payload, content_type="application/json")
        job_ref.update({"traceRef": f"gs://{bucket_name}/{blob_path}"})
    except Exception:
        log.exception("job %s: failed to persist trace", job_id)


def _json_transport_default(value):
    # Firestore stores native timestamps; Storage JSON and SSE use ISO-8601.
    from datetime import datetime, date
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    raise TypeError(f"Cannot serialize {type(value).__name__}")


def _complete_job(job_ref, job_id: str, result: dict, usage_map: dict, *, progress=None) -> None:
    """Writes the terminal `complete` state, inlining `result` under 400 KB
    (contract §2) and otherwise uploading to `LLM_ARTIFACT_BUCKET` with a
    `gs://` `resultRef`.
    """
    payload = json.dumps(result, default=_json_transport_default).encode("utf-8")
    update: dict[str, Any] = {
        "status": "complete",
        "completedAt": firestore.SERVER_TIMESTAMP,
        "usage": usage_map,
    }
    if progress is not None:
        update["progress"] = {**progress, "stage": "complete", "fraction": 1.0,
                              "completedWorkouts": progress["totalWorkouts"], "detail": "Your program is ready"}
    if len(payload) < _INLINE_RESULT_LIMIT_BYTES:
        update["result"] = result
    else:
        bucket_name = os.environ.get("LLM_ARTIFACT_BUCKET")
        if not bucket_name:
            raise GatewayError("internal", "Result exceeds inline limit and LLM_ARTIFACT_BUCKET is not configured")
        blob_path = f"llmJobs/{job_id}/result.json"
        blob = _storage_client().bucket(bucket_name).blob(blob_path)
        blob.upload_from_string(payload, content_type="application/json")
        update["resultRef"] = f"gs://{bucket_name}/{blob_path}"
    job_ref.update(update)


@app.route("/v1/jobs/handle", methods=["POST"])
def handle_job():
    payload = request.get_json(silent=True) or {}
    job_id = _extract_job_id(payload, request.headers)
    if not job_id:
        log.error("jobs/handle: could not extract a jobId from the trigger payload")
        # 200: nothing about this shape will become extractable on redelivery.
        return jsonify({"ok": False, "error": "missing jobId"}), 200

    db = _firestore_client()
    job_ref = db.collection("llmJobs").document(job_id)
    job_snap = job_ref.get()
    if not job_snap.exists:
        log.error("jobs/handle: job %s not found", job_id)
        return jsonify({"ok": False, "error": "job not found"}), 200

    job = job_snap.to_dict() or {}

    from gateway.personalized_access import CAPABILITIES as PERSONALIZED_CAPABILITIES
    if job.get('capability') in PERSONALIZED_CAPABILITIES:
        from gateway.personalized_jobs import handle
        payload, status = handle(db, job_id, job, storage_factory=_artifact_store_client,
            resolve_identity=lambda uid: resolve_job_identity(uid, include_provider=True),
            run_pipeline=run_job_capability, persist_trace=_persist_trace)
        return jsonify(payload), status

    # Eventarc is at-least-once; a redelivered or already-processed event
    # should be a no-op, not a second run against a job already in flight.
    if job.get("status") not in (None, "pending"):
        log.info("jobs/handle: job %s already status=%s, skipping", job_id, job.get("status"))
        return jsonify({"ok": True, "skipped": True}), 200

    requested_by_uid = job.get("requestedByUid")
    capability = job.get("capability")
    player_id = job.get("playerId")
    if not requested_by_uid or not capability or not player_id:
        log.error("jobs/handle: job %s missing required fields", job_id)
        _fail_job(job_ref, GatewayError("invalid_request", "Job doc is missing requestedByUid/capability/playerId"))
        return jsonify({"ok": False}), 200

    try:
        from gateway.personalized_plans import engine_for,CAPABILITIES
        version = engine_for(capability,(job.get('params') or {}).get('engineVersion')) if capability in (*CAPABILITIES,'generate_training_plan') else None
        pinned = job.get('engineVersion')
        if pinned is not None and pinned != version:
            _fail_job(job_ref,GatewayError('invalid_request','Pinned engine version is unavailable'))
            return jsonify({'ok':False}),200
        job_ref.update({"status": "running", "startedAt": firestore.SERVER_TIMESTAMP,**({'engineVersion':version} if version else {})})
    except GatewayError as exc:
        _fail_job(job_ref,exc)
        return jsonify({'ok':False,'code':exc.code}),200
    except Exception:
        log.exception("jobs/handle: failed to flip job %s to running", job_id)
        return jsonify({"ok": False}), 500  # infrastructure fault — worth a redelivery

    inv = Invocation(
        capability=capability,
        player_id=player_id,
        uid=requested_by_uid,
        email=job.get("requestedByEmail"),
        params=job.get("params") or {},
        job_id=job_id,
        client_version=job.get("clientVersion"),
        db=db,
        storage=_artifact_store_client(),
        log=logging.getLogger(f"gateway.job.{job_id}"),
    )
    latest_progress = None
    if capability in ("generate_training_plan","generate_personalized_plan"):
        def publish_progress(progress):
            nonlocal latest_progress
            latest_progress = dict(progress)
            try:
                job_ref.update({"progress": latest_progress})
            except Exception:
                # Progress is observational: a transient write failure must not
                # cancel a valid program. A later milestone replaces this one.
                log.warning("job %s: progress update unavailable", job_id)
        inv.context["_programProgressCallback"] = publish_progress

    try:
        # Every asynchronous capability needs authoritative account claims:
        # legacy report/chat policy also supports verified staff under strict
        # authorization. Client requestedByEmail never grants that authority.
        identity = resolve_job_identity(requested_by_uid)
        inv.email = identity.email
        inv.trusted_claims = identity.claims
        result, usage_map = run_job_capability(inv)
    except GatewayError as exc:
        log.warning("job %s capability=%s failed code=%s: %s", job_id, capability, exc.code, exc.message)
        _fail_job(job_ref, exc)
        _persist_trace(job_ref, job_id, inv)
        return jsonify({"ok": False, "code": exc.code}), 200
    except Exception as exc:  # noqa: BLE001 - deliberate catch-all: never leave a job "running"
        log.exception("job %s capability=%s failed unexpectedly", job_id, capability)
        _fail_job(job_ref, GatewayError("internal", str(exc)))
        _persist_trace(job_ref, job_id, inv)
        return jsonify({"ok": False}), 200

    _persist_trace(job_ref, job_id, inv)

    try:
        _complete_job(job_ref, job_id, result, usage_map, progress=latest_progress)
    except Exception as exc:  # noqa: BLE001 - same rule: a persistence failure still must not leave "running"
        log.exception("job %s: failed to persist terminal state", job_id)
        _fail_job(job_ref, GatewayError("internal", f"Result persistence failed: {exc}"))
        return jsonify({"ok": False}), 200

    return jsonify({"ok": True}), 200


# ---------------------------------------------------------------------------
# POST /v1/chat/stream — Transport B
# ---------------------------------------------------------------------------

_HEARTBEAT_SECONDS = 15
_STREAM_DONE = object()


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, default=_json_transport_default)}\n\n"


@app.route("/v1/chat/stream", methods=["POST"])
def chat_stream():
    try:
        auth_ctx = verify_request(request.headers)
    except GatewayError as exc:
        return jsonify(exc.to_dict()), exc.http_status

    body = request.get_json(silent=True) or {}
    schema_version = body.get("schemaVersion")
    if schema_version not in (None, 1):
        exc = GatewayError("invalid_request", f"Unsupported schemaVersion: {schema_version!r}")
        return jsonify(exc.to_dict()), exc.http_status

    capability = body.get("capability")
    player_id = body.get("playerId")
    message = body.get("message")
    if not capability or not player_id or not message:
        exc = GatewayError("invalid_request", "capability, playerId, and message are required")
        return jsonify(exc.to_dict()), exc.http_status

    conversation_id = body.get("conversationId")
    # Optional rep anchor (contract §3): rep-aware chat capabilities (kick_chat)
    # require it via their assemblers; capabilities that don't read it ignore it.
    rep_id = body.get("repId")
    if rep_id is not None and not isinstance(rep_id, str):
        exc = GatewayError("invalid_request", "repId must be a string when present")
        return jsonify(exc.to_dict()), exc.http_status
    inv = Invocation(
        capability=capability,
        player_id=player_id,
        uid=auth_ctx.uid,
        email=auth_ctx.email,
        trusted_claims=auth_ctx.claims,
        params={"message": message, "conversationId": conversation_id, "repId": rep_id,
                **({"context": body["context"]} if "context" in body else {})},
        conversation_id=conversation_id,
        client_version=body.get("clientVersion"),
        db=_firestore_client(),
        storage=_artifact_store_client(),
        log=logging.getLogger(f"gateway.stream.{player_id}"),
    )

    def _worker(q: "queue.Queue"):
        try:
            for event in run_stream_capability(inv):
                q.put(("event", event))
        except GatewayError as exc:
            q.put(("gateway_error", exc))
        except Exception as exc:  # noqa: BLE001 - mid-stream error becomes an `error` event, never a 500
            log.exception("chat_stream: unexpected error")
            q.put(("error", exc))
        finally:
            q.put((_STREAM_DONE, None))

    def _generate():
        q: "queue.Queue" = queue.Queue()
        # The pipeline runs on a worker thread so this generator can keep
        # polling the queue with a timeout and emit `: ping` heartbeats
        # (contract §3) even while a model call is blocked — a plain
        # synchronous generator has no way to interleave a 15s timer with a
        # network call it's waiting on.
        thread = threading.Thread(target=_worker, args=(q,), daemon=True)
        thread.start()

        while True:
            try:
                kind, item = q.get(timeout=_HEARTBEAT_SECONDS)
            except queue.Empty:
                yield ": ping\n\n"
                continue

            if kind is _STREAM_DONE:
                return
            if kind == "gateway_error":
                yield _sse("error", item.to_dict())
                return
            if kind == "error":
                yield _sse("error", {"code": "internal", "message": str(item)})
                return

            event = dict(item)
            etype = event.pop("type", None)
            if etype == "persisted":
                continue  # internal signal from the pipeline, not part of the wire contract
            if etype is None:
                continue
            yield _sse(etype, event)

    return Response(
        stream_with_context(_generate()),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    app.run(host="0.0.0.0", port=port)
