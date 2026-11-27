/* ChatSurface request context, attachment consumption and project-doc loading. */
window.AppUIChatSurfaceRequest = (() => {
  function create({CAP, state, call, getAttachments, setAttachments, renderAttachChips, contextText}) {
    let destroyed = false, request = 0;
    async function loadProjectDocs() {
      const id = ++request;
      const current = () => !destroyed && id === request;
      if (!current()) return;
      let docs = null;
      if (typeof CAP.projectDocs === 'function') {
        try { docs = await CAP.projectDocs(); } catch (_e) { docs = null; }
      } else if (CAP.projectDocsRoot) {
        // turnkey: let the server read AGENTS.md/README.md from a vfs:// root
        try {
          const r = await call('project_docs', {root: CAP.projectDocsRoot}, 15000);
          if (r && r.ok) docs = r.docs;
        } catch (_e) { docs = null; }
      } else { return; }
      if (!current()) return;
      if (!Array.isArray(docs) || !docs.length) { state.projectDocs = null; state.projectDocsText = ''; return; }
      state.projectDocs = docs;
      const CAP_PER = 8000, CAP_TOTAL = 20000;
      let total = 0; const blocks = [];
      for (const d of docs) {
        if (!d || !d.text) continue;
        let t = String(d.text);
        if (t.length > CAP_PER) t = t.slice(0, CAP_PER) + '\n…(truncated)';
        if (total + t.length > CAP_TOTAL) { t = t.slice(0, Math.max(0, CAP_TOTAL - total)) + '\n…(truncated)'; }
        total += t.length;
        blocks.push('--- project doc: ' + (d.name || 'doc') + ' ---\n' + t);
        if (total >= CAP_TOTAL) break;
      }
      state.projectDocsText = blocks.length
        ? ('PROJECT CONTEXT — the workspace ships these docs; follow their '
           + 'conventions:\n\n' + blocks.join('\n\n')) : '';
    }

    // A compact note of the tool calls a PAST assistant turn made (which tool,
    // which SQL / args), appended to that turn's content in the request. Without
    // it the model sees only the prose of earlier answers and loses WHAT they
    // queried (e.g. which table), so a follow-up drifts to other tables.
    function _toolNote(tcs) {
      if (!Array.isArray(tcs) || !tcs.length) return '';
      const lines = [];
      for (const tc of tcs) {
        if (!tc) continue;
        let name = String(tc.name || '');
        let a = tc.args || {};
        if (a && typeof a === 'object' && a.id && a.args && typeof a.args === 'object') { name = String(a.id); a = a.args; }
        if (!name || /^(load_tools|unload_tools|vis_)/.test(name)) continue;
        let s = '';
        try {
          const b = (a && typeof a === 'object') ? Object.assign({}, a) : a;
          if (b && typeof b === 'object') delete b.path;   // the source is in the page context
          s = JSON.stringify(b);
        } catch (_e) { s = ''; }
        if (s.length > 500) s = s.slice(0, 500) + '…';
        lines.push('- ' + name + ' ' + s + (tc.status === 'error' ? '  (failed)' : ''));
      }
      if (!lines.length) return '';
      const kept = lines.slice(-8);
      return '\n\n[tool calls behind this answer]\n' + kept.join('\n');
    }

    // ---- request shaping ----------------------------------------------------
    function buildReqBody(req, {history}) {
      if (destroyed) return;
      let pendingAttachments = getAttachments();
      const msgs = (history || [])
        .filter(m => (m.role === 'user' || m.role === 'assistant') && (m.content || '').length)
        .map(m => ({role: m.role, content: m.role === 'assistant'
          ? m.content + _toolNote(m.tool_calls) : m.content}));
      if (pendingAttachments.length && msgs.length) {
        for (let i = msgs.length - 1; i >= 0; i--) {
          if (msgs[i].role === 'user') {
            const blocks = pendingAttachments.map(a =>
              '--- attached file: ' + a.name + (a.truncated ? ' (truncated)' : '') + ' ---\n' + a.text);
            msgs[i] = {role: 'user', content: blocks.join('\n\n') + '\n\n' + msgs[i].content};
            break;
          }
        }
        setAttachments([]); renderAttachChips();
      }
      if (msgs.length) { req.messages = msgs; delete req.prompt; }
      // Prepend host project docs (AGENTS.md/README.md) then the user's custom
      // system prompt, then any per-turn host context (e.g. the editor's current
      // slide), so the model is grounded in the workspace conventions + state.
      // IMPROVEMENTS_NEXT #31: turn-CONSTANT parts first (project docs, the custom/profile prompt, wired
      // workflows), the parts that change between turns LAST (where the user is, the page's live view, the
      // context chips) - a provider's prompt cache then reuses the whole constant prefix every turn
      const sysParts = [];
      if (state.projectDocsText) sysParts.push(state.projectDocsText);
      if (state.system) sysParts.push(state.system);
      if (state.wiredWorkflows && state.wiredWorkflows.length) {
        sysParts.push('[Workflows wired into this chat] Run one with '
          + 'platform/tool_runner.run {workflow:"<name>", inputs:{…}} (read its inputs first with '
          + 'platform/tool_runner.flow {workflow:"<name>"}): ' + state.wiredWorkflows.join(', '));
      }
      if (state.locationContext) sysParts.push(state.locationContext);
      // Per-turn host context (the page's live view: open source, shown table,
      // filter). ALWAYS sent: the system prompt is rebuilt per request and a
      // stateless backend (ericai) keeps nothing between turns. The old #26
      // "skip when unchanged" made every follow-up turn blind to the page (the
      // duckdb assistant searched all tables instead of the one on screen).
      if (state.turnContext) sysParts.push('[Current page view]\n' + state.turnContext);
      // ➕ context chips (other apps' exposed context + pins) - every turn, like the page view
      if (typeof contextText === 'function') { try { const ct = contextText(); if (ct) sysParts.push(ct); } catch (_e) {} }
      state._lastSentTurnContext = state.turnContext || '';
      req.system = sysParts.join('\n\n');
      req.scope = state.scope || [];
      req.progressive = !!state.progressive;
      req.flatten = !!(state.flatten && !(state.scope && state.scope.length));
      if (state.model) req.model = state.model;
      if (state.temperature != null) req.temperature = state.temperature;
      if (state.pendingReset) { req.reset = 1; state.pendingReset = false; }
      // CHAT_SIDEBAR #1 / #174 — pin a STABLE per-chat key (the mounted profile
      // id) so the kiro backend gives each app's chat its own warm driver + its
      // own system prompt, with no cross-page prompt leak via the shared pool.
      // Server+transport already consume `?pool=` → pool_id (committed); this is
      // the last client link. Ignored by backends that don't pool (ericai).
      if (state.profileId) req.pool = state.profileId;
      if (state.confirmWrites) req.confirm_writes = 1;
      // a .kiro agent chosen in the 🔌 tool wiring: the server applies its prompt, resources and tool scope
      if (state.agent) req.agent = state.agent;
      // tools WIRED into this chat (MCP servers, workflows, apps) - merged server-side (llm_server
      // merge_extra_scope), kept apart from `scope` so the Tools dialog / backend switch don't drop them
      if (state.wiredScope && state.wiredScope.length) req.extra_scope = state.wiredScope.slice();
      // HOST turn scope: tools the page makes available for THIS turn only (e.g. the Workspace adds the
      // read-only ops of the app showing the open file) - merged like wired tools
      if (typeof CAP.turnScope === 'function') {
        try {
          const ts = CAP.turnScope();
          if (Array.isArray(ts) && ts.length) {
            const ex = req.extra_scope || [];
            ts.forEach(p => { if (typeof p === 'string' && p && ex.indexOf(p) < 0) ex.push(p); });
            req.extra_scope = ex;
          }
        } catch (_e) { /* host hook failed: no turn scope */ }
      }
      // HOST-bound tool args for this turn ({"<app_id>" | "<app_id>.<op>": {arg: value}}): the server forces them onto
      // the model's calls of those tools (e.g. the shown viewer's file as src, so a wrong file is impossible)
      if (typeof CAP.turnBind === 'function') {
        try { const tb = CAP.turnBind(); if (tb && typeof tb === 'object' && Object.keys(tb).length) req.tool_bind = tb; } catch (_e) { /* no binding */ }
      }
      state.lastReq = {backend: req.backend, system: req.system, scope: req.scope.slice(),
        extra_scope: (req.extra_scope || []).slice(),
        progressive: req.progressive, flatten: req.flatten, model: state.model || '(default)'};
    }

    return {loadProjectDocs, buildReqBody, destroy() {destroyed = true; request++;}};
  }
  return {create};
})();
