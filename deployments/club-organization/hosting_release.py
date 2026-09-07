#!/usr/bin/env python3
"""Release the reviewed, existing dist through Hosting REST; never build/install.

snapshot is read-only remotely; prepare is offline; publish is the only remote
mutation. Credentials and gzip payloads remain in memory. See HOSTING.md.
"""
from __future__ import annotations
import argparse
import copy
import gzip
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import urllib.error
import urllib.parse
import urllib.request

PROJECT = SITE = "kickai-69dd0"
BASE = "https://firebasehosting.googleapis.com/v1beta1/"
IGNORE = ["firebase.json", "**/.*", "**/node_modules/**", "backfill-session-summaries.html", "images/logo-export.html"]
MAX_FILE_BYTES = 256 * 1024 * 1024


def sha(data):
    return hashlib.sha256(data).hexdigest()


def digest(value):
    return sha(json.dumps(value, sort_keys=True, separators=(",", ":")).encode())


def read(path):
    return json.loads(Path(path).read_text())


def private_write(path, value, *, new=False):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if path.is_symlink():
        raise ValueError("Private journal cannot be a symlink")
    temporary = None
    if new:
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600)
    else:
        fd, temporary = tempfile.mkstemp(prefix=".hosting-journal-", dir=path.parent)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w") as out:
            json.dump(value, out, indent=2)
            out.write("\n")
            out.flush()
            os.fsync(out.fileno())
        if temporary:
            os.replace(temporary, path)
    finally:
        if temporary and os.path.exists(temporary):
            os.unlink(temporary)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


class Api:
    def __init__(self, token_provider=None):
        self.token_provider = token_provider or self.gcloud_token
        self.token = None
        self.opener = urllib.request.build_opener(NoRedirect())

    @staticmethod
    def gcloud_token():
        result = subprocess.run(["gcloud", "auth", "print-access-token"], capture_output=True, text=True)
        if result.returncode or not result.stdout.strip():
            raise RuntimeError("Existing Google login unavailable; no credentials were logged")
        return result.stdout.strip()

    def request(self, method, resource, body=None, *, binary=False):
        url = resource if resource.startswith("https://") else BASE + resource
        parsed = urllib.parse.urlsplit(url)
        if parsed.scheme != "https" or parsed.netloc not in {"firebasehosting.googleapis.com", "upload-firebasehosting.googleapis.com"}:
            raise ValueError("Unexpected Hosting API host")
        if self.token is None:
            self.token = self.token_provider()
        payload = body if binary else None if body is None else json.dumps(body).encode()
        request = urllib.request.Request(url, method=method, data=payload, headers={
            "Authorization": "Bearer " + self.token,
            "x-goog-user-project": PROJECT,
            "Content-Type": "application/octet-stream" if binary else "application/json",
        })
        try:
            with self.opener.open(request, timeout=45) as response:
                data = response.read()
                return None if binary or not data else json.loads(data)
        except urllib.error.HTTPError as error:
            raise RuntimeError(f"Hosting API returned HTTP {error.code}; response and credentials omitted") from None
        except urllib.error.URLError:
            raise RuntimeError("Hosting connection failed; inspect the private journal before retrying") from None


def latest(api):
    entries = api.request("GET", f"sites/{SITE}/releases?pageSize=1").get("releases", [])
    if len(entries) != 1 or entries[0].get("type") != "DEPLOY":
        raise ValueError("Expected an active deployed Hosting release")
    return entries[0]


def files_for(api, version):
    if not re.fullmatch(rf"sites/{SITE}/versions/[A-Za-z0-9_-]+", version):
        raise ValueError("Unexpected Hosting version identity")
    result = []
    token = None
    seen = set()
    while True:
        suffix = "?pageSize=1000" + ("&pageToken=" + urllib.parse.quote(token, safe="") if token else "")
        page = api.request("GET", version + "/files" + suffix)
        result.extend(page.get("files", []))
        token = page.get("nextPageToken")
        if not token:
            return result
        if token in seen:
            raise ValueError("Repeated Hosting file-list pagination token")
        seen.add(token)


def capture(api):
    release = latest(api)
    version = api.request("GET", release["version"]["name"])
    files = files_for(api, version["name"])
    if latest(api)["name"] != release["name"]:
        raise ValueError("Live release changed during snapshot")
    result = {"project": PROJECT, "site": SITE, "release": release, "version": version, "files": files}
    validate_baseline(result)
    return result


def validate_baseline(value):
    if value.get("project") != PROJECT or value.get("site") != SITE:
        raise ValueError("Hosting project/site mismatch")
    version = value["version"]
    if value["release"].get("type") != "DEPLOY" or value["release"]["version"]["name"] != version["name"]:
        raise ValueError("Baseline release/version mismatch")
    if not re.fullmatch(rf"sites/{SITE}/versions/[A-Za-z0-9_-]+", version["name"]) or version.get("status") != "FINALIZED":
        raise ValueError("Baseline must be a finalized version of the target site")
    if len({row["path"] for row in value["files"]}) != len(value["files"]):
        raise ValueError("Baseline has duplicate file paths")
    if int(version.get("fileCount", -1)) != len(value["files"]):
        raise ValueError("Baseline file inventory is incomplete")


def hosting_config(baseline_config, firebase):
    local = firebase.get("hosting", {})
    if local.get("public") != "dist" or local.get("ignore") != IGNORE:
        raise ValueError("Review changed public directory or Hosting ignore policy")
    supported = {"public", "ignore", "predeploy", "headers", "rewrites"}
    if set(local) - supported:
        raise ValueError("Review additional local Hosting configuration")
    result = copy.deepcopy(baseline_config)
    for name in ["headers", "rewrites"]:
        for row in local.get(name, []):
            if name == "headers":
                if set(row) != {"source", "headers"}:
                    raise ValueError("Unsupported local header rule")
                headers = {item["key"]: item["value"] for item in row["headers"]}
                if len(headers) != len(row["headers"]):
                    raise ValueError("Duplicate header key")
                converted = {"glob": row["source"], "headers": headers}
            else:
                if set(row) != {"source", "destination"}:
                    raise ValueError("Unsupported local rewrite")
                converted = {"glob": row["source"], "path": row["destination"]}
            rules = result.setdefault(name, [])
            matching = [item for item in rules if item.get("glob") == converted["glob"]]
            if matching and matching != [converted]:
                raise ValueError("Local Hosting rule conflicts with live configuration")
            if not matching:
                rules.append(converted)
    return result


def ignored(relative):
    return any(part.startswith(".") or part == "node_modules" for part in relative.parts) or relative.as_posix() in {
        "firebase.json", "backfill-session-summaries.html", "images/logo-export.html",
    }


def payload_for(dist, relative):
    parts = Path(relative).parts
    if not parts or Path(relative).is_absolute() or any(part in {".", ".."} for part in parts):
        raise ValueError("Unsafe artifact path")
    current = Path(dist)
    for part in parts:
        current = current / part
        if current.is_symlink():
            raise ValueError("Artifact symlinks are not allowed")
    if current.stat().st_size > MAX_FILE_BYTES:
        raise ValueError("Artifact exceeds the publisher's in-memory file limit")
    raw = current.read_bytes()
    compressed = gzip.compress(raw, compresslevel=9, mtime=0)
    return raw, compressed


def artifact_files(dist):
    dist = Path(dist)
    if dist.is_symlink() or not dist.is_dir():
        raise ValueError("Expected an existing regular dist directory")
    files = {}
    for path in sorted(dist.rglob("*")):
        relative = path.relative_to(dist)
        if ignored(relative):
            continue
        if path.is_symlink():
            raise ValueError("Artifact symlinks are not allowed")
        if path.is_dir():
            continue
        if not path.is_file() or relative.parts[0] in {"functions", "app", "deployments", "tools", "__"}:
            raise ValueError("Unexpected build artifact or reserved Hosting path")
        raw, compressed = payload_for(dist, relative.as_posix())
        files["/" + relative.as_posix()] = {"sha256": sha(raw), "gzipSha256": sha(compressed), "bytes": len(raw), "gzipBytes": len(compressed)}
    if "/index.html" not in files:
        raise ValueError("Built index.html is missing")
    return files


def prepare(dist, baseline, firebase_path):
    validate_baseline(baseline)
    files = artifact_files(dist)
    firebase = read(firebase_path)
    plan = {
        "schemaVersion": 1, "project": PROJECT, "site": SITE,
        "dist": str(Path(dist).resolve()), "firebasePath": str(Path(firebase_path).resolve()),
        "firebaseSha256": sha(Path(firebase_path).read_bytes()),
        "baseline": baseline, "config": hosting_config(baseline["version"].get("config", {}), firebase),
        "files": files, "removedPaths": sorted({row["path"] for row in baseline["files"]} - set(files)),
        "totalBytes": sum(row["bytes"] for row in files.values()),
        "totalGzipBytes": sum(row["gzipBytes"] for row in files.values()),
    }
    plan["planHash"] = digest(plan)
    return plan


def validate_plan(plan):
    if plan.get("schemaVersion") != 1 or plan.get("project") != PROJECT or plan.get("site") != SITE:
        raise ValueError("Unexpected Hosting release plan")
    value = dict(plan)
    claimed = value.pop("planHash", None)
    if digest(value) != claimed:
        raise ValueError("Hosting plan hash mismatch")
    validate_baseline(plan["baseline"])
    if sha(Path(plan["firebasePath"]).read_bytes()) != plan["firebaseSha256"]:
        raise ValueError("Hosting configuration changed after preparation")
    if hosting_config(plan["baseline"]["version"].get("config", {}), read(plan["firebasePath"])) != plan["config"]:
        raise ValueError("Hosting configuration differs from the reviewed merge")
    if artifact_files(plan["dist"]) != plan["files"]:
        raise ValueError("Built artifact changed after preparation")


def assert_live(api, baseline):
    current = latest(api)
    if current["name"] != baseline["release"]["name"] or current["version"]["name"] != baseline["version"]["name"]:
        raise ValueError("Live Hosting release changed; prepare a fresh baseline")


def verify_remote(api, name, plan, *, finalized=False):
    version = api.request("GET", name)
    files = files_for(api, name)
    expected = {key: row["gzipSha256"] for key, row in plan["files"].items()}
    actual = {row["path"]: row["hash"] for row in files}
    if actual != expected or len(files) != len(expected) or any(row.get("status") != "ACTIVE" for row in files):
        raise ValueError("Hosting uploaded file hashes/status do not match the artifact")
    if version.get("config", {}) != plan["config"] or (finalized and version.get("status") != "FINALIZED"):
        raise ValueError("Hosting version configuration/status does not match")
    return version


def publish(api, plan, journal_path):
    validate_plan(plan)
    if Path(journal_path).exists():
        raise ValueError("Use a new private journal; inspect previous attempt before retry")
    assert_live(api, plan["baseline"])
    journal = {"planHash": plan["planHash"], "baseline": plan["baseline"], "phase": "preflight", "uploadsCompleted": []}
    private_write(journal_path, journal, new=True)
    try:
        created = api.request("POST", f"sites/{SITE}/versions", {"config": plan["config"], "labels": {"posetek-club-plan": plan["planHash"][:32]}})
        name = created["name"]
        if not re.fullmatch(rf"sites/{SITE}/versions/[A-Za-z0-9_-]+", name):
            raise ValueError("Unexpected created version identity")
        journal.update(phase="version-created", versionName=name)
        private_write(journal_path, journal)
        expected_upload_url = "https://upload-firebasehosting.googleapis.com/upload/" + name + "/files"
        by_hash = {row["gzipSha256"]: key for key, row in plan["files"].items()}
        entries = list(plan["files"].items())
        required = set()
        for offset in range(0, len(entries), 1000):
            response = api.request("POST", name + ":populateFiles", {"files": {key: row["gzipSha256"] for key, row in entries[offset:offset + 1000]}})
            if response.get("uploadUrl") != expected_upload_url:
                raise ValueError("Unexpected Hosting upload destination")
            hashes = set(response.get("uploadRequiredHashes", []))
            if not hashes <= set(by_hash):
                raise ValueError("Hosting requested an unknown file hash")
            required.update(hashes)
        journal.update(phase="uploading", uploadsRequired=len(required))
        private_write(journal_path, journal)
        for hashed in sorted(required):
            key = by_hash[hashed]
            raw, compressed = payload_for(plan["dist"], key[1:])
            if sha(raw) != plan["files"][key]["sha256"] or sha(compressed) != hashed:
                raise ValueError("Artifact changed during upload")
            api.request("POST", expected_upload_url + "/" + hashed, compressed, binary=True)
            journal["uploadsCompleted"].append(hashed)
            private_write(journal_path, journal)
        verify_remote(api, name, plan)
        validate_plan(plan)
        assert_live(api, plan["baseline"])
        api.request("PATCH", name + "?updateMask=status", {"status": "FINALIZED"})
        verify_remote(api, name, plan, finalized=True)
        journal["phase"] = "finalized-not-released"
        private_write(journal_path, journal)
        validate_plan(plan)
        assert_live(api, plan["baseline"])
        journal["phase"] = "release-request-starting"
        private_write(journal_path, journal)
        release = api.request("POST", f"sites/{SITE}/releases?versionName=" + urllib.parse.quote(name, safe=""), {"message": "Club organization web " + plan["planHash"][:12]})
        journal.update(phase="release-acknowledged", release=release)
        private_write(journal_path, journal)
        current = latest(api)
        if current["name"] != release["name"] or current["version"]["name"] != name:
            raise ValueError("Live Hosting readback does not match the new release")
        verify_remote(api, name, plan, finalized=True)
        journal.update(phase="released-and-verified", currentRelease=current)
        private_write(journal_path, journal)
        return {"releaseName": release["name"], "versionName": name, "planHash": plan["planHash"]}
    except Exception as error:
        journal["failureType"] = type(error).__name__
        # A failed acknowledgement may still have published. Observe only;
        # never retry a release or perform an automatic permissive rollback.
        try:
            journal["observedReleaseAfterFailure"] = latest(api)
        except Exception:
            journal["readbackUnavailable"] = True
        private_write(journal_path, journal)
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    snapshot = commands.add_parser("snapshot")
    snapshot.add_argument("--output", required=True)
    prep = commands.add_parser("prepare")
    prep.add_argument("--dist", required=True)
    prep.add_argument("--baseline", required=True)
    prep.add_argument("--firebase", default="firebase.json")
    prep.add_argument("--output", required=True)
    pub = commands.add_parser("publish")
    pub.add_argument("--plan", required=True)
    pub.add_argument("--journal", required=True)
    args = parser.parse_args()
    if args.command == "snapshot":
        value = capture(Api())
        private_write(args.output, value, new=True)
        print(json.dumps({"releaseName": value["release"]["name"], "versionName": value["version"]["name"]}))
    elif args.command == "prepare":
        value = prepare(args.dist, read(args.baseline), args.firebase)
        private_write(args.output, value, new=True)
        print(json.dumps({key: value[key] for key in ["planHash", "totalBytes", "totalGzipBytes"]} | {"files": len(value["files"])}))
    else:
        print(json.dumps(publish(Api(), read(args.plan), args.journal)))


if __name__ == "__main__":
    main()
