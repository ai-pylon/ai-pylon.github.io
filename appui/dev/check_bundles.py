"""Validate the AppUI bundle graph and report raw, minified and gzip sizes."""
from __future__ import annotations

import gzip
import json
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))
from framework import bundler
from framework.page_assets import minify_javascript


def main():
    source = (ROOT / "framework/appui/loader.js").read_text(encoding="utf-8")
    defs = bundler._load_bundle_defs()
    match = re.search(r"var _bundleDeps = (\{[\s\S]*?\n\});", source)
    deps = json.loads(match[1])
    if not defs:
        raise ValueError("No bundle definitions parsed")
    bodies = {}
    for name, files in defs.items():
        if not files:
            raise ValueError(f"Empty bundle: {name}")
        bodies[name] = b"\n;\n".join(Path(bundler._appui_path(file)).read_bytes() for file in files)

    def closure(name, trail=()):
        if name in trail:
            raise ValueError(f"Dependency cycle: {trail + (name,)}")
        if name not in defs:
            raise ValueError(f"Unknown bundle dependency: {name}")
        result = {name}
        for dependency in deps.get(name, []):
            result |= closure(dependency, trail + (name,))
        return result

    for name in defs:
        closure(name)
    foundation = closure("foundation")
    files = [file for name in foundation for file in defs[name]]
    if len(files) != len(set(files)):
        raise ValueError("Foundation includes duplicate source files")
    for name in ("foundationCore", "dialog", "menu", "statusbar", "foundation", "shell"):
        body = b"\n;\n".join(bodies[item] for item in sorted(closure(name)))
        compact = minify_javascript(body)
        print(f"{name:16} raw={len(body):7} minified={len(compact):7} gzip={len(gzip.compress(compact, mtime=0)):7}")
    print(f"Validated {len(defs)} bundles")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
