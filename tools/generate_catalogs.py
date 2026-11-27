#!/usr/bin/env python3
"""Generate declarative app catalogs in pylon-client/catalogs/ from pylon-server/api and pylon-client/pages."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

CLIENT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SERVER_ROOT = CLIENT_ROOT.parent / "pylon-server"


def generate(
    server_root: Path = DEFAULT_SERVER_ROOT,
    client_root: Path = CLIENT_ROOT,
    api_origin: str = "https://pylon-server.duckdns.org",
    pages_origin: str = "https://ai-pylon.github.io",
) -> dict:
    api_root = server_root / "api"
    pages_root = client_root / "pages"
    catalogs_root = client_root / "catalogs"
    catalogs_root.mkdir(parents=True, exist_ok=True)
    (catalogs_root / "profiles").mkdir(parents=True, exist_ok=True)

    discovered: dict[str, dict] = {}

    # 1. Read non-secret metadata from server api/**/manifest.json if available
    if api_root.is_dir():
        for manifest_path in sorted(api_root.glob("*/*/manifest.json")):
            try:
                data = json.loads(manifest_path.read_text(encoding="utf-8"))
            except Exception:
                continue
            group = manifest_path.parents[1].name
            name = manifest_path.parent.name
            app_id = str(data.get("id") or f"{group}/{name}")
            entry = {
                "id": app_id,
                "group": group,
                "name": name,
                "title": str(data.get("title") or name),
                "category": str(data.get("category") or group),
                "description": str(data.get("description") or ""),
                "tags": list(data.get("tags") or []),
                "workspace": data.get("workspace") or {},
                "api": f"/v1/apps/{group}/{name}",
                "has_api": True,
                "page": None,
                "has_page": False,
                "needs_apps": [
                    (item.get("id") if isinstance(item, dict) else str(item))
                    for item in (data.get("needs_apps") or [])
                ],
            }
            discovered[app_id] = entry

    # 2. Match against pylon-client/pages/<group>/<name>/
    if pages_root.is_dir():
        for group_dir in sorted(pages_root.iterdir()):
            if not group_dir.is_dir():
                continue
            for app_dir in sorted(group_dir.iterdir()):
                if not app_dir.is_dir():
                    continue
                has_index = (app_dir / "index.htm").is_file() or (app_dir / "index.html").is_file()
                if not has_index:
                    continue
                group = group_dir.name
                name = app_dir.name
                app_id = f"{group}/{name}"
                page_path = f"/pages/{group}/{name}/"
                if app_id in discovered:
                    discovered[app_id]["page"] = page_path
                    discovered[app_id]["has_page"] = True
                else:
                    discovered[app_id] = {
                        "id": app_id,
                        "group": group,
                        "name": name,
                        "title": name.replace("_", " ").title(),
                        "category": group,
                        "description": "",
                        "tags": [],
                        "workspace": {},
                        "api": None,
                        "has_api": False,
                        "page": page_path,
                        "has_page": True,
                        "needs_apps": [],
                    }

    apps_list = [discovered[k] for k in sorted(discovered.keys())]

    config = {
        "schema_version": 1,
        "api_origin": api_origin.rstrip("/"),
        "pages_origin": pages_origin.rstrip("/"),
        "default_profile": "default",
    }
    (catalogs_root / "config.json").write_text(
        json.dumps(config, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )

    catalog = {
        "schema_version": 1,
        "count": len(apps_list),
        "page_count": sum(1 for a in apps_list if a["has_page"]),
        "apps": apps_list,
    }
    (catalogs_root / "catalog.json").write_text(
        json.dumps(catalog, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )

    default_profile = {
        "schema_version": 1,
        "name": "default",
        "description": "Default Pylon static page catalog profile",
        "apps": [a["id"] for a in apps_list if a["has_page"]],
    }
    (catalogs_root / "profiles" / "default.json").write_text(
        json.dumps(default_profile, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )

    return {
        "total_apps": len(apps_list),
        "with_pages": catalog["page_count"],
        "api_only": sum(1 for a in apps_list if a["has_api"] and not a["has_page"]),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate pylon-client/catalogs/")
    parser.add_argument("--server-root", default=str(DEFAULT_SERVER_ROOT))
    parser.add_argument("--api-origin", default="https://pylon-server.duckdns.org")
    parser.add_argument("--pages-origin", default="https://ai-pylon.github.io")
    args = parser.parse_args()
    summary = generate(
        server_root=Path(args.server_root),
        api_origin=args.api_origin,
        pages_origin=args.pages_origin,
    )
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
