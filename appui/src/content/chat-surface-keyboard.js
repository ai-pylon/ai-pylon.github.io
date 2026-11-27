/* Composer steering, shortcuts, and slash-command interception. */
window._AppUIChatSurfaceKeyboard = (() => {
  function bind({CAP, composerInput, viewHost, getChat, steerRunningTurn, setStatus, newChat, runSlash}) {
    const owner = AppUILifecycle.createScope();
      if (CAP.steer) {
        owner.listen(composerInput() || viewHost, 'keydown', (e) => {
          const chat = getChat();
          if (e.key === 'Enter' && !e.shiftKey && chat && chat.isStreaming) {
            const inp = composerInput();
            const text = inp ? String(inp.value || '').trim() : '';
            if (text) {
              e.preventDefault(); e.stopPropagation();
              steerRunningTurn(text);
              if (inp) { inp.value = ''; try { inp.dispatchEvent(new Event('input', {bubbles: true})); } catch (_e) {} }
              setStatus('Steered the running turn');
            }
          }
        }, true);
      }

      // ---- keyboard map (improvement idea) ----------------------------------
      // Ctrl/Cmd+Enter = send, Esc = stop (only while streaming), Ctrl/Cmd+L =
      // new chat. ↑/↓ recall + plain-Enter send + Shift+Enter newline are
      // already handled by the engine composer; this adds the explicit shortcuts
      // without touching those. Bound on the composer input so it doesn't hijack
      // page-wide keys. Esc/Ctrl+L act even with the input focused.
      (function _bindKeymap() {
        const inp = composerInput();
        const el = inp || viewHost;
        if (!el || el._csKeymapBound) return;
        el._csKeymapBound = true;
        owner.add(() => { delete el._csKeymapBound; });
        owner.listen(el, 'keydown', (e) => {
          const chat = getChat();
          const mod = e.ctrlKey || e.metaKey;
          if (mod && e.key === 'Enter') {               // Ctrl/Cmd+Enter → send
            e.preventDefault();
            try { if (chat && chat.isStreaming) return; } catch (_e) {}
            const text = inp ? String(inp.value || '').trim() : '';
            if (text) { try { chat && chat.send(text); } catch (_e) {} if (inp) inp.value = ''; }
            return;
          }
          if (e.key === 'Escape') {                      // Esc → stop (if streaming)
            let streaming = false; try { streaming = !!(chat && chat.isStreaming); } catch (_e) {}
            if (streaming) { e.preventDefault(); try { chat.cancel(); } catch (_e) {} setStatus('Stopped'); }
            return;
          }
          if (mod && (e.key === 'l' || e.key === 'L')) { // Ctrl/Cmd+L → new chat
            e.preventDefault();
            try { newChat(); } catch (_e) {}
          }
        });
      })();

      // ---- slash commands (improvement idea) --------------------------------
      // Typing a /command as the WHOLE message and pressing Enter runs a UI
      // action instead of sending a chat turn: /tools /model /new /export /help.
      // Capture-phase (before the engine composer's Enter=send) so the command
      // never reaches the backend. A non-command message, or a slash line with
      // trailing text that isn't a known command, sends normally. Also surfaced
      // via the public API (runSlash) for tests/hosts.
      (function _bindSlash() {
        const inp = composerInput();
        if (!inp || inp._csSlashBound) return;
        inp._csSlashBound = true;
        owner.add(() => { delete inp._csSlashBound; });
        owner.listen(inp, 'keydown', (e) => {
          if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
          const raw = String(inp.value || '').trim();
          if (raw[0] !== '/') return;                  // not a command → normal send
          if (runSlash(raw)) {                         // known command → consume
            e.preventDefault(); e.stopPropagation();
            inp.value = '';
            try { inp.dispatchEvent(new Event('input', {bubbles: true})); } catch (_e) {}
          }
          // unknown /command → fall through (sent as a normal message)
        }, true);
      })();
    return {destroy:()=>owner.destroy()};
  }
  return {bind};
})();
