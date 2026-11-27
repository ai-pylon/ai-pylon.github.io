# Terminal page modules

The page loads these internal factories before `terminal.js`:

- `sidebar.js` renders merged server sessions and open client tabs. It receives
  live active-session/tab/sidebar getters and delegates session actions to core.
- `processes.js` owns host scanning, process tables, process details and kill
  controls. Tmux attachment is delegated through the page to remote sessions.
- `raw-mode.js` owns the raw-mode view, polling and key forwarding. The page
  supplies its API, current root, status callback and session helpers.
- `execution.js` owns one-shot commands, persistent session creation/execution,
  remote connection, ANSI output cleanup, initial working-directory discovery,
  and session shutdown. It receives API, rendering, prompt, status and sidebar
  callbacks and operates on the session object supplied by the page.
- `remote-sessions.js` owns tmux attachment, alias-aware discovery of existing
  remote shells, and revival/kill banners. It receives the shared session map,
  live alias/tab getters, activation callback, and page rendering/session helpers.
  The page retains tab ownership; the controller requests activation and opening
  through those callbacks.
- `input.js` owns command/toolbar event bindings, per-session history, and
  debounced PTY size observation. It receives live root/session/raw-mode getters
  and delegates command, connection, host, shell and status actions to the page.
  Binding again first tears down existing listeners, observer and pending resize;
  `destroy()` performs the same cleanup and prevents stale observer callbacks.
  Resize suppression includes session ID and host as well as dimensions.

`terminal.js` owns session state, command submission, tabs, mounting and event
wiring. Text escaping uses `AppUITextUtils`; bundle-load failures render with
`textContent` so they still work if foundation failed to load.

Operation requests use `AppUIApi.requestResponse` with explicit POST, no request
timeout, and raw JSON decoding. HTTP-error bodies remain available to execution
handlers, and transport/JSON failures still reject. The shared transport adds
trace headers without adding fields to returned payloads.

The execution controller is constructed after AppUI is ready and before the
shell mounts. Status and sidebar callbacks resolve the current page objects
when invoked, so they also work after asynchronous bootstrap installs the real
sidebar refresh handler. Construction stays inside the readiness handler so
bundle failures can render the page's existing fallback message.

Keep the script order in `../../index.htm` and bump asset query versions after
changes. No additional runtime dependency or build step is required.

Clipboard actions use `AppUI.utils.core.copyText` for the shared browser/textarea fallback and cleanup. Rejected copy requests are handled by the caller.
