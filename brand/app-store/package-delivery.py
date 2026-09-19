"""Package App Store review artifacts and explicitly selected local screenshots.

python package-delivery.py --native-patch PATH --native-readme PATH --output-dir PATH
The full ZIP includes editable sources. The email ZIP contains artwork and handoff.
"""
import argparse
import hashlib
import json
import re
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent.parent
PREFIX = "brand/app-store/"


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--native-patch", type=Path, required=True)
    parser.add_argument("--native-readme", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--version", default="v2")
    parser.add_argument("--review-input", type=Path)
    args = parser.parse_args()
    if not re.fullmatch(r"v[1-9][0-9]*", args.version):
        parser.error("--version must be v followed by a positive integer")
    output = args.output_dir.resolve()
    output.mkdir(parents=True, exist_ok=True)
    gallery = json.loads((ROOT / "gallery-content.json").read_text(encoding="utf-8"))
    metadata = json.loads((ROOT / "metadata.json").read_text(encoding="utf-8"))
    manifest = json.loads((ROOT / "output/gallery-manifest.json").read_text(encoding="utf-8"))
    private_inputs = {}
    if manifest.get("mode") == "user-supplied-review":
        if args.review_input is None:
            parser.error("A supplied-screenshot review needs --review-input for reproducible packaging")
        input_path = args.review_input.resolve()
        review = json.loads(input_path.read_text(encoding="utf-8"))
        expected = {(item["platform"], item["id"]): item for item in manifest["images"]
                    if item.get("nativeScreenshotSupplied")}
        seen = set()
        for device in ["iphone", "ipad"]:
            for panel_id, entry in review.get(device, {}).items():
                record = expected.get((device, panel_id))
                if record is None:
                    raise ValueError(f"Review input has no matching rendered capture: {device}/{panel_id}")
                filename = entry if isinstance(entry, str) else entry["file"]
                source = (input_path.parent / filename).resolve()
                suffix = source.suffix.lower()
                if suffix not in {".png", ".jpg", ".jpeg"}:
                    raise ValueError("Only explicit PNG/JPEG review inputs can be packaged")
                data = source.read_bytes()
                if sha256(data) != record["capture"]["sha256"]:
                    raise ValueError(f"Screenshot changed since rendering: {device}/{panel_id}")
                if isinstance(entry, dict):
                    for key in ["headline", "description", "eyebrow", "screenTitle"]:
                        if key in entry and entry[key] != record[key]:
                            raise ValueError(f"Caption changed since rendering: {device}/{panel_id}/{key}")
                relative = f"review-inputs/{device}-{panel_id}{suffix}"
                private_inputs[PREFIX + relative] = data
                review[device][panel_id] = relative if isinstance(entry, str) else {**entry, "file": relative}
                seen.add((device, panel_id))
        if seen != set(expected):
            raise ValueError("Review input does not match every supplied screenshot in the render")
        private_inputs[PREFIX + "gallery-review.local.json"] = json.dumps(review, indent=2).encode()
    elif args.review_input is not None:
        parser.error("--review-input requires an output rendered in user-supplied-review mode")
    supplied_count = sum(bool(item.get("nativeScreenshotSupplied")) for item in manifest["images"])
    preview_count = len(manifest["images"]) - supplied_count
    status = (f"{supplied_count} supplied screenshot compositions and {preview_count} illustrative previews. "
              "Verify original resolution, release-build identity and visible personal details before external release. "
              "Replace remaining previews with release-build captures before uploading.")
    common = {}

    def add(target, source):
        common[target] = source.read_bytes()

    for file in ["README.md", "TAIYO_HANDOFF.md", "DESIGN_REFERENCES.md", "capture-brief.md",
                 "SCREENSHOT_UPDATE.md", "metadata.json", "gallery-content.json", "gallery-input.example.json",
                 "review-input.example.json", "asset-validation.json"]:
        add(PREFIX + file, ROOT / file)
    for file in sorted((REPO / "images/brand").iterdir()):
        if file.is_file() and file.suffix.lower() in {".png", ".jpg", ".svg", ".md", ".txt"}:
            add("images/brand/" + file.name, file)
    for device in ["iphone", "ipad"]:
        for panel in gallery["panels"]:
            name = f"{device}-{panel['id']}.png"
            add(PREFIX + "output/" + name, ROOT / "output" / name)
    add(PREFIX + "output/gallery-manifest.json", ROOT / "output/gallery-manifest.json")
    add(PREFIX + "output/gallery-validation.json", ROOT / "output/gallery-validation.json")
    add(PREFIX + "output/gallery-review.html", ROOT / "output/gallery-review.html")
    add("native/" + args.native_patch.name, args.native_patch)
    add("native/README.md", args.native_readme)
    # Main review is offline-capable in delivery packages, with embedded public copy.
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    old = "Promise.all([fetch('metadata.json').then(r=>r.json()),fetch('gallery-content.json').then(r=>r.json()),fetch('output/gallery-manifest.json').then(r=>r.json())])"
    if old not in html:
        raise ValueError("Review data loader changed; update the offline packaging transform")
    embedded = json.dumps([metadata, gallery, manifest], ensure_ascii=False).replace("<", "\\u003c")
    common[PREFIX + "index.html"] = html.replace(old, "Promise.resolve(" + embedded + ")").encode()
    for file in sorted((ROOT / "fonts").iterdir()):
        if file.is_file():
            add(PREFIX + "fonts/" + file.name, file)
    # Include asset licenses and provenance even in the artwork-only handoff.
    for folder in ["emoji", "pose"]:
        for file in sorted((ROOT / folder).rglob("*")):
            if file.is_file() and (file.suffix.lower() in {".json", ".svg", ".md", ".txt"} or file.name == "LICENSE"):
                add(PREFIX + file.relative_to(ROOT).as_posix(), file)
    common["START_HERE.html"] = ('''<!doctype html><html lang="en"><meta charset="utf-8"><title>PoseTek App Store handoff</title><meta name="viewport" content="width=device-width,initial-scale=1"><body style="background:#04130e;color:#f0f5ed;font:18px/1.6 system-ui;padding:40px;max-width:800px"><h1>PoseTek App Store handoff</h1><p><a style="color:#b7f34a" href="brand/app-store/index.html">Open the icon, six-image gallery and listing copy</a></p><p>Read brand/app-store/TAIYO_HANDOFF.md for the release steps. ''' + status + ''' The icon requires a signed iOS build.</p><p>Editable sources: <a style="color:#b7f34a" href="https://github.com/dk242/posetek_website/tree/codex/official-brand-icon/brand/app-store">PoseTek repository</a>.</p></body></html>''').encode()
    common["PACKAGE_README.txt"] = ("PoseTek App Store handoff\n\nExtract the ZIP, then open START_HERE.html.\n"
        "Instructions: brand/app-store/TAIYO_HANDOFF.md\n"
        "Icon PNG, reusable JPEG and SVG: images/brand/\n"
        "Six iPhone + six iPad PNG previews: brand/app-store/output/\n"
        "Listing fields: brand/app-store/metadata.json\n"
        "Native icon patch and Mac instructions: native/\n\n"
        + status + "\n"
        "No App Store Connect metadata or build was published by this task.\n"
        "Editable source: https://github.com/dk242/posetek_website/tree/codex/official-brand-icon/brand/app-store\n").encode()

    full = dict(common)
    # Explicit allowlist: include only requested review inputs, never unrelated local files.
    full.update(private_inputs)
    for file in ROOT.iterdir():
        if file.is_file() and file.suffix in {".mjs", ".py"}:
            full[PREFIX + file.name] = file.read_bytes()
    for name in ["package.json", "package-lock.json", ".gitignore", ".gitattributes"]:
        full[PREFIX + name] = (ROOT / name).read_bytes()
    for folder in ["pose", "emoji", "source"]:
        for file in sorted((ROOT / folder).rglob("*")):
            if file.is_file() and (file.suffix.lower() in {".json", ".svg", ".md", ".txt", ".mjs"} or file.name == "LICENSE"):
                full[PREFIX + file.relative_to(ROOT).as_posix()] = file.read_bytes()
    full[PREFIX + "output/contact-sheet.png"] = (ROOT / "output/contact-sheet.png").read_bytes()
    full[PREFIX + "output/pose-reference-sheet.png"] = (ROOT / "output/pose-reference-sheet.png").read_bytes()

    # The binary patch preserves the old raster for Git's reversible patch format.
    # Keep it with integration sources; attachment-size eligibility is reported below.
    patch_key = "native/" + args.native_patch.name
    handoff = {key: value for key, value in common.items() if key != patch_key}
    review_key = PREFIX + "output/gallery-review.html"
    handoff[review_key] = handoff[review_key].replace(
        b'<a href="contact-sheet.png">View iPhone contact sheet</a> \xc2\xb7 ', b'')
    handoff["PACKAGE_README.txt"] += ("\nThe native patch and editable source are in the companion integration ZIP.\n"
        "Extract both ZIPs into the same folder to combine them.\n").encode()
    integration = {key: value for key, value in full.items()
                   if not key.startswith(PREFIX + "output/") and not key.startswith(PREFIX + "source/")}
    integration["PACKAGE_README.txt"] = ("PoseTek editable source and native integration\n\n"
        "Extract into the same folder as the handoff ZIP.\n"
        "Native patch: " + patch_key + "\n"
        "Read brand/app-store/TAIYO_HANDOFF.md before integration.\n"
        "Generator: cd brand/app-store; npm ci; npm run render"
        + (" -- --review-input gallery-review.local.json" if private_inputs else "") + "\n"
        "Validation: npm run validate\n"
        + ("Private review inputs: brand/app-store/review-inputs/ and gallery-review.local.json.\n"
           "These exact screenshots include a visible player identity; keep this review package private.\n" if private_inputs else "") +
        "No private video, credentials, or signed storage URLs are included.\n").encode()
    integration[PREFIX + "output/pose-reference-sheet.png"] = full[PREFIX + "output/pose-reference-sheet.png"]
    records = []
    for kind, files in [("handoff", handoff), ("integration", integration), ("full-source", full)]:
        receipt = {
            "package": kind,
            "submissionReady": manifest.get("submissionReady", False),
            "files": [{"path": path, "bytes": len(data), "sha256": sha256(data)}
                      for path, data in sorted(files.items())],
        }
        files = dict(files)
        files["PACKAGE_MANIFEST.json"] = json.dumps(receipt, indent=2).encode()
        target = output / f"posetek-app-store-{kind}-{args.version}.zip"
        with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
            for path, data in sorted(files.items()):
                archive.writestr(path, data)
        with zipfile.ZipFile(target) as archive:
            assert archive.testzip() is None
            for item in receipt["files"]:
                assert sha256(archive.read(item["path"])) == item["sha256"]
        data = target.read_bytes()
        records.append({"path": str(target), "bytes": len(data), "sha256": sha256(data),
                        "files": len(files), "outlookDirectAttachmentEligible": len(data) < 3_000_000})
    (output / f"posetek-app-store-delivery-{args.version}.json").write_text(json.dumps(records, indent=2), encoding="utf-8")
    print(json.dumps(records, indent=2))


if __name__ == "__main__":
    main()
