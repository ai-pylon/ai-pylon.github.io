# Credential page

`index.htm` loads `credential-form.js` and `credential-table.js` before
`credential.js`. The page
constructs `CredentialForm.create(deps)` inside the AppUI readiness handler,
preserving the existing bundle-failure fallback.

The form controller owns provider discovery, provider hints/type selection,
form fill/reset, credential editing, validation, and save submission. The page
supplies vault/auth HTTP operations, refresh, and a getter for the current
credential list. Refresh replaces that list, so the getter keeps editing and
blank-token handling current. The controller owns its provider registry and
exposes `hasProvider(name)` for the page's provider deep link.

Editing clears the secret field rather than prefilling it. Saving an existing
credential with a blank secret omits the token argument, preserving the stored
value. The page retains connection actions, master-account controls, and shell
wiring.

`CredentialTable.create(deps)` owns table rendering, health badges, immediate
credential-list refresh, and per-cell countdown updates. It shares the page's
state object and receives the vault/auth operations and row-action callbacks.
Its refresh loop uses `AppUIPollRefresh`: visible countdowns tick every 30
seconds, status is polled every two visible minutes, and overlapping ticks are
coalesced. The poller's `stopWhen` condition releases the loop when the root is
detached, including while hidden. Explicit `destroy()` also stops the loop.

The shared `_post` wrapper uses `AppUIApi.requestResponse` for both vault and
auth HTTP operations. It keeps raw JSON and the existing `{ok, status, data}`
envelope, with HTTP `ok` independent of the body, unlimited request duration,
and rejected transport/JSON errors.

## Deep links
Use AppUIUrlFields.credentialSchema and link()/prefill(). For example: /apps/platform/credential/?name=duckdns-pylon-server&service=custom&url=https%3A%2F%2Fwww.duckdns.org&type=bearer&product=duckdns . The token field stays blank; the user explicitly saves and confirms. Destination/authentication metadata changes require re-entering a token rather than silently reusing an existing one.
