"""Tests for `ArtifactStore`, the real `Invocation.storage`.

These exist because of a bug the rest of the suite could not have caught: the
tool handlers were written against a `download_json(path)` facade, `main.py`
injected a raw `google.cloud.storage.Client` (which has no such method), and
every test passed because `conftest.FakeStorage` implemented the facade. A fake
that is more capable than the real thing tests nothing.

So the last test here is the important one: it asserts the fake and the real
implementation expose the same surface, which is what stops them drifting apart
again.
"""

from __future__ import annotations

import json

import pytest

from gateway.storage import MAX_ARTIFACT_BYTES, ArtifactStore, artifact_bucket_name
from tests.conftest import FakeStorage


class _FakeBlob:
    def __init__(self, payload: bytes | None, size: int | None = None):
        self._payload = payload
        self.size = size if size is not None else (len(payload) if payload else 0)

    def exists(self) -> bool:
        return self._payload is not None

    def reload(self) -> None:
        pass

    def download_as_bytes(self) -> bytes:
        assert self._payload is not None
        return self._payload


class _FakeBucket:
    def __init__(self, blobs: dict[str, _FakeBlob]):
        self._blobs = blobs
        self.requested_paths: list[str] = []

    def blob(self, path: str) -> _FakeBlob:
        self.requested_paths.append(path)
        return self._blobs.get(path, _FakeBlob(None))


class _FakeGCSClient:
    def __init__(self, blobs: dict[str, _FakeBlob]):
        self.bucket_obj = _FakeBucket(blobs)
        self.requested_buckets: list[str] = []

    def bucket(self, name: str) -> _FakeBucket:
        self.requested_buckets.append(name)
        return self.bucket_obj


def _store(blobs: dict[str, _FakeBlob], bucket: str = "test-bucket") -> tuple[ArtifactStore, _FakeGCSClient]:
    client = _FakeGCSClient(blobs)
    return ArtifactStore(client, bucket_name=bucket), client


def test_download_json_parses_the_object():
    payload = json.dumps([{"frameIndex": 0}, {"frameIndex": 1}]).encode()
    store, _ = _store({"player1/sprint/session1/kick1/pose.json": _FakeBlob(payload)})

    assert store.download_json("player1/sprint/session1/kick1/pose.json") == [
        {"frameIndex": 0},
        {"frameIndex": 1},
    ]


def test_missing_object_raises_file_not_found():
    # The one failure the tool handlers catch and turn into `invalid_request`:
    # a rep can legitimately predate an artifact kind.
    store, _ = _store({})
    with pytest.raises(FileNotFoundError):
        store.download_json("player1/jump/session1/kick1/pose.json")


def test_corrupt_json_is_reported_as_missing_rather_than_crashing():
    store, _ = _store({"a/b.json": _FakeBlob(b"{not json")})
    with pytest.raises(FileNotFoundError):
        store.download_json("a/b.json")


def test_oversized_artifact_is_refused_before_download():
    # Decimation happens after the download, so the size guard is what keeps a
    # pathological object from becoming a memory incident.
    store, _ = _store({"a/b.json": _FakeBlob(b"[]", size=MAX_ARTIFACT_BYTES + 1)})
    with pytest.raises(ValueError):
        store.download_json("a/b.json")


def test_leading_slash_is_stripped_so_paths_are_bucket_relative():
    store, client = _store({"a/b.json": _FakeBlob(b"[]")})
    store.download_json("/a/b.json")
    assert client.bucket_obj.requested_paths == ["a/b.json"]


def test_bucket_is_resolved_once_and_reused():
    store, client = _store({"a/b.json": _FakeBlob(b"[]"), "c/d.json": _FakeBlob(b"[]")})
    store.download_json("a/b.json")
    store.download_json("c/d.json")
    assert client.requested_buckets == ["test-bucket"]


def test_default_bucket_is_the_apps_upload_bucket(monkeypatch):
    monkeypatch.delenv("POSETEK_STORAGE_BUCKET", raising=False)
    assert artifact_bucket_name() == "kickai-69dd0.firebasestorage.app"

    monkeypatch.setenv("POSETEK_STORAGE_BUCKET", "staging-bucket")
    assert artifact_bucket_name() == "staging-bucket"


def test_fake_storage_matches_the_real_storage_surface():
    """The regression guard.

    If a tool starts calling a new method on `inv.storage`, adding it to the
    fake alone will make the suite pass while production raises AttributeError.
    Requiring the surfaces to match is what makes the fake trustworthy.
    """
    real_surface = {name for name in dir(ArtifactStore) if not name.startswith("_")}
    fake_surface = {name for name in dir(FakeStorage) if not name.startswith("_")}

    # `put` is a test-only seeding helper and is allowed to be fake-only.
    missing_from_fake = real_surface - fake_surface
    fake_only = fake_surface - real_surface - {"put"}

    assert not missing_from_fake, f"FakeStorage is missing: {missing_from_fake}"
    assert not fake_only, f"FakeStorage invents methods production lacks: {fake_only}"
