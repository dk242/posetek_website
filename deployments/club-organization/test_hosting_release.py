import copy
import gzip
import json
import os
from pathlib import Path
import tempfile
import unittest
from urllib.parse import parse_qs, urlsplit

import hosting_release as release


class FakeApi:
    def __init__(self, baseline):
        self.current = copy.deepcopy(baseline["release"])
        self.version = None
        self.files = {}
        self.uploaded = set()
        self.calls = []
        self.on_upload = None
        self.on_finalize = None
        self.lose_release_ack = False
        self.upload_url = None

    def request(self, method, resource, body=None, *, binary=False):
        self.calls.append((method, resource, body))
        if resource == f"sites/{release.SITE}/releases?pageSize=1":
            return {"releases": [copy.deepcopy(self.current)]}
        if method == "POST" and resource == f"sites/{release.SITE}/versions":
            self.version = {"name": f"sites/{release.SITE}/versions/newversion", "status": "CREATED", **copy.deepcopy(body)}
            return copy.deepcopy(self.version)
        if resource.endswith(":populateFiles"):
            self.files.update(body["files"])
            return {"uploadRequiredHashes": list(set(body["files"].values())), "uploadUrl": self.upload_url or "https://upload-firebasehosting.googleapis.com/upload/" + self.version["name"] + "/files"}
        if binary:
            if self.on_upload:
                self.on_upload()
            hashed = resource.rsplit("/", 1)[-1]
            assert release.sha(body) == hashed
            gzip.decompress(body)
            self.uploaded.add(hashed)
            return None
        if self.version and resource == self.version["name"] + "/files?pageSize=1000":
            return {"files": [{"path": p, "hash": h, "status": "ACTIVE" if h in self.uploaded else "EXPECTED"} for p, h in self.files.items()]}
        if self.version and resource == self.version["name"]:
            return copy.deepcopy(self.version)
        if method == "PATCH" and resource.endswith("?updateMask=status"):
            self.version["status"] = body["status"]
            if self.on_finalize:
                self.on_finalize()
            return copy.deepcopy(self.version)
        if method == "POST" and "/releases?versionName=" in resource:
            assert parse_qs(urlsplit(resource).query)["versionName"] == [self.version["name"]]
            self.current = {"name": f"sites/{release.SITE}/releases/newrelease", "type": "DEPLOY", "version": copy.deepcopy(self.version)}
            if self.lose_release_ack:
                raise RuntimeError("Synthetic lost acknowledgement")
            return copy.deepcopy(self.current)
        raise AssertionError((method, resource))


class HostingReleaseTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.dist = self.root / "dist"
        (self.dist / "assets").mkdir(parents=True)
        (self.dist / "index.html").write_text('<script src="/assets/app-hash.js"></script>')
        (self.dist / "assets/app-hash.js").write_text("window.synthetic = true;")
        config = {"headers": [{"glob": "**/*.html", "headers": {"Cache-Control": "no-cache"}}], "redirects": [{"glob": "/legacy", "location": "/kept", "statusCode": 301}], "cleanUrls": False}
        version = {"name": f"sites/{release.SITE}/versions/oldversion", "status": "FINALIZED", "fileCount": "1", "config": config}
        self.baseline = {"project": release.PROJECT, "site": release.SITE, "release": {"name": f"sites/{release.SITE}/releases/oldrelease", "type": "DEPLOY", "version": copy.deepcopy(version)}, "version": version, "files": [{"path": "/old.html", "hash": "a" * 64, "status": "ACTIVE"}]}
        self.firebase = self.root / "firebase.json"
        self.firebase.write_text(json.dumps({"hosting": {"public": "dist", "ignore": release.IGNORE, "predeploy": ["MUST NOT EXECUTE"], "rewrites": [{"source": "**", "destination": "/index.html"}], "headers": [{"source": "**/*.html", "headers": [{"key": "Cache-Control", "value": "no-cache"}]}, {"source": "/assets/**", "headers": [{"key": "Cache-Control", "value": "public, max-age=31536000, immutable"}]}]}}))
        self.plan = release.prepare(self.dist, self.baseline, self.firebase)
        self.api = FakeApi(self.baseline)
        self.journal = self.root / "journal.json"

    def publish(self):
        return release.publish(self.api, self.plan, self.journal)

    def writes(self):
        return [row for row in self.api.calls if row[0] != "GET"]

    def test_success_uploads_exact_gzip_and_preserves_config_without_predeploy(self):
        result = self.publish()
        self.assertEqual(result["versionName"], self.api.version["name"])
        self.assertEqual(self.api.version["config"]["redirects"], self.baseline["version"]["config"]["redirects"])
        self.assertFalse(self.api.version["config"]["cleanUrls"])
        self.assertEqual(self.api.version["config"]["rewrites"], [{"glob": "**", "path": "/index.html"}])
        self.assertEqual(release.read(self.journal)["phase"], "released-and-verified")
        self.assertEqual(self.journal.stat().st_mode & 0o777, 0o600)
        self.assertTrue(all("kickai-idp-view" not in row[1] for row in self.api.calls))

    def test_ignored_private_and_maintenance_files_are_not_uploaded(self):
        (self.dist / ".git").mkdir()
        (self.dist / ".git/config").write_text("synthetic private")
        (self.dist / "images").mkdir()
        (self.dist / "images/.DS_Store").write_text("hidden")
        (self.dist / "images/logo-export.html").write_text("maintenance")
        (self.dist / "backfill-session-summaries.html").write_text("maintenance")
        self.assertEqual(release.artifact_files(self.dist), self.plan["files"])

    def test_stale_live_baseline_refused_before_mutation(self):
        self.api.current["name"] += "-newer"
        with self.assertRaisesRegex(ValueError, "Live Hosting release changed"):
            self.publish()
        self.assertFalse(self.writes())
        self.assertFalse(self.journal.exists())

    def test_changed_dist_or_configuration_refused_before_mutation(self):
        for target in [self.dist / "index.html", self.firebase]:
            original = target.read_bytes()
            target.write_bytes(original + b" ")
            with self.assertRaises(ValueError):
                self.publish()
            target.write_bytes(original)
        self.assertFalse(self.writes())

    def test_tampered_plan_and_other_site_refused(self):
        self.plan["site"] = "another-site"
        with self.assertRaises(ValueError):
            self.publish()
        self.assertFalse(self.writes())

    def test_artifact_change_during_upload_never_releases(self):
        self.api.on_upload = lambda: (self.dist / "index.html").write_text("changed")
        with self.assertRaisesRegex(ValueError, "changed"):
            self.publish()
        self.assertFalse(any("/releases?" in row[1] for row in self.writes()))
        self.assertIn("versionName", release.read(self.journal))

    def test_live_change_after_finalize_never_overwrites_new_release(self):
        self.api.on_finalize = lambda: self.api.current.update(name=self.api.current["name"] + "-newer")
        with self.assertRaisesRegex(ValueError, "Live Hosting release changed"):
            self.publish()
        self.assertFalse(any("/releases?" in row[1] for row in self.writes()))
        self.assertEqual(release.read(self.journal)["phase"], "finalized-not-released")

    def test_lost_release_ack_observes_success_without_retry_or_rollback(self):
        self.api.lose_release_ack = True
        with self.assertRaisesRegex(RuntimeError, "lost acknowledgement"):
            self.publish()
        journal = release.read(self.journal)
        self.assertEqual(journal["phase"], "release-request-starting")
        self.assertEqual(journal["observedReleaseAfterFailure"]["version"]["name"], self.api.version["name"])
        self.assertEqual(sum("/releases?" in row[1] for row in self.writes()), 1)
        with self.assertRaisesRegex(ValueError, "new private journal"):
            self.publish()

    def test_untrusted_upload_url_is_refused_before_upload(self):
        self.api.upload_url = "https://attacker.example.test/upload"
        with self.assertRaisesRegex(ValueError, "upload destination"):
            self.publish()
        self.assertFalse(self.api.uploaded)

    def test_symlink_artifact_is_refused(self):
        (self.dist / "assets/secret.js").symlink_to(self.firebase)
        with self.assertRaisesRegex(ValueError, "symlinks"):
            self.publish()
        self.assertFalse(self.writes())

    def test_conflicting_header_does_not_silently_replace_live_behavior(self):
        config = release.read(self.firebase)
        config["hosting"]["headers"][0]["headers"][0]["value"] = "different"
        with self.assertRaisesRegex(ValueError, "conflicts"):
            release.hosting_config(self.baseline["version"]["config"], config)

    def test_incomplete_baseline_is_refused(self):
        self.baseline["version"]["fileCount"] = "2"
        with self.assertRaisesRegex(ValueError, "incomplete"):
            release.prepare(self.dist, self.baseline, self.firebase)

    def test_incorrect_remote_file_inventory_never_releases(self):
        self.api.on_upload = lambda: self.api.files.update({"/unreviewed.js": "f" * 64})
        with self.assertRaisesRegex(ValueError, "file hashes"):
            self.publish()
        self.assertFalse(any("/releases?" in row[1] for row in self.writes()))


if __name__ == "__main__":
    unittest.main()
