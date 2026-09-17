"""Cross-repo parity test (WORKOUT_BUILDER_AGENT_PLAN.md Part 0.2 / B2): the gateway's
`assemble_week_progress` and the Swift `WeeklyProgressBuilder.build` are two independent
implementations of the same fold and must produce numerically identical output on the same
inputs — the client's progress bars and the server's "what's left this week" selection can never
be allowed to quietly disagree.

`FIXTURE_JSON` below is duplicated byte-for-byte as `weekProgressParityFixtureJSON` in
`PoseTek-mobile-app/KickAITests/TrainingPlanModelTests.swift`'s `testWeekProgressParityFixture`.
There is no single file both repos' CI can read (they are independently checked out), so this is
a deliberate, documented duplication rather than a shared resource — change one, change the other
in the same commit, or the two suites silently stop enforcing the same contract.

Deliberately NOT covered here: a rep timed exactly at a week boundary. Building this fixture
surfaced a real, previously-latent divergence — this assembler's `_week_window` defaults to UTC
absent `params.timezone`, while Swift's `TrainingPlan.weekWindow` always resolves against
`Calendar.current` (the device's local zone), and `WeeklyProgressBuilder.build` exposes no way to
override that. The two genuinely disagree within a few hours of midnight for any athlete not in
UTC. The real fix is the client always sending `timezone` on `build_workout` (mirroring
`generate_training_plan`'s existing param) — tracked as an open item in
WORKOUT_BUILDER_AGENT_PLAN.md — not something this fixture can paper over by picking a "lucky"
boundary instant. Every case below uses a timestamp comfortably mid-window (>20h from any
boundary) so what's actually being asserted is the fold logic, not calendar-default agreement.
"""

from __future__ import annotations

import datetime as dt
import json

from gateway.assemblers import assemble_week_progress

FIXTURE_JSON = r"""
{
  "schemaVersion": 1,
  "note": "Shared fixture: gateway assemble_week_progress <-> Swift WeeklyProgressBuilder.build must agree on every case. Keep byte-identical between python-video-processor/Services/agent-gateway/tests/test_week_progress_parity.py's FIXTURE_JSON and PoseTek-mobile-app/KickAITests/TrainingPlanModelTests.swift's weekProgressParityFixtureJSON.",
  "cases": [
    {
      "name": "fresh_week_zero_progress",
      "startDate": "2026-01-05",
      "weekNumber": 1,
      "targets": [
        {"domain": "linearSpeed", "exposures": 2, "note": "Quality"},
        {"domain": "dribbling", "exposures": 1, "note": "Touches"}
      ],
      "drills": [
        {"drillId": "SPD-002", "domain": "linearSpeed", "frequencyPerWeek": 2},
        {"drillId": "DRB-001", "domain": "dribbling", "frequencyPerWeek": 1}
      ],
      "logs": [],
      "reps": [],
      "trainingSessions": [],
      "expected": {
        "domainProgress": [
          {"domain": "linearSpeed", "exposuresDone": 0, "exposuresTarget": 2},
          {"domain": "dribbling", "exposuresDone": 0, "exposuresTarget": 1}
        ],
        "drillProgress": [
          {"drillId": "SPD-002", "state": "notStarted"},
          {"drillId": "DRB-001", "state": "notStarted"}
        ]
      }
    },
    {
      "name": "partial_and_done_from_logged_blocks",
      "startDate": "2026-01-05",
      "weekNumber": 1,
      "targets": [
        {"domain": "linearSpeed", "exposures": 2, "note": "Quality"},
        {"domain": "dribbling", "exposures": 1, "note": "Touches"}
      ],
      "drills": [
        {"drillId": "SPD-002", "domain": "linearSpeed", "frequencyPerWeek": 2},
        {"drillId": "DRB-001", "domain": "dribbling", "frequencyPerWeek": 1}
      ],
      "logs": [
        {
          "id": "w1",
          "linkedTrainingSessionId": null,
          "blocks": [
            {"blockId": "b1", "drillId": "SPD-002", "domain": "linearSpeed", "status": "done"},
            {"blockId": "b2", "drillId": "SPD-002", "domain": "linearSpeed", "status": "done"}
          ]
        }
      ],
      "reps": [],
      "trainingSessions": [],
      "expected": {
        "domainProgress": [
          {"domain": "linearSpeed", "exposuresDone": 2, "exposuresTarget": 2},
          {"domain": "dribbling", "exposuresDone": 0, "exposuresTarget": 1}
        ],
        "drillProgress": [
          {"drillId": "SPD-002", "state": "done"},
          {"drillId": "DRB-001", "state": "notStarted"}
        ]
      }
    },
    {
      "name": "skipped_with_pain_does_not_count",
      "startDate": "2026-01-05",
      "weekNumber": 1,
      "targets": [
        {"domain": "strengthResilience", "exposures": 2, "note": "n"}
      ],
      "drills": [
        {"drillId": "STR-010", "domain": "strengthResilience", "frequencyPerWeek": 2}
      ],
      "logs": [
        {
          "id": "w1",
          "linkedTrainingSessionId": null,
          "blocks": [
            {"blockId": "b1", "drillId": "STR-010", "domain": "strengthResilience", "status": "skipped", "skipReason": "pain"}
          ]
        }
      ],
      "reps": [],
      "trainingSessions": [],
      "expected": {
        "domainProgress": [
          {"domain": "strengthResilience", "exposuresDone": 0, "exposuresTarget": 2}
        ],
        "drillProgress": [
          {"drillId": "STR-010", "state": "notStarted"}
        ]
      }
    },
    {
      "name": "free_reps_from_one_session_count_once",
      "startDate": "2026-01-05",
      "weekNumber": 1,
      "targets": [
        {"domain": "linearSpeed", "exposures": 2, "note": "n"}
      ],
      "drills": [
        {"drillId": "SPD-002", "domain": "linearSpeed", "frequencyPerWeek": 2}
      ],
      "logs": [],
      "reps": [
        {"id": "r1", "repType": "sprint", "createdAt": "2026-01-06T12:00:00Z", "sessionNumber": 3},
        {"id": "r2", "repType": "sprint", "createdAt": "2026-01-06T12:05:00Z", "sessionNumber": 3}
      ],
      "trainingSessions": [],
      "expected": {
        "domainProgress": [
          {"domain": "linearSpeed", "exposuresDone": 1, "exposuresTarget": 2}
        ],
        "drillProgress": [
          {"drillId": "SPD-002", "state": "notStarted"}
        ]
      }
    },
    {
      "name": "deadball_shot_side_kick_rep_type_credits_shooting",
      "startDate": "2026-01-05",
      "weekNumber": 1,
      "targets": [
        {"domain": "shooting", "exposures": 1, "note": "n"}
      ],
      "drills": [],
      "logs": [],
      "reps": [
        {"id": "r1", "repType": "side_kick", "createdAt": "2026-01-06T12:00:00Z", "sessionNumber": 1}
      ],
      "trainingSessions": [],
      "expected": {
        "domainProgress": [
          {"domain": "shooting", "exposuresDone": 1, "exposuresTarget": 1}
        ],
        "drillProgress": []
      }
    },
    {
      "name": "rep_from_a_different_week_is_not_credited",
      "startDate": "2026-01-05",
      "weekNumber": 1,
      "targets": [
        {"domain": "linearSpeed", "exposures": 1, "note": "n"}
      ],
      "drills": [],
      "logs": [],
      "reps": [
        {"id": "r1", "repType": "sprint", "createdAt": "2026-01-20T12:00:00Z", "sessionNumber": 1}
      ],
      "trainingSessions": [],
      "expected": {
        "domainProgress": [
          {"domain": "linearSpeed", "exposuresDone": 0, "exposuresTarget": 1}
        ],
        "drillProgress": []
      }
    },
    {
      "name": "rep_inside_the_queried_week_is_credited",
      "startDate": "2026-01-05",
      "weekNumber": 3,
      "targets": [
        {"domain": "linearSpeed", "exposures": 1, "note": "n"}
      ],
      "drills": [],
      "logs": [],
      "reps": [
        {"id": "r1", "repType": "sprint", "createdAt": "2026-01-20T12:00:00Z", "sessionNumber": 1}
      ],
      "trainingSessions": [],
      "expected": {
        "domainProgress": [
          {"domain": "linearSpeed", "exposuresDone": 1, "exposuresTarget": 1}
        ],
        "drillProgress": []
      }
    },
    {
      "name": "rep_covered_by_logged_training_session_is_not_a_second_exposure",
      "startDate": "2026-01-05",
      "weekNumber": 1,
      "targets": [
        {"domain": "linearSpeed", "exposures": 2, "note": "n"}
      ],
      "drills": [
        {"drillId": "SPD-002", "domain": "linearSpeed", "frequencyPerWeek": 2}
      ],
      "logs": [
        {
          "id": "w1",
          "linkedTrainingSessionId": "ts1",
          "blocks": [
            {"blockId": "b1", "drillId": "SPD-002", "domain": "linearSpeed", "status": "done"}
          ]
        }
      ],
      "reps": [
        {"id": "r1", "repType": "sprint", "createdAt": "2026-01-06T12:00:00Z", "sessionNumber": 1}
      ],
      "trainingSessions": [
        {
          "id": "ts1",
          "sessionRefs": [
            {"sessionDocId": "r1", "drillType": "sprint", "sessionNumber": 1}
          ]
        }
      ],
      "expected": {
        "domainProgress": [
          {"domain": "linearSpeed", "exposuresDone": 1, "exposuresTarget": 2}
        ],
        "drillProgress": [
          {"drillId": "SPD-002", "state": "partial"}
        ]
      }
    }
  ]
}
"""


def _parse_iso(value: str) -> dt.datetime:
    return dt.datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=dt.timezone.utc)


def _run_case(make_invocation, db, case: dict) -> dict:
    # A unique player id per case keeps every case's Firestore docs isolated
    # even though every case shares one FakeFirestore instance and one
    # hardcoded "plan1" doc id.
    player_id = f"parity_{case['name']}"
    plan_id = "plan1"
    week_number = case["weekNumber"]

    inv = make_invocation(player_id=player_id)
    inv.context["activePlanWeek"] = {
        "planId": plan_id,
        "weekNumber": week_number,
        "startDate": case["startDate"],
        "timezone": None,
        "week": {
            "weekNumber": week_number,
            "targets": case["targets"],
            "drills": case["drills"],
        },
    }

    for log in case.get("logs", []):
        data = {"planId": plan_id, "weekNumber": week_number, "blocks": log["blocks"]}
        if log.get("linkedTrainingSessionId"):
            data["linkedTrainingSessionId"] = log["linkedTrainingSessionId"]
        db.set_doc(("players", player_id, "workoutLogs", log["id"]), data)

    for rep in case.get("reps", []):
        db.set_doc(("players", player_id, "reps", rep["id"]), {
            "repType": rep["repType"],
            "createdAt": _parse_iso(rep["createdAt"]),
            "sessionNumber": rep["sessionNumber"],
        })

    for ts in case.get("trainingSessions", []):
        db.set_doc(("players", player_id, "trainingSessions", ts["id"]), {
            "sessionRefs": ts["sessionRefs"],
        })

    return assemble_week_progress(inv)


def test_week_progress_parity_fixture(make_invocation, db):
    fixture = json.loads(FIXTURE_JSON)
    assert fixture["cases"], "fixture must carry at least one case"

    for case in fixture["cases"]:
        out = _run_case(make_invocation, db, case)

        domain_out = {
            d["domain"]: (d["exposuresDone"], d["exposuresTarget"]) for d in out["domainProgress"]
        }
        domain_expected = {
            d["domain"]: (d["exposuresDone"], d["exposuresTarget"])
            for d in case["expected"]["domainProgress"]
        }
        assert domain_out == domain_expected, f"case '{case['name']}' domainProgress mismatch"

        drill_out = {d["drillId"]: d["state"] for d in out["drillProgress"]}
        drill_expected = {d["drillId"]: d["state"] for d in case["expected"]["drillProgress"]}
        assert drill_out == drill_expected, f"case '{case['name']}' drillProgress mismatch"
