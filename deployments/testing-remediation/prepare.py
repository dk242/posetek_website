"""Prepare/verify exactly two result-read callables using the existing audited release verifier."""
from pathlib import Path
import argparse
import importlib.util

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("scoped_release", HERE.parent / "expanded-insights" / "prepare.py")
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)
release.HERE = HERE
release.ENDPOINTS = ("getAthleteEffectiveResults", "getAthleteRepMedia")
release.CALLABLES = release.ENDPOINTS
release.FILES = ("effective-results.js", "processing-evidence.js", "insights-v2-qualification.js",
                 "insights-v2-projection.js", "club-access.js", "athlete-storage-paths.js", "package.json", "package-lock.json")
release.FIREBASE_CONFIG = {"functions": {"source": "source", "codebase": "testing-results", "runtime": "nodejs22"}}

def definitions():
    return {name: {"timeout": "120s", "availableMemoryMb": 512, "maxInstances": 10,
                   "httpsTrigger": True, "callableLabel": "true", "publicInvoker": True,
                   "ingressSettings": "ALLOW_ALL"} for name in release.ENDPOINTS}

release.expected_definitions = definitions

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=["prepare", "verify"], required=True)
    parser.add_argument("--run-dir", required=True)
    parser.add_argument("--credential-file", required=True)
    args = parser.parse_args()
    action = release.prepare if args.mode == "prepare" else release.verify
    action(release.private(args.run_dir), release.Api(args.credential_file))
