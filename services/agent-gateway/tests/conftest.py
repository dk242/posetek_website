"""A minimal fake Firestore + Storage, and an `Invocation` factory, so assemblers/tools/catalog/
validators are testable with no network and no real Firebase/GCS. Deliberately small: it supports
exactly the surface the gateway code under test actually calls
(`collection().document().get()/.set()/.collection()`, `collection().where().order_by().limit().stream()`),
not the full Firestore client API.
"""

from __future__ import annotations

from typing import Any
from copy import deepcopy

import pytest

# V3 tests exercise the real transaction decorator and wire-size encoder. Load
# the declared SDK dependency before legacy suites install namespace stubs.
from google.cloud import firestore

from gateway.ctx import Invocation


# ---------------------------------------------------------------------------
# Fake Firestore
# ---------------------------------------------------------------------------


class FakeDocumentSnapshot:
    def __init__(self, doc_id: str, data: dict | None):
        self.id = doc_id
        self._data = data
        self.exists = data is not None

    def to_dict(self) -> dict | None:
        return deepcopy(self._data) if self._data is not None else None


def _match(actual: Any, op: str, expected: Any) -> bool:
    if op == "==":
        return actual == expected
    if op == "in":
        return actual in expected
    if op == "<":
        return actual is not None and actual < expected
    if op == "<=":
        return actual is not None and actual <= expected
    if op == ">":
        return actual is not None and actual > expected
    if op == ">=":
        return actual is not None and actual >= expected
    raise NotImplementedError(f"FakeQuery does not support operator '{op}'")


class _SortWrapper:
    """Orders `None` before any real value, and otherwise compares normally. Lets `order_by` sort
    a field even when some fixture docs omit it, without blowing up on cross-type comparison."""

    __slots__ = ("value",)

    def __init__(self, value: Any):
        self.value = value

    def __lt__(self, other: "_SortWrapper") -> bool:
        if self.value is None and other.value is None:
            return False
        if self.value is None:
            return True
        if other.value is None:
            return False
        return self.value < other.value


class FakeQuery:
    def __init__(self, docs_provider, filters=None, order_field=None, limit_n=None):
        self._docs_provider = docs_provider
        self._filters = filters or []
        self._order_field = order_field
        self._limit_n = limit_n

    def where(self, field: str, op: str, value: Any) -> "FakeQuery":
        return FakeQuery(self._docs_provider, self._filters + [(field, op, value)], self._order_field, self._limit_n)

    def order_by(self, field: str, direction: str | None = None) -> "FakeQuery":
        return FakeQuery(self._docs_provider, self._filters, field, self._limit_n)

    def limit(self, n: int) -> "FakeQuery":
        return FakeQuery(self._docs_provider, self._filters, self._order_field, n)

    def stream(self, transaction=None) -> list[FakeDocumentSnapshot]:
        if transaction is not None:
            transaction._record_query()
        docs = self._docs_provider()
        for field, op, value in self._filters:
            docs = [(doc_id, data) for doc_id, data in docs if _match(data.get(field), op, value)]
        if self._order_field:
            docs = sorted(docs, key=lambda d: _SortWrapper(d[1].get(self._order_field)))
        if self._limit_n is not None:
            docs = docs[: self._limit_n]
        return [FakeDocumentSnapshot(doc_id, data) for doc_id, data in docs]


class FakeDocumentRef:
    def __init__(self, store: "FakeFirestore", path_parts: tuple[str, ...]):
        self._store = store
        self._path_parts = path_parts

    @property
    def id(self) -> str:
        return self._path_parts[-1]

    def collection(self, name: str) -> "FakeCollectionRef":
        return FakeCollectionRef(self._store, self._path_parts + (name,))

    def get(self, transaction=None) -> FakeDocumentSnapshot:
        if transaction is not None:
            transaction._record_read(self._path_parts)
        data = self._store.get_doc(self._path_parts)
        return FakeDocumentSnapshot(self._path_parts[-1], data)

    @property
    def path(self):
        return "/".join(self._path_parts)

    def set(self, data: dict, merge=False) -> None:
        old = self._store.get_doc(self._path_parts) or {}
        self._store.set_doc(self._path_parts, {**old, **data} if merge else data)

    def create(self, data):
        from google.api_core.exceptions import AlreadyExists
        if self.get().exists:
            raise AlreadyExists(self.path)
        self.set(data)

    def update(self, data):
        if not self.get().exists:
            raise KeyError(self.path)
        self.set(data, merge=True)


class FakeCollectionRef:
    def __init__(self, store: "FakeFirestore", path_parts: tuple[str, ...]):
        self._store = store
        self._path_parts = path_parts

    def document(self, doc_id: str | None = None) -> FakeDocumentRef:
        if doc_id is None:
            existing = self._store.get_collection(self._path_parts)
            doc_id = f"auto_{len(existing)}"
        return FakeDocumentRef(self._store, self._path_parts + (doc_id,))

    def _docs_provider(self):
        return list(self._store.get_collection(self._path_parts).items())

    def where(self, field: str, op: str, value: Any) -> FakeQuery:
        return FakeQuery(self._docs_provider).where(field, op, value)

    def order_by(self, field: str, direction: str | None = None) -> FakeQuery:
        return FakeQuery(self._docs_provider).order_by(field, direction)

    def limit(self, n: int) -> FakeQuery:
        return FakeQuery(self._docs_provider).limit(n)

    def stream(self, transaction=None) -> list[FakeDocumentSnapshot]:
        return FakeQuery(self._docs_provider).stream(transaction=transaction)


def _server_values(value):
    from datetime import datetime, timezone
    if value is firestore.SERVER_TIMESTAMP:
        return datetime.now(timezone.utc)
    if isinstance(value, dict):
        return {key: _server_values(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_server_values(item) for item in value]
    return deepcopy(value)


class FakeFirestore:
    """Docs are stored flat, keyed by their full path tuple
    (e.g. `("players", "p1", "reps", "r1")`), so arbitrarily deep subcollections work for free."""

    def __init__(self):
        self._docs: dict[tuple[str, ...], dict] = {}
        self._versions = {}
        self._serial = 0
        self.before_commit = None

    def collection(self, name: str) -> FakeCollectionRef:
        return FakeCollectionRef(self, (name,))

    def get_doc(self, path_parts: tuple[str, ...]) -> dict | None:
        return deepcopy(self._docs.get(tuple(path_parts)))

    def set_doc(self, path_parts: tuple[str, ...], data: dict) -> None:
        self._serial += 1
        self._docs[tuple(path_parts)] = _server_values(data)
        self._versions[tuple(path_parts)] = self._serial

    def transaction(self, max_attempts=5):
        return FakeTransaction(self, max_attempts=max_attempts)

    def document(self, path):
        return FakeDocumentRef(self, tuple(path.split("/")))

    def get_collection(self, path_parts: tuple[str, ...]) -> dict[str, dict]:
        prefix = tuple(path_parts)
        depth = len(prefix) + 1
        return {path[-1]: deepcopy(data) for path, data in self._docs.items() if len(path) == depth and path[:-1] == prefix}


class FakeTransaction:
    """Optimistic fake driven by the real firestore_v1.transactional decorator.

    Reads are tracked; pending writes are invisible until atomic commit. Tests inject
    a concurrent write through before_commit. Query reads conservatively track every
    document version, catching phantoms without pretending to implement MVCC queries.
    """
    def __init__(self, store, max_attempts=5):
        self.store = store
        self._max_attempts = max_attempts
        self._read_only = False
        self._clean_up()

    def _clean_up(self):
        self._id = None
        self.reads = {}
        self.query_serial = None
        self.writes = []

    def _begin(self, retry_id=None):
        self._id = b"fake-transaction"

    def _record_read(self, path):
        if self.writes:
            raise RuntimeError("Firestore forbids reads after writes")
        self.reads[path] = self.store._versions.get(path, 0)

    def _record_query(self):
        if self.writes:
            raise RuntimeError("Firestore forbids reads after writes")
        self.query_serial = self.store._serial

    def get(self, ref):
        if hasattr(ref, "stream"):
            return iter(ref.stream(transaction=self))
        return iter([ref.get(transaction=self)])

    def create(self, ref, data):
        self.writes.append(("create", ref, deepcopy(data)))

    def set(self, ref, data, merge=False):
        self.writes.append(("merge" if merge else "set", ref, deepcopy(data)))

    def update(self, ref, data):
        self.writes.append(("update", ref, deepcopy(data)))

    def _rollback(self):
        self._clean_up()

    def _commit(self):
        from google.api_core.exceptions import Aborted, AlreadyExists
        hook = self.store.before_commit
        self.store.before_commit = None
        if hook:
            hook(self.store)
        if (any(self.store._versions.get(p, 0) != v for p, v in self.reads.items())
                or (self.query_serial is not None and self.query_serial != self.store._serial)):
            raise Aborted("concurrent write")
        for op, ref, data in self.writes:
            if op == "create" and ref.get().exists:
                raise AlreadyExists(ref.path)
            if op == "update" and not ref.get().exists:
                raise KeyError(ref.path)
        for op, ref, data in self.writes:
            ref.set(data, merge=op in ("merge", "update"))
        self._clean_up()


# ---------------------------------------------------------------------------
# Fake Storage
# ---------------------------------------------------------------------------


class FakeStorage:
    """Stand-in for `gateway.storage.ArtifactStore`.

    Its surface is pinned to the real one by
    `test_storage.test_fake_storage_matches_the_real_storage_surface` — a fake
    that is more capable than production is how the `download_json` mismatch
    survived a green suite in the first place.
    """

    def __init__(self, files: dict[str, Any] | None = None, bucket_name: str = "test-bucket"):
        self._files = dict(files or {})
        self._bucket_name = bucket_name

    @property
    def bucket_name(self) -> str:
        return self._bucket_name

    def put(self, path: str, data: Any) -> None:
        self._files[path] = data

    def upload_immutable_json(self, path: str, value: Any) -> None:
        import json
        from datetime import datetime
        encoded = json.loads(json.dumps(value, default=lambda v: v.isoformat() if isinstance(v, datetime) else None))
        if path in self._files and self._files[path] != encoded:
            raise ValueError("Existing immutable artifact has different content")
        self._files[path] = encoded

    def download_json(self, path: str) -> Any:
        key = path.lstrip("/")
        if key not in self._files:
            raise FileNotFoundError(path)
        return self._files[key]


# ---------------------------------------------------------------------------
# Seed helpers
# ---------------------------------------------------------------------------


def add_player(db: FakeFirestore, player_id: str, data: dict) -> None:
    db.collection("players").document(player_id).set(data)


def add_rep(db: FakeFirestore, player_id: str, rep_id: str, data: dict) -> None:
    db.collection("players").document(player_id).collection("reps").document(rep_id).set(data)


def add_session(db: FakeFirestore, player_id: str, session_id: str, data: dict) -> None:
    db.collection("players").document(player_id).collection("sessions").document(session_id).set(data)


def add_message(db: FakeFirestore, player_id: str, conv_id: str, msg_id: str, data: dict) -> None:
    (
        db.collection("players")
        .document(player_id)
        .collection("aiConversations")
        .document(conv_id)
        .collection("messages")
        .document(msg_id)
        .set(data)
    )


def add_drill(db: FakeFirestore, drill_id: str, data: dict) -> None:
    db.collection("drillCatalog").document(drill_id).set(data)


def add_benchmark(db: FakeFirestore, doc_id: str, data: dict) -> None:
    db.collection("benchmarks").document(doc_id).set(data)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def db() -> FakeFirestore:
    return FakeFirestore()


@pytest.fixture
def storage() -> FakeStorage:
    return FakeStorage()


@pytest.fixture
def make_invocation(db, storage):
    def _make(
        *,
        capability: str = "test_capability",
        player_id: str = "player1",
        uid: str = "uid1",
        params: dict | None = None,
        context: dict | None = None,
        conversation_id: str | None = None,
    ) -> Invocation:
        return Invocation(
            capability=capability,
            player_id=player_id,
            uid=uid,
            params=params or {},
            db=db,
            storage=storage,
            context=context if context is not None else {},
            conversation_id=conversation_id,
        )

    return _make
