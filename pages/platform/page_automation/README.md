# Page Automation UI

`index.htm` waits for AppUI foundation/shell, then uses `AppUIScriptLoader` to
load these authored scripts in order, with one per-load cache-busting timestamp:

- `assets/page_automation-editors.js`: case/fragment JSON dialogs, schema hints,
  validation and save operations.
- `assets/page_automation-runs.js`: case/all-runs scope controls, run-list
  rendering and a four-second successful-response cache through AppUI.
- `assets/page_automation-shots.js`: page/session screenshot caches, bulk
  prefetch and concurrent request sharing through AppUI's async cache.
- `assets/page_automation-filmstrip.js`: run header, collected data,
  action/screenshot cards, issue-report context, and run-to-case reconciliation.
- `assets/page_automation.js`: case/run selection, sidebar, screenshot services,
  and shell mounting.

The editor controller receives API/escaping services and getters for the current
app and selected case. It retains schema caching and explicit confirmation on
`set`/`set_fragment`; UI tests intercept those operations.
The runs controller receives a current-case getter. Concurrent requests for the
same scope share one promise, successful responses expire after four seconds,
and unsuccessful responses are retried on the next request.
The filmstrip controller receives live root/selection getters and callbacks to
pin a run's case or select its scheme. Screenshot retrieval stays in the page's
shared screenshot controller, so both scheme and filmstrip images use the same
prefetch results. Individual images remain cached for the page lifetime and use
the existing six-hour session lookup. Only pending requests are shared: a later
bulk request can discover screenshots added to a running automation. Failed
requests remain retryable.
The run's own case remains authoritative until a trusted sidebar click releases
the pin.
The page's JSON operation wrapper delegates to `AppUIApi.requestResponse`,
retaining raw response payloads and rejected transport/JSON errors. It disables
the default timeout to preserve existing long-running-operation behavior.
