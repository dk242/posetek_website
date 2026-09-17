"""Knowledge-asset integrity: the files baked into the image parse, carry the corpus the
workbook promises, and stay internally consistent (every rule's drill reference resolves
against the emitted drill index — the same content published to `drillCatalog`)."""

from gateway import knowledge


def test_all_assets_present_and_parse():
    for name in knowledge.all_asset_names():
        assert (knowledge.KNOWLEDGE_DIR / name).exists(), name
    assert knowledge.catalog_version() == "1.0.0"


def test_corpus_counts():
    assert len(knowledge.rules()) == 28
    assert len(knowledge.age_level_matrix()) == 15
    assert len(knowledge.tests()) == 18
    assert len(knowledge.drill_index()) == 90


def test_rule_drill_refs_resolve():
    index = knowledge.drill_index()
    for rule in knowledge.rules():
        for drill_id in rule["starterDrillIds"]:
            assert drill_id in index, f"{rule['ruleId']} -> {drill_id}"


def test_rule_selectors():
    by_id = {r["ruleId"]: r for r in knowledge.rules()}
    assert by_id["R01"]["testsSelector"] == "ids"
    assert by_id["R25"]["testsSelector"] == "allTechnical"
    assert by_id["R25"]["tests"] == ["T12", "T13", "T14", "T15", "T16", "T17", "T18"]
    for rid in ("R26", "R27", "R28"):
        assert by_id[rid]["testsSelector"] == "any"
    # R26 (pain) prescribes nothing, by design
    assert by_id["R26"]["starterDrillIds"] == []


def test_rules_for_tests_includes_wildcards():
    hits = knowledge.rules_for_tests({"T01"})
    ids = {r["ruleId"] for r in hits}
    assert "R01" in ids            # T01/T02 trigger
    assert {"R26", "R27", "R28"} <= ids  # wildcard rules always ride along
    assert "R20" not in ids        # shooting rule, no T01 trigger


def test_matrix_lookup():
    row = knowledge.matrix_row("U11-U12", "club")
    assert row is not None
    assert sum(p["percent"] for p in row["sessionArchitecture"]) == 100
    assert knowledge.matrix_row("U6-U8", "performance") is None  # combination doesn't exist


def test_age_band_mapping():
    assert knowledge.age_band_for(7) == "U6-U8"
    assert knowledge.age_band_for(10) == "U9-U10"
    assert knowledge.age_band_for(12) == "U11-U12"
    assert knowledge.age_band_for(14) == "U13-U14"
    assert knowledge.age_band_for(16) == "U15-U16"
    assert knowledge.age_band_for(19) == "U17-U19"


def test_measured_drill_tests_mapping():
    m = knowledge.measured_drill_tests()
    assert m["sprint"] == ["T01", "T02", "T03"]
    assert m["deadballShot"] == ["T17"]
    obs = knowledge.observable_test_ids()
    assert obs == {"T01", "T02", "T03", "T05", "T07", "T10", "T12", "T17"}
    # every observable test id exists in the protocols sheet
    protocol_ids = {t["testId"] for t in knowledge.tests()}
    assert obs <= protocol_ids


def test_observability_flags_match_mapping():
    obs = knowledge.observable_test_ids()
    for t in knowledge.tests():
        assert t["observableInApp"] == (t["testId"] in obs)


def test_markdown_assets_carry_core_language():
    dosage = knowledge.dosage_principles()
    assert "stop rule" in dosage.lower()
    assert "48h" in dosage
    copy = knowledge.copy_rules()
    assert "may be limiting" in copy
    assert "Improved / Unclear / Declined" in copy
