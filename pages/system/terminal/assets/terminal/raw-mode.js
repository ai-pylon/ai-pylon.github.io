/** Terminal raw-mode rendering, polling, and key forwarding. */
window.TerminalRawMode = (() => {
  function create({ api, ensureSession, getRoot, setStatus, syncToolbar, readyPrompt, aliasOf, sess }) {
    // --- interactive RAW mode (tmux-backed remote sessions) ---------------------
    // In raw mode the session screen is replaced by a live <pre> that mirrors the
    // tmux pane (polled via terminal.read), and the input box forwards keystrokes
    // straight to the pane via terminal.write (literal text, or named keys for
    // Enter/arrows/Ctrl-C/Esc/etc). This lets vim/top/less/a REPL actually run.
    var RAW_KEYMAP = {
      "Enter": "Enter", "Tab": "Tab", "Escape": "Escape", "Backspace": "BSpace",
      "ArrowUp": "Up", "ArrowDown": "Down", "ArrowLeft": "Left", "ArrowRight": "Right",
      "Home": "Home", "End": "End", "PageUp": "PageUp", "PageDown": "PageDown",
      "Delete": "DC", "Insert": "IC",
      "F1": "F1", "F2": "F2", "F3": "F3", "F4": "F4", "F5": "F5", "F6": "F6",
      "F7": "F7", "F8": "F8", "F9": "F9", "F10": "F10", "F11": "F11", "F12": "F12",
    };

    async function enterRaw(s) {
      if (!s.host) { setStatus("Raw mode is remote-only."); return; }
      if (!(await ensureSession(s))) return;
      s.raw = true;
      s.screen.classList.add("raw");
      var pre = document.createElement("pre");
      pre.className = "raw-pane";
      pre.setAttribute("tabindex", "0");
      s.screen.appendChild(pre);
      s.rawPre = pre;
      var inp = getRoot().querySelector("#cmd");
      inp.placeholder = "raw mode — keystrokes go straight to the shell (Esc-heavy apps: use the input)";
      inp.value = "";
      rawPoll(s);                 // start the live mirror
      syncToolbar();
      pre.focus();
      setStatus("Raw interactive mode on " + aliasOf(s.host) + " — type here; Ctrl-keys via the input. Click 'exit raw' to leave.");
    }

    function exitRaw(s) {
      s.raw = false;
      if (s.rawTimer) { clearTimeout(s.rawTimer); s.rawTimer = null; }
      if (s.rawPre) { s.rawPre.remove(); s.rawPre = null; }
      s.screen.classList.remove("raw");
      var inp = getRoot().querySelector("#cmd");
      inp.placeholder = "type a command, Enter to run";
      readyPrompt(s);
      syncToolbar();
      setStatus("Left raw mode.");
    }

    async function rawPoll(s) {
      if (!s.raw) return;
      try {
        var d = await api("read", { host: s.host, id: s.sid });
        if (s.raw && s.rawPre && d && d.output != null) {
          var atBottom = (s.screen.scrollTop + s.screen.clientHeight) >= (s.screen.scrollHeight - 30);
          s.rawPre.textContent = d.output;
          if (atBottom) s.screen.scrollTop = s.screen.scrollHeight;
        }
      } catch (_) {}
      if (s.raw) s.rawTimer = setTimeout(function () { rawPoll(s); }, 700);
    }

    // map a keydown in raw mode → either literal text or a named tmux key, send it.
    async function rawKey(s, e) {
      if (!s.raw || !s.host) return false;
      var key = e.key;
      // control combos: C-<letter>, C-c etc.
      if (e.ctrlKey && key.length === 1 && /[a-zA-Z0-9\[\]\\\/]/.test(key)) {
        e.preventDefault();
        await api("write", { host: s.host, id: s.sid, data: "C-" + key.toLowerCase(), keys: true });
        return true;
      }
      if (e.altKey && key.length === 1 && /[a-zA-Z0-9]/.test(key)) {
        e.preventDefault();
        await api("write", { host: s.host, id: s.sid, data: "M-" + key.toLowerCase(), keys: true });
        return true;
      }
      if (RAW_KEYMAP[key]) {
        e.preventDefault();
        await api("write", { host: s.host, id: s.sid, data: RAW_KEYMAP[key], keys: true });
        return true;
      }
      if (key.length === 1) {              // printable → literal
        e.preventDefault();
        await api("write", { host: s.host, id: s.sid, data: key, keys: false });
        return true;
      }
      return false;                        // let other keys pass (e.g. browser shortcuts)
    }

    function toggleRaw() {
      var s = sess(); if (!s) return;
      if (s.raw) exitRaw(s); else enterRaw(s);
    }
    return { enterRaw, exitRaw, rawKey, toggleRaw };
  }
  return { create };
})();
