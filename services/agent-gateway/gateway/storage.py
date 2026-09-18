"""`ArtifactStore` — the Storage facade tools read pose artifacts through.

Two things needed a Storage client and wanted different shapes from it: the job
handler uploads an oversized result (bucket/blob, and it knows its own bucket),
while `tools.fetch_pose_artifact` wants "give me the JSON at this athlete-
relative path" and has no business knowing which bucket that is. Handing the raw
`google.cloud.storage.Client` to both made the second one's call site wrong.

So the raw client stays where a bucket is explicit, and `Invocation.storage` gets
this instead: one method, path-relative to the app's upload bucket, raising
`FileNotFoundError` for a missing object so callers can turn that into a clean
`invalid_request` rather than a 500.

The bucket default matches the Firebase Storage bucket the app uploads to and
that Standard-processor already hardcodes; `POSETEK_STORAGE_BUCKET` overrides it
for staging.
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any

log = logging.getLogger("gateway.storage")

DEFAULT_BUCKET = "kickai-69dd0.firebasestorage.app"

# Pose artifacts are landmark series; a genuinely large one is a bug, and
# decimation happens *after* the download, so this is the guard that keeps a
# pathological object from becoming a memory incident.
MAX_ARTIFACT_BYTES = 32 * 1024 * 1024


def artifact_bucket_name() -> str:
    return os.environ.get("POSETEK_STORAGE_BUCKET", DEFAULT_BUCKET).strip() or DEFAULT_BUCKET


class ArtifactStore:
    """Read JSON artifacts and create private immutable generation evidence."""

    def __init__(self, client: Any, bucket_name: str | None = None):
        self._client = client
        self._bucket_name = bucket_name or artifact_bucket_name()
        self._bucket = None
        self._context_bucket_name = os.environ.get('TRAINING_CONTEXT_BUCKET', '').strip() or self._bucket_name
        self._context_bucket = None

    @property
    def bucket_name(self) -> str:
        return self._bucket_name

    def _get_bucket(self):
        if self._bucket is None:
            self._bucket = self._client.bucket(self._bucket_name)
        return self._bucket

    def object_metadata(self, path: str) -> dict:
        """Read immutable source identity without downloading an athlete movie."""
        from google.api_core.exceptions import NotFound
        blob = self._get_bucket().blob(path)
        try:
            blob.reload()
        except NotFound as exc:
            raise FileNotFoundError(path) from exc
        return {'generation': str(blob.generation), 'md5Hash': blob.md5_hash,
                'size': blob.size}

    def read_evidence_json(self, path: str) -> Any:
        """Small processing evidence, pinned to the generation just inspected."""
        meta = self.object_metadata(path)
        if not isinstance(meta['size'], int) or not 0 <= meta['size'] <= 2 * 1024 * 1024:
            raise ValueError('Processing evidence exceeds its size limit')
        blob = self._get_bucket().blob(path, generation=int(meta['generation']))
        raw = blob.download_as_bytes()
        if len(raw) > 2 * 1024 * 1024:
            raise ValueError('Processing evidence exceeds its size limit')
        try:
            return json.loads(raw)
        except (ValueError, UnicodeError):
            return None

    def download_json(self, path: str) -> Any:
        """Fetch and parse the JSON object at a bucket-relative `path`.

        Raises `FileNotFoundError` when the object is absent — the one failure
        mode callers are expected to handle, because a rep can legitimately
        predate the artifact kind being asked for.
        """
        clean = path.lstrip('/')
        blob = self._get_bucket().blob(clean)
        if clean.startswith('trainingPlanContexts/') and self._context_bucket_name != self._bucket_name:
            candidate = self._get_context_bucket().blob(clean)
            if candidate.exists():
                blob = candidate
        if not blob.exists():
            raise FileNotFoundError(path)

        blob.reload()
        size = blob.size or 0
        if size > MAX_ARTIFACT_BYTES:
            raise ValueError(f"Artifact {path} is {size} bytes, over the {MAX_ARTIFACT_BYTES} limit")

        raw = blob.download_as_bytes()
        try:
            return json.loads(raw)
        except json.JSONDecodeError as exc:
            # A corrupt artifact is indistinguishable from a missing one as far
            # as the model is concerned, but it is worth a log line.
            log.warning("artifact %s is not valid JSON: %s", path, exc)
            raise FileNotFoundError(path) from exc


    def _get_context_bucket(self):
        if self._context_bucket_name == self._bucket_name:
            return self._get_bucket()
        if self._context_bucket is None:
            self._context_bucket = self._client.bucket(self._context_bucket_name)
        return self._context_bucket

    def upload_immutable_json(self, path: str, value: Any) -> None:
        """Create a private, content-addressed generation artifact without overwrites."""
        import hashlib
        from datetime import datetime
        from google.api_core.exceptions import PreconditionFailed
        if not path.startswith("trainingPlanContexts/") or ".." in path.split("/"):
            raise ValueError("Only private generation context artifacts may be written")
        def encode(v):
            if isinstance(v, datetime):
                return v.isoformat()
            raise TypeError(type(v).__name__)
        raw = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=encode).encode("utf-8")
        if len(raw) > MAX_ARTIFACT_BYTES:
            raise ValueError("Generation context exceeds the artifact limit")
        digest = hashlib.sha256(raw).hexdigest()
        if path.rsplit("/", 1)[-1] != digest + ".json":
            raise ValueError("Generation artifact path must match its SHA-256 content")
        blob = self._get_context_bucket().blob(path)
        try:
            blob.upload_from_string(raw, content_type="application/json", if_generation_match=0)
        except PreconditionFailed:
            # A retry may encounter the same immutable bytes; a collision/corruption
            # must fail loudly, never overwrite original evidence.
            if blob.download_as_bytes() != raw:
                raise ValueError("Existing immutable artifact has different content")
