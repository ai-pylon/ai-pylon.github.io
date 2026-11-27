#!/usr/bin/env python3
"""Static GitHub Pages builder for ai-pylon.github.io (pylon-client).

Assembles:
  - /catalogs/     <- declarative app catalog, config, profiles
  - /appui/        <- AppUI runtime + pre-built bundles from appui/loader.js
  - /dependencies/ <- browser vendor libs (e.g. marked.min.js)
  - /pages/        <- static app pages (<group>/<name>/index.html)
  - /daemons/      <- install.ps1, install.sh, pylon-daemon.zip, latest.json
  - /index.html    <- launcher UI backed by /catalogs/catalog.json
  - /pylon-config.js, /release.json, /.nojekyll

Includes a strict secret-scan gate so credentials or private keys can never
be published to GitHub Pages.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import http.server
import json
import os
import re
import shutil
import socketserver
import subprocess
import zipfile
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]

ASSET_EXT = {
    ".js", ".mjs", ".css", ".svg", ".png", ".jpg", ".jpeg", ".gif", ".webp",
    ".woff", ".woff2", ".ttf", ".eot", ".ico", ".map", ".json", ".htm", ".html",
    ".txt", ".md", ".wasm",
}

SKIP_DIRS = {".git", "__pycache__", ".venv", ".venvs", "node_modules", "_site", "dist", "tests"}

SECRET_PATTERNS = [
    re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----\r?\n[A-Za-z0-9+/=]{20,}"),
    re.compile(r"\bgh[pousr]_[A-Za-z0-9]{20,}\b"),
    re.compile(r"\bAIza[0-9A-Za-z\-_]{30,}\b"),
    re.compile(r"\bsk-[A-Za-z0-9]{20,}\b"),
    re.compile(r"PYLON_GATEWAY_SECRET\s*=\s*['\"][^'\"]{8,}['\"]"),
]


def _git_sha(repo_dir: Path) -> str:
    try:
        out = subprocess.check_output(
            ["git", "rev-parse", "--short", "HEAD"], cwd=repo_dir, stderr=subprocess.DEVNULL
        )
        return out.decode("utf-8").strip()
    except Exception:
        return "dev"


def _copy_safe(src: Path, dst: Path) -> None:
    if not src.is_file() or src.is_symlink() or not src.resolve().is_relative_to(ROOT):
        raise ValueError(f"Missing or unsafe asset: {src}")
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(src, dst)


def _build_appui_bundles(out: Path) -> list[str]:
    loader_path = ROOT / "appui" / "loader.js"
    loader = loader_path.read_text(encoding="utf-8")
    m = re.search(r"var _bundleDefs\s*=\s*\{(.*?)\n\s*\};", loader, re.S)
    if not m:
        raise ValueError("Cannot locate AppUI _bundleDefs in appui/loader.js")
    bundles = {
        name: re.findall(r"'([^']+)'", body)
        for name, body in re.findall(r"'([A-Za-z0-9_]+)'\s*:\s*\[(.*?)\]", m.group(1), re.S)
    }
    built: list[str] = []
    for name, paths in bundles.items():
        parts: list[bytes] = []
        for value in paths:
            if (not value.startswith("/appui/") and not value.startswith("/dependencies/")) or ".." in value.split("/"):
                raise ValueError(f"Invalid bundle input: {value}")
            src = ROOT / value.lstrip("/")
            if not src.is_file() or src.is_symlink():
                raise ValueError(f"Missing bundle input: {value}")
            parts.append(src.read_bytes())
        dest = out / "appui" / "bundle" / f"{name}.js"
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(b"\n;\n".join(parts))
        built.append(name)
    return sorted(built)


def _package_daemons(out: Path, base_path: str, version: str) -> dict:
    daemons_src = ROOT / "daemons"
    daemons_out = out / "daemons"
    daemons_out.mkdir(parents=True, exist_ok=True)

    for installer in ("install.ps1", "install.sh"):
        p = daemons_src / installer
        if p.is_file():
            _copy_safe(p, daemons_out / installer)

    zip_path = daemons_out / "pylon-daemon.zip"
    included = 0
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for dirpath, dirnames, filenames in os.walk(daemons_src):
            dirnames[:] = sorted(d for d in dirnames if d not in SKIP_DIRS)
            dp = Path(dirpath)
            for fname in sorted(filenames):
                if fname.endswith((".pyc", ".pyo", ".tmp", ".log")) or fname in ("install.ps1", "install.sh", "latest.json"):
                    continue
                fp = dp / fname
                if fp.is_symlink():
                    continue
                rel = fp.relative_to(ROOT).as_posix()
                zf.write(fp, arcname=rel)
                included += 1

    zip_bytes = zip_path.read_bytes()
    sha256 = hashlib.sha256(zip_bytes).hexdigest()
    latest = {
        "schema_version": 1,
        "version": version,
        "file": "pylon-daemon.zip",
        "url": f"{base_path}/daemons/pylon-daemon.zip",
        "sha256": sha256,
        "size": len(zip_bytes),
        "files": included,
        "built_at": dt.datetime.now(dt.timezone.utc).isoformat(),
    }
    (daemons_out / "latest.json").write_text(json.dumps(latest, indent=2) + "\n", encoding="utf-8")
    return latest


def _secret_scan(out: Path) -> None:
    findings: list[str] = []
    for p in sorted(out.rglob("*")):
        if not p.is_file():
            continue
        if p.name in (".gateway-secret", ".env") or "host-config" in p.parts:
            findings.append(f"Forbidden file: {p.relative_to(out).as_posix()}")
            continue
        if p.suffix.lower() in {".png", ".jpg", ".jpeg", ".gif", ".webp", ".woff", ".woff2", ".ttf", ".ico", ".zip", ".wasm"}:
            continue
        try:
            text = p.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            continue
        for pat in SECRET_PATTERNS:
            if pat.search(text):
                findings.append(f"Secret pattern {pat.pattern!r} matched in {p.relative_to(out).as_posix()}")
    if findings:
        raise RuntimeError("Secret scan failed:\n  - " + "\n  - ".join(findings))


def _render_launcher_html(base_path: str, api_origin: str) -> str:
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>AI Pylon</title>
  <style>
    :root {{ color-scheme: dark light; font-family: system-ui, -apple-system, sans-serif; }}
    body {{ max-width: 1080px; margin: 0 auto; padding: 24px 20px 64px; line-height: 1.5; }}
    header {{ display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 12px; border-bottom: 1px solid #8884; padding-bottom: 16px; margin-bottom: 20px; }}
    h1 {{ margin: 0; font-size: 1.6rem; }}
    .meta {{ font-size: 0.9rem; opacity: 0.78; }}
    .toolbar {{ display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 18px; }}
    input[type=search], input[type=url] {{ flex: 1; min-width: 220px; padding: 8px 12px; border-radius: 8px; border: 1px solid #8886; font-size: 0.95rem; }}
    button {{ padding: 8px 14px; border-radius: 8px; border: 1px solid #8886; background: #3b82f6; color: #fff; font-weight: 600; cursor: pointer; font-size: 0.9rem; }}
    button.secondary {{ background: transparent; color: inherit; font-weight: 500; }}
    .box {{ border: 1px solid #8884; border-radius: 10px; padding: 14px 16px; margin-bottom: 18px; }}
    .box h2 {{ margin: 0 0 8px; font-size: 1.05rem; }}
    .row {{ display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }}
    .status {{ font-size: 0.86rem; margin-top: 8px; opacity: 0.9; }}
    .status.ok {{ color: #22c55e; }}
    .status.warn {{ color: #f59e0b; }}
    code {{ background: #8882; padding: 2px 6px; border-radius: 5px; font-size: 0.88rem; word-break: break-all; }}
    .grid {{ display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 12px; }}
    .card {{ display: block; text-decoration: none; color: inherit; border: 1px solid #8884; border-radius: 10px; padding: 12px 14px; transition: border-color .15s; }}
    .card:hover {{ border-color: #3b82f6; }}
    .card .title {{ font-weight: 600; margin-bottom: 4px; }}
    .card .id {{ font-size: 0.8rem; opacity: 0.7; margin-bottom: 6px; }}
    .card .desc {{ font-size: 0.86rem; opacity: 0.88; }}
    .group-title {{ margin: 22px 0 10px; font-size: 1.05rem; text-transform: uppercase; letter-spacing: .04em; opacity: 0.75; }}
  </style>
</head>
<body>
  <header>
    <h1>AI Pylon</h1>
    <div class="meta"><a href="{base_path}/catalogs/catalog.json">catalog.json</a> · <a href="{base_path}/daemons/latest.json">daemons/latest.json</a></div>
  </header>

  <section class="box">
    <h2>Connected Pylon Server</h2>
    <form id="server-form" class="row">
      <input id="server-url" type="url" placeholder="https://pylon-server.duckdns.org or http://127.0.0.1:8910" required>
      <button type="submit">Connect &amp; Save</button>
      <button type="button" class="secondary" id="preset-vm">VM</button>
      <button type="button" class="secondary" id="preset-local">Local (127.0.0.1:8910)</button>
    </form>
    <div id="server-status" class="status">Checking server...</div>
  </section>

  <section class="box">
    <h2>Pylon Daemon Client Install</h2>
    <div>Windows (PowerShell): <code>irm https://ai-pylon.github.io/daemons/install.ps1 | iex</code></div>
    <div style="margin-top:6px">Linux / macOS: <code>curl -fsSL https://ai-pylon.github.io/daemons/install.sh | sh</code></div>
  </section>

  <div class="toolbar">
    <input id="q" type="search" placeholder="Filter apps by name, group, or description...">
  </div>
  <div id="apps">Loading catalog...</div>

  <script>
    const BASE = {json.dumps(base_path)};
    const DEFAULT_SERVER = {json.dumps(api_origin)};
    const STORAGE_KEY = 'pylon.server_origin';
    let allApps = [];
    let enabledSet = null;

    function normalizeOrigin(raw) {{
      try {{
        const u = new URL((raw || '').trim());
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
        return u.origin;
      }} catch (_) {{
        return '';
      }}
    }}

    function currentServer() {{
      const qp = new URLSearchParams(location.search).get('server');
      if (qp) {{
        const norm = normalizeOrigin(qp);
        if (norm) {{
          try {{ localStorage.setItem(STORAGE_KEY, norm); }} catch (_) {{}}
          return norm;
        }}
      }}
      try {{
        const saved = normalizeOrigin(localStorage.getItem(STORAGE_KEY) || '');
        if (saved) return saved;
      }} catch (_) {{}}
      return DEFAULT_SERVER;
    }}

    function setStatus(text, cls) {{
      const el = document.getElementById('server-status');
      el.textContent = text;
      el.className = 'status ' + (cls || '');
    }}

    function render(filterText) {{
      const q = (filterText || '').trim().toLowerCase();
      const root = document.getElementById('apps');
      const items = allApps.filter(a => {{
        if (!a.has_page) return false;
        if (enabledSet && !enabledSet.has(a.id)) return false;
        return !q || (a.id + ' ' + a.title + ' ' + a.description).toLowerCase().includes(q);
      }});
      const byGroup = new Map();
      for (const a of items) {{
        if (!byGroup.has(a.group)) byGroup.set(a.group, []);
        byGroup.get(a.group).push(a);
      }}
      root.innerHTML = '';
      for (const [group, list] of byGroup.entries()) {{
        const h = document.createElement('div');
        h.className = 'group-title';
        h.textContent = group + ' (' + list.length + ')';
        root.appendChild(h);
        const grid = document.createElement('div');
        grid.className = 'grid';
        for (const a of list) {{
          const link = document.createElement('a');
          link.className = 'card';
          link.href = BASE + a.page;
          link.innerHTML = '<div class="title"></div><div class="id"></div><div class="desc"></div>';
          link.querySelector('.title').textContent = a.title;
          link.querySelector('.id').textContent = a.id;
          link.querySelector('.desc').textContent = a.description || '';
          grid.appendChild(link);
        }}
        root.appendChild(grid);
      }}
      if (!items.length) root.textContent = 'No matching apps.';
    }}

    async function connectServer(origin) {{
      const input = document.getElementById('server-url');
      input.value = origin;
      setStatus('Connecting to ' + origin + ' ...');
      let catalogUrl = BASE + '/catalogs/catalog.json';
      enabledSet = null;
      try {{
        const res = await fetch(origin + '/_pylon/bootstrap', {{ mode: 'cors' }});
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const boot = await res.json();
        if (boot.catalog_url) catalogUrl = boot.catalog_url;
        if (Array.isArray(boot.enabled_apps) && boot.enabled_apps.length) {{
          enabledSet = new Set(boot.enabled_apps);
        }}
        setStatus('Connected: ' + (boot.server_name || origin) + ' (' + (boot.mode || 'server') + ') · catalog: ' + catalogUrl, 'ok');
      }} catch (err) {{
        setStatus('Server unreachable (' + origin + ': ' + err.message + ') — showing default static catalog.', 'warn');
      }}
      try {{
        const catRes = await fetch(catalogUrl);
        const cat = await catRes.json();
        allApps = cat.apps || [];
        render(document.getElementById('q').value);
      }} catch (err) {{
        document.getElementById('apps').textContent = 'Failed to load catalog: ' + err;
      }}
    }}

    document.getElementById('server-form').addEventListener('submit', e => {{
      e.preventDefault();
      const norm = normalizeOrigin(document.getElementById('server-url').value);
      if (!norm) {{
        setStatus('Invalid server URL. Use http:// or https:// origin.', 'warn');
        return;
      }}
      try {{ localStorage.setItem(STORAGE_KEY, norm); }} catch (_) {{}}
      connectServer(norm);
    }});
    document.getElementById('preset-vm').addEventListener('click', () => {{
      try {{ localStorage.setItem(STORAGE_KEY, DEFAULT_SERVER); }} catch (_) {{}}
      connectServer(DEFAULT_SERVER);
    }});
    document.getElementById('preset-local').addEventListener('click', () => {{
      const localOrigin = 'http://127.0.0.1:8910';
      try {{ localStorage.setItem(STORAGE_KEY, localOrigin); }} catch (_) {{}}
      connectServer(localOrigin);
    }});
    document.getElementById('q').addEventListener('input', e => render(e.target.value));
    connectServer(currentServer());
  </script>
</body>
</html>
"""


def build(out: Path, api_origin: str, base_path: str = "", clean: bool = True) -> dict:
    if base_path and not re.fullmatch(r"/[A-Za-z0-9_-]{1,100}", base_path):
        raise ValueError(f"Invalid Pages base path: {base_path!r}")
    u = urlsplit(api_origin)
    if u.scheme != "https" or not u.hostname or u.username or u.password or u.path or u.query or u.fragment:
        raise ValueError(f"Canonical HTTPS API origin required: {api_origin!r}")

    out = out.resolve()
    if out.exists():
        if clean:
            shutil.rmtree(out)
        else:
            raise ValueError(f"Output directory already exists: {out}")
    out.mkdir(parents=True, exist_ok=True)

    try:
        # 1. Copy catalogs/
        catalogs_src = ROOT / "catalogs"
        if catalogs_src.is_dir():
            for p in sorted(catalogs_src.rglob("*")):
                if p.is_file() and not p.is_symlink():
                    _copy_safe(p, out / p.relative_to(ROOT))

        # 2. Copy appui/ + dependencies/
        for rel in ("appui/loader.js", "appui/sw.js", "appui/app.htm", "dependencies/marked/marked.min.js"):
            sp = ROOT / rel
            if sp.is_file():
                _copy_safe(sp, out / rel)
        for folder in ("src", "assets", "lib", "vendor"):
            sub = ROOT / "appui" / folder
            if not sub.is_dir():
                continue
            for p in sorted(sub.rglob("*")):
                if p.is_file() and not p.is_symlink() and p.suffix.lower() in ASSET_EXT:
                    _copy_safe(p, out / p.relative_to(ROOT))

        bundles = _build_appui_bundles(out)

        # 3. Copy & rewrite pages/<group>/<name>/*
        pages_src = ROOT / "pages"
        page_apps: list[str] = []
        if pages_src.is_dir():
            for group_dir in sorted(pages_src.iterdir()):
                if not group_dir.is_dir() or group_dir.name in SKIP_DIRS:
                    continue
                for app_dir in sorted(group_dir.iterdir()):
                    if not app_dir.is_dir() or app_dir.name in SKIP_DIRS:
                        continue
                    for p in sorted(app_dir.rglob("*")):
                        if p.is_file() and not p.is_symlink() and not any(part in SKIP_DIRS for part in p.parts):
                            _copy_safe(p, out / p.relative_to(ROOT))
                    dst_app = out / "pages" / group_dir.name / app_dir.name
                    idx = dst_app / "index.htm"
                    if not idx.is_file():
                        idx = dst_app / "index.html"
                    if idx.is_file():
                        html = idx.read_text(encoding="utf-8", errors="replace")
                        if "/pylon-config.js" not in html and '<script src="/appui/loader.js">' in html:
                            html = html.replace(
                                '<script src="/appui/loader.js">',
                                '<script src="/pylon-config.js"></script>\n  <script src="/appui/loader.js">',
                                1,
                            )
                        if base_path:
                            html = re.sub(
                                r'((?:src|href)=")(/(?:appui/|pages/|catalogs/|pylon-config\.js|dependencies/))',
                                lambda m: m.group(1) + base_path + m.group(2),
                                html,
                            )
                        (dst_app / "index.html").write_text(html, encoding="utf-8")
                        if idx.name == "index.htm":
                            idx.unlink()
                        page_apps.append(f"{group_dir.name}/{app_dir.name}")

        # 4. Cross-validate catalog page references
        catalog_path = out / "catalogs" / "catalog.json"
        missing_pages: list[str] = []
        if catalog_path.is_file():
            cat = json.loads(catalog_path.read_text(encoding="utf-8"))
            for item in cat.get("apps", []):
                if item.get("has_page") and item.get("page"):
                    rel_page = item["page"].lstrip("/") + "index.html"
                    if not (out / rel_page).is_file():
                        missing_pages.append(item["id"])
        if missing_pages:
            raise ValueError(f"Catalog references missing pages: {missing_pages}")

        # 5. Compute content version hash & write pylon-config.js
        version_hash = hashlib.sha256(
            b"".join(
                hashlib.sha256(p.read_bytes()).digest()
                for p in sorted(out.rglob("*"))
                if p.is_file()
            )
        ).hexdigest()[:16]
        (out / "pylon-config.js").write_text(
            "(function(){\n"
            f"  var def={json.dumps(api_origin)};\n"
            "  var resolved=def;\n"
            "  try{\n"
            "    var qp=new URLSearchParams(location.search).get('server');\n"
            "    var raw=qp||localStorage.getItem('pylon.server_origin')||'';\n"
            "    if(raw){var u=new URL(raw.trim());if(u.protocol==='http:'||u.protocol==='https:'){resolved=u.origin;if(qp)localStorage.setItem('pylon.server_origin',resolved);}}\n"
            "  }catch(_){}\n"
            "  window.PYLON_API_ORIGIN=resolved;\n"
            f"  window.PYLON_STATIC_BASE={json.dumps(base_path)};\n"
            f"  window.APPUI_BASE={json.dumps(base_path + '/appui/')};\n"
            f"  window.__PYLON_BASE__={json.dumps(base_path)};\n"
            f"  window.APPUI_ASSET_VERSION={json.dumps(version_hash)};\n"
            "  if(typeof window.fetch==='function'&&resolved&&location.origin&&resolved!==location.origin){\n"
            "    var _origFetch=window.fetch.bind(window);\n"
            "    var _isStatic=function(p){return /^\\/(?:appui\\/|pages\\/|catalogs\\/|daemons\\/|dependencies\\/|pylon-config\\.js|release\\.json|$)/.test(p);};\n"
            "    window.fetch=function(input,init){\n"
            "      try{\n"
            "        if(typeof input==='string'&&input.startsWith('/')&&!input.startsWith('//')&&!_isStatic(input)){\n"
            "          return _origFetch(resolved+input,init);\n"
            "        }\n"
            "        if(input instanceof Request){\n"
            "          var ru=new URL(input.url);\n"
            "          if(ru.origin===location.origin&&!_isStatic(ru.pathname)){\n"
            "            return _origFetch(new Request(resolved+ru.pathname+ru.search,input),init);\n"
            "          }\n"
            "        }\n"
            "      }catch(_){}\n"
            "      return _origFetch(input,init);\n"
            "    };\n"
            "  }\n"
            "})();\n",
            encoding="utf-8",
        )

        # 6. Package daemons/
        git_sha = _git_sha(ROOT)
        daemon_version = f"0.1.{git_sha}"
        daemon_meta = _package_daemons(out, base_path, daemon_version)

        # 7. Root launcher, release.json, .nojekyll
        (out / "index.html").write_text(_render_launcher_html(base_path, api_origin), encoding="utf-8")
        (out / ".nojekyll").write_text("", encoding="utf-8")

        files = [p for p in out.rglob("*") if p.is_file()]
        release_info = {
            "schema_version": 1,
            "git_sha": git_sha,
            "asset_version": version_hash,
            "api_origin": api_origin,
            "base_path": base_path,
            "built_at": dt.datetime.now(dt.timezone.utc).isoformat(),
            "pages": len(page_apps),
            "appui_bundles": bundles,
            "daemon": daemon_meta,
            "total_files": len(files),
            "total_bytes": sum(p.stat().st_size for p in files),
        }
        (out / "release.json").write_text(json.dumps(release_info, indent=2) + "\n", encoding="utf-8")

        # 8. Strict secret scan gate
        _secret_scan(out)
        return release_info
    except BaseException:
        if out.exists():
            shutil.rmtree(out, ignore_errors=True)
        raise


def main() -> None:
    parser = argparse.ArgumentParser(description="Build static GitHub Pages bundle for ai-pylon.github.io")
    parser.add_argument("--out", default=str(ROOT / "_site"))
    parser.add_argument("--api-origin", default="https://pylon-server.duckdns.org")
    parser.add_argument("--base-path", default="")
    parser.add_argument("--serve", type=int, default=0, help="Serve output locally on given port after build")
    args = parser.parse_args()

    result = build(Path(args.out), args.api_origin, args.base_path, clean=True)
    print(json.dumps(result, indent=2))

    if args.serve > 0:
        os.chdir(args.out)
        handler = http.server.SimpleHTTPRequestHandler
        with socketserver.TCPServer(("127.0.0.1", args.serve), handler) as httpd:
            print(f"[build_pages] Serving {args.out} at http://127.0.0.1:{args.serve}/")
            httpd.serve_forever()


if __name__ == "__main__":
    main()
