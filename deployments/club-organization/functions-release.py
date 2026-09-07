#!/usr/bin/env python3
"""Prepare, snapshot, or explicitly deploy exactly the reviewed club callables.

Default `prepare` is offline. Snapshot is read-only remotely. Deploy is the only
mutation command and requires a reviewed plan plus completed SDK verification.
No local dependency installation, Firebase source discovery, or hosting/rules
release is performed. All credential/config/source evidence stays private.
"""
from __future__ import annotations
import argparse
import copy
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
from datetime import datetime, timezone

PROJECT = "kickai-69dd0"
REGION = "us-central1"
ACCOUNT = "kickai-69dd0@appspot.gserviceaccount.com"
SECRET = "ATHLETE_SHARE_SIGNING_KEY"
ENDPOINTS = [
    "getClubContext", "createClubOrganization", "saveClubTeam", "createClubStaffInvitation",
    "redeemClubStaffInvitation", "setClubStaffTeams", "revokeClubStaffInvitation",
    "setClubPlayerTeam", "createClubPlayer", "issueClubPlayerInvitation", "importClubLogo",
    "redeemPlayerSignupCode", "joinOrganization", "createOrganization", "attachPlayerByCode",
    "getTeamLeaderboard", "createAthleteResultsShare", "getAthleteResultsShare", "getAthleteSharedRepArtifacts",
]
SHARES = set(ENDPOINTS[-3:])
SOURCE_FILES = ["index.js", "admission.js", "athlete-shares.js", "athlete-storage-paths.js", "club-access.js",
                "club-branding.js", "clubs.js", "team-leaderboard.js", "package.json", "package-lock.json"]
TRANSIENT = {"status", "updateTime", "versionId", "buildId", "buildName", "sourceUploadUrl", "sourceArchiveUrl", "sourceRepository"}


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def private_write(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if path.is_symlink(): raise ValueError("Private output cannot be a symlink")
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | getattr(os, "O_NOFOLLOW", 0), 0o600)
    with os.fdopen(fd, "w") as out: json.dump(value, out, indent=2); out.write("\n")


def read(path):
    return json.loads(Path(path).read_text())


def now():
    return datetime.now(timezone.utc).isoformat()


def gcloud(argv):
    result = subprocess.run(["gcloud", *argv], capture_output=True, text=True)
    if result.returncode:
        # Raw CLI stderr can contain credential account names or private config.
        raise RuntimeError(f"gcloud command failed (exit {result.returncode}); operation {argv[0]} {argv[1]}")
    return json.loads(result.stdout) if result.stdout.strip() else {}


def function_name(record):
    return record["name"].rsplit("/", 1)[-1]


def inventory():
    entries = gcloud(["functions", "list", f"--project={PROJECT}", f"--regions={REGION}", "--format=json"])
    return {function_name(record): record for record in entries}


def iam(name):
    return gcloud(["functions", "get-iam-policy", name, f"--project={PROJECT}", f"--region={REGION}", "--format=json"])


def stable(record, *, allow_source_label=False, allow_share_secret=False):
    value = {key: copy.deepcopy(item) for key, item in record.items() if key not in TRANSIENT}
    if allow_source_label:
        for key in ["posetek-club-source", "deployment-callable"]: value.get("labels", {}).pop(key, None)
    if allow_share_secret:
        value["secretEnvironmentVariables"] = [item for item in value.get("secretEnvironmentVariables", []) if item.get("key") != SECRET]
        if not value["secretEnvironmentVariables"]: value.pop("secretEnvironmentVariables")
    return value


def snapshot(output):
    output = Path(output)
    if output.exists(): raise ValueError("Snapshot directory must be new")
    output.mkdir(parents=True, mode=0o700)
    records = inventory()
    policies = {name: iam(name) for name in records}
    result = {"project": PROJECT, "region": REGION, "capturedAt": now(), "functions": records, "iam": policies}
    private_write(output / "baseline.json", result)
    print(json.dumps({"status": "snapshotted", "functions": sorted(records), "baselineHash": digest(result)}))


def source_entries(source, names=SOURCE_FILES, *, exact=False):
    if exact and {p.name for p in source.iterdir()} - {".gcloudignore"} != set(names):
        raise ValueError("Prepared source contains unreviewed files")
    ignore = source / ".gcloudignore"
    if ignore.exists() and (ignore.is_symlink() or ignore.read_text() != ".gcloudignore\n"):
        raise ValueError("Source upload ignore rules changed")
    result = {}
    for name in names:
        path = source / name
        if not path.is_file() or path.is_symlink(): raise ValueError(f"Missing/unsafe source file: {name}")
        content = path.read_bytes()
        result[name] = {"sha256": hashlib.sha256(content).hexdigest(), "bytes": len(content)}
    return result


def validate_existing(name, record):
    if record.get("runtime") != "nodejs22" or not record.get("httpsTrigger") or record.get("environment") == "GEN_2":
        raise ValueError(f"Existing function is not the expected gen1/nodejs22/HTTP target: {name}")
    if record.get("entryPoint") != name or record.get("status") != "ACTIVE":
        raise ValueError(f"Existing function is not active at its expected entrypoint: {name}")
    if record.get("serviceAccountEmail") != ACCOUNT or record.get("vpcConnector") or record.get("secretVolumes"):
        raise ValueError(f"Review nonstandard service account/network/secret-volume settings: {name}")


def prepare(source, sharing_source, sharing_manifest_path, baseline_path, output, secret_version):
    source, output = Path(source), Path(output)
    if output.exists(): raise ValueError("Prepared release directory must be new")
    if not re.fullmatch(r"[1-9][0-9]*", secret_version): raise ValueError("A numeric, enabled signing-secret version is required")
    baseline = read(baseline_path)
    if baseline.get("project") != PROJECT or baseline.get("region") != REGION: raise ValueError("Baseline project/region mismatch")
    records = baseline["functions"]
    donor = records.get("createAthleteResultsShare")
    if not donor: raise ValueError("A verified current shared runtime baseline is required")
    for name in ENDPOINTS:
        if name in records: validate_existing(name, records[name])
    files = source_entries(source)
    sharing_source = Path(sharing_source)
    sharing_manifest = read(sharing_manifest_path)
    share_files = source_entries(sharing_source, sharing_manifest["files"], exact=True)
    if share_files != sharing_manifest["files"] or digest(share_files) != sharing_manifest["filesManifestSha256"]:
        raise ValueError("Scoped sharing source differs from its reviewed manifest")
    if not sharing_manifest.get("baseSourceZipSha256"):
        raise ValueError("Scoped sharing lacks rollback source provenance")
    index = (source / "index.js").read_text()
    if any(f"exports.{name} =" not in index for name in ENDPOINTS): raise ValueError("An approved callable export is missing")
    if json.loads((source / "package.json").read_text()).get("engines", {}).get("node") != "22": raise ValueError("Node runtime mismatch")
    output.mkdir(parents=True, mode=0o700)
    sources = {}
    for kind, original, entries in [("functions", source, files), ("sharing", sharing_source, share_files)]:
        staged = output / (kind + "-source"); staged.mkdir(mode=0o700)
        for name in entries:
            shutil.copyfile(original / name, staged / name)
            (staged / name).chmod(0o600)
        # Ignore only this ignore file; no parent Git rules, dependencies or caches.
        (staged / ".gcloudignore").write_text(".gcloudignore\n")
        sources[kind] = {"source": str(staged.resolve()), "files": entries, "manifestHash": digest(entries)}
    manifest_hash = digest({kind: item["manifestHash"] for kind, item in sources.items()})
    operations = []
    for name in ENDPOINTS:
        existing = records.get(name)
        source_kind = "sharing" if name in SHARES else "functions"
        selected_source = sources[source_kind]
        runtime = existing or donor
        timeout = "120s" if name == "importClubLogo" else runtime.get("timeout", "60s")
        command = ["gcloud", "functions", "deploy", name, f"--project={PROJECT}", f"--region={REGION}", "--no-gen2", "--runtime=nodejs22",
                   f"--entry-point={name}", "--trigger-http", f"--source={selected_source['source']}", "--ignore-file=.gcloudignore",
                   f"--service-account={runtime['serviceAccountEmail']}", f"--memory={runtime.get('availableMemoryMb', 256)}MB",
                   f"--timeout={timeout}", "--ingress-settings=all", "--security-level=secure-always",
                   f"--update-labels=deployment-callable=true,posetek-club-source={selected_source['manifestHash'][:20]}", "--quiet", "--format=json"]
        if runtime.get("ingressSettings", "ALLOW_ALL") != "ALLOW_ALL" or runtime.get("httpsTrigger", {}).get("securityLevel", "SECURE_ALWAYS") != "SECURE_ALWAYS":
            raise ValueError(f"Review nonstandard ingress/security settings before deployment: {name}")
        for key, flag in [("minInstances", "--min-instances"), ("maxInstances", "--max-instances")]:
            if key in runtime: command.append(f"{flag}={runtime[key]}")
        env_metadata = None
        if not existing:
            env = copy.deepcopy(donor.get("environmentVariables", {}))
            if "EVENTARC_CLOUD_EVENT_SOURCE" in env:
                env["EVENTARC_CLOUD_EVENT_SOURCE"] = f"projects/{PROJECT}/locations/{REGION}/functions/{name}"
            env_path = output / f"env-{name}.json"; private_write(env_path, env)
            command += ["--allow-unauthenticated", f"--env-vars-file={env_path.resolve()}"]
            env_metadata = {"path": str(env_path.resolve()), "sha256": hashlib.sha256(env_path.read_bytes()).hexdigest()}
        if name in SHARES: command.append(f"--update-secrets={SECRET}=projects/{PROJECT}/secrets/{SECRET}:{secret_version}")
        operations.append({"name": name, "action": "update" if existing else "create", "argv": command, "timeout": timeout, "sourceKind": source_kind, "sourceManifestHash": selected_source["manifestHash"], "environmentFile": env_metadata})
    plan = {"project": PROJECT, "region": REGION, "baselineHash": digest(baseline), "sourceManifestHash": manifest_hash, "sources": sources,
            "sharingBaselineZipSha256": sharing_manifest["baseSourceZipSha256"], "secretVersion": secret_version, "operations": operations,
            "preservedFunctions": sorted(set(records) - set(ENDPOINTS)), "createdAt": now(),
            "requiredVerification": ["club-sdk-canonical-and-scoped", "handler-tests", "web-build", "gateway-club-candidate", "scoped-sharing-offline", "secret-and-runtime-iam", "rollback-source-archives"]}
    plan["planHash"] = digest(plan)
    private_write(output / "plan.json", plan)
    private_write(output / "baseline.json", baseline)
    print(json.dumps({"status": "prepared", "planHash": plan["planHash"], "sourceManifestHash": manifest_hash,
                      "newFunctions": sum(op['action'] == 'create' for op in operations), "updatedFunctions": sum(op['action'] == 'update' for op in operations), "preservedFunctions": plan['preservedFunctions']}))


def verify_plan(plan, baseline, evidence):
    if plan.get("planHash") != digest({key: value for key, value in plan.items() if key != "planHash"}): raise ValueError("Plan changed after review")
    if plan.get("baselineHash") != digest(baseline) or plan.get("project") != PROJECT or plan.get("region") != REGION: raise ValueError("Baseline/target mismatch")
    if [op["name"] for op in plan["operations"]] != ENDPOINTS: raise ValueError("Endpoint scope changed")
    if set(plan["sources"]) != {"functions", "sharing"}: raise ValueError("Source scope changed")
    for source in plan["sources"].values():
        if source_entries(Path(source["source"]), source["files"], exact=True) != source["files"] or digest(source["files"]) != source["manifestHash"]:
            raise ValueError("Prepared source changed")
    if plan["sourceManifestHash"] != digest({kind: item["manifestHash"] for kind, item in plan["sources"].items()}):
        raise ValueError("Combined source manifest changed")
    for operation in plan["operations"]:
        env = operation.get("environmentFile")
        if env and (f"--env-vars-file={env['path']}" not in operation["argv"] or hashlib.sha256(Path(env["path"]).read_bytes()).hexdigest() != env["sha256"]):
            raise ValueError("Prepared environment settings changed")
        expected_kind = "sharing" if operation["name"] in SHARES else "functions"
        expected_source = plan["sources"][expected_kind]
        if operation.get("sourceKind") != expected_kind or operation.get("sourceManifestHash") != expected_source["manifestHash"]:
            raise ValueError("Endpoint source scope changed")
        if f"--source={expected_source['source']}" not in operation["argv"]:
            raise ValueError("Endpoint source command changed")
    if evidence.get("planHash") != plan["planHash"] or evidence.get("sourceManifestHash") != plan["sourceManifestHash"]: raise ValueError("Verification is for a different plan/source")
    if any(evidence.get("checks", {}).get(check) is not True for check in plan["requiredVerification"]): raise ValueError("Required release validation remains incomplete")
    for name in SHARES & set(baseline['functions']):
        archive = evidence.get("rollbackSources", {}).get(name, {})
        path = Path(archive.get("archive", ""))
        if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != archive.get("sha256") or archive.get("sha256") != plan["sharingBaselineZipSha256"]: raise ValueError(f"Verified private rollback source archive is missing for {name}")


def deploy(plan_path, evidence_path, journal_path):
    plan_path = Path(plan_path); plan = read(plan_path); baseline = read(plan_path.parent / "baseline.json"); evidence = read(evidence_path)
    verify_plan(plan, baseline, evidence)
    if Path(journal_path).exists(): raise ValueError("Use a new deployment journal; never retry a partial rollout blindly")
    live = inventory()
    if live != baseline["functions"]: raise ValueError("Live function baseline changed; snapshot and review again")
    for name, policy in baseline["iam"].items():
        if iam(name) != policy: raise ValueError(f"IAM baseline changed: {name}")
    secret = gcloud(["secrets", "versions", "describe", plan["secretVersion"], f"--secret={SECRET}", f"--project={PROJECT}", "--format=json"])
    if secret.get("state") != "ENABLED": raise ValueError("Signing-secret version is not enabled")
    journal = {"project": PROJECT, "planHash": plan["planHash"], "sourceManifestHash": plan["sourceManifestHash"], "status": "prepared", "startedAt": now(), "completed": []}
    private_write(journal_path, journal)
    try:
        for operation in plan["operations"]:
            name = operation["name"]
            journal.update(status="deploying", current=name); private_write(journal_path, journal)
            result = subprocess.run(operation["argv"], capture_output=True, text=True)
            private_write(Path(journal_path).parent / (Path(journal_path).stem + "-" + name + "-cli.json"),
                          {"returncode": result.returncode, "stdout": result.stdout, "stderr": result.stderr})
            if result.returncode: raise RuntimeError(f"Deployment failed for {name}; inspect private CLI journal before any retry")
            current = gcloud(["functions", "describe", name, f"--project={PROJECT}", f"--region={REGION}", "--format=json"])
            validate_existing(name, current)
            if current.get("labels", {}).get("posetek-club-source") != operation["sourceManifestHash"][:20]: raise RuntimeError(f"Source label readback mismatch: {name}")
            before = baseline["functions"].get(name)
            if before and stable(before, allow_source_label=True, allow_share_secret=name in SHARES) != stable(current, allow_source_label=True, allow_share_secret=name in SHARES): raise RuntimeError(f"Unintended runtime setting changed: {name}")
            if before and iam(name) != baseline["iam"][name]: raise RuntimeError(f"IAM policy changed: {name}")
            if not before and not any(b.get("role") == "roles/cloudfunctions.invoker" and "allUsers" in b.get("members", []) for b in iam(name).get("bindings", [])): raise RuntimeError(f"Callable invoker IAM is missing: {name}")
            if name in SHARES and not any(s.get("key") == SECRET and s.get("version") == plan["secretVersion"] for s in current.get("secretEnvironmentVariables", [])): raise RuntimeError(f"Signing-secret binding mismatch: {name}")
            journal["completed"].append({"name": name, "action": operation["action"], "versionId": current.get("versionId"), "updateTime": current.get("updateTime"), "runtimeHash": digest(stable(current)), "iamHash": digest(iam(name))})
            private_write(journal_path, journal)
        after = inventory()
        for name in plan["preservedFunctions"]:
            if after.get(name) != baseline["functions"][name] or iam(name) != baseline["iam"][name]: raise RuntimeError(f"Unrelated function changed: {name}")
        journal.update(status="deployed-runtime-verified-functional-checks-pending", finishedAt=now()); private_write(journal_path, journal)
    except Exception:
        journal.update(status="partial-or-unconfirmed", failedAt=now()); private_write(journal_path, journal); raise
    print(json.dumps({"status": journal["status"], "functions": len(journal["completed"]), "planHash": plan["planHash"]}))


def main():
    parser = argparse.ArgumentParser(description=__doc__); commands = parser.add_subparsers(dest="command", required=True)
    snap = commands.add_parser("snapshot"); snap.add_argument("--output", required=True)
    prep = commands.add_parser("prepare")
    for arg in ["source", "sharing-source", "sharing-manifest", "baseline", "output", "share-secret-version"]: prep.add_argument("--" + arg, required=True)
    apply = commands.add_parser("deploy")
    for arg in ["plan", "evidence", "journal"]: apply.add_argument("--" + arg, required=True)
    args = parser.parse_args()
    if args.command == "snapshot": snapshot(args.output)
    elif args.command == "prepare": prepare(args.source, args.sharing_source, args.sharing_manifest, args.baseline, args.output, args.share_secret_version)
    else: deploy(args.plan, args.evidence, args.journal)


if __name__ == "__main__":
    try: main()
    except (ValueError, RuntimeError, OSError, json.JSONDecodeError) as error:
        print(str(error) if isinstance(error, (ValueError, RuntimeError)) else "Release input/output failed; inspect private artifacts.", file=sys.stderr)
        raise SystemExit(1)
