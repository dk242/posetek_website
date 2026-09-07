"""Offline release-scope tests; synthetic source/config, no credentials or SDK."""
import contextlib
import copy
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("club_release", HERE / "functions-release.py")
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)

class FunctionsReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="club-release-offline-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / "source"; self.source.mkdir()
        for name in release.SOURCE_FILES: (self.source / name).write_text("// synthetic test source\n")
        (self.source / "index.js").write_text("\n".join(f"exports.{name} = null;" for name in release.ENDPOINTS))
        (self.source / "package.json").write_text(json.dumps({"engines": {"node": "22"}}))
        self.sharing = self.root / "sharing"; self.sharing.mkdir()
        (self.sharing / "index.js").write_text("// exact scoped fixture\n")
        self.archive = self.root / "rollback.zip"; self.archive.write_bytes(b"synthetic rollback archive")
        self.archive_hash = hashlib.sha256(self.archive.read_bytes()).hexdigest()
        files = release.source_entries(self.sharing, ["index.js"], exact=True)
        self.manifest = self.root / "sharing.json"
        release.private_write(self.manifest, {"files": files, "filesManifestSha256": release.digest(files), "baseSourceZipSha256": self.archive_hash})
        records = {}
        for name in [*release.SHARES, "aiCoachStreamProxy"]:
            records[name] = {"name": f"projects/{release.PROJECT}/locations/{release.REGION}/functions/{name}", "entryPoint": name,
                "runtime": "nodejs22", "httpsTrigger": {"securityLevel": "SECURE_ALWAYS"}, "status": "ACTIVE",
                "serviceAccountEmail": release.ACCOUNT, "availableMemoryMb": 256, "timeout": "60s",
                "environmentVariables": {"FIREBASE_CONFIG": '{"projectId":"synthetic"}', "EVENTARC_CLOUD_EVENT_SOURCE": "old"}}
        self.baseline = {"project": release.PROJECT, "region": release.REGION, "functions": records, "iam": {n: {"bindings": []} for n in records}}
        self.baseline_path = self.root / "baseline.json"; release.private_write(self.baseline_path, self.baseline)
        self.output = self.root / "prepared"
        with contextlib.redirect_stdout(io.StringIO()):
            release.prepare(self.source, self.sharing, self.manifest, self.baseline_path, self.output, "1")
        self.plan = release.read(self.output / "plan.json")
        self.evidence = {"planHash": self.plan["planHash"], "sourceManifestHash": self.plan["sourceManifestHash"],
            "checks": {name: True for name in self.plan["requiredVerification"]},
            "rollbackSources": {name: {"archive": str(self.archive), "sha256": self.archive_hash} for name in release.SHARES}}

    def test_scope_is_exactly_sixteen_new_and_three_scoped_updates(self):
        release.verify_plan(self.plan, self.baseline, self.evidence)
        self.assertEqual([op["name"] for op in self.plan["operations"]], release.ENDPOINTS)
        self.assertEqual(sum(op["action"] == "create" for op in self.plan["operations"]), 16)
        self.assertEqual(self.plan["preservedFunctions"], ["aiCoachStreamProxy"])
        for op in self.plan["operations"]:
            share = op["name"] in release.SHARES
            self.assertEqual(op["sourceKind"], "sharing" if share else "functions")
            self.assertEqual(any(arg.startswith("--update-secrets=") for arg in op["argv"]), share)
            self.assertEqual("--allow-unauthenticated" in op["argv"], not share)
            self.assertEqual(op["timeout"], "120s" if op["name"] == "importClubLogo" else "60s")

    def test_commands_preserve_firebase_owned_labels_without_manually_setting_them(self):
        for operation in self.plan["operations"]:
            flags = [arg for arg in operation["argv"] if arg.startswith("--update-labels=")]
            self.assertEqual(flags, ["--update-labels=posetek-club-source=" + operation["sourceManifestHash"][:20]])
            self.assertFalse(any(arg.startswith(("--clear-labels", "--remove-labels")) for arg in operation["argv"]))

    def test_prior_partial_rollout_function_is_resumed_with_invoker_only(self):
        records = self.baseline["functions"]
        records["getClubContext"] = {**copy.deepcopy(records["createAthleteResultsShare"]),
            "name": f"projects/{release.PROJECT}/locations/{release.REGION}/functions/getClubContext", "entryPoint": "getClubContext",
            "labels": {"deployment-tool": "cli-gcloud", "posetek-club-source": "6e82a893398bc014c61b"}}
        self.baseline["iam"]["getClubContext"] = {"etag": "ACAB"}
        baseline_path = self.root / "baseline-resume.json"; release.private_write(baseline_path, self.baseline)
        output = self.root / "prepared-resume"
        with contextlib.redirect_stdout(io.StringIO()):
            release.prepare(self.source, self.sharing, self.manifest, baseline_path, output, "1")
        plan = release.read(output / "plan.json")
        operation = next(op for op in plan["operations"] if op["name"] == "getClubContext")
        self.assertEqual(operation["action"], "resume")
        self.assertIn("--allow-unauthenticated", operation["argv"])
        self.assertIsNone(operation["environmentFile"])
        self.assertFalse(any(arg.startswith("--env-vars-file=") for arg in operation["argv"]))
        self.assertEqual(sum(op["action"] == "create" for op in plan["operations"]), 15)
        for share in release.SHARES:
            self.assertEqual(next(op for op in plan["operations"] if op["name"] == share)["action"], "update")

    def test_tool_owned_labels_do_not_count_as_runtime_changes(self):
        before = {"labels": {"deployment-tool": "cli-firebase", "deployment-callable": "true", "firebase-functions-hash": "abc"}, "timeout": "60s"}
        after = {"labels": {"deployment-tool": "cli-gcloud", "firebase-functions-hash": "abc", "posetek-club-source": "x"}, "timeout": "60s"}
        self.assertEqual(release.stable(before, allow_source_label=True), release.stable(after, allow_source_label=True))
        after["timeout"] = "120s"
        self.assertNotEqual(release.stable(before, allow_source_label=True), release.stable(after, allow_source_label=True))

    def test_already_released_functions_are_verified_not_redeployed(self):
        records = self.baseline["functions"]
        share_hash = self.plan["sources"]["sharing"]["manifestHash"][:20]
        functions_hash = self.plan["sources"]["functions"]["manifestHash"][:20]
        invoker = {"bindings": [{"role": release.INVOKER, "members": ["allUsers"]}]}
        records["getClubContext"] = {**copy.deepcopy(records["createAthleteResultsShare"]),
            "name": f"projects/{release.PROJECT}/locations/{release.REGION}/functions/getClubContext", "entryPoint": "getClubContext",
            "labels": {"deployment-tool": "cli-gcloud", "posetek-club-source": functions_hash}}
        self.baseline["iam"]["getClubContext"] = invoker
        records["createAthleteResultsShare"]["labels"] = {"deployment-tool": "cli-gcloud", "posetek-club-source": share_hash}
        records["createAthleteResultsShare"]["secretEnvironmentVariables"] = [{"key": release.SECRET, "secret": release.SECRET, "version": "1"}]
        self.baseline["iam"]["createAthleteResultsShare"] = invoker
        # Same label but the signing secret is missing: must still be updated, not skipped.
        records["getAthleteResultsShare"]["labels"] = {"deployment-tool": "cli-gcloud", "posetek-club-source": share_hash}
        self.baseline["iam"]["getAthleteResultsShare"] = invoker
        baseline_path = self.root / "baseline-verified.json"; release.private_write(baseline_path, self.baseline)
        output = self.root / "prepared-verified"
        with contextlib.redirect_stdout(io.StringIO()):
            release.prepare(self.source, self.sharing, self.manifest, baseline_path, output, "1")
        actions = {op["name"]: op["action"] for op in release.read(output / "plan.json")["operations"]}
        self.assertEqual(actions["getClubContext"], "verified")
        self.assertEqual(actions["createAthleteResultsShare"], "verified")
        self.assertEqual(actions["getAthleteResultsShare"], "update")
        self.assertEqual(actions["getAthleteSharedRepArtifacts"], "update")
        self.assertEqual(sum(action == "create" for action in actions.values()), 15)

    def test_missing_invoker_is_remediated_once_then_required(self):
        granted = {"bindings": [{"role": release.INVOKER, "members": ["allUsers"]}]}
        with patch.object(release, "iam", side_effect=[{"etag": "ACAB"}, granted]), patch.object(release, "gcloud") as gcloud:
            release.ensure_public_invoker("getClubContext")
        gcloud.assert_called_once()
        argv = gcloud.call_args.args[0]
        self.assertEqual(argv[:3], ["functions", "add-iam-policy-binding", "getClubContext"])
        self.assertIn("--member=allUsers", argv); self.assertIn("--role=" + release.INVOKER, argv)
        with patch.object(release, "iam", return_value=granted), patch.object(release, "gcloud") as gcloud:
            release.ensure_public_invoker("getClubContext")
        gcloud.assert_not_called()
        with patch.object(release, "iam", return_value={"etag": "ACAB"}), patch.object(release, "gcloud"):
            with self.assertRaisesRegex(RuntimeError, "invoker IAM is missing"):
                release.ensure_public_invoker("getClubContext")

    def test_missing_sdk_evidence_blocks_deploy_preflight(self):
        self.evidence["checks"]["club-sdk-canonical-and-scoped"] = False
        with self.assertRaisesRegex(ValueError, "validation remains incomplete"):
            release.verify_plan(self.plan, self.baseline, self.evidence)

    def test_modified_baseline_is_rejected(self):
        self.baseline["functions"]["createAthleteResultsShare"]["timeout"] = "300s"
        with self.assertRaisesRegex(ValueError, "Baseline/target mismatch"):
            release.verify_plan(self.plan, self.baseline, self.evidence)

    def test_incomplete_evidence_stops_before_any_gcloud_call_or_journal(self):
        self.evidence["checks"]["club-sdk-canonical-and-scoped"] = False
        evidence_path = self.root / "evidence.json"; release.private_write(evidence_path, self.evidence)
        journal = self.root / "journal.json"
        with patch.object(release, "inventory") as inventory, patch.object(release, "gcloud") as gcloud:
            with self.assertRaisesRegex(ValueError, "validation remains incomplete"):
                release.deploy(self.output / "plan.json", evidence_path, journal)
            inventory.assert_not_called(); gcloud.assert_not_called()
        self.assertFalse(journal.exists())

    def test_sharing_cannot_switch_to_whole_main_source(self):
        operation = self.plan["operations"][-1]
        operation["sourceKind"] = "functions"
        self.plan["planHash"] = release.digest({k: v for k, v in self.plan.items() if k != "planHash"})
        self.evidence["planHash"] = self.plan["planHash"]
        with self.assertRaisesRegex(ValueError, "Endpoint source scope changed"):
            release.verify_plan(self.plan, self.baseline, self.evidence)

    def test_source_byte_tamper_is_rejected(self):
        (Path(self.plan["sources"]["sharing"]["source"]) / "index.js").write_text("altered")
        with self.assertRaisesRegex(ValueError, "Prepared source changed"):
            release.verify_plan(self.plan, self.baseline, self.evidence)

    def test_source_upload_extra_file_is_rejected(self):
        (Path(self.plan["sources"]["functions"]["source"]) / "unreviewed.js").write_text("extra")
        with self.assertRaisesRegex(ValueError, "unreviewed files"):
            release.verify_plan(self.plan, self.baseline, self.evidence)

    def test_upload_ignore_tamper_is_rejected(self):
        (Path(self.plan["sources"]["functions"]["source"]) / ".gcloudignore").write_text("index.js\n")
        with self.assertRaisesRegex(ValueError, "ignore rules changed"):
            release.verify_plan(self.plan, self.baseline, self.evidence)

    def test_environment_tamper_is_rejected(self):
        Path(self.plan["operations"][0]["environmentFile"]["path"]).write_text("{}")
        with self.assertRaisesRegex(ValueError, "environment settings changed"):
            release.verify_plan(self.plan, self.baseline, self.evidence)

    def test_wrong_rollback_archive_is_rejected(self):
        self.archive.write_bytes(b"different archive")
        with self.assertRaisesRegex(ValueError, "rollback source archive is missing"):
            release.verify_plan(self.plan, self.baseline, self.evidence)

    def test_modified_plan_requires_fresh_review_evidence(self):
        self.plan["operations"] = self.plan["operations"][:-1]
        with self.assertRaisesRegex(ValueError, "Plan changed after review"):
            release.verify_plan(self.plan, self.baseline, self.evidence)

if __name__ == "__main__": unittest.main()
