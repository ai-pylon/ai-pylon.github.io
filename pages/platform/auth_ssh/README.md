# Connection page

`index.htm` loads the saved-host and file-browser controllers before
`connection.js`. The main page constructs them after AppUI is ready, preserving
the bundle-failure fallback.

- `connection-hosts.js`: saved-host listing/datalist, use, probe, save and delete
  actions. It receives the API and escaping functions.
- `connection-browser.js`: SFTP directory listing/navigation, size formatting
  and file reading. It receives API, escaping and the page's shared state object.
- `connection.js`: transport, active connections, connection setup, command
  execution, page markup and event wiring.

The browser updates the shared host/path state, so command execution can use the
host selected through SFTP. Controllers resolve state when called; they do not
capture a copy of the current host. Keep asset order and query versions current.
