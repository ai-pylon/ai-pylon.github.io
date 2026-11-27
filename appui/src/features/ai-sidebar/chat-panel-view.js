/* ChatPanel view helpers; loaded by the aiSidebar bundle. */
window._AppUIChatPanelView = (() => {
  // #9 — remember the panel's DOCK width (and open flag) per configKey, so the
  // assistant stays where the user left it. Restores a saved width onto the
  // host element on mount, and persists changes (ResizeObserver, debounced) via
  // AppUIConfigStore when present (else a localStorage mirror). Returns a
  // control { isOpen, setOpen, stop } — setOpen toggles a saved open flag the
  // host can react to (the shell owns actual visibility via toggleRightSidebar).
  function rememberDock(hostEl, configKey) {
    const key = 'dock:' + (configKey || 'chat-panel');
    const wKey = key + ':width', oKey = key + ':open';
    const store = {
      get(k, d) {
        if (window.AppUIConfigStore) return window.AppUIConfigStore.get(k, d);
        try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (_e) { return d; }
      },
      set(k, v) {
        if (window.AppUIConfigStore) { window.AppUIConfigStore.set(k, v); return; }
        try { localStorage.setItem(k, JSON.stringify(v)); } catch (_e) {}
      },
    };
    // restore width
    const savedW = store.get(wKey, null);
    if (hostEl && savedW && Number(savedW) > 0) { try { hostEl.style.width = Number(savedW) + 'px'; } catch (_e) {} }
    // persist width on resize (debounced)
    let ro = null, t = null;
    if (hostEl && typeof ResizeObserver === 'function') {
      ro = new ResizeObserver(() => {
        if (t) clearTimeout(t);
        t = setTimeout(() => { const w = Math.round(hostEl.getBoundingClientRect().width); if (w > 0) store.set(wKey, w); }, 400);
      });
      try { ro.observe(hostEl); } catch (_e) {}
    }
    return {
      isOpen: () => store.get(oKey, true) !== false,
      setOpen: (v) => store.set(oKey, !!v),
      stop: () => { try { if (t) clearTimeout(t); } catch (_e) {} try { ro && ro.disconnect(); } catch (_e) {} },
    };
  }

  // #8 — append a page.see SCREENSHOT as a small thumbnail into the chat
  // transcript, so the user SEES what the vision model was shown. Best-effort:
  // finds the transcript scroll area (the surface's stable container) and adds a
  // compact figure with the captured data URL; clicking opens it full-size in a
  // new tab. No-op if the host or the url is missing.
  function _appendShotThumb(hostEl, url) {
    try {
      if (!hostEl || !url || typeof document === 'undefined') return;
      const area = hostEl.querySelector('.ai-chat-messages, .ai-chat-transcript, .ai-chat-log')
        || hostEl;
      const fig = document.createElement('div');
      fig.className = 'ai-chat-shot';
      fig.style.cssText = 'margin:6px 0;max-width:220px';
      const cap = document.createElement('div');
      cap.style.cssText = 'font-size:10px;color:var(--text-muted,#888);margin-bottom:2px';
      cap.textContent = '📷 what the assistant looked at';
      const a = document.createElement('a');
      a.href = url; a.target = '_blank'; a.rel = 'noopener';
      a.title = 'open full-size';
      const img = document.createElement('img');
      img.src = url; img.alt = 'page screenshot';
      img.style.cssText = 'max-width:220px;max-height:160px;border:1px solid var(--border,#333);'
        + 'border-radius:6px;display:block;cursor:zoom-in';
      a.append(img); fig.append(cap, a); area.append(fig);
      try { area.scrollTop = area.scrollHeight; } catch (_e) {}
    } catch (_e) { /* best-effort */ }
  }

  // #12 — render a one-tap STARTER-PROMPT chip row. The chips sit in the chat
  // area just ABOVE the input field (between the transcript and the composer),
  // where "suggested prompts" belong. Clicking a chip prefills the composer
  // (.ai-chat-input) and focuses it. The row disappears as soon as the user
  // SENDS (clicks .ai-chat-send or presses Enter), with a message-appeared
  // observer as a fallback. Returns { stop() } for teardown. No-op when there
  // are no prompts.
  function _renderStarterChips(hostEl, examplePrompts, promptVars) {
    // #11 (NODE_HEALTH_TODO): a prompt may carry {name} placeholders filled from the page -
    // promptVars() -> {name: value} (the host hook of that name). The chip SHOWS "this <name>"
    // (a short label instead of e.g. a long bundle path) and FILLS the real value; a prompt whose
    // placeholder the page cannot fill (yet) is skipped. Values are read at click time.
    const vars = () => { try { return (typeof promptVars === 'function' ? promptVars() : promptVars) || {}; } catch (_e) { return {}; } };
    const names = (s) => Array.from(String(s).matchAll(/\{(\w+)\}/g), (m) => m[1]);
    const fillIn = (s, v, label) => String(s).replace(/\{(\w+)\}/g, (m, k) => (k in v && v[k] != null && v[k] !== ''
      ? (label ? 'this ' + k.replace(/_/g, ' ') : String(v[k])) : m));
    const v0 = vars();
    const list = (Array.isArray(examplePrompts) ? examplePrompts : [])
      .map((p) => (typeof p === 'string' ? p : (p && p.prompt)))
      .filter((s) => s && String(s).trim())
      .filter((s) => names(s).every((k) => k in v0 && v0[k] != null && v0[k] !== ''))
      .slice(0, 6);
    if (!hostEl || !list.length) return { stop() {} };
    const bar = document.createElement('div');
    bar.className = 'ai-chat-starter-chips';
    bar.style.cssText = 'flex:0 0 auto;display:flex;flex-wrap:wrap;gap:6px;'
      + 'padding:6px 8px;border-top:1px solid var(--border,#2a2a2a)';
    const hint = document.createElement('div');
    hint.style.cssText = 'width:100%;font-size:10px;color:var(--text-muted,#888);margin-bottom:2px';
    hint.textContent = 'Try asking:';
    bar.append(hint);
    const fill = (text) => {
      const input = hostEl.querySelector('.ai-chat-input');
      if (input) {
        input.value = text; input.focus();
        try { input.dispatchEvent(new Event('input', { bubbles: true })); } catch (_e) {}
      }
    };
    list.forEach((text) => {
      const chip = document.createElement('button');
      chip.type = 'button'; chip.className = 'ai-btn';
      chip.style.cssText = 'font-size:11px;padding:3px 8px;border:1px solid var(--border,#333);'
        + 'border-radius:12px;background:var(--bg-elevated,#1e1e1e);color:var(--text-primary,#ddd);'
        + 'cursor:pointer;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
      const t = String(text);
      const shown = fillIn(t, v0, true);
      chip.textContent = shown.length > 48 ? shown.slice(0, 47) + '…' : shown;
      chip.title = fillIn(t, v0, false);
      chip.addEventListener('click', () => fill(fillIn(t, vars(), false)));
      bar.append(chip);
    });

    let obs = null;
    const listeners = [];
    const hide = () => {
      try { bar.remove(); } catch (_e) {}
      if (obs) { try { obs.disconnect(); } catch (_e2) {} obs = null; }
      listeners.forEach((off) => { try { off(); } catch (_e3) {} });
      listeners.length = 0;
    };

    // Place the bar just ABOVE the composer (`.ai-chat-input-area`), so it reads
    // as "suggested prompts" right over where you type. If the composer isn't in
    // the DOM yet (surface still mounting), retry briefly, then fall back to the
    // top of the host. The chat surface fills its host at height:100%, so the
    // host is made a flex column and the bar takes only its content height.
    const place = () => {
      const inputArea = hostEl.querySelector('.ai-chat-input-area');
      if (inputArea && inputArea.parentNode) {
        inputArea.parentNode.insertBefore(bar, inputArea);
        _wireHide();
        return true;
      }
      return false;
    };
    // Hide the chips the moment the user SENDS: Send button click OR Enter in the
    // composer (not Shift+Enter). Plus a transcript observer as a safety net.
    const _wireHide = () => {
      const sendBtn = hostEl.querySelector('.ai-chat-send');
      const input = hostEl.querySelector('.ai-chat-input');
      if (sendBtn) {
        const onClick = () => hide();
        sendBtn.addEventListener('click', onClick);
        listeners.push(() => sendBtn.removeEventListener('click', onClick));
      }
      if (input) {
        const onKey = (e) => { if (e.key === 'Enter' && !e.shiftKey) hide(); };
        input.addEventListener('keydown', onKey);
        listeners.push(() => input.removeEventListener('keydown', onKey));
      }
      try {
        obs = new MutationObserver(() => {
          if (hostEl.querySelector('.ai-chat-msg, .ai-msg, [data-role="assistant"], [data-role="user"]')) hide();
        });
        obs.observe(hostEl, { childList: true, subtree: true });
      } catch (_e) { /* no MutationObserver */ }
    };

    try { hostEl.style.display = 'flex'; hostEl.style.flexDirection = 'column'; hostEl.style.minHeight = '0'; } catch (_e) {}
    if (!place()) {
      // composer not ready — retry a few frames, else drop the bar at the top.
      let tries = 0;
      const timer = setInterval(() => {
        if (place() || ++tries > 20) {
          clearInterval(timer);
          if (!bar.isConnected) {
            try { hostEl.insertBefore(bar, hostEl.firstChild); } catch (_e) { hostEl.appendChild(bar); }
            _wireHide();
          }
        }
      }, 100);
      listeners.push(() => clearInterval(timer));
    }
    return { stop: hide };
  }

  return { rememberDock, _appendShotThumb, _renderStarterChips };
})();
