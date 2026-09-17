"""Same-athlete bilateral evidence assembly and durable analysis lineage."""
from __future__ import annotations

import copy
from dataclasses import replace
from datetime import datetime, timezone

from gateway.errors import GatewayError, invalid_request, context_unavailable
from gateway.kick_evidence import VERSION, digest, evidence_rows, number


def comparison_id(left_rep_id: str, right_rep_id: str) -> str:
    return "feet-" + digest([left_rep_id, right_rep_id])[:32]


def assemble_comparison(inv) -> dict:
    from gateway.assemblers import assemble_kick_analysis_context
    ids = [inv.params.get("leftRepId"), inv.params.get("rightRepId")]
    if any(not isinstance(value, str) or not value.strip() or "/" in value for value in ids) or ids[0] == ids[1]:
        raise invalid_request("Choose two distinct kick reps: one verified left-foot rep and one verified right-foot rep")
    contexts = {}
    details = {}
    for side, rep_id in zip(("left", "right"), ids):
        scoped = replace(inv, params={"repId": rep_id}, context={})
        context = assemble_kick_analysis_context(scoped)
        orientation = context.get("orientation") or {}
        # A field/kinematic disagreement is not resolved merely by ordering the IDs.
        # Defaulted or derived-only labels are not evidence of physical laterality.
        if (orientation.get("kickingSide") != side
                or orientation.get("strikeFootField") != side
                or orientation.get("sideAgreement") == "disagree"
                or orientation.get("kickingSideSource") == "assumed"
                or (context.get("dataQuality") or {}).get("sideConfidence") == "low"):
            raise invalid_request(f"Rep '{rep_id}' does not have a reliable {side}-foot label. Verify its strike foot and pose tracking before comparing")
        contexts[rep_id] = context
        details.update(getattr(scoped, "_kick_details", {}))
    inv._kick_rep_contexts = contexts
    inv._kick_details = details
    left, right = (contexts[value] for value in ids)
    lrows, rrows = ({row["id"]: row for row in evidence_rows(context)} for context in (left, right))
    differences = []
    for key in sorted(set(lrows) | set(rrows)):
        lrow, rrow = lrows.get(key, {}), rrows.get(key, {})
        row = lrow or rrow
        notes = [f"{side}: {note}" for side, item in (("left", lrow), ("right", rrow))
                 for note in item.get("qualityNotes", [])]
        comparable = (lrow.get("comparisonEligible") is True and rrow.get("comparisonEligible") is True
                      and lrow.get("units") == rrow.get("units")
                      and number(lrow.get("athlete")) and number(rrow.get("athlete")))
        if not lrow or not rrow:
            notes.append("Evidence is missing for one rep")
        if row.get("comparisonEligible") is False and not notes:
            notes.append("Reference-overlay displacement cannot be compared as intrinsic technique")
        differences.append({"id": key, "frameKey": row.get("frameKey"), "metric": row.get("metric"),
                            "side": row.get("side"), "left": lrow.get("athlete"), "right": rrow.get("athlete"),
                            "delta": rrow["athlete"] - lrow["athlete"] if comparable else None,
                            "units": row.get("units"), "comparable": comparable, "notes": notes,
                            "leftFrame": lrow.get("frame"), "rightFrame": rrow.get("frame")})
    comparable_count = sum(row["comparable"] for row in differences)
    if not comparable_count:
        raise context_unavailable("These reps have no comparable technique measurements. Review tracking and record a matched left/right pair")
    return {"comparisonId": comparison_id(*ids), "leftRepId": ids[0], "rightRepId": ids[1],
            "differences": differences, "left": left, "right": right,
            "dataQuality": {"comparableCount": comparable_count, "totalCount": len(differences),
                            "left": left.get("dataQuality"), "right": right.get("dataQuality"),
                            "sampleSize": {"left": 1, "right": 1},
                            "notes": ["One rep per foot: differences describe these clips, not a repeatable asymmetry",
                                      "Intent, effort, camera perspective and tracking can differ; neither foot is an ideal template"]}}


def provenance(inv) -> dict:
    from gateway.registry import get_capability
    from gateway.prompts import render_prompt
    from gateway.knowledge import kick_corpus_version
    spec = get_capability(inv.capability)
    versions = {}
    models = {}
    for stage in spec.stage_list():
        system, _ = render_prompt(stage.prompt, inv.context)
        versions[stage.id] = {"key": stage.prompt, "sha256": digest(system)}
        models[stage.id] = {"provider": stage.provider, "model": stage.model}
    ids = ([inv.params["leftRepId"], inv.params["rightRepId"]]
           if inv.capability == "kick_foot_comparison" else [inv.params.get("repId")])
    contexts = getattr(inv, "_kick_rep_contexts", {})
    if not contexts and inv.context.get("kickAnalysisContext"):
        contexts = {ids[0]: inv.context["kickAnalysisContext"]}
    return {"contextHash": digest(inv.context), "sourceRepIds": ids,
            "sources": {key: value.get("source", {}) for key, value in contexts.items()},
            "promptVersions": versions, "models": models, "evidenceVersion": VERSION,
            "toolEvidenceHash": digest(getattr(inv, "_kick_tool_evidence", [])),
            "toolEvidenceCallsHash": digest(getattr(inv, "_kick_tool_evidence_calls", [])),
            "modelCalls": [{"stage": entry.get("stage"), "model": entry.get("model"),
                            "promptHash": digest(entry.get("prompt"))} for entry in inv.trace],
            "corpusVersion": kick_corpus_version()}


def persist_analysis(inv, payload: dict, collection: str, target_id: str) -> dict:
    """Atomic immutable source + current projection; a job ID cannot be rewritten."""
    from google.cloud import firestore
    if not isinstance(inv.job_id, str) or not inv.job_id or "/" in inv.job_id:
        raise GatewayError("invalid_request", "A durable analysis requires a job ID")
    payload["provenance"] = provenance(inv)
    run = {"schemaVersion": 1, "capability": inv.capability, "playerId": inv.player_id,
           "jobId": inv.job_id, "generatedAt": payload["generatedAt"],
           "result": copy.deepcopy(payload), "context": copy.deepcopy(inv.context),
           "toolEvidence": copy.deepcopy(getattr(inv, "_kick_tool_evidence", [])),
           "toolEvidenceCalls": list(getattr(inv, "_kick_tool_evidence_calls", [])),
           "provenance": payload["provenance"], "createdAt": firestore.SERVER_TIMESTAMP}
    # Check encoded Firestore size before taking a transaction. Keep headroom for
    # document path/index metadata; never silently truncate the review source.
    from google.cloud.firestore_v1 import _helpers
    from google.cloud.firestore_v1.types import Document
    encoded = Document(fields=_helpers.encode_dict({k: v for k, v in run.items() if k != "createdAt"}))
    if len(Document.serialize(encoded)) > 900_000:
        raise GatewayError("context_unavailable", "Analysis evidence exceeds the durable review limit")
    player = inv.player_ref()
    run_ref = player.collection("aiAnalysisRuns").document(inv.job_id)
    current_ref = player.collection(collection).document(target_id)

    @firestore.transactional
    def publish(transaction):
        existing = run_ref.get(transaction=transaction)
        if existing.exists:
            raise invalid_request("This analysis job already has an immutable result; create a new job to regenerate")
        transaction.create(run_ref, run)
        transaction.set(current_ref, {**payload, "createdAt": firestore.SERVER_TIMESTAMP})

    publish(inv.db.transaction())
    return payload


def finalize_comparison(inv, result: dict) -> dict:
    context = inv.context["kickComparisonContext"]
    payload = {"schemaVersion": 1, "capability": "kick_foot_comparison",
               "comparisonId": context["comparisonId"], "playerId": inv.player_id, "jobId": inv.job_id,
               "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
               "leftRepId": context["leftRepId"], "rightRepId": context["rightRepId"],
               "leftKeyFrames": context["left"].get("keyFrames"), "rightKeyFrames": context["right"].get("keyFrames"),
               "leftFps": context["left"].get("fps"), "rightFps": context["right"].get("fps"),
               "summary": result["summary"], "differences": context["differences"],
               "focusAreas": result["focusAreas"], "dataQuality": context["dataQuality"]}
    return persist_analysis(inv, payload, "aiKickComparisons", context["comparisonId"])


def validate_comparison(result: dict, inv) -> list[str]:
    from jsonschema import Draft202012Validator
    from gateway.schemas.kick_comparison_v1 import KICK_COMPARISON_V1_SCHEMA
    structural = [f"{'.'.join(map(str, error.absolute_path)) or 'output'}: {error.message}"
                  for error in Draft202012Validator(KICK_COMPARISON_V1_SCHEMA).iter_errors(result)]
    if structural:
        return structural
    from gateway.kick_grounding import validate_grounded_item, validate_grounded_text
    errors = []
    rows = {row["id"]: row for row in (inv.context.get("kickComparisonContext") or {}).get("differences", [])}
    errors.extend(validate_grounded_text(result.get("summary"), "summary", list(rows.values())))
    areas = result.get("focusAreas", [])
    seen_evidence = set()
    for index, area in enumerate(areas):
        path = f"focusAreas[{index}]"
        if not isinstance(area, dict):
            errors.append(f"{path} is not an object")
            continue
        if area.get("rank") != index + 1:
            errors.append(f"{path}.rank must be consecutive from 1")
        ids = area.get("evidenceIds") or []
        errors.extend(validate_grounded_item(area, path, [rows[key] for key in ids if key in rows]))
        if not ids or any(not isinstance(key, str) or key not in rows or rows[key].get("comparable") is not True for key in ids):
            errors.append(f"{path}.evidenceIds must cite comparable difference rows")
        signature = tuple(sorted(key for key in ids if isinstance(key, str)))
        if signature in seen_evidence:
            errors.append(f"{path} repeats the same evidence as an earlier focus")
        seen_evidence.add(signature)
        if not 5 <= len(str(area.get("cue", "")).split()) <= 20:
            errors.append(f"{path}.cue must contain 5–20 words")
    return errors
