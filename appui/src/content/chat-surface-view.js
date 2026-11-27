/* Capability-driven surface chrome, with owned button listeners. */
window._AppUIChatSurfaceView = (() => {
  function render({container, _compact, CAP, state, setStatus, _backendHolder, backendsController, scopeLabelText, getChat, handlers}) {
    const owner = AppUILifecycle.createScope();
    const {openSettings, openConfig, openPrompts, openAttach, attachCurrentView, openContext,
      openServerHistory, openEngineHistory, openJobs, runInBackground, exportTranscript, sendCurrentLocation, newChat,
      openKiro, kiroLabel, openAddContext} = handlers;
    let jobsBtn = null;
    function mkBtn(icon, label, title, fn) {
      const b = document.createElement('button'); b.className = 'cs-btn' + (_compact ? ' cs-btn-icon' : '');
      b.textContent = _compact ? icon : (icon ? icon + ' ' + label : label);
      b.title = title || label;
      b.setAttribute('aria-label', label);
      owner.listen(b, 'click', fn);
      return b;
    }
      const wrap = document.createElement('div'); wrap.className = 'cs-wrap' + (_compact ? ' cs-compact' : '');
      const bar = document.createElement('div'); bar.className = 'cs-bar';
      // The backend <select> lives in the LLM dialog now (not the bar). Keep the
      // element around (off-DOM) so paintBackendOptions/loadBackendsBootstrap
      // keep working; the LLM dialog reparents it when opened.
      const backendSel = document.createElement('select'); backendSel.className = 'cs-backend'; backendSel.title = 'Backend';
      backendsController.bind(backendSel);
      _backendHolder.append(backendSel);
      const scopeBtn = mkBtn('🧩', scopeLabelText(), 'Select which tools the model can use (scope / flatten / hierarchical)', () => { openSettings().catch(() => {}); });

      // ⚙️ LLM — backend picker + model + tunables. Always shown.
      const buttons = [mkBtn('⚙️', 'LLM', 'Backend, model + tunables', () => openConfig()), scopeBtn];
      buttons.push(mkBtn('★', 'Prompts', 'Saved prompt favourites', () => openPrompts()));
      // 🔌 Tool wiring: the platform's tool_* apps for THIS chat - agent persona, MCP servers (tool_kiro), skills,
      // workflows (tool_runner), the CASK marketplace (tool_cask), any catalog tool (tool_catalog / tool_guides)
      let kiroBtn = null;
      if (CAP.kiro !== false && typeof openKiro === 'function') {
        kiroBtn = mkBtn('🔌', kiroLabel ? kiroLabel() : 'Wiring', 'Tool wiring: agent, MCP servers, skills, workflows, marketplace for this chat', () => openKiro());
        if (state.agent || (state.wiredScope && state.wiredScope.length) || (state.wiredWorkflows && state.wiredWorkflows.length)) kiroBtn.classList.add('cs-btn-on');
        buttons.push(kiroBtn);
        state._kiroBtn = kiroBtn;
      }
      // ➕ add another app's exposed context (manifest chat_context) to this chat as a chip
      if (CAP.contextChips && typeof openAddContext === 'function') buttons.push(mkBtn('➕', 'Add context', 'Add context from an app (a workspace, a DuckDB file, …) — sent with every turn', () => openAddContext()));
      if (CAP.attachments) buttons.push(mkBtn('📎', 'Attach', 'Attach files (converted to text for the next turn)', () => openAttach()));
      // ⭐ VFS-path attach: when a host provides currentLocation (it knows the
      // user's selected file by its vfs:// ref), offer a one-click "attach the
      // file I'm viewing" — the server reads it via file/vfs (no browser
      // download). Hidden on the bare page (no currentLocation).
      if (CAP.attachments && typeof CAP.currentLocation === 'function')
        buttons.push(mkBtn('📎', 'View', 'Attach the file you are viewing (resolved by its path)', () => attachCurrentView()));
      buttons.push(mkBtn('ℹ️', 'Context', 'Edit the system prompt + see the FULL context sent to the model', () => openContext()));
      // 🛡 Confirm-writes toggle: when ON, every model invoke of a safety=confirm
      // (write) tool pauses for an approve/deny in the timeline. Off by default
      // (the model + each op's own dry-run self-gate still apply). Reflects state
      // in the button label so it's visible.
      let confirmBtn = null;
      confirmBtn = mkBtn(state.confirmWrites ? '🛡' : '🛡', state.confirmWrites ? 'Confirm: on' : 'Confirm', 'Approve each write tool before it runs', () => {
        state.confirmWrites = !state.confirmWrites;
        confirmBtn.textContent = _compact ? '🛡' : ('🛡 ' + (state.confirmWrites ? 'Confirm: on' : 'Confirm'));
        confirmBtn.classList.toggle('cs-btn-on', state.confirmWrites);
        setStatus(state.confirmWrites ? 'Write confirmation ON — writes pause for approval' : 'Write confirmation off');
      });
      if (state.confirmWrites) confirmBtn.classList.add('cs-btn-on');
      buttons.push(confirmBtn);
      buttons.push(mkBtn('🕑', 'History', 'Saved conversations', () => (CAP.serverHistory ? openServerHistory() : (getChat()?.getSessions ? openEngineHistory() : setStatus('History unavailable')))));
      if (CAP.jobs) { jobsBtn = mkBtn('🧰', 'Jobs', 'Background turns', () => openJobs()); buttons.push(jobsBtn); }
      if (CAP.jobs) buttons.push(mkBtn('⏳', 'Run in bg', 'Run the current prompt as a detached background turn', () => runInBackground()));
      if (CAP.export) buttons.push(mkBtn('↗', 'Export', 'Export the transcript', () => exportTranscript()));
      if (typeof CAP.currentLocation === 'function') buttons.push(mkBtn('📍', 'Path', 'Send the current view as context', () => sendCurrentLocation()));
      if (typeof CAP.saveLink === 'function') buttons.push(mkBtn('🔗', 'Link', 'Save a link to this conversation', () => { try { CAP.saveLink(getChat()?.exportChat?.() || ''); } catch (e) { setStatus('Link failed: ' + (e.message || e)); } }));
      // HOST-PROVIDED extra actions (e.g. the workspace's MCP/skills, agent
      // restart/log, raw dump, analytics) — surfaced as extra bar buttons so a
      // host keeps its UNIQUE dialogs while using the recent surface. Each:
      // {icon, label, title?, run(ctx)}. ctx = {chat, getHistory, setStatus}.
      if (Array.isArray(CAP.hostActions)) {
        CAP.hostActions.forEach(a => {
          if (!a || typeof a.run !== 'function') return;
          buttons.push(mkBtn(a.icon || '•', a.label || 'Action', a.title || a.label || '',
            () => { try { const chat = getChat(); a.run({chat, getHistory: () => (chat?.getHistory?.() || []), setStatus}); } catch (e) { setStatus('Action failed: ' + (e.message || e)); } }));
        });
      }

      const sp = document.createElement('span'); sp.className = 'cs-sp';
      const newBtn = mkBtn('🆕', 'New', 'Start a fresh conversation', () => newChat());
      // "#5fbad0bf" — the saved conversation's id (click copies the full id), so a
      // chat can be referred to ("check conversation 5fbad0bf"). Hidden until the
      // conversation is saved (first autosave after a reply).
      const sidChip = document.createElement('button');
      sidChip.type = 'button'; sidChip.className = 'cs-btn cs-sid'; sidChip.hidden = true;
      owner.listen(sidChip, 'click', () => {
        const id = state.activeSessionId; if (!id) return;
        const done = () => setStatus('Conversation id copied: ' + id);
        try {
          if (window.AppUICore && AppUICore.copyText) AppUICore.copyText(id).then(done, () => setStatus('Conversation id: ' + id));
          else if (navigator.clipboard) navigator.clipboard.writeText(id).then(done, () => setStatus('Conversation id: ' + id));
          else setStatus('Conversation id: ' + id);
        } catch (_e) { setStatus('Conversation id: ' + id); }
      });
      const paintSid = (id) => {
        sidChip.hidden = !id;
        sidChip.textContent = id ? '#' + String(id).slice(0, 8) : '';
        sidChip.title = id ? ('Conversation id ' + id + ' — click to copy (e.g. to say “check conversation ' + String(id).slice(0, 8) + '”)') : '';
        sidChip.setAttribute('aria-label', id ? 'Copy conversation id ' + id : 'Conversation id');
      };
      state._onSessionId = paintSid;
      paintSid(state.activeSessionId);
      bar.append(...buttons, sp, sidChip, newBtn);

      // Current-workspace indicator on its OWN top line (above the buttons), so
      // a long "📂 RRP/CSR · RE Follow up discussion…" doesn't crowd the bar.
      // Shows WHERE the chat is operating; updated on a host 'workspace-changed'
      // signal while IDLE. Hidden if no currentLocation. The header stacks the
      // indicator row + the button bar vertically (2-line chrome).
      const header = document.createElement('div'); header.className = 'cs-header';
      let wsIndicator = null;
      if (typeof CAP.currentLocation === 'function') {
        wsIndicator = document.createElement('div');
        wsIndicator.className = 'cs-wsind';
        wsIndicator.title = 'Current workspace / folder the chat is operating in';
        header.append(wsIndicator);
      }
      header.append(bar);


      const attachBar = document.createElement('div'); attachBar.id = 'cs-attach-bar'; attachBar.className = 'cs-attach-bar';
      const viewHost = document.createElement('div'); viewHost.className = 'cs-view';
      const ctxBar = document.createElement('div'); ctxBar.id = 'cs-ctx-bar'; ctxBar.className = 'cs-ctx-bar'; ctxBar.style.display = 'none';
      ctxBar.setAttribute('aria-label', 'Context sent with every turn');
      wrap.append(header, ctxBar, attachBar, viewHost);
      container.replaceChildren(wrap);

    return {root:wrap, viewHost, backendSel, scopeBtn, jobsBtn, wsIndicator, destroy:()=>owner.destroy()};
  }
  return {render};
})();
