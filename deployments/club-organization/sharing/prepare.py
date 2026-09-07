#!/usr/bin/env python3
"""Offline exact reconstruction; private runtime config is never printed."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil

ARTIFACT = Path(__file__).resolve().parent

def entries(source):
    result = {}
    for path in sorted(source.iterdir()):
        if path.is_symlink() or not path.is_file():
            raise ValueError("Baseline/candidate must contain only regular source files")
        data = path.read_bytes()
        result[path.name] = {"sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data)}
    return result

def prepare(baseline, output):
    manifest = json.loads((ARTIFACT / "source-manifest.json").read_text())
    baseline, output = Path(baseline), Path(output)
    if output.exists(): raise ValueError("Output must be a new private directory")
    if entries(baseline) != manifest["baseFiles"]: raise ValueError("Exact serving source baseline did not match")
    overrides = ARTIFACT / "overrides"
    if set(entries(overrides)) != set(manifest["changedFiles"]): raise ValueError("Override scope changed")
    output.mkdir(parents=True, mode=0o700)
    for name in manifest["files"]:
        source = overrides / name if name in manifest["changedFiles"] else baseline / name
        content = source.read_bytes()
        expected = manifest["files"][name]
        if len(content) != expected["bytes"] or hashlib.sha256(content).hexdigest() != expected["sha256"]:
            raise ValueError("Reviewed source content changed")
        destination = output / name
        fd = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "wb") as handle: handle.write(content)
    if entries(output) != manifest["files"]: raise ValueError("Reconstructed source did not match")
    print(json.dumps({"status": "reconstructed", "filesManifestSha256": manifest["filesManifestSha256"], "files": len(manifest["files"])}))

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    prepare(args.baseline, args.output)
