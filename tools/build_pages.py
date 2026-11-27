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
    :root {{
      color-scheme: dark light;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      --bg: #0f1117;
      --panel: #161922;
      --border: #2a2f3e;
      --text: #e6e9f2;
      --muted: #939bb0;
      --accent: #3b82f6;
      --hover: #1f2433;
      --active: #1d2c49;
      --ok: #22c55e;
      --warn: #f59e0b;
    }}
    @media (prefers-color-scheme: light) {{
      :root {{
        --bg: #f6f7fb;
        --panel: #ffffff;
        --border: #dfe3ec;
        --text: #181c26;
        --muted: #5d667a;
        --accent: #2563eb;
        --hover: #eef2fa;
        --active: #dbeafe;
      }}
    }}
    * {{ box-sizing: border-box; }}
    html, body {{ height: 100%; margin: 0; background: var(--bg); color: var(--text); }}
    .layout {{ display: flex; height: 100vh; overflow: hidden; }}
    .sidebar {{
      width: 320px; min-width: 240px; max-width: 45vw;
      background: var(--panel); border-right: 1px solid var(--border);
      display: flex; flex-direction: column; overflow: hidden;
    }}
    .sb-head {{ padding: 12px 14px; border-bottom: 1px solid var(--border); }}
    .brand-row {{ display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; }}
    .brand {{ font-weight: 700; font-size: 1.05rem; letter-spacing: -0.01em; }}
    .dot {{ display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--muted); flex-shrink: 0; }}
    .dot.ok {{ background: var(--ok); }}
    .dot.warn {{ background: var(--warn); }}
    .server-form {{ display: flex; gap: 6px; margin-bottom: 6px; }}
    .server-form input {{
      flex: 1; min-width: 0; padding: 6px 8px; border-radius: 6px;
      border: 1px solid var(--border); background: var(--bg); color: var(--text); font-size: 0.82rem;
    }}
    .btn {{
      padding: 5px 10px; border-radius: 6px; border: 1px solid var(--border);
      background: var(--accent); color: #fff; font-weight: 600; cursor: pointer; font-size: 0.8rem;
      white-space: nowrap;
    }}
    .btn.sec {{ background: transparent; color: var(--text); font-weight: 500; }}
    .btn.sec:hover {{ background: var(--hover); }}
    .icon-btn {{
      border: 0; background: transparent; color: var(--muted); cursor: pointer;
      padding: 1px 4px; border-radius: 4px; font-size: 0.78rem; line-height: 1;
    }}
    .icon-btn:hover {{ background: var(--hover); color: var(--text); }}
    .presets {{ display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }}
    .sb-search {{
      padding: 8px 12px; border-bottom: 1px solid var(--border);
      display: flex; gap: 6px; align-items: center;
    }}
    .sb-search input {{
      flex: 1; min-width: 0; padding: 6px 9px; border-radius: 6px;
      border: 1px solid var(--border); background: var(--bg); color: var(--text); font-size: 0.84rem;
    }}
    .tree-wrap {{ flex: 1; overflow-y: auto; padding: 8px 6px 16px; }}
    .tree-group {{ margin-bottom: 2px; }}
    .tree-node {{
      display: flex; align-items: center; gap: 6px; padding: 5px 8px; border-radius: 6px;
      cursor: pointer; user-select: none; font-size: 0.86rem; color: var(--text);
    }}
    .tree-node:hover {{ background: var(--hover); }}
    .tree-node.server-root {{ font-weight: 700; font-size: 0.88rem; margin-top: 4px; }}
    .tree-node.folder {{ font-weight: 600; }}
    .tree-node.sub {{ font-weight: 500; color: var(--muted); font-size: 0.82rem; }}
    .tree-node.leaf {{ text-decoration: none; font-weight: 400; padding-left: 8px; }}
    .tree-node.leaf.active {{ background: var(--active); color: var(--accent); font-weight: 600; }}
    .server-sub {{ font-size: 0.72rem; color: var(--muted); padding: 0 8px 4px 26px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }}
    .chev {{ width: 14px; text-align: center; font-size: 0.7rem; color: var(--muted); transition: transform .12s; flex-shrink: 0; }}
    .tree-group.collapsed > .tree-node .chev {{ transform: rotate(-90deg); }}
    .tree-children {{ padding-left: 14px; border-left: 1px solid var(--border); margin-left: 13px; }}
    .tree-group.collapsed > .tree-children,
    .tree-group.collapsed > .server-sub {{ display: none; }}
    .badge {{ margin-left: auto; font-size: 0.72rem; color: var(--muted); background: var(--bg); padding: 1px 6px; border-radius: 10px; border: 1px solid var(--border); }}
    .leaf-title {{ overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }}
    .server-pill {{ font-size: 0.75rem; color: var(--accent); background: var(--active); padding: 2px 8px; border-radius: 999px; white-space: nowrap; }}
    .sb-foot {{
      border-top: 1px solid var(--border); padding: 8px 12px; font-size: 0.78rem; color: var(--muted);
    }}
    .sb-foot details summary {{ cursor: pointer; font-weight: 600; color: var(--text); }}
    .sb-foot code {{ display: block; background: var(--bg); border: 1px solid var(--border); padding: 5px 7px; border-radius: 6px; margin-top: 5px; font-size: 0.74rem; word-break: break-all; color: var(--text); }}
    .sb-links {{ display: flex; gap: 10px; margin-top: 6px; }}
    .sb-links a {{ color: var(--muted); text-decoration: none; }}
    .sb-links a:hover {{ color: var(--accent); text-decoration: underline; }}

    .main {{ flex: 1; display: flex; flex-direction: column; min-width: 0; background: var(--bg); }}
    .topbar {{
      height: 44px; padding: 0 14px; border-bottom: 1px solid var(--border); background: var(--panel);
      display: flex; align-items: center; justify-content: space-between; gap: 12px;
    }}
    .topbar-left {{ display: flex; align-items: baseline; gap: 10px; min-width: 0; }}
    .app-title {{ font-weight: 600; font-size: 0.95rem; white-space: nowrap; }}
    .app-id {{ font-size: 0.8rem; color: var(--muted); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }}
    .app-desc {{ font-size: 0.82rem; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }}
    .topbar-actions {{ display: flex; gap: 6px; flex-shrink: 0; }}
    .frame-wrap {{ flex: 1; position: relative; }}
    iframe#app-frame {{ width: 100%; height: 100%; border: 0; background: var(--bg); display: none; }}
    .welcome {{
      position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center;
      text-align: center; padding: 32px; color: var(--muted);
    }}
    .welcome h2 {{ margin: 0 0 8px; color: var(--text); font-size: 1.25rem; }}
    .welcome p {{ margin: 4px 0; max-width: 480px; font-size: 0.9rem; }}
    @media (max-width: 760px) {{
      .layout {{ flex-direction: column; }}
      .sidebar {{ width: 100%; max-width: none; height: 48vh; border-right: 0; border-bottom: 1px solid var(--border); }}
      .app-desc {{ display: none; }}
    }}
  </style>
</head>
<body>
  <div class="layout">
    <aside class="sidebar">
      <div class="sb-head">
        <div class="brand-row">
          <div class="brand">AI Pylon</div>
          <span id="server-count" class="badge">0 servers</span>
        </div>
        <form id="server-form" class="server-form">
          <input id="server-url" type="url" placeholder="Add server (https://... or http://127.0.0.1:8910)" required>
          <button type="submit" class="btn">+ Add</button>
        </form>
        <div class="presets">
          <button type="button" class="btn sec" id="preset-vm">+ VM</button>
          <button type="button" class="btn sec" id="preset-local">+ Local (8910)</button>
          <button type="button" class="btn sec" id="btn-refresh-all">Refresh</button>
          <button type="button" class="btn sec" id="toggle-all">Collapse</button>
        </div>
      </div>

      <div class="sb-search">
        <input id="q" type="search" placeholder="Filter apps across all servers...">
      </div>

      <div id="tree" class="tree-wrap">Loading servers...</div>

      <div class="sb-foot">
        <details>
          <summary>Daemon Client Install</summary>
          <code>irm https://ai-pylon.github.io/daemons/install.ps1 | iex</code>
          <code>curl -fsSL https://ai-pylon.github.io/daemons/install.sh | sh</code>
        </details>
        <div class="sb-links">
          <a href="{base_path}/catalogs/catalog.json" target="_blank">catalog.json</a>
          <a href="{base_path}/daemons/latest.json" target="_blank">daemons/latest.json</a>
        </div>
      </div>
    </aside>

    <main class="main">
      <div class="topbar">
        <div class="topbar-left">
          <span id="cur-server" class="server-pill" style="display:none"></span>
          <span id="cur-title" class="app-title">Select an app</span>
          <span id="cur-id" class="app-id"></span>
          <span id="cur-desc" class="app-desc"></span>
        </div>
        <div class="topbar-actions">
          <button type="button" class="btn sec" id="btn-reload" style="display:none">Reload</button>
          <a id="btn-open" class="btn" href="#" target="_blank" style="display:none;text-decoration:none">Open Tab ↗</a>
        </div>
      </div>
      <div class="frame-wrap">
        <div id="welcome" class="welcome">
          <h2>AI Pylon Multi-Server Workspace</h2>
          <p>Add one or more Pylon servers (VM, Local, or LAN) on the left. Each server appears as a root node in the tree with its own catalog and apps.</p>
        </div>
        <iframe id="app-frame" title="Pylon App"></iframe>
      </div>
    </main>
  </div>

  <script>
    const BASE = {json.dumps(base_path)};
    const DEFAULT_VM = {json.dumps(api_origin)};
    const DEFAULT_LOCAL = 'http://127.0.0.1:8910';
    const SERVERS_KEY = 'pylon.servers';
    const LEGACY_SERVER_KEY = 'pylon.server_origin';
    const COLLAPSED_KEY = 'pylon.tree.collapsed';
    const LAST_SEL_KEY = 'pylon.last_selection';

    let servers = [];
    // origin -> {{ origin, name, status: 'loading'|'ok'|'warn', detail, catalogUrl, apps: [], enabledSet: Set|null }}
    const serverState = new Map();
    let activeKey = ''; // origin + '::' + app.id
    let collapsedSet = new Set();
    try {{
      const raw = JSON.parse(localStorage.getItem(COLLAPSED_KEY) || '[]');
      if (Array.isArray(raw)) collapsedSet = new Set(raw);
    }} catch (_) {{}}

    function saveCollapsed() {{
      try {{ localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...collapsedSet])); }} catch (_) {{}}
    }}

    function normalizeOrigin(raw) {{
      try {{
        const u = new URL((raw || '').trim());
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
        return u.origin;
      }} catch (_) {{
        return '';
      }}
    }}

    function loadSavedServers() {{
      let list = [];
      try {{
        const raw = JSON.parse(localStorage.getItem(SERVERS_KEY) || '[]');
        if (Array.isArray(raw)) list = raw.map(normalizeOrigin).filter(Boolean);
      }} catch (_) {{}}
      if (!list.length) {{
        const legacy = normalizeOrigin(localStorage.getItem(LEGACY_SERVER_KEY) || '');
        if (legacy) list.push(legacy);
        if (!list.includes(DEFAULT_LOCAL)) list.push(DEFAULT_LOCAL);
        if (!list.includes(DEFAULT_VM)) list.push(DEFAULT_VM);
      }}
      const qp = normalizeOrigin(new URLSearchParams(location.search).get('server') || '');
      if (qp && !list.includes(qp)) list.unshift(qp);
      return [...new Set(list)];
    }}

    function saveServers() {{
      try {{ localStorage.setItem(SERVERS_KEY, JSON.stringify(servers)); }} catch (_) {{}}
    }}

    function appUrlFor(origin, app) {{
      return BASE + app.page + '?server=' + encodeURIComponent(origin);
    }}

    function selectApp(origin, app, pushHash) {{
      if (!origin || !app || !app.page) return;
      activeKey = origin + '::' + app.id;
      try {{
        localStorage.setItem(LAST_SEL_KEY, JSON.stringify({{ origin, id: app.id }}));
        localStorage.setItem(LEGACY_SERVER_KEY, origin);
      }} catch (_) {{}}
      if (pushHash) history.replaceState(null, '', '#' + encodeURIComponent(origin) + '/' + app.id);

      const url = appUrlFor(origin, app);
      const st = serverState.get(origin);
      const pill = document.getElementById('cur-server');
      pill.textContent = (st && st.name) ? st.name : origin;
      pill.title = origin;
      pill.style.display = 'inline-block';

      document.getElementById('cur-title').textContent = app.title;
      document.getElementById('cur-id').textContent = app.id;
      document.getElementById('cur-desc').textContent = app.description || '';
      const openBtn = document.getElementById('btn-open');
      openBtn.href = url;
      openBtn.style.display = 'inline-block';
      document.getElementById('btn-reload').style.display = 'inline-block';
      document.getElementById('welcome').style.display = 'none';
      const frame = document.getElementById('app-frame');
      frame.style.display = 'block';
      frame.src = url;

      document.querySelectorAll('.tree-node.leaf').forEach(el => {{
        el.classList.toggle('active', el.dataset.key === activeKey);
      }});
    }}

    function buildTreeData(items) {{
      const groups = new Map();
      for (const a of items) {{
        const g = a.group || 'other';
        if (!groups.has(g)) groups.set(g, new Map());
        const cat = (a.category || g).trim();
        let sub = '';
        if (cat.includes('/')) {{
          const parts = cat.split('/');
          if (parts[1] && parts[1] !== g) sub = parts.slice(1).join('/');
        }} else if (cat !== g) {{
          sub = cat;
        }}
        const subMap = groups.get(g);
        if (!subMap.has(sub)) subMap.set(sub, []);
        subMap.get(sub).push(a);
      }}
      return groups;
    }}

    function makeLeaf(origin, app) {{
      const key = origin + '::' + app.id;
      const a = document.createElement('a');
      a.className = 'tree-node leaf' + (key === activeKey ? ' active' : '');
      a.href = appUrlFor(origin, app);
      a.dataset.key = key;
      a.title = '[' + origin + '] ' + app.id + (app.description ? ' — ' + app.description : '');
      const span = document.createElement('span');
      span.className = 'leaf-title';
      span.textContent = app.title;
      a.appendChild(span);
      a.addEventListener('click', e => {{
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
        e.preventDefault();
        selectApp(origin, app, true);
      }});
      return a;
    }}

    function renderTree() {{
      const q = (document.getElementById('q').value || '').trim().toLowerCase();
      const root = document.getElementById('tree');
      document.getElementById('server-count').textContent = servers.length + (servers.length === 1 ? ' server' : ' servers');
      root.innerHTML = '';

      if (!servers.length) {{
        root.textContent = 'No servers added. Add a server URL above.';
        return;
      }}

      for (const origin of servers) {{
        const st = serverState.get(origin) || {{ origin, name: origin, status: 'loading', detail: 'Connecting...', apps: [], enabledSet: null }};
        const items = (st.apps || []).filter(a => {{
          if (!a.has_page) return false;
          if (st.enabledSet && !st.enabledSet.has(a.id)) return false;
          return !q || (a.id + ' ' + a.title + ' ' + (a.category || '') + ' ' + (a.description || '') + ' ' + origin + ' ' + st.name).toLowerCase().includes(q);
        }});

        const srvKey = 'srv:' + origin;
        const srvWrap = document.createElement('div');
        srvWrap.className = 'tree-group' + (!q && collapsedSet.has(srvKey) ? ' collapsed' : '');

        const srvRow = document.createElement('div');
        srvRow.className = 'tree-node server-root';
        srvRow.innerHTML = '<span class="chev">▼</span><span class="dot"></span><span class="leaf-title"></span><span class="badge"></span>';
        srvRow.children[1].className = 'dot ' + (st.status === 'ok' ? 'ok' : st.status === 'warn' ? 'warn' : '');
        srvRow.children[2].textContent = st.name || origin;
        srvRow.children[2].title = origin;
        srvRow.children[3].textContent = String(items.length);

        const refreshBtn = document.createElement('button');
        refreshBtn.type = 'button';
        refreshBtn.className = 'icon-btn';
        refreshBtn.title = 'Refresh server';
        refreshBtn.textContent = '↻';
        refreshBtn.addEventListener('click', e => {{
          e.stopPropagation();
          loadServer(origin);
        }});
        srvRow.appendChild(refreshBtn);

        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'icon-btn';
        delBtn.title = 'Remove server';
        delBtn.textContent = '×';
        delBtn.addEventListener('click', e => {{
          e.stopPropagation();
          servers = servers.filter(s => s !== origin);
          serverState.delete(origin);
          saveServers();
          renderTree();
        }});
        srvRow.appendChild(delBtn);

        srvRow.addEventListener('click', () => {{
          srvWrap.classList.toggle('collapsed');
          if (srvWrap.classList.contains('collapsed')) collapsedSet.add(srvKey);
          else collapsedSet.delete(srvKey);
          saveCollapsed();
        }});
        srvWrap.appendChild(srvRow);

        const subInfo = document.createElement('div');
        subInfo.className = 'server-sub';
        subInfo.textContent = origin + (st.detail ? ' · ' + st.detail : '');
        subInfo.title = subInfo.textContent;
        srvWrap.appendChild(subInfo);

        const srvChildren = document.createElement('div');
        srvChildren.className = 'tree-children';

        if (!items.length) {{
          const empty = document.createElement('div');
          empty.className = 'server-sub';
          empty.style.paddingLeft = '8px';
          empty.textContent = st.status === 'loading' ? 'Loading...' : 'No matching apps.';
          srvChildren.appendChild(empty);
        }} else {{
          const tree = buildTreeData(items);
          for (const [groupName, subMap] of [...tree.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {{
            const groupKey = 'g:' + origin + ':' + groupName;
            const totalInGroup = [...subMap.values()].reduce((s, arr) => s + arr.length, 0);
            const gWrap = document.createElement('div');
            gWrap.className = 'tree-group' + (!q && collapsedSet.has(groupKey) ? ' collapsed' : '');

            const gRow = document.createElement('div');
            gRow.className = 'tree-node folder';
            gRow.innerHTML = '<span class="chev">▼</span><span></span><span class="badge"></span>';
            gRow.children[1].textContent = groupName;
            gRow.children[2].textContent = String(totalInGroup);
            gRow.addEventListener('click', () => {{
              gWrap.classList.toggle('collapsed');
              if (gWrap.classList.contains('collapsed')) collapsedSet.add(groupKey);
              else collapsedSet.delete(groupKey);
              saveCollapsed();
            }});
            gWrap.appendChild(gRow);

            const gChildren = document.createElement('div');
            gChildren.className = 'tree-children';

            const subKeys = [...subMap.keys()].sort((a, b) => a.localeCompare(b));
            const useSubFolders = subKeys.length > 1 || (subKeys.length === 1 && subKeys[0] !== '');
            for (const subName of subKeys) {{
              const apps = subMap.get(subName).slice().sort((a, b) => a.title.localeCompare(b.title));
              if (!useSubFolders || !subName) {{
                for (const app of apps) gChildren.appendChild(makeLeaf(origin, app));
              }} else {{
                const subKey = 's:' + origin + ':' + groupName + '/' + subName;
                const sWrap = document.createElement('div');
                sWrap.className = 'tree-group' + (!q && collapsedSet.has(subKey) ? ' collapsed' : '');

                const sRow = document.createElement('div');
                sRow.className = 'tree-node sub';
                sRow.innerHTML = '<span class="chev">▼</span><span></span><span class="badge"></span>';
                sRow.children[1].textContent = subName;
                sRow.children[2].textContent = String(apps.length);
                sRow.addEventListener('click', () => {{
                  sWrap.classList.toggle('collapsed');
                  if (sWrap.classList.contains('collapsed')) collapsedSet.add(subKey);
                  else collapsedSet.delete(subKey);
                  saveCollapsed();
                }});
                sWrap.appendChild(sRow);

                const sChildren = document.createElement('div');
                sChildren.className = 'tree-children';
                for (const app of apps) sChildren.appendChild(makeLeaf(origin, app));
                sWrap.appendChild(sChildren);
                gChildren.appendChild(sWrap);
              }}
            }}
            gWrap.appendChild(gChildren);
            srvChildren.appendChild(gWrap);
          }}
        }}
        srvWrap.appendChild(srvChildren);
        root.appendChild(srvWrap);
      }}
    }}

    async function loadServer(origin) {{
      const prev = serverState.get(origin) || {{}};
      serverState.set(origin, {{
        origin,
        name: prev.name || new URL(origin).host,
        status: 'loading',
        detail: 'Connecting...',
        catalogUrl: BASE + '/catalogs/catalog.json',
        apps: prev.apps || [],
        enabledSet: null,
      }});
      renderTree();

      let name = new URL(origin).host;
      let status = 'warn';
      let detail = 'offline (default catalog)';
      let catalogUrl = BASE + '/catalogs/catalog.json';
      let enabledSet = null;

      try {{
        const res = await fetch(origin + '/_pylon/bootstrap', {{ mode: 'cors' }});
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const boot = await res.json();
        name = boot.server_name || name;
        status = 'ok';
        detail = boot.mode || 'connected';
        if (boot.catalog_url) catalogUrl = boot.catalog_url;
        if (Array.isArray(boot.enabled_apps) && boot.enabled_apps.length) {{
          enabledSet = new Set(boot.enabled_apps);
        }}
      }} catch (err) {{
        detail = 'offline (' + err.message + ')';
      }}

      let apps = [];
      try {{
        const catRes = await fetch(catalogUrl);
        const cat = await catRes.json();
        apps = cat.apps || [];
      }} catch (_) {{
        try {{
          const fbRes = await fetch(BASE + '/catalogs/catalog.json');
          const fb = await fbRes.json();
          apps = fb.apps || [];
        }} catch (_) {{}}
      }}

      serverState.set(origin, {{ origin, name, status, detail, catalogUrl, apps, enabledSet }});
      renderTree();
      tryRestoreSelection(origin, apps);
    }}

    function tryRestoreSelection(origin, apps) {{
      if (activeKey) return;
      try {{
        const saved = JSON.parse(localStorage.getItem(LAST_SEL_KEY) || 'null');
        if (saved && saved.origin === origin) {{
          const found = apps.find(a => a.id === saved.id && a.has_page);
          if (found) selectApp(origin, found, false);
        }}
      }} catch (_) {{}}
    }}

    function addServer(rawOrigin) {{
      const norm = normalizeOrigin(rawOrigin);
      if (!norm) return;
      if (!servers.includes(norm)) {{
        servers.unshift(norm);
        saveServers();
      }}
      collapsedSet.delete('srv:' + norm);
      saveCollapsed();
      loadServer(norm);
    }}

    document.getElementById('server-form').addEventListener('submit', e => {{
      e.preventDefault();
      const input = document.getElementById('server-url');
      addServer(input.value);
      input.value = '';
    }});
    document.getElementById('preset-vm').addEventListener('click', () => addServer(DEFAULT_VM));
    document.getElementById('preset-local').addEventListener('click', () => addServer(DEFAULT_LOCAL));
    document.getElementById('btn-refresh-all').addEventListener('click', () => servers.forEach(loadServer));
    document.getElementById('toggle-all').addEventListener('click', e => {{
      const groups = [...document.querySelectorAll('#tree .tree-group')];
      const anyOpen = groups.some(g => !g.classList.contains('collapsed'));
      groups.forEach(g => g.classList.toggle('collapsed', anyOpen));
      e.target.textContent = anyOpen ? 'Expand' : 'Collapse';
    }});
    document.getElementById('btn-reload').addEventListener('click', () => {{
      const frame = document.getElementById('app-frame');
      if (frame.src) frame.src = frame.src;
    }});
    document.getElementById('q').addEventListener('input', renderTree);

    servers = loadSavedServers();
    saveServers();
    servers.forEach(loadServer);
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
            "    if(raw){var u=new URL(raw.trim());if(u.protocol==='http:'||u.protocol==='https:'){resolved=u.origin;}}\n"
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
