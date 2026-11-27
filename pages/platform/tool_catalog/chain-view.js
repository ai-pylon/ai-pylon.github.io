// Chain builder: an ordered pipeline of tool calls in which a later step's INPUT parameter can be ROUTED from
// an earlier step's OUTPUT field. The page owns the tool list (left sidebar "Tools" tab) and calls addStep();
// this module owns the canvas (pipeline graph), the inspector (per-parameter route picker) and the run.
//
// Routing: every parameter has a ⤵ button listing each earlier step's output fields (discovered from its
// last run - "Run to here" fills them in); picking one stores {{stepN.path}}. A parameter that is exactly one
// route shows as a chip and receives the TYPED value; a route inside text is substituted. Routes follow
// steps when they are moved, a removed source is flagged, and Run refuses a chain with routing errors or
// with a route that did not resolve (nothing is ever sent as a literal "{{...}}").
import { buildArgs, validateChain, outputFields, wholeRef, parseRefs, refText, remapRefs, wires, hintType, lookup } from './chain-bindings.js?v=3';
import { createChainGraph } from './chain-graph.js?v=3';

const STORE_KEY = 'pylon2.catalog.chains';
export const EXAMPLES = {
  'Catalog self-tour (routing)': [
    { tool: 'platform/tool_catalog.groups', params: {} },
    { tool: 'platform/tool_catalog.browse', params: { group: '{{step1.groups.0.group}}' } },
  ],
  'Search + Summarize': [
    { tool: 'knowledge/knowledge_base.search', params: { query: 'architecture' } },
    { tool: 'ai/llm_server.summarize', params: { text: 'Summarize concisely:\n\n{{step1.result}}' } },
  ],
};

export function mountChainEditor(root, actions, setStatus, { esc, catalog, callOp, svgEl, svgText, confirm }) {
  root.classList.add('tc-chain');
  const canvasBox = document.createElement('div');
  canvasBox.className = 'tc-canvas'; canvasBox.id = 'c-canvas';
  const insBox = document.createElement('div'); insBox.className = 'tc-pane';
  insBox.innerHTML = '<div class="tc-ins-h">Inspector</div><div class="tc-ins" id="c-ins"><div class="tc-dim">Select a step to edit and route its parameters.</div></div>';
  const outBox = document.createElement('div'); outBox.className = 'tc-pane';
  outBox.innerHTML = '<div class="tc-out-h"><span>Output</span><button type="button" id="c-clearout" class="tc-link">clear</button></div><div class="tc-out" id="c-out"><div class="tc-dim">Run the chain to see each step\'s result.</div></div>';
  const side = document.createElement('div'); side.className = 'tc-side';
  let splits = [];
  if (window.AppUISplit) {
    splits.push(AppUISplit.create({ container: root, direction: 'horizontal', ratio: 0.58, minSize: 260,
      primary: (el) => { el.appendChild(canvasBox); }, secondary: (el) => { el.appendChild(side); } }));
    splits.push(AppUISplit.create({ container: side, direction: 'vertical', ratio: 0.62, minSize: 120,
      primary: (el) => { el.appendChild(insBox); }, secondary: (el) => { el.appendChild(outBox); } }));
  } else { root.append(canvasBox, side); side.append(insBox, outBox); }
  const q = (id) => root.querySelector('#' + id);
  const st = { byId: {}, steps: [], selected: -1, running: false };

  if (window.AppUI && AppUI.components && AppUI.components.Toolbar) {
    AppUI.components.Toolbar.create({ container: actions, label: 'Chain actions', items: [
      { label: '▶ Run', title: 'Run every step top to bottom', action: () => run() },
      { label: 'Clear', title: 'Remove all steps', action: () => clear() },
      { label: 'Save…', title: 'Save this chain in this browser', action: () => save() },
    ] });
  }
  const sel = document.createElement('div'); sel.className = 'tc-selects';
  sel.innerHTML = '<select id="c-examples" aria-label="Load an example chain"><option value="">Examples…</option>' +
    Object.keys(EXAMPLES).map((n) => '<option>' + esc(n) + '</option>').join('') +
    '</select><select id="c-saved" aria-label="Load a saved chain"><option value="">Saved…</option></select>';
  actions.appendChild(sel);

  const issuesOf = (i) => validateChain(st.steps).filter((x) => x.step === i);
  const graph = createChainGraph({ state: st, find: q, renderInspector: drawInspector, svgEl, svgText, issuesOf });
  const redraw = () => { graph.render(); drawInspector(); };

  async function toolWithParams(id) {
    const t = st.byId[id]; if (t && t.params) return t;
    const r = await catalog('detail', { names: [id] }); const full = (r.ok && r.tools && r.tools[0]) || null;
    if (full) { st.byId[id] = full; return full; }
    const p = id.split('.'); return { id, name: id, app_id: p.slice(0, -1).join('.'), op: p[p.length - 1], params: {}, missing: true };
  }
  async function addStep(id, params, at) {
    const tool = await toolWithParams(id);
    const step = { tool, params: Object.assign({}, params || {}) };
    if (at == null || at >= st.steps.length) { st.steps.push(step); st.selected = st.steps.length - 1; }
    else { st.steps.splice(at, 0, step); remapInsert(at); st.selected = at; }
    redraw();
    if (tool.missing) setStatus('Unknown tool ' + id + ' - check the id.');
  }
  // inserting at `at` shifts every later step: references to them follow
  function remapInsert(at) {
    for (const s of st.steps) for (const k of Object.keys(s.params)) {
      const v = s.params[k];
      if (typeof v === 'string' && v.indexOf('{{step') >= 0) s.params[k] = v.replace(/\{\{\s*step(\d+)\./g, (m, n) => (parseInt(n, 10) - 1 >= at && s !== st.steps[at] ? '{{step' + (parseInt(n, 10) + 1) + '.' : m));
    }
  }
  function removeStep(i) {
    st.steps.splice(i, 1); remapRefs(st.steps, i, null);
    if (st.selected >= st.steps.length) st.selected = st.steps.length - 1;
    redraw();
  }
  function moveStep(i, d) {
    const j = i + d; if (j < 0 || j >= st.steps.length) return;
    const [s] = st.steps.splice(i, 1); st.steps.splice(j, 0, s); remapRefs(st.steps, i, j); st.selected = j; redraw();
  }
  function clear() { st.steps = []; st.selected = -1; q('c-out').innerHTML = '<div class="tc-dim">Run the chain to see each step\'s result.</div>'; redraw(); }

  // ── route picker ─────────────────────────────────────────────────────────────
  function routeMenu(ev, i, key, input) {
    const items = [];
    for (let s = 0; s < i; s++) {
      const src = st.steps[s], res = src._result;
      const fields = res !== undefined ? outputFields(res) : [{ path: 'result', type: '?', preview: 'not run yet' }];
      const sub = fields.map((f) => ({ label: f.path + '   ' + (f.type !== '?' ? f.type + ' ' : '') + (f.preview ? '= ' + f.preview : ''),
        action: () => applyRoute(i, key, s, f.path, input) }));
      if (res === undefined) sub.push({ separator: true }, { label: '▶ Run steps 1-' + (s + 1) + ' to list its output fields', action: () => run(s) });
      items.push({ label: 'Step ' + (s + 1) + ' · ' + (src.tool.id || '') + (res === undefined ? '  (not run)' : ''), submenu: sub });
    }
    if (!i) items.push({ label: 'The first step has no earlier output to route from', disabled: true });
    const cur = st.steps[i].params[key];
    if (typeof cur === 'string' && parseRefs(cur).length) items.push({ separator: true }, { label: 'Remove route(s) from ' + key, danger: true, action: () => { st.steps[i].params[key] = ''; redraw(); } });
    (window.AppUIContextMenu || AppUI.components.ContextMenu).show(ev, items);
  }
  function applyRoute(i, key, s, path, input) {
    const ref = refText(s, path), step = st.steps[i], cur = step.params[key];
    const textual = input && input.tagName === 'TEXTAREA' && typeof cur === 'string' && cur.trim() && !wholeRef(cur);
    if (textual) {                                          // embed at the cursor of a free-text field
      const a = input.selectionStart == null ? cur.length : input.selectionStart, b = input.selectionEnd == null ? a : input.selectionEnd;
      step.params[key] = cur.slice(0, a) + ref + cur.slice(b);
    } else step.params[key] = ref;                         // otherwise the parameter takes the whole value
    setStatus('Routed step ' + (s + 1) + ' · ' + path + ' → step ' + (i + 1) + ' · ' + key);
    redraw();
  }

  // ── inspector ────────────────────────────────────────────────────────────────
  function drawInspector() {
    const box = q('c-ins'); const i = st.selected;
    if (i < 0 || i >= st.steps.length) { box.innerHTML = '<div class="tc-dim">Select a step to edit and route its parameters.</div>'; return; }
    const step = st.steps[i]; box.innerHTML = '';
    const head = document.createElement('div'); head.className = 'tc-ins-step';
    head.innerHTML = '<span class="tc-ins-n">Step ' + (i + 1) + '</span> <span class="tc-ins-tool">' + esc(step.tool.id || '') + '</span>' +
      (step.tool.safety === 'confirm' ? ' <span class="tc-write" title="this tool writes / changes something">write</span>' : '');
    const ctl = document.createElement('div'); ctl.className = 'tc-ins-ctl';
    const mk = (t, title, fn, cls) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'tc-link' + (cls ? ' ' + cls : ''); b.textContent = t; b.title = title; b.onclick = fn; return b; };
    ctl.append(mk('▶ Run to here', 'Run steps 1-' + (i + 1) + ' (discovers this step\'s output fields)', () => run(i)),
      mk('↑', 'Move up', () => moveStep(i, -1)), mk('↓', 'Move down', () => moveStep(i, 1)), mk('✕ remove', 'Remove this step', () => removeStep(i), 'rm'));
    head.appendChild(ctl); box.appendChild(head);
    if (step.tool.description) { const d = document.createElement('div'); d.className = 'tc-fh'; d.textContent = step.tool.description; box.appendChild(d); }
    const schema = step.tool.params || {}; const keys = Object.keys(schema);
    for (const k of Object.keys(step.params)) if (!keys.includes(k)) keys.push(k);   // AI / saved extras stay visible
    const issues = issuesOf(i);
    if (!keys.length) { const d = document.createElement('div'); d.className = 'tc-dim'; d.textContent = 'This tool takes no parameters.'; box.appendChild(d); }
    for (const k of keys) {
      const row = document.createElement('div'); row.className = 'tc-f'; row.dataset.param = k;
      const lab = document.createElement('div'); lab.className = 'tc-f-head';
      const l = document.createElement('label'); l.textContent = k;
      const type = hintType(schema[k]);
      const tt = document.createElement('span'); tt.className = 'tc-type'; tt.textContent = k in schema ? type : 'extra';
      const rb = mk('⤵ route', 'Route an earlier step\'s output into ' + k, () => {});
      rb.classList.add('tc-route-btn'); rb.disabled = i === 0;
      lab.append(l, tt, rb); row.appendChild(lab);
      const val = step.params[k];
      const whole = wholeRef(val);
      let input = null;
      if (whole && whole.step >= 0 && whole.step < i) {
        const chip = document.createElement('div'); chip.className = 'tc-chip-route';
        const src = st.steps[whole.step];
        const now = src && src._result !== undefined ? lookup(src._result, whole.path) : null;
        chip.innerHTML = '<span class="tc-from">← step ' + (whole.step + 1) + '</span> <code>' + esc(whole.path) + '</code>' +
          '<span class="tc-dim">' + esc(src ? ' · ' + src.tool.id : '') + (now ? (now.found ? ' = ' + esc(JSON.stringify(now.value)).slice(0, 80) : ' · not in its last output') : '') + '</span>';
        const x = mk('✕', 'Remove this route (type a value instead)', () => { step.params[k] = ''; redraw(); }, 'rm'); chip.appendChild(x);
        row.appendChild(chip);
      } else {
        const big = /prompt|content|body|text|message|detail|json|args|query/i.test(k) || (typeof val === 'string' && val.length > 60);
        input = document.createElement(big ? 'textarea' : 'input');
        input.value = val == null ? '' : typeof val === 'object' ? JSON.stringify(val) : String(val);
        input.placeholder = String(schema[k] || '');
        input.addEventListener('input', () => { step.params[k] = input.value; });
        input.addEventListener('change', () => { step.params[k] = input.value; redraw(); });
        row.appendChild(input);
        const used = parseRefs(input.value);
        if (used.length) {
          const u = document.createElement('div'); u.className = 'tc-uses';
          u.textContent = 'uses ' + used.map((r) => 'step ' + (r.step + 1) + ' · ' + r.path).join(', ');
          row.appendChild(u);
        }
      }
      rb.onclick = (ev) => routeMenu(ev, i, k, input);
      for (const iss of issues.filter((x) => x.param === k)) {
        const e = document.createElement('div'); e.className = 'tc-issue ' + iss.level; e.textContent = (iss.level === 'error' ? '✗ ' : '⚠ ') + k + ' ' + iss.message;
        row.appendChild(e);
      }
      if (schema[k]) { const h = document.createElement('div'); h.className = 'tc-fh'; h.textContent = String(schema[k]); row.appendChild(h); }
      box.appendChild(row);
    }
    if (step._result !== undefined) {
      const r = document.createElement('details'); r.className = 'tc-res ' + (step._ok ? 'ok' : 'err'); r.open = true;
      const sm = document.createElement('summary'); sm.textContent = (step._ok ? 'Last output' : 'Last error') + (step._time != null ? ' · ' + step._time + ' ms' : '');
      const pre = document.createElement('pre');
      const txt = typeof step._result === 'string' ? step._result : JSON.stringify(step._result, null, 2);
      pre.textContent = txt.slice(0, 4000) + (txt.length > 4000 ? '\n… (truncated)' : '');
      r.append(sm, pre); box.appendChild(r);
    }
    const ins = wires(step.params).filter((w) => w.step >= 0 && w.step < i);
    if (ins.length) { const w = document.createElement('div'); w.className = 'tc-wires'; w.textContent = '🔗 inputs routed from ' + [...new Set(ins.map((x) => 'step ' + (x.step + 1)))].join(', '); box.appendChild(w); }
  }

  // ── run ──────────────────────────────────────────────────────────────────────
  async function run(upto) {
    if (st.running || !st.steps.length) return;
    const last = upto == null ? st.steps.length - 1 : Math.min(upto, st.steps.length - 1);
    const errs = validateChain(st.steps.slice(0, last + 1)).filter((x) => x.level === 'error');
    if (errs.length) {
      st.selected = errs[0].step; redraw();
      setStatus('Fix the routing first: step ' + (errs[0].step + 1) + ' · ' + errs[0].param + ' ' + errs[0].message);
      return;
    }
    const writes = st.steps.slice(0, last + 1).map((s, i) => ({ s, i })).filter((x) => x.s.tool.safety === 'confirm');
    let confirmWrites = false;
    if (writes.length) {
      confirmWrites = await confirm('This chain calls ' + writes.length + ' tool(s) that WRITE or change something:\n\n' +
        writes.map((x) => '  step ' + (x.i + 1) + ': ' + x.s.tool.id).join('\n') +
        '\n\nRun them for real? (Cancel runs them as previews - write tools answer with a dry-run.)');
    }
    st.running = true; setStatus('Running…');
    const out = q('c-out'); out.innerHTML = ''; const results = [];
    for (const s of st.steps) { delete s._running; if (st.steps.indexOf(s) <= last) { delete s._result; delete s._ok; delete s._done; delete s._time; } }
    graph.render(); const t0 = performance.now();
    try {
      for (let i = 0; i <= last; i++) {
        const step = st.steps[i]; step._running = true; graph.render();
        setStatus('Step ' + (i + 1) + '/' + (last + 1) + ': ' + (step.tool.id || ''));
        const { args, missing } = buildArgs(step.params, results, step.tool.params);
        const block = document.createElement('details'); block.open = true; block.className = 'tc-out-step';
        const sum = document.createElement('summary'); const pre = document.createElement('pre');
        block.append(sum, pre); out.appendChild(block);
        if (missing.length) {
          Object.assign(step, { _result: { _error: 'unresolved route(s): ' + missing.map((m) => m.param + ' ← ' + m.ref).join(', ') }, _ok: false, _done: true, _running: false });
          sum.textContent = '✗ Step ' + (i + 1) + ': ' + step.tool.id + ' - not called';
          pre.textContent = 'These inputs are routed from outputs that do not exist:\n' + missing.map((m) => '  ' + m.param + ' ← ' + m.ref).join('\n');
          st.selected = i; redraw(); break;
        }
        if (step.tool.safety === 'confirm' && confirmWrites) args.confirm = true;
        const start = performance.now();
        const resp = await callOp(step.tool.app_id, step.tool.op, args);
        const elapsed = Math.round(performance.now() - start);
        const result = resp.result !== undefined ? resp.result : resp;
        const ok = !!(resp.ok && !(result && (result._error || result.error)));
        results.push(result); Object.assign(step, { _result: result, _ok: ok, _done: true, _running: false, _time: elapsed });
        sum.textContent = (ok ? '✓' : '✗') + ' Step ' + (i + 1) + ': ' + step.tool.id + ' · ' + elapsed + ' ms' + (result && result.dry_run ? ' · preview (dry run)' : '');
        pre.textContent = 'args: ' + JSON.stringify(args) + '\n\n' + JSON.stringify(result, null, 2).slice(0, 4000);
        if (i === st.selected) drawInspector(); graph.render();
        if (!ok) { st.selected = i; drawInspector(); break; }
      }
      const done = st.steps.filter((s) => s._done && s._ok).length;
      setStatus('Done - ' + done + '/' + (last + 1) + ' ok in ' + Math.round(performance.now() - t0) + ' ms');
    } finally { st.running = false; redraw(); }
  }

  // ── save / load ──────────────────────────────────────────────────────────────
  const loadSaved = () => { try { return JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {}; } catch (_e) { return {}; } };
  const serialize = () => st.steps.map((s) => ({ tool: s.tool.id || s.tool.name, params: Object.assign({}, s.params) }));
  function refreshSaved() {
    const box = actions.querySelector('#c-saved'); if (!box) return; const sv = loadSaved();
    box.innerHTML = '<option value="">Saved…</option>' + Object.keys(sv).sort().map((n) => '<option>' + esc(n) + '</option>').join('') +
      (Object.keys(sv).length ? '<option value="__delete__">Delete a saved chain…</option>' : '');
  }
  async function save() {
    if (!st.steps.length) { setStatus('Nothing to save.'); return; }
    const nm = await askName('Save chain as:'); if (!nm) return;
    const sv = loadSaved(); sv[nm] = serialize();
    try { localStorage.setItem(STORE_KEY, JSON.stringify(sv)); } catch (_e) {}
    refreshSaved(); setStatus("Saved '" + nm + "'.");
  }
  function askName(label) {
    return new Promise((resolve) => {
      if (window.AppUIDialog && AppUIDialog.prompt) AppUIDialog.prompt(label, '', (v) => resolve(v ? String(v).trim() : ''));
      else resolve((window.prompt(label) || '').trim());
    });
  }
  async function hydrate(recs) { st.steps = []; st.selected = -1; for (const r of recs || []) await addStep(r.tool, r.params); st.selected = st.steps.length ? 0 : -1; redraw(); }
  async function append(recs) { for (const r of recs || []) await addStep(r.tool, r.params); redraw(); }
  function snapshot() {
    return {
      steps: st.steps.map((s, i) => ({ n: i + 1, tool: s.tool.id || s.tool.name, params: s.params,
        routes: wires(s.params).map((w) => w.param + ' ← step ' + (w.step + 1) + '.' + w.path),
        output_fields: s._result !== undefined ? outputFields(s._result, { max: 25 }).map((f) => f.path) : undefined,
        status: s._done ? (s._ok ? 'ok' : 'error') : undefined })),
      selected: st.selected >= 0 ? st.selected + 1 : null,
      issues: validateChain(st.steps).map((x) => 'step ' + (x.step + 1) + ' ' + x.param + ': ' + x.message),
    };
  }

  q('c-clearout').addEventListener('click', () => { q('c-out').innerHTML = ''; });
  canvasBox.addEventListener('dragover', (e) => { e.preventDefault(); canvasBox.classList.add('drag-over'); });
  canvasBox.addEventListener('dragleave', (e) => { if (e.target === canvasBox) canvasBox.classList.remove('drag-over'); });
  canvasBox.addEventListener('drop', (e) => { e.preventDefault(); canvasBox.classList.remove('drag-over'); const id = e.dataTransfer.getData('text/plain'); if (id) addStep(id); });
  const ex = actions.querySelector('#c-examples'); if (ex) ex.addEventListener('change', (e) => { const n = e.target.value; if (n && EXAMPLES[n]) hydrate(EXAMPLES[n]); e.target.value = ''; });
  const sv = actions.querySelector('#c-saved');
  if (sv) sv.addEventListener('change', async (e) => {
    const n = e.target.value; e.target.value = ''; const s = loadSaved();
    if (n === '__delete__') {
      const nm = await askName('Delete which saved chain? (' + Object.keys(s).sort().join(', ') + ')');
      if (nm && s[nm]) { delete s[nm]; try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch (_e) {} refreshSaved(); setStatus("Deleted '" + nm + "'."); }
      return;
    }
    if (n && s[n]) hydrate(s[n]);
  });
  refreshSaved(); redraw();
  return { hydrate, append, snapshot, addStep, run, clear, save, count: () => st.steps.length,
           destroy: () => splits.forEach((x) => { try { x.destroy && x.destroy(); } catch (_e) {} }) };
}
