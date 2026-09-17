"""Transport-level progress persists intermediate stages and terminal outcome."""
import pytest

import main
from gateway.authz import AuthContext
from gateway.errors import GatewayError
from tests.conftest import FakeFirestore, FakeStorage


@pytest.mark.parametrize("fail", [False, True])
def test_job_progress_is_visible_while_running_and_terminal_state_is_authoritative(monkeypatch, fail):
    db = FakeFirestore()
    path = ("llmJobs", "job")
    db.set_doc(path, {"capability": "generate_training_plan", "playerId": "athlete",
                     "requestedByUid": "athlete", "status": "pending", "params": {"planVersion": 3}})
    monkeypatch.setattr(main, "_firestore_client", lambda: db)
    monkeypatch.setattr(main, "_artifact_store_client", FakeStorage)
    monkeypatch.setattr(main, "resolve_job_identity", lambda uid: AuthContext(uid, "athlete@example.test", {}))

    def generate(inv):
        report = inv.context["_programProgressCallback"]
        report({"stage": "build", "completedWorkouts": 1, "totalWorkouts": 4, "fraction": .3})
        running = db.get_doc(path)
        assert running["status"] == "running"
        assert running["progress"]["stage"] == "build"
        assert running["progress"]["fraction"] == .3
        if fail:
            raise GatewayError("validation_failed", "Synthetic rejected workout")
        report({"stage": "persist", "completedWorkouts": 4, "totalWorkouts": 4, "fraction": .95})
        return {"planId": "plan"}, {}

    monkeypatch.setattr(main, "run_job_capability", generate)
    response = main.app.test_client().post("/v1/jobs/handle", json={"jobId": "job"})
    assert response.status_code == 200
    result = db.get_doc(path)
    if fail:
        assert result["status"] == "failed" and result["progress"]["fraction"] < 1
    else:
        assert result["status"] == "complete"
        assert result["progress"] == {"stage": "complete", "completedWorkouts": 4,
            "totalWorkouts": 4, "fraction": 1.0, "detail": "Your program is ready"}
