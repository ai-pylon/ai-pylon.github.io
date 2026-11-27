// Try-It: open one tool, fill a form generated from its schema, call it through the normal op edge and
// see the result; read-only tools run directly, a WRITE tool offers "Preview" (no confirm - the tool answers
// with a dry run) and "Run for real" (after a confirm dialog, sends confirm:true). Recent calls are kept in
// this browser (localStorage) and can be replayed. "Add to chain" carries the filled-in args to the builder.
// With no tool open the view is the catalog landing: groups + a search box.
import { hintType, coerce } from './chain-bindings.js?v=3';

const HIST_KEY = 'pylon2.catalog.try.history', HIST_MAX = 30;

export function mountTryView(root, actions, setStatus, { esc, catalog, callOp, confirm, onAddToChain, onOpenTool }) {
  root.classList.add('tc-try');
  root.innerHTML = '<div class="tc-try-main" id="t-main"></div><div class="tc-try-hist"><div class="tc-out-h"><span>Recent calls</span>' +
    '<button type="button" class="tc-link" id="t-clear">clear</button></div><div id="t-hist" class="tc-hist"></div></div>';
  const q = (id) => root.querySelector('#' + id);
  let current = null;                // the open tool's catalog row
  const hist = () => { try { return JSON.parse(localStorage.getItem(HIST_KEY) || '[]') || []; } catch (_e) { return []; } };
  const saveHist = (h) => { try { localStorage.setItem(HIST_KEY, JSON.stringify(h.slice(0, HIST_MAX))); } catch (_e) {} };

  function landing() {
    current = null;
    const main = q('t-main');
    main.innerHTML = '<h2>Tool Catalog</h2><p class="tc-dim">Pick a tool in the <b>Tools</b> list on the left, or search. ' +
      'Every tool here can be tried with a generated form, added to a chain, or looked up in the API reference.</p>' +
      '<div class="tc-find"><input id="t-search" type="search" placeholder="Search tools by name or description (or /regex/)…" aria-label="Search tools"></div>' +
      '<div id="t-hits"></div><h3>Groups</h3><div id="t-groups" class="tc-cards"><div class="tc-dim">loading…</div></div>';
    catalog('groups', {}).then((r) => {
      const box = q('t-groups'); if (!box) return; box.innerHTML = '';
      for (const g of (r.groups || [])) {
        const c = document.createElement('button'); c.type = 'button'; c.className = 'tc-card';
        c.innerHTML = '<b>' + esc(g.group) + '</b> <span class="tc-dim">' + g.count + ' tools · ' + (g.apps || []).length + ' apps</span><div class="tc-fh">' + esc((g.sample || []).join(', ')) + '</div>';
        c.addEventListener('click', () => search(g.group + '/'));
        box.appendChild(c);
      }
    });
    let t = null;
    q('t-search').addEventListener('input', (e) => { clearTimeout(t); const v = e.target.value; t = setTimeout(() => search(v, true), 220); });
  }
  function search(v, typed) {
    const inp = q('t-search'); if (inp && !typed) inp.value = v;
    const hits = q('t-hits'); if (!hits) return;
    if (!String(v || '').trim()) { hits.innerHTML = ''; return; }
    catalog('search', { query: v, limit: 40 }).then((r) => {
      hits.innerHTML = '';
      const tools = r.tools || [];
      hits.appendChild(Object.assign(document.createElement('p'), { className: 'tc-dim', textContent: tools.length + ' match(es)' }));
      for (const t of tools) {
        const a = document.createElement('button'); a.type = 'button'; a.className = 'tc-hit';
        a.innerHTML = '<code>' + esc(t.id) + '</code>' + (t.safety === 'confirm' ? ' <span class="tc-write">write</span>' : '') +
          '<div class="tc-fh">' + esc(String(t.description || '').slice(0, 160)) + '</div>';
        a.addEventListener('click', () => onOpenTool(t.id));
        hits.appendChild(a);
      }
    });
  }

  async function open(id, preset) {
    const r = await catalog('detail', { names: [id] });
    const t = r.ok && r.tools && r.tools[0];
    const main = q('t-main');
    if (!t) { main.innerHTML = '<p class="tc-bad">Unknown tool <code>' + esc(id) + '</code>.</p>'; current = null; return; }
    current = t;
    const write = t.safety !== 'read_only';
    main.innerHTML = '<div class="tc-try-head"><h2><code>' + esc(t.id) + '</code></h2>' +
      '<span class="' + (write ? 'tc-write' : 'tc-ro') + '">' + esc(t.safety) + '</span></div>' +
      '<p>' + esc(t.description || '') + '</p>' +
      '<p class="tc-dim">POST <code>/v1/apps/' + esc(t.app_id) + '/' + esc(t.op) + '</code> · ' +
      '<a href="/apps/platform/tool_profiler/?view=tool&tool=' + encodeURIComponent(t.id) + '">call stats in the Profiler</a></p>' +
      '<form id="t-form" class="tc-form" autocomplete="off"></form>' +
      '<div class="tc-try-btns" id="t-btns"></div><div id="t-result"></div>';
    const form = q('t-form'), fields = {};
    const params = t.params || {};
    if (!Object.keys(params).length) form.innerHTML = '<p class="tc-dim">This tool takes no parameters.</p>';
    for (const k of Object.keys(params)) {
      const type = hintType(params[k]);
      const row = document.createElement('div'); row.className = 'tc-f';
      const id2 = 't-f-' + k.replace(/\W/g, '_');
      let input;
      if (type === 'boolean') {
        input = document.createElement('select');
        input.innerHTML = '<option value="">(default)</option><option>true</option><option>false</option>';
      } else {
        const big = type === 'json' || /prompt|content|body|text|message|query/i.test(k);
        input = document.createElement(big ? 'textarea' : 'input');
        if (!big && type === 'number') input.inputMode = 'decimal';
      }
      input.id = id2; input.placeholder = String(params[k] || '');
      const v = preset && preset[k] !== undefined ? preset[k] : '';
      input.value = v === '' || v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
      row.innerHTML = '<label for="' + id2 + '">' + esc(k) + ' <span class="tc-type">' + type + '</span></label>';
      row.appendChild(input);
      const h = document.createElement('div'); h.className = 'tc-fh'; h.textContent = String(params[k] || ''); row.appendChild(h);
      form.appendChild(row); fields[k] = { input, type };
    }
    const collect = () => {
      const args = {};
      for (const [k, f] of Object.entries(fields)) { const raw = f.input.value; if (raw === '') continue; args[k] = coerce(raw, f.type); }
      return args;
    };
    const btns = q('t-btns');
    const button = (label, cls, fn, title) => { const b = document.createElement('button'); b.type = 'button'; b.className = cls; b.textContent = label; if (title) b.title = title; b.addEventListener('click', fn); btns.appendChild(b); return b; };
    if (!write) button('▶ Run', 'tc-primary', () => call(collect(), false));
    else {
      button('Preview (dry run)', 'tc-primary', () => call(collect(), false), 'call without confirm - a write tool answers with a preview of what it would do');
      button('Run for real…', 'tc-danger', async () => {
        if (await confirm('Run ' + t.id + ' for real? It ' + (t.safety === 'confirm' ? 'writes or changes something' : 'is not read-only') + '.')) call(collect(), true);
      });
    }
    button('Add to chain', '', () => onAddToChain(t.id, collect()), 'add this call (with these arguments) as a step of the chain builder');
    button('Copy as curl', '', () => {
      const cmd = "curl -X POST " + location.origin + '/v1/apps/' + t.app_id + '/' + t.op + " -H 'Content-Type: application/json' -d '" + JSON.stringify(collect()).replace(/'/g, "'\\''") + "'";
      copy(cmd);
    });
    form.addEventListener('submit', (e) => { e.preventDefault(); });
    setStatus(t.id);
  }
  function copy(text) {
    const u = window.AppUI && AppUI.utils && AppUI.utils.core;
    if (u && u.copyText) u.copyText(text, { fallbackOnError: true }).then(() => setStatus('copied'));
    else if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => setStatus('copied'));
  }
  async function call(args, real) {
    const t = current; if (!t) return;
    const sent = Object.assign({}, args, real ? { confirm: true } : {});
    const box = q('t-result'); box.innerHTML = '<p class="tc-dim">calling…</p>';
    const t0 = performance.now();
    const resp = await callOp(t.app_id, t.op, sent);
    const ms = Math.round(performance.now() - t0);
    const result = resp.result !== undefined ? resp.result : resp;
    const ok = !!(resp.ok && !(result && (result._error || result.error)));
    box.innerHTML = '';
    const head = document.createElement('div'); head.className = 'tc-res-h ' + (ok ? 'ok' : 'err');
    head.textContent = (ok ? '✓ ' : '✗ ') + ms + ' ms' + (result && result.dry_run ? ' · preview only (dry run) - nothing was changed' : '');
    const pre = document.createElement('pre'); pre.className = 'tc-res ' + (ok ? 'ok' : 'err');
    const txt = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
    pre.textContent = txt.length > 20000 ? txt.slice(0, 20000) + '\n… (truncated)' : txt;
    box.append(head, pre);
    const h = hist(); h.unshift({ tool: t.id, args, real: !!real, ok, ms, ts: Date.now() / 1000 }); saveHist(h); drawHist();
    setStatus(t.id + ' · ' + (ok ? 'ok' : 'error') + ' · ' + ms + ' ms');
  }
  function drawHist() {
    const box = q('t-hist'); const h = hist(); box.innerHTML = '';
    if (!h.length) { box.innerHTML = '<div class="tc-dim">No calls yet.</div>'; return; }
    for (const e of h) {
      const row = document.createElement('div'); row.className = 'tc-hist-row ' + (e.ok ? 'ok' : 'err');
      row.innerHTML = '<span>' + (e.ok ? '✓' : '✗') + '</span> <code>' + esc(e.tool) + '</code>' + (e.real ? ' <span class="tc-write">real</span>' : '') +
        '<div class="tc-fh">' + esc(new Date(e.ts * 1000).toLocaleTimeString()) + ' · ' + e.ms + ' ms · ' + esc(JSON.stringify(e.args).slice(0, 90)) + '</div>';
      const again = document.createElement('button'); again.type = 'button'; again.className = 'tc-link'; again.textContent = 'open';
      again.title = 'open this tool with the same arguments';
      again.addEventListener('click', () => onOpenTool(e.tool, e.args));
      row.appendChild(again); box.appendChild(row);
    }
  }
  q('t-clear').addEventListener('click', () => { saveHist([]); drawHist(); });
  drawHist(); landing();
  return { open: (id, preset) => (id ? open(id, preset) : landing()), current: () => (current ? current.id : null), search };
}
