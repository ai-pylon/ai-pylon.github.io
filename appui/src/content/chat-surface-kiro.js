/* ChatSurface 🔌 TOOL WIRING - the platform's tool_* apps for one chat, in one tabbed dialog:
 *   Wired        what THIS chat has: its agent persona + the tools wired into it (remove with ×)
 *   MCP servers  platform/tool_kiro: .kiro folders + MCP registries - enable, sign in, WIRE into this chat
 *   Skills       platform/tool_kiro skills (the assistant also finds them as guides) - read them
 *   Workflows    platform/tool_runner flows - wire one so the assistant can run it
 *   Marketplace  platform/tool_cask - search CASK skills/agents and install them into the host's .kiro
 *   Find tools   platform/tool_catalog search - wire any tool or app; tool_guides (find/guide) on/off
 * Wired tools travel as the request's `extra_scope` (llm_server merges them into the chat's scope; kept apart
 * from the 🧩 Tools selection so that dialog and a backend switch don't drop them). Agent + wiring are
 * remembered per chat profile. The same dialog opens standalone (manage only, nothing to wire into) via
 * window.AppUIToolWiring.open() - e.g. from the Workspace's "MCP servers & skills" dialog.
 * Hidden in a chat when the host sets capabilities.kiro === false. */
window._AppUIChatSurfaceKiro = (() => {
  const STORE = 'ai-chat-agent:', WIRED = 'ai-chat-wired:';
  const RUNNER = ['platform/tool_runner.run', 'platform/tool_runner.flow'];
  const GUIDES = ['platform/tool_guides.find', 'platform/tool_guides.guide'];
  function create({state, Dialog, esc, setStatus, kiroBase, onChange, standalone, extraTabs}) {
    let active = true;
    state = state || {};
    const kbase = (kiroBase || '/v1/apps/platform/tool_kiro').replace(/\/$/, '');
    const appBase = app => app === 'platform/tool_kiro' ? kbase : '/v1/apps/' + app;
    const key = () => STORE + (state.profileId || '_');
    const wkey = () => WIRED + (state.profileId || '_');
    const store = window.AppUIStorage || null;
    const status = t => { try { (setStatus || (() => {}))(t); } catch (_e) { /* no status bar */ } };
    async function op(app, name, body, timeout) {
      const r = await window.AppUIApi.requestResponse(appBase(app) + '/' + name, body || {},
        {method: 'POST', timeout: timeout || 30000, decode: res => res.json()});
      return r.data || {};
    }
    const kop = (name, body, timeout) => op('platform/tool_kiro', name, body, timeout);
    // ---- per-chat memory: agent + wiring ----
    function derive() {
      const w = state.wired || {scope: [], workflows: []};
      const s = (w.scope || []).slice();
      if ((w.workflows || []).length) RUNNER.forEach(p => { if (s.indexOf(p) < 0) s.push(p); });
      state.wiredScope = s;
      state.wiredWorkflows = (w.workflows || []).slice();
    }
    function restore() {
      try {
        const v = store && store.get ? store.get(key()) : localStorage.getItem(key());
        state.agent = (typeof v === 'string' ? v : (v && v.agent)) || '';
      } catch (_e) { state.agent = ''; }
      let w = null;
      try { w = store && store.getJSON ? store.getJSON(wkey(), null) : JSON.parse(localStorage.getItem(wkey()) || 'null'); } catch (_e) { w = null; }
      state.wired = {scope: (w && Array.isArray(w.scope)) ? w.scope.slice() : [], workflows: (w && Array.isArray(w.workflows)) ? w.workflows.slice() : []};
      state.wiredIsDefault = !w;
      derive();
      if (!w && state.profileId && !standalone) loadProfileDefaults();
      return state.agent;
    }
    // #29: a chat_profile may declare default wiring ("wired": ["mcp/gerrit", ...]) - used until the user
    // changes this chat's wiring (then their choice is stored and wins).
    async function loadProfileDefaults() {
      try {
        const r = await window.AppUIApi.requestResponse('/v1/apps/ai/llm_server/profile', {id: state.profileId, resolve: false},
          {method: 'POST', timeout: 15000, decode: res => res.json()});
        const prof = (r.data || {}).profile || {};
        if (state.wiredIsDefault && Array.isArray(prof.wired) && prof.wired.length) {
          state.wired = {scope: prof.wired.filter(p => typeof p === 'string'), workflows: []};
          derive();
          if (onChange) onChange(state.agent);
        }
      } catch (_e) { /* no profile / llm_server down: no defaults */ }
    }
    // #30/#31: the wiring as a plain object - saved with a conversation, copied to another chat, exported.
    function snapshot() { return {agent: state.agent || '', scope: (state.wired || {}).scope || [], workflows: (state.wired || {}).workflows || []}; }
    function apply(snap, msg) {
      if (!snap || typeof snap !== 'object') return false;
      state.agent = typeof snap.agent === 'string' ? snap.agent : (state.agent || '');
      state.wired = {scope: Array.isArray(snap.scope) ? snap.scope.filter(p => typeof p === 'string') : [],
                     workflows: Array.isArray(snap.workflows) ? snap.workflows.slice() : []};
      state.wiredIsDefault = false;
      changed(msg || 'Wiring restored');
      return true;
    }
    function otherProfiles() {
      const out = [];
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i) || '';
          const idx = k.indexOf(WIRED);
          const raw = idx >= 0 ? k.slice(idx + WIRED.length) : null;
          if (raw && raw !== (state.profileId || '_') && out.indexOf(raw) < 0) out.push(raw);
        }
      } catch (_e) { /* storage unavailable */ }
      return out;
    }
    function readProfile(pid) {
      let w = null, a = '';
      try { w = store && store.getJSON ? store.getJSON(WIRED + pid, null) : JSON.parse(localStorage.getItem(WIRED + pid) || 'null'); } catch (_e) { w = null; }
      try { const v = store && store.get ? store.get(STORE + pid) : localStorage.getItem(STORE + pid); a = (typeof v === 'string' ? v : (v && v.agent)) || ''; } catch (_e) { a = ''; }
      return w ? {agent: a, scope: w.scope || [], workflows: w.workflows || []} : null;
    }
    function persist() {
      derive();
      if (standalone) return;
      try {
        if (store && store.set) store.set(key(), state.agent || '');
        else if (state.agent) localStorage.setItem(key(), state.agent); else localStorage.removeItem(key());
        const w = {scope: state.wired.scope, workflows: state.wired.workflows};
        if (store && store.setJSON) store.setJSON(wkey(), w); else localStorage.setItem(wkey(), JSON.stringify(w));
      } catch (_e) { /* storage unavailable */ }
    }
    function wiredCount() { return (state.wired ? state.wired.scope.length + state.wired.workflows.length : 0); }
    function label() {
      const n = wiredCount();
      if (state.agent) return 'Agent: ' + state.agent + (n ? ' +' + n : '');
      return n ? 'Wiring: ' + n : 'Wiring';
    }
    function changed(msg) { state.wiredIsDefault = false; persist(); if (msg) status(msg); if (onChange) onChange(state.agent); }
    function isWired(p) { return !!state.wired && state.wired.scope.indexOf(p) >= 0; }
    function setWired(p, on) {
      const s = state.wired.scope.filter(x => x !== p);
      if (on) s.push(p);
      state.wired.scope = s;
      changed((on ? 'Wired ' : 'Unwired ') + p + ' — applies from the next message');
    }
    function setWorkflow(name, on) {
      const s = state.wired.workflows.filter(x => x !== name);
      if (on) s.push(name);
      state.wired.workflows = s;
      changed((on ? 'Wired workflow ' : 'Unwired workflow ') + name);
    }
    const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    const note = t => el('div', 'cs-kiro-note', t);
    function link(text, href) { const a = el('a', null, text); a.href = href; a.target = '_blank'; a.rel = 'noopener'; return a; }
    function wireBox(checked, onToggle, title) {
      const lab = el('label', 'cs-wire'); const cb = el('input'); cb.type = 'checkbox'; cb.checked = !!checked;
      cb.setAttribute('aria-label', title || 'wire into this chat');
      cb.addEventListener('change', () => onToggle(cb.checked)); lab.append(cb, document.createTextNode(' wire'));
      lab.title = title || 'make it available to the assistant in this chat'; return lab;
    }

    // ---- tabs ----
    const TABS = [['wired', 'Wired'], ['mcp', 'MCP servers'], ['skills', 'Skills'], ['workflows', 'Workflows'],
                  ['market', 'Marketplace'], ['find', 'Find tools']].filter(t => !(standalone && t[0] === 'wired'));
    async function openKiro(initialTab) {
      if (!Dialog) { status('Dialogs unavailable'); return; }
      // host-provided tabs (e.g. the Workspace's own built-in tool groups): [{id, label, render: async ({note, el, status}) => [nodes]}]
      const extra = (Array.isArray(extraTabs) ? extraTabs : []).filter(t => t && t.id && typeof t.render === 'function');
      const tabs = TABS.concat(extra.map(t => [t.id, t.label || t.id]));
      const body = el('div', 'cs-kiro');
      const bar = el('div', 'cs-wire-tabs'); bar.setAttribute('role', 'tablist');
      const pane = el('div', 'cs-wire-pane');
      body.append(bar, pane);
      let cur = initialTab || (standalone ? 'mcp' : 'wired');
      // #47: one fetch per dialog open for the listings; an action (enable, sign in, install) drops what it changed
      const cache = {};
      const cached = (k, fn) => cache[k] || (cache[k] = Promise.resolve().then(fn).catch(e => { delete cache[k]; throw e; }));
      const invalidate = (...ks) => ks.forEach(k => { delete cache[k]; });
      const btns = {};
      tabs.forEach(([id, text]) => {
        const b = el('button', 'cs-btn cs-wire-tab', text); b.type = 'button'; b.setAttribute('role', 'tab'); b.dataset.tab = id;
        b.addEventListener('click', () => { cur = id; paintTabs(); render(); });
        btns[id] = b; bar.append(b);
      });
      function paintTabs() { Object.keys(btns).forEach(id => { btns[id].classList.toggle('cs-btn-on', id === cur); btns[id].setAttribute('aria-selected', id === cur ? 'true' : 'false'); }); }
      let gen = 0;
      async function render() {
        const my = ++gen;
        pane.replaceChildren(note('loading…'));
        try {
          const hostTab = extra.find(t => t.id === cur);
          const out = hostTab ? await hostTab.render({note, el, status, refresh: render})
            : await ({wired: renderWired, mcp: renderMcp, skills: renderSkills, workflows: renderWorkflows,
                      market: renderMarket, find: renderFind})[cur]();
          if (my === gen && active) pane.replaceChildren(...(out || []));
        } catch (e) {
          if (my === gen) pane.replaceChildren(note('unavailable: ' + (e.message || e)));
        }
      }
      paintTabs();
      Dialog.show({title: '🔌 Tool wiring' + (standalone ? '' : ' — this chat'), body, width: '700px', buttons: [{text: 'Close'}]});
      render();
      void esc;

      // ── Wired: agent + everything wired into this chat ──
      async function renderWired() {
        const out = [];
        const agents = await cached('agents', () => kop('agents')).catch(() => ({}));
        out.push(el('h4', null, 'Agent persona'));
        const sel = el('select', 'cs-kiro-agent'); sel.setAttribute('aria-label', 'Agent for this chat');
        const none = el('option', null, '(none — the app’s own assistant)'); none.value = ''; sel.append(none);
        (agents.agents || []).forEach(a => { const o = el('option', null, a.name + (a.description ? ' — ' + a.description.slice(0, 80) : '')); o.value = a.name; sel.append(o); });
        sel.value = state.agent || '';
        const info = note('');
        const paint = () => {
          const a = (agents.agents || []).find(x => x.name === sel.value);
          info.textContent = a ? ('tools → ' + ((a.platform_scope || []).join(', ') || '(none)') +
            ((a.unmapped_tools || []).length ? ' · Kiro-only (no platform equivalent): ' + a.unmapped_tools.join(', ') : '') +
            ' · from ' + a.scope + ' .kiro') : 'The app’s own system prompt and tools.';
        };
        sel.addEventListener('change', () => { state.agent = sel.value; paint(); changed(state.agent ? ('Agent ' + state.agent + ' — applies from the next message') : 'Agent cleared'); });
        paint();
        out.push(sel, info);
        out.push(el('h4', null, 'Tools wired into this chat'));
        const list = el('div', 'cs-kiro-list');
        const items = state.wired.scope.map(p => ({p, kind: 'tool'})).concat(state.wired.workflows.map(p => ({p, kind: 'workflow'})));
        if (!items.length) list.append(note('Nothing wired yet — wire MCP servers, workflows or tools from the other tabs.'));
        items.forEach(it => {
          const row = el('div', 'cs-kiro-row');
          const x = el('button', 'cs-kiro-signin', '×'); x.type = 'button'; x.title = 'unwire'; x.setAttribute('aria-label', 'unwire ' + it.p);
          x.addEventListener('click', () => { (it.kind === 'workflow' ? setWorkflow : setWired)(it.p, false); render(); });
          row.append(el('span', 'cs-kiro-name', it.p), el('span', 'cs-kiro-meta', it.kind), x);
          list.append(row);
        });
        out.push(list);
        if (state.progressive || state.flatten) out.push(note('This chat already reaches every catalog tool (hierarchical / all mode) — wiring matters once you pick a tool scope in 🧩.'));
        else out.push(note('Wired tools are added to the chat’s 🧩 tool scope on every message (a chat without a scope gets exactly them).'));
        if (state.wiredIsDefault && wiredCount()) out.push(note('These are the app’s default wiring (its chat profile) — change anything and this chat keeps your choice.'));
        // #31: copy the wiring from another chat, or move it around as JSON
        out.push(el('h4', null, 'Copy / export'));
        const cp = el('div', 'cs-wire-search');
        const from = el('select'); from.setAttribute('aria-label', 'copy the wiring of another chat');
        const o0 = el('option', null, 'copy from another chat…'); o0.value = ''; from.append(o0);
        otherProfiles().forEach(pid => { const o = el('option', null, pid); o.value = pid; from.append(o); });
        from.addEventListener('change', () => {
          const snap = from.value && readProfile(from.value);
          if (snap) { apply(snap, 'Copied the wiring of ' + from.value); render(); }
        });
        const io = el('textarea', 'cs-kiro-pre cs-wire-json'); io.rows = 3; io.setAttribute('aria-label', 'wiring as JSON');
        io.placeholder = '{"agent": "", "scope": ["mcp/gerrit"], "workflows": []}';
        const ex = el('button', 'cs-btn', 'Export'); ex.type = 'button';
        ex.addEventListener('click', () => {
          io.value = JSON.stringify(snapshot(), null, 1);
          try {
            const p = navigator.clipboard && navigator.clipboard.writeText(io.value);
            if (p && p.then) p.then(() => status('Wiring copied to the clipboard'), () => { /* not focused / denied: the box has it */ });
          } catch (_e) { /* no clipboard */ }
        });
        const im = el('button', 'cs-btn', 'Import'); im.type = 'button';
        im.addEventListener('click', () => {
          let snap = null;
          try { snap = JSON.parse(io.value); } catch (_e) { status('Import: not valid JSON'); return; }
          if (apply(snap, 'Wiring imported')) render();
        });
        cp.append(from, ex, im);
        out.push(cp, io);
        return out;
      }

      // ── MCP servers (tool_kiro: .kiro + registries) ──
      async function renderMcp() {
        const sv = await cached('servers', () => kop('servers'));
        const rows = sv.servers || [];
        const out = [note('From your .kiro folders and the MCP registries. Enabling connects and lists its tools; wiring makes them available in this chat.')];
        const list = el('div', 'cs-kiro-list');
        if (!rows.length) list.append(note('No MCP servers — add one in Tool Kiro (or a .kiro/settings/mcp.json).'));
        rows.forEach(s => {
          const row = el('div', 'cs-kiro-row');
          const cb = el('input'); cb.type = 'checkbox'; cb.checked = !!s.enabled; cb.disabled = !!(s.disabled || s.self_loop);
          cb.setAttribute('aria-label', 'Enable ' + s.name);
          const name = el('span', 'cs-kiro-name', s.name);
          const meta = el('span', 'cs-kiro-meta', [s.kind, s.runs_on ? ('on ' + s.runs_on) : '', s.scope, s.enabled ? (s.tools + ' tools') : 'off',
            s.needs_auth ? 'needs sign-in' : '', s.needs_env ? 'needs env' : '', s.last_error ? ('error: ' + s.last_error.slice(0, 80)) : '',
            s.disabled ? 'disabled in mcp.json' : ''].filter(Boolean).join(' · '));
          const pat = 'mcp/' + (s.vname || s.name);
          let wb = null;
          cb.addEventListener('change', async () => {
            cb.disabled = true; meta.textContent = cb.checked ? 'connecting…' : 'disabling…';
            try {
              const r = await kop('mcp_enable', {name: s.name, enabled: cb.checked, confirm: true}, 180000);
              invalidate('servers');
              if (r.ok === false) { cb.checked = !cb.checked; meta.textContent = r._error || r.error || 'failed'; }
              else {
                meta.textContent = r.enabled ? (r.tools + ' tools' + (r.error ? ' · ' + r.error.slice(0, 80) : '') + (r.needs_auth ? ' · needs sign-in' : '')) : 'off';
                if (!r.enabled && isWired(pat)) setWired(pat, false);
                if (wb) wb.querySelector('input').disabled = !r.enabled;
              }
              status(r.ok === false ? ('MCP ' + s.name + ': ' + (r._error || 'failed')) : ('MCP ' + s.name + (r.enabled ? ' enabled' : ' disabled')));
            } catch (e) { cb.checked = !cb.checked; meta.textContent = 'failed: ' + (e.message || e); }
            cb.disabled = false;
          });
          row.append(cb, name, meta);
          if (s.can_sign_in && !s.self_loop && (s.needs_auth || s.signed_in)) row.append(signInButton(s, meta));
          if (!standalone) {
            wb = wireBox(isWired(pat), on => setWired(pat, on), 'wire ' + pat + ' into this chat');
            wb.querySelector('input').disabled = !s.enabled;
            row.append(wb);
          }
          row.append(link('⚙', '/apps/platform/tool_kiro/?path=' + encodeURIComponent('mcp/' + (s.vname || s.name))));
          list.append(row);
        });
        out.push(list, note('Tools that are not read-only still ask for confirmation. Registries, env values and new servers: '));
        out[out.length - 1].append(link('Tool Kiro', '/apps/platform/tool_kiro/?path=roots'));
        return out;
      }
      function signInButton(s, meta) {
        // OAuth: open the tab inside the click (popup blockers), then point it at the authorize_url
        const sb = el('button', 'cs-kiro-signin', s.signed_in ? 'Sign out' : 'Sign in'); sb.type = 'button';
        sb.addEventListener('click', async () => {
          sb.disabled = true;
          if (s.signed_in) {
            try { await kop('mcp_signout', {name: s.name, confirm: true}); s.signed_in = false; s.needs_auth = true; sb.textContent = 'Sign in'; meta.textContent = 'signed out'; }
            catch (e) { meta.textContent = 'failed: ' + (e.message || e); }
            sb.disabled = false; return;
          }
          const w = window.open('about:blank', '_blank');
          try {
            const r = await kop('mcp_signin', {name: s.name, redirect_base: location.origin, confirm: true}, 60000);
            if (!r.authorize_url) throw new Error(r._error || r.error || 'no authorize_url');
            if (w) { w.opener = null; w.location.href = r.authorize_url; } else window.open(r.authorize_url, '_blank', 'noopener');
            meta.textContent = 'complete the sign-in in the opened tab…';
            for (let i = 0; i < 150 && active; i++) {
              await new Promise(res => setTimeout(res, 2000));
              const x = await kop('mcp_auth_status', {name: s.name});
              if (x.state === 'authenticated') { invalidate('servers'); s.signed_in = true; s.needs_auth = false; sb.textContent = 'Sign out'; meta.textContent = 'signed in' + (x.tools ? ' · ' + x.tools + ' tools' : ''); status('MCP ' + s.name + ' signed in'); break; }
              if (x.state === 'error') { meta.textContent = 'sign-in failed: ' + (x.error || ''); break; }
            }
          } catch (e) { if (w) w.close(); meta.textContent = 'sign-in failed: ' + (e.message || e); }
          sb.disabled = false;
        });
        return sb;
      }

      // ── Skills (tool_kiro) ──
      async function renderSkills() {
        const skills = await cached('skills', () => kop('skills'));
        const out = [note('Skills from your .kiro folders. The assistant finds them on its own (as guides); open one to read it.')];
        const sk = el('div', 'cs-kiro-list');
        (skills.skills || []).forEach(s => {
          const d = el('details', 'cs-kiro-skill');
          const sum = el('summary', null, '');
          const cb = el('input'); cb.type = 'checkbox'; cb.checked = s.enabled !== false; cb.className = 'cs-kiro-skill-on';
          cb.title = 'offer this skill to the assistants (off: not a guide, not listed in chats)';
          cb.setAttribute('aria-label', 'enable the skill ' + s.name);
          cb.addEventListener('click', e => e.stopPropagation());
          cb.addEventListener('change', async () => {
            cb.disabled = true;
            try {
              const r = await kop('skill_enable', {name: s.name, enabled: cb.checked, confirm: true});
              if (r.ok === false) cb.checked = !cb.checked;
              invalidate('skills');
              status('Skill ' + s.name + (cb.checked ? ' enabled' : ' disabled'));
            } catch (e) { cb.checked = !cb.checked; status('Skill toggle failed: ' + (e.message || e)); }
            cb.disabled = false;
          });
          sum.append(cb, document.createTextNode(' ' + s.name + ' — ' + (s.description || '').slice(0, 120)));
          d.append(sum);
          d.addEventListener('toggle', async () => {
            if (!d.open || d.dataset.loaded) return;
            d.dataset.loaded = '1';
            const r = await kop('skill', {name: s.name}).catch(() => ({}));
            d.append(el('pre', 'cs-kiro-pre', ((r.skill && r.skill.body) || '(could not read)').slice(0, 6000)));
          });
          sk.append(d);
        });
        if (!(skills.skills || []).length) sk.append(note('No skills — add one as .kiro/skills/<name>/SKILL.md, or install one from the Marketplace tab.'));
        out.push(sk);
        return out;
      }

      // ── Workflows (tool_runner) ──
      async function renderWorkflows() {
        const r = await cached('flows', () => op('platform/tool_runner', 'flows', {}));
        const flows = r.flows || r.workflows || r.items || [];
        const out = [note(standalone ? 'Saved workflows (platform/tool_runner).' :
          'Wire a workflow so the assistant can run it (platform/tool_runner.run); write steps still ask for confirmation.')];
        const list = el('div', 'cs-kiro-list');
        if (!flows.length) list.append(note('No workflows yet — build one in Tool Runner.'));
        flows.forEach(f => {
          const nm = f.name || f.id || f.workflow; if (!nm) return;
          const row = el('div', 'cs-kiro-row');
          row.append(el('span', 'cs-kiro-name', nm), el('span', 'cs-kiro-meta', ((f.description || '') + (f.steps != null ? ' · ' + (f.steps.length != null ? f.steps.length : f.steps) + ' steps' : '')).slice(0, 120)));
          if (!standalone) {
            // #26: a workflow with a manual trigger is its own tool wf/<name>.run (tool_runner publishes it)
            const manual = (f.triggers || []).some(t => t && t.type === 'manual');
            const vid = 'wf/' + String(nm).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64);
            if (manual) row.append(wireBox(isWired(vid) || state.wired.workflows.indexOf(nm) >= 0, on => {
              if (state.wired.workflows.indexOf(nm) >= 0) setWorkflow(nm, false);     // drop a legacy runner-style wiring
              setWired(vid, on);
            }, 'wire the workflow ' + nm + ' as the tool ' + vid + '.run'));
            else row.append(wireBox(state.wired.workflows.indexOf(nm) >= 0, on => setWorkflow(nm, on), 'wire the workflow ' + nm + ' (no manual trigger: runs via tool_runner.run)'));
          }
          list.append(row);
        });
        out.push(list);
        const f = note(''); f.append(link('Open Tool Runner', '/apps/platform/tool_runner/')); out.push(f);
        return out;
      }

      // ── Marketplace (tool_cask) ──
      async function renderMarket() {
        const out = [note('CASK marketplace — the cask CLI runs on your SSH host. Installed skills/agents land in that host’s ~/.kiro (shown in Tool Kiro).')];
        const row = el('div', 'cs-wire-search');
        const kind = el('select'); kind.setAttribute('aria-label', 'kind');
        ['skill', 'agent'].forEach(k => { const o = el('option', null, k + 's'); o.value = k; kind.append(o); });
        const q = el('input'); q.placeholder = 'search the marketplace'; q.setAttribute('aria-label', 'search the marketplace');
        const go = el('button', 'cs-btn', 'Search'); go.type = 'button';
        row.append(kind, q, go);
        const res = el('div', 'cs-kiro-list');
        async function search() {
          res.replaceChildren(note('searching on the host…'));
          let r;
          try { r = await op('platform/tool_cask', 'search', {kind: kind.value, query: q.value.trim()}, 120000); }
          catch (e) { res.replaceChildren(note('Tool Cask unavailable: ' + (e.message || e))); return; }
          if (r.needs_login) { const n = note('cask is not signed in on the host — '); n.append(link('sign in on Tool Cask', '/apps/platform/tool_cask/')); res.replaceChildren(n); return; }
          if (r.ok === false) { res.replaceChildren(note(r.error || r._error || 'search failed')); return; }
          res.replaceChildren();
          (r.items || []).slice(0, 100).forEach(it => {
            const line = el('div', 'cs-kiro-row');
            const ib = el('button', 'cs-kiro-signin', it.update_available ? 'Update' : (it.installed ? 'Installed ✓' : 'Install')); ib.type = 'button';
            if (it.installed && !it.update_available) { ib.disabled = true; ib.title = 'installed (v' + (it.installed_version || '?') + ')'; }
            ib.addEventListener('click', () => {
              Dialog.confirm ? Dialog.confirm('Install the ' + it.kind + ' ' + it.name + ' into the host’s ~/.kiro?', () => install(it, ib)) : install(it, ib);
            });
            line.append(el('span', 'cs-kiro-name', it.name), el('span', 'cs-kiro-meta', ((it.version ? 'v' + it.version + ' · ' : '') + (it.description || '')).slice(0, 140)), ib);
            res.append(line);
          });
          if (!(r.items || []).length) res.append(note('no matches'));
        }
        async function install(it, ib) {
          ib.disabled = true; ib.textContent = 'Installing…';
          try {
            const r = await op('platform/tool_cask', 'install', {kind: it.kind, name: it.name, add_root: true, confirm: true}, 300000);
            ib.textContent = r.ok ? 'Installed' : 'Failed';
            if (r.ok) {
              // #27: the install landed in a (remote) .kiro root - rescan so the Skills / MCP tabs show it now
              invalidate('skills', 'servers', 'agents');
              try { await kop('refresh', {connect: false, confirm: true}, 120000); } catch (_e) { /* next open shows it */ }
              const where = note('→ ' + (r.kiro_root || 'the host’s ~/.kiro') + (r.root_added ? ' (added as a Tool Kiro root)' : '') + ' · ');
              const goto = el('button', 'cs-kiro-signin', it.kind === 'agent' ? 'see Wired (agents)' : 'see Skills'); goto.type = 'button';
              goto.addEventListener('click', () => { cur = it.kind === 'agent' ? (standalone ? 'mcp' : 'wired') : 'skills'; paintTabs(); render(); });
              where.append(goto);
              ib.closest('.cs-kiro-row').after(where);
            }
            status(r.ok ? ('Installed ' + it.name + (r.kiro_root ? ' → ' + r.kiro_root : '')) : ('Install failed: ' + (r.error || r._error || r.output || '').slice(0, 120)));
          } catch (e) { ib.textContent = 'Failed'; status('Install failed: ' + (e.message || e)); }
        }
        go.addEventListener('click', search);
        q.addEventListener('keydown', e => { if (e.key === 'Enter') search(); });
        out.push(row, res);
        return out;
      }

      // ── Find tools (tool_catalog + tool_guides) ──
      async function renderFind() {
        const out = [note(standalone ? 'Search every tool on the platform (platform/tool_catalog).' :
          'Search every tool on the platform and wire a tool or its whole app into this chat.')];
        if (!standalone) {
          const g = el('div', 'cs-kiro-row');
          g.append(el('span', 'cs-kiro-name', 'Tool guides'), el('span', 'cs-kiro-meta', 'let the assistant look up which tool fits (platform/tool_guides find/guide)'),
            wireBox(GUIDES.every(isWired), on => { GUIDES.forEach(p => { if (isWired(p) !== on) setWired(p, on); }); }, 'wire tool guides'));
          out.push(g);
        }
        const row = el('div', 'cs-wire-search');
        const q = el('input'); q.placeholder = 'what should the assistant be able to do? (e.g. jira, convert pptx)'; q.setAttribute('aria-label', 'search tools');
        const go = el('button', 'cs-btn', 'Search'); go.type = 'button';
        row.append(q, go);
        const res = el('div', 'cs-kiro-list');
        async function search() {
          const text = q.value.trim(); if (!text) return;
          res.replaceChildren(note('searching…'));
          const r = await op('platform/tool_catalog', 'search', {query: text, limit: 30}).catch(e => ({_error: e.message || String(e)}));
          const tools = r.tools || r.results || r.items || [];
          res.replaceChildren();
          if (!tools.length) { res.append(note(r._error || 'no matches')); return; }
          // #28: the apps (and groups) the matches belong to come first, so a whole app is one click
          if (!standalone) {
            const apps = {}, groups = {};
            tools.forEach(t => {
              const id = t.id || t.name; if (!id || id.lastIndexOf('.') < 0) return;
              const appId = id.slice(0, id.lastIndexOf('.'));
              apps[appId] = (apps[appId] || 0) + 1;
              const g = appId.indexOf('/') > 0 ? appId.slice(0, appId.lastIndexOf('/')) : '';
              if (g) groups[g] = (groups[g] || 0) + 1;
            });
            const head = el('div', 'cs-kiro-list cs-wire-apps');
            Object.keys(apps).sort((a, b) => apps[b] - apps[a]).slice(0, 8).forEach(a => {
              const line = el('div', 'cs-kiro-row');
              line.append(el('span', 'cs-kiro-name', a), el('span', 'cs-kiro-meta', 'app · ' + apps[a] + ' matching tool' + (apps[a] > 1 ? 's' : '')),
                wireBox(isWired(a), on => setWired(a, on), 'wire every tool of ' + a));
              head.append(line);
            });
            Object.keys(groups).filter(g => groups[g] > 1 && Object.keys(apps).filter(a => a.indexOf(g + '/') === 0).length > 1).slice(0, 4).forEach(g => {
              const line = el('div', 'cs-kiro-row');
              line.append(el('span', 'cs-kiro-name', g), el('span', 'cs-kiro-meta', 'group · every app under ' + g + '/'),
                wireBox(isWired(g), on => setWired(g, on), 'wire every tool of the group ' + g));
              head.append(line);
            });
            if (head.childNodes.length) res.append(el('h4', null, 'Apps'), head, el('h4', null, 'Tools'));
          }
          tools.forEach(t => {
            const id = t.id || t.name; if (!id) return;
            const line = el('div', 'cs-kiro-row');
            const safe = t.safety === 'read_only';
            const badge = el('span', 'cs-wire-safety' + (safe ? '' : ' cs-wire-write'), safe ? 'read' : 'write');
            badge.title = safe ? 'read-only: runs without asking' : 'changes something: asks for confirmation';
            line.append(el('span', 'cs-kiro-name', id), badge, el('span', 'cs-kiro-meta', (t.description || '').slice(0, 120)));
            if (!standalone) {
              line.append(wireBox(isWired(id), on => setWired(id, on), 'wire the tool ' + id));
            }
            res.append(line);
          });
        }
        go.addEventListener('click', search);
        q.addEventListener('keydown', e => { if (e.key === 'Enter') search(); });
        out.push(row, res);
        return out;
      }
    }
    restore();
    state._applyWiring = apply;           // chat-surface-history restores a saved conversation's wiring (#30)
    return {openKiro, restore, persist, label, snapshot, apply, destroy() { active = false; }};
  }
  return {create};
})();

// Standalone (manage-only) tool wiring for pages without a chat surface, e.g. the Workspace dialog.
window.AppUIToolWiring = {
  open(opts) {
    const o = opts || {};
    const c = window._AppUIChatSurfaceKiro.create({state: {}, Dialog: o.Dialog || window.AppUIDialog, esc: o.esc,
      setStatus: o.setStatus, kiroBase: o.kiroBase, standalone: true, extraTabs: o.extraTabs});
    return c.openKiro(o.tab);
  },
};
