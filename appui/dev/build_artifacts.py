"""Build/check AppUI's declared portable distributions and mirrors.

Run from any directory: python framework/appui/dev/build_artifacts.py [--check]
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import sys
import re

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))
from framework.page_assets import build


def versioned_loader(appui):
    """Stamp portable deployments too; hosted loader versions are derived live."""
    loader = (appui / "loader.js").read_text(encoding="utf-8")
    pattern = r"(var _fwVersion = ')[^']*(';)"
    normalized, count = re.subn(pattern, r"\1CONTENT_VERSION\2", loader)
    if count != 1:
        raise ValueError("Expected one loader asset-version declaration")
    digest = hashlib.sha256(normalized.encode())
    files = [appui / name for name in ("sw.js", "app.htm", "artifacts.json")]
    for folder in ("src", "assets", "lib", "vendor"):
        files += [file for file in (appui / folder).rglob("*") if file.suffix in (".js", ".css")]
    for file in sorted(files):
        body = file.read_bytes().replace(b"\r\n", b"\n")
        digest.update(str(file.relative_to(appui)).replace("\\", "/").encode() + b"\0")
        digest.update(str(len(body)).encode() + b"\0" + body)
    return re.sub(pattern, lambda match: match[1] + digest.hexdigest()[:16] + match[2], loader).encode()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="report drift without writing artifacts")
    args = parser.parse_args()
    appui = ROOT / "framework/appui"
    manifest = appui / "artifacts.json"
    spec = json.loads(manifest.read_text(encoding="utf-8"))
    failures = []
    for output in spec["page_assets"]:
        result = build(appui, output, minify=False, manifest_path=manifest, fallback=False)
        if result is None:
            raise ValueError(f"Missing declaration: {output}")
        body, _ = result
        destinations = [appui / output]
        destinations += [ROOT / mirror for mirror in spec.get("mirrors", {}).get(output, [])]
        for destination in destinations:
            destination = destination.resolve()
            if not destination.is_relative_to(ROOT):
                raise ValueError(f"Artifact destination outside repository: {destination}")
            if destination.is_file() and destination.read_bytes() == body:
                continue
            if args.check:
                failures.append(str(destination.relative_to(ROOT)))
            else:
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_bytes(body)
                print(f"Built {destination.relative_to(ROOT)}")
    if failures:
        print("Artifact drift:\n" + "\n".join(failures), file=sys.stderr)
        return 1
    loader_path = appui / "loader.js"
    stamped = versioned_loader(appui)
    if loader_path.read_bytes().replace(b"\r\n", b"\n") != stamped:
        if args.check:
            print("Loader asset version is stale", file=sys.stderr)
            return 1
        loader_path.write_bytes(stamped)
        print("Stamped loader asset version")
    print("AppUI artifacts are current")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
