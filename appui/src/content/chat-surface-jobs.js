/* ChatSurface background jobs and owned polling timers. */
window.AppUIChatSurfaceJobs = (() => {
  function create({ call, _compact, Dialog, esc, q, setStatus, composerInput, state, renderAttachChips, getJobsButton, getAttachments, setAttachments }) {
    let destroyed = false;
    const BADGE_FAST_MS = 5000, BADGE_MAX_MS = 60000;
    let badgeMs = BADGE_FAST_MS, idleTicks = 0;
    const badgePoll = AppUIPollRefresh.create(refreshJobsBadge, BADGE_FAST_MS);
    const polls = new Set();
    let jobsBus = null;
    // ---- 🧰 Jobs ------------------------------------------------------------
    async function refreshJobsBadge({signal} = {}) {
      const jobsBtn = getJobsButton();
      if (!jobsBtn || destroyed) return;
      let r = {};
      try { r = await call('jobs_list', {}, 10000); } catch (_e) { return; }
      if (destroyed || signal?.aborted) return;
      const active = (r && r.active) || 0;
      // NEXT2 #45: back off while there are no background turns (5 s → 10 → 20
      // → 40 → 60 s cap) instead of polling jobs_list every 5 s forever; any
      // active job (or a new run) snaps back to 5 s.
      const next = active ? BADGE_FAST_MS
        : Math.min(BADGE_MAX_MS, BADGE_FAST_MS * Math.pow(2, Math.min(++idleTicks, 4)));
      if (active) idleTicks = 0;
      if (next !== badgeMs) { badgeMs = next; badgePoll.setInterval(next); }
      // Respect icon-only (sidebar) mode: compact shows "🧰" + a count badge,
      // full page shows "🧰 Jobs (N)".
      jobsBtn.textContent = _compact
        ? ('🧰' + (active ? active : ''))
        : ('🧰 Jobs' + (active ? ' (' + active + ')' : ''));
      jobsBtn.title = 'Background turns' + (active ? ' — ' + active + ' active' : '');
      jobsBtn.style.borderColor = active ? 'var(--accent)' : '';
    }
    function startJobsBadge() {
      if (destroyed) return;
      badgePoll.start(); badgePoll.refresh();
      // ROUND4 #29: llm_server announces every background-turn state change on the EventBus "llm_jobs" channel -
      // refresh the badge (and an open jobs dialog) on the event; the backed-off poll stays as the fallback.
      if (!jobsBus && window.AppUIEventBus) {
        try {
          jobsBus = new AppUIEventBus(['llm_jobs'], {debounce: 200});
          jobsBus.onAny((ch) => {
            if (ch !== 'llm_jobs' || destroyed) return;
            idleTicks = 0;
            refreshJobsBadge();
            polls.forEach(poll => poll.refresh());
          });
        } catch (_e) { jobsBus = null; }
      }
    }
    async function openJobs() {
      if (!Dialog || destroyed) return;
      let closed = false;
      const body = document.createElement('div');
      body.style.cssText = 'display:flex;flex-direction:column;gap:6px;min-width:480px';
      const listEl = document.createElement('div');
      listEl.style.cssText = 'display:flex;flex-direction:column;gap:5px;max-height:52vh;overflow:auto';
      body.append(listEl);
      async function render({signal} = {}) {
        if (destroyed || closed || signal?.aborted) return;
        let r = {};
        try { r = await call('jobs_list', {}, 10000); } catch (_e) { r = {}; }
        if (destroyed || closed || signal?.aborted) return;
        const jobs = (r && r.jobs) || []; listEl.replaceChildren();
        if (!jobs.length) { const e = document.createElement('div');
          e.style.cssText = 'color:var(--text-muted);font-size:12px;padding:6px';
          e.textContent = 'No background turns. Use “Run in bg” on a long prompt.'; listEl.append(e); return; }
        jobs.forEach(j => {
          const row = document.createElement('div');
          row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 8px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg)';
          const dot = {running: '●', done: '✓', error: '✕', cancelled: '⊘', interrupted: '⚠'}[j.state] || '·';
          const col = {running: 'var(--accent)', done: '#3ba55d', error: '#d92d3a', cancelled: 'var(--text-muted)', interrupted: 'var(--color-warning,#e0a030)'}[j.state] || 'var(--text-muted)';
          const meta = document.createElement('div'); meta.style.cssText = 'flex:1;min-width:0';
          meta.innerHTML = '<div style="font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"><span style="color:' + col + '">' + dot + '</span> ' + esc(j.label) + '</div>'
            + '<div style="font-size:10px;color:var(--text-muted)">' + esc(j.state) + ' · ' + j.chars + ' chars · ' + j.tools + ' tools' + (j.error ? ' · ' + esc(j.error) : '') + '</div>';
          const foldBtn = document.createElement('button'); foldBtn.type = 'button'; foldBtn.className = 'tt-ctl'; foldBtn.textContent = 'Open';
          foldBtn.disabled = j.state === 'running';
          foldBtn.addEventListener('click', async () => { if (destroyed || closed) return; const s = await call('jobs_status', {id: j.id}, 10000); if (!destroyed && !closed && s && s.ok && s.job) foldJobIntoChat(s.job); });
          const cancelBtn = document.createElement('button'); cancelBtn.type = 'button'; cancelBtn.className = 'tt-ctl'; cancelBtn.textContent = 'Cancel';
          cancelBtn.disabled = j.state !== 'running';
          cancelBtn.addEventListener('click', async () => { if (destroyed || closed) return; await call('jobs_cancel', {id: j.id}, 10000); if (!destroyed && !closed) poll.refresh(); });
          row.append(meta, foldBtn, cancelBtn); listEl.append(row);
        });
      }
      const poll = AppUIPollRefresh.create(render, 3000, {pauseOnHidden: false});
      polls.add(poll);
      const stop = () => { closed = true; poll.destroy(); polls.delete(poll); };
      poll.start(); poll.refresh();
      Dialog.show({title: '🧰 Background jobs', body, width: '600px', onClose: stop, buttons: [{text: 'Refresh', action: () => poll.refresh()}, {text: 'Close', action: stop}]});
    }
    function foldJobIntoChat(job) {
      if (destroyed) return;
      const host = q('.ai-chat-messages'); if (!host) return;
      const div = document.createElement('div'); div.className = 'ai-chat-msg assistant';
      const md = window.AppUIMarkdown?.render ? window.AppUIMarkdown.render(job.content || '') : esc(job.content || '');
      div.innerHTML = '<div class="ai-chat-bubble"><div style="font-size:10px;color:var(--text-muted);margin-bottom:4px">🧰 background job “' + esc(job.label) + '” (' + esc(job.state) + ')</div>' + md + '</div>';
      host.appendChild(div); host.scrollTop = host.scrollHeight; setStatus('Folded job result into the chat');
    }
    async function runInBackground() {
      if (destroyed) return;
      const input = composerInput();
      const text = input ? String(input.value || '').trim() : '';
      if (!text) { setStatus('Type a prompt to run in the background'); return; }
      const body = {backend: state.backend, messages: [{role: 'user', content: text}],
        system: state.system || '', scope: state.scope || [], progressive: !!state.progressive,
        flatten: !!(state.flatten && !(state.scope && state.scope.length)), label: text.slice(0, 48)};
      if (state.wiredScope && state.wiredScope.length) body.extra_scope = state.wiredScope.slice();
      if (state.model) body.model = state.model;
      if (state.temperature != null) body.temperature = state.temperature;
      if (getAttachments().length) {
        const blocks = getAttachments().map(a => '--- attached file: ' + a.name + (a.truncated ? ' (truncated)' : '') + ' ---\n' + a.text);
        body.messages[0].content = blocks.join('\n\n') + '\n\n' + text; setAttachments([]); renderAttachChips();
      }
      let r = null;
      try { r = await call('chat_bg_start', body, 30000); } catch (e) { r = {error: e.message}; }
      if (destroyed) return;
      if (r && r.ok) {
        if (input) { input.value = ''; try { input.dispatchEvent(new Event('input', {bubbles: true})); } catch (_e) {} }
        setStatus('Started background turn ' + r.job_id);
        idleTicks = 0; if (badgeMs !== BADGE_FAST_MS) { badgeMs = BADGE_FAST_MS; badgePoll.setInterval(BADGE_FAST_MS); }
        refreshJobsBadge(); openJobs();
      } else { setStatus('Background start failed: ' + ((r && r.error) || 'error')); }
    }

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      badgePoll.destroy();
      if (jobsBus) { try { jobsBus.close(); } catch (_e) {} jobsBus = null; }
      polls.forEach(poll => poll.destroy()); polls.clear();
    }
    return {refreshJobsBadge, startJobsBadge, openJobs, runInBackground, destroy};
  }
  return {create};
})();
