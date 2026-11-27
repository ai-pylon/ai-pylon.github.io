# AppUI runtime

For new pages that need shared services without shell widgets, load
`AppUIAssets.load('foundationCore')`. Add `dialog`, `menu`, or `statusbar` as
needed. `foundation` remains the compatibility entry point: it loads all these
families plus the existing routing and shared widgets. `shell` still depends
on that complete foundation. Each source belongs to one of these bundles,
so loading core first and the full shell later does not re-execute it.

The core path is approximately 33 KB gzipped after minification versus 54 KB
for the full foundation dependency closure. Run
`py -3 framework/appui/dev/check_bundles.py` for current raw, minified and gzip
sizes and dependency-graph validation. Timing varies by browser and host;
`tests/test_browser.py` reports local loading times for both entry paths.

Service-worker caches are restricted to same-origin `/appui/` assets. Upgrades
remove only older `appui-runtime-*` caches. Offline requests require an exact
cached URL, including its version and minification variant; a missing version
returns 504 rather than mixing releases. Loader diagnostics retain at most 200
events and report the effective asset version.

Modal dialogs trap keyboard focus in the top dialog, isolate background body
children with `inert`, and restore focus and prior inert attributes on close.
`AppUIEmbed.onCommand(callback)` returns an idempotent unsubscribe function;
pass it to a lifecycle scope's `add()` method when the view owns the subscription.
The legacy `AppUITextUtils.sanitizeHtml()` API is deprecated and now delegates
to `sanitizeDom()` while retaining its optional text-length limit. Prefer
`sanitizeDom()` for HTML and `esc()` for plain text.

`AppUIApi.runJob()` applies its timeout to submission and waiting, aborts
in-flight requests when cancelled, and requests cancellation of a known job on
timeout or caller cancellation. Cancellation is best effort; a job may already
have completed. Direct-operation fallback requires an explicit missing-service
or missing-submit response. Ambiguous submission failures return an
`idempotency_key`; reuse it as `options.idempotencyKey` to retry safely with the
updated Work Runner. The server scopes keys by caller, rejects changed payloads,
and deduplicates jobs while their records remain in its queue or retained
history. Keys are stored with the normal job persistence and do not promise
exactly-once execution across crashes or after history pruning.

Persistent state deletion removes pending debounced writes as well as stored
values, so `clear()` and `clearAll()` cannot resurrect a deleted value on flush.
Reactive state propagates changes through derived dependency chains before
notifying observers, rejects cycles, and coalesces nested synchronous batches
into one update round while retaining each key's original value.

Chat streaming and `AppUICore.parseSSE()` share `AppUIStreamEvents` framing,
including multiline data, split lines, CRLF/CR, and BOM handling. When using
`parseSSE()` directly, pass the same callbacks object for successive chunks and
call `AppUICore.parseSSE.finish(callbacks)` at EOF to flush an unterminated final
frame. The `streamEvents` compatibility bundle reuses the core parser.
`streamChat()` rejects HTTP and application failures, emits one terminal
notification, and cancels/releases readers on cancellation or callback failure.
EOF without an explicit terminal event remains successful for legacy streams.

`AppUIScriptLoader.load(url, globalName, {timeout: 10000})` normalizes URLs
relative to the document, ignores fragments for transport deduplication, and
rejects missing requested exports. The first caller sets the deadline for the
shared URL request. A timeout or transport failure removes the script and
permits retry; successful transports remain cached even if one caller asks for
a missing export. Removing a timed-out script cannot undo browser execution
that has already begun.

`AppUIAsyncCache.create({ttlMs, cacheIf, maxEntries: 256})` bounds successful
results with least-recently-used eviction and prunes expired entries during
cache activity. Pending requests retain coalescing and invalidation protection.
Use `maxEntries: 0` to disable completed-result retention, or `Infinity` for an
explicitly unbounded cache. The default `ttlMs: 0` still only coalesces requests.

`AppUIConfigStore` owns initialization and pending saves by namespace. Saves
serialize per key, retain an immutable value/version until acknowledged, and
retry at most five times with exponential backoff after an initial failure.
Unacknowledged changes and deletion markers are journaled in browser storage
and restored after reload; initializing their namespace or calling `flush()`
retries them. `flush({keepalive: true})` is used on unload and returns a promise
of save outcomes. `getStatus(namespace?)` reports `saved`, `pending`, `saving`,
or `error`; `onStatus(callback)` subscribes to the current namespace and returns
an unsubscribe function. Browser-storage failure is reported and changes stay
in memory. This is best-effort persistence; simultaneous edits from multiple
tabs still use the server's existing last-write behavior.

The API queue recognizes same-origin `/api/`, `/v1/apps/`, and `/run` paths
using parsed URLs, including `Request` and `URL` inputs. Aborting or flushing
queued work rejects callers with `AbortError`. `_apiQueue.max` accepts positive
integers and starts newly eligible work immediately. Ordinary admission slots
end at response headers; response bodies remain native. Explicit SSE requests
and `/stream` or `/subscribe` paths bypass admission so long-lived streams do
not block ordinary requests. Set `appuiQueue: 'default'` to force admission or
`appuiQueue: 'bypass'`/`'stream'` to bypass it. The queue does not cap open streams.
Startup retries preserve network failures and cancellation, bound each delay to
30 seconds, and clone `Request` bodies before consumption. Explicit streaming
`init.body` values are not retried.

`AppUIWebSocket` invalidates obsolete connection callbacks and heartbeat timers
on reconnect. Sending returns whether a message was accepted. Defaults bound
queued work to 256 messages and 1 MiB, expire it after 30 seconds, and use a
1 MiB `bufferedAmount` high-water limit. Configure `maxQueuedMessages`,
`maxQueuedBytes`, `queueTtlMs`, `highWaterMark`, and `drainInterval` as needed;
`overflowPolicy` is `reject-newest` by default, with `drop-oldest` available.
`send`, `sendBinary`, and `sendJSON` accept `{ttlMs}` as a second argument;
`Infinity` explicitly disables expiry. `overflow`, `expired`, `backpressure`,
and `drain` events report queue changes; `queuedBytes` and `bufferedAmount`
expose current pressure. Expiry affects queued messages, not bytes already
accepted by the native socket. Applications sending larger frames must raise
the byte and high-water limits explicitly.

Repository checks (Node.js and Python, with `rjsmin==1.3.0` from `pyproject.toml`):

```
py -3 framework/appui/dev/build_artifacts.py
py -3 framework/appui/dev/build_artifacts.py --check
py -3 framework/appui/dev/check_bundles.py
node --test framework/appui/tests/test_runtime.js
node --test framework/appui/tests/test_services.js
node --test framework/appui/tests/test_networking.js
py -3 framework/appui/tests/test_job_submissions.py
py -3 framework/appui/tests/test_browser.py
py -3 framework/appui/tests/test_browser.py --minify
```

The browser check serves a local fixture and launches headless Chromium/Edge;
it does not require a running Pylon host. The submission check uses the local
Work Runner implementation without starting jobs.

This checkout intentionally ignores runtime-installed apps such as Work Runner.
Its companion submission-key changes are saved in
`dev/work_runner_idempotency.patch` as well as applied to the local app. On
another deployment with that app installed, review/apply the patch from the
repository root with `git apply framework/appui/dev/work_runner_idempotency.patch`
before relying on submission-key retries. The submission tests require that app.

This directory is the portable AppUI browser package. Copy it as a unit when
another application needs the shared shell.

The self-contained `appui-shim.js` distribution is assembled from focused
`src/portable-shim/` sources: status/toasts, menu, account indicator, sidebars,
shell, dialogs, router and context menu. Edit those sources, then run
`py -3 framework/appui/dev/build_artifacts.py`; `--check` verifies publishing
artifacts without writing. The builder also stamps the portable loader with a
content-derived asset version. Hosted requests rebuild from
sources automatically and never write artifacts; `?minify=1` opts into compact
output. Existing standalone pages still receive one complete script.

The loader requests cached minified framework bundles by default. Set
`window.APPUI_MINIFY=false` before loading for source-level debugging.
Apps can declare automatically built page bundles and request feature bundles
on demand; see [Framework page assets](../PAGE_ASSETS.md).

`AppUILazyFeature.create({src, initialize})` defers a native module and its
factory until `load()` or `call(method, args)`. Concurrent calls share one
initialization; failed loads or initialization can be retried. Each handle owns
its instance, so hosts can inject separate state into the same module. It uses
`AppUIAssets.loadModule` when available and native `import()` on portable pages.
The foundation bundle supplies it; Workspace uses it for Git and MCP dialogs.

`AppUIVisExplorer` ships in the `visExplorer` bundle. Load that bundle rather
than the controller source alone: it includes private stylesheet and view
modules before the public controller. Home and VIS share its cards, sections,
breadcrumbs, search and leaf views. The Components gallery has a runnable
fixture-backed example. Instance state, routing and request ordering stay in
the controller; pagination ignores stale responses after navigation/destroy
and keeps existing cards available for retry after a failed request.

`feature.mount('renderPanel', host)` loads and renders an optional panel and
returns `{ready, destroy}`. A lifecycle scope can own that handle. Destroying it
before loading finishes prevents a stale render; returned cleanup functions or
handles are also disposed, including cleanup returned after cancellation.
mkdoc views, Leave's assistant and the Guide's docs section use this API.

`AppUIDialog.show({buttons:[{text, action, disabled:true}]})` renders a disabled
action that stays inert until its DOM button is enabled. The portable Workspace
dialog facade honors the same flag in `show()` and `open()` actions. Async
previews should also guard their action handler until a successful preview.

`AppUILifecycle.debounce(callback, delay)` returns a callable task that runs once
after the latest call, preserving its receiver and arguments. `cancel()` drops
pending work while allowing another call; `destroy()` also prevents later
scheduling. A scope can own it with `scope.add(task.destroy)`. Canceled timer
callbacks stay inert even if delivered late. Home's searches, Guide filters,
and `AppUIPageUtils.onInput` use this shared scheduler.

Home's endpoint/app polling uses `AppUIPollRefresh` at five/thirty seconds,
with its view scope owning cleanup. Endpoint refresh still runs on visibility
restoration; overlapping automatic requests are suppressed. Guide's per-op
request memo uses `AppUIAsyncCache` with an infinite successful-result TTL,
retaining coalescing and invalidation while preventing an old reply from
repopulating or evicting a replacement request.

The `aiSidebar` bundle loads `chat-panel-actions.js`, `chat-panel-context.js`,
`chat-panel-view.js`, and `chat-panel-profiles.js` before `chat-panel.js`.
These private helpers own action parsing, context generation, panel UI, and
manifest/page-agent composition. `AppUIChatPanel` and its `AppUIRightChat` alias
retain the same public API. Load the bundle rather than the entry file alone.

`AppUISuggestions.bind({input, container, onSelect, renderItem, getLabel})`
attaches keyboard and ARIA behavior to page-owned suggestion data. Call
`setItems(items)` after local filtering or a remote lookup. `selectFirst: false`
keeps raw Enter input available until an arrow key selects a row. `close()`
hides the list; `destroy()` removes listeners and restores the original ARIA
attributes. Leave uses this component for contacts while keeping its lookup
cache, debounce policy, status header, and selection action in the page.

`AppUICopyButton.copy(button, textOrGetter, options)` copies through
`AppUICore.copyText` and resolves a boolean. It shows `successText` only after
the write succeeds and `errorText` on failure, restoring the original text after
`duration` milliseconds (defaults: `Copied`, `Copy failed`, 1200). Repeated
clicks preserve the original label and ignore stale completions. Use plain-text
button labels. `AppUICopyButton.bind(button, textOrGetter, options)` wires an
existing button and returns an idempotent `destroy()` that removes its listener,
cancels feedback, and invalidates pending results. `fallbackOnError` opts into
the core clipboard fallback when the Clipboard API rejects. The foundation
bundle includes this component. MOM, 3GPP Messages, mkdoc, OBS, and Home's curl
control share it. Hosts that own the click handler can call
`AppUICopyButton.reset(button)` on view replacement to restore the label and
invalidate pending feedback.

`AppUIDocumentLayout.declaredDimensions(page)` reads a declared page box in
pixels, converting point dimensions at 96/72. It returns `{w, h}` or `null`.
`AppUIDocumentLayout.fit(placeholder, page, paneWidth, preserveDeclaredBox)`
measures and caches the page's natural box, scales it to the pane (up to 4x),
and reserves the placeholder dimensions. Pass `true` for explicitly boxed
slides marked `data-boxed`. Both buffered and streaming Workspace previews use
this foundation helper; the Guide includes a DocumentLayout example.

`AppUIRowFilter.bind({input, container, selector, text})` filters existing rows
using a trimmed, case-insensitive literal substring. `text(row)` defaults to
the row's text content. It applies the initial input, re-queries rows on input,
and preserves their original inline display values. The returned `apply()`
refreshes after a data update; `destroy()` removes the listener and restores
the rows. This foundation component powers the MOM and 3GPP attribute filters
without replacing their table markup or row interactions.

`AppUIPollRefresh.create(fetch, intervalMs, {stopWhen})` accepts an optional
stop predicate. It is checked on each tick before hidden-tab or in-flight
suppression, so `stopWhen: () => !root.isConnected` releases a detached view's
timer and visibility listener even while the tab is hidden. Credential Store's
health table uses this alongside the poller's normal overlap protection.
Work Runner (2.5 seconds), Task Analyzer (3 seconds), and Keep Awake (5 seconds)
also use the shared poller for automatic status refresh. Their manual controls
retain their page-specific behavior; automatic requests pause while hidden,
avoid overlapping automatic ticks, and stop after their view is detached.

`AppUIDialog.confirmAsync(body, options)` returns a boolean and resolves `false`
when dismissed or aborted. In addition to `title`, `signal`, and `onClose`,
confirmation options support `width`, `confirmText`, `cancelText`, `cancelFirst`,
`primary`, and `danger`. Existing defaults keep OK before Cancel. A DOM node can
provide the body without extra markup. Git, File Storage, Work Runner, and Remote
Runner delegate their confirmation dialogs to this helper, retaining their own
native-confirm fallback if the dialog service is unavailable. Task Analyzer,
Spec Analyzer, and Kiro Doctor use the same helper for process termination,
spec ingestion, and stale-lock cleanup, including cancellation on dismissal.

`AppUI.utils.core.downloadBlob(blob, filename, {attach, revokeDelay, rel})` triggers
a browser download and releases its object URL afterward. Existing callers
keep a detached link and zero-delay cleanup. Use `attach: true` for an attached
link and `revokeDelay` in milliseconds when a surface needs delayed cleanup.
The optional `rel` value sets the download anchor's relationship attributes.
Attached links are removed during cleanup; failed clicks release both resources
immediately and rethrow so the caller can report the failure. Mail attachments
use this helper with an attached link and a one-second delay. Workspace table exports use an attached link with zero-delay cleanup; remote and converted-file downloads use the same helper with a two-second delay. Chunked table exports still pass their parts directly to `Blob`.

CASK Manager artifact saves and Leave calendar exports also share this helper,
retaining their one- and two-second URL lifetimes. Parquet Reader preset
exports use `AppUICore.downloadText(text, filename, 'text/javascript')`;
configuration exports use `AppUICore.downloadJson(value, filename)` for formatted
JSON with the correct MIME type. These are foundation APIs; callers do not
need their own anchor creation or object-URL cleanup.

SysDoc Live and Markdown downloads use this transport and
`AppUIFileUtils.bytesFromBase64`; Viewer originals, ZIP bundles and side-text
exports share its URL cleanup too. SysDoc's existing bootstrap already awaits
foundation before loading those surfaces in both deployment layouts.

Pages that interpret their own operation results can use
`AppUIApi.requestResponse(path, args, {method: 'POST', timeout: null,
decode: response => response.json()})` and read the returned `.data`. This keeps
HTTP-error JSON payloads available to the page and rejects transport/JSON
failures. The explicit decoder also preserves JSON parse failures for empty
responses. `timeout: null` leaves request duration unlimited. Shared trace
headers are added to requests; payloads receive no extra fields. Git, Page
Automation, Terminal, File Storage, Work Runner, and Remote Runner use this path.
VFS, CDP Inspector, and CPI Store map the envelope to their existing
`{status, data}` shape. Connection retains `{ok, status, data}`, where `ok`
reflects the HTTP response independently of the JSON payload.
Task Analyzer, Keep Awake, and the 3GPP page also use this raw-result path.
3GPP supplies its existing boolean-confirmation header through the request
options. Credential Store maps the envelope for both its vault and auth HTTP
operations, retaining HTTP `ok` separately from the JSON body.
Leave and mkdoc also use this raw-result path for their page operations.

`AppUI.utils.files.textToBase64(text, {urlSafe})` and
`textFromBase64(value, {urlSafe})` encode/decode strict UTF-8 text. URL-safe mode
uses unpadded base64url for links. Malformed Unicode/base64 errors remain visible
to callers so they can retain format-specific fallbacks.

`AppUI.utils.scripts.load(url, globalName?)` (also `AppUIScriptLoader.load`)
loads a classic script once per URL. Concurrent callers share the load and can
request different globals exported by the same script. An existing requested
global resolves immediately. Failed loads reject, remove their script element,
and allow a later retry; successful URLs remain cached. This foundation utility
is used by Workspace's editor modes, Markdown, preview libraries and lazy
renderer registration. Callers can retain their own failure policy and messages;
the loader handles only script transport and URL reuse.

`AppUI.utils.documentStyles.scope(cssText, {selector, omitDarkMedia})` scopes
document rules under a root selector (default `.fs-doc`), including nested media
and supports rules. It omits CSS imports; callers can exclude dark-scheme media
rules when rendering on a light surface. Workspace's buffered and streaming
document renderers share this utility. Standalone vendored pages retain one
local fallback for both paths when AppUI foundation is absent.

`AppUIPointerGesture.bindPercentage(handle, {container, direction, min, max,
onResize})` binds a divider to a container-relative percentage. `container` can
be an element or getter; `direction` defaults to horizontal. It captures the
container box at drag start, clamps percentages, and releases pointer/body state
on completion or handle removal. The returned `destroy()` is idempotent.
Workspace's source/preview divider uses this helper with limits of 15–85%.

The `tree` bundle loads `components/tree-keyboard.js` before `tree.js`.
`AppUITreeKeyboard` owns keyboard focus/activation state and its listener;
`AppUITree` supplies guarded event registration and destroys the binding with
the tree. Keyboard handlers tolerate row removal while a focus index is stale.
`tree-rendering.js` owns node markup and event wiring; `tree-mutations.js` owns
sorted insertion and removal of rendered rows. They receive selection/expansion
callbacks and the tree's guarded event registrar. The core retains model state,
lazy expansion, filtering and public lifecycle. Load these modules through the
`tree` bundle so their dependencies are available before `tree.js`.

Runtime contents:

- `app.htm` — starter page template
- `loader.js` — public bundle loader
- `assets/` — shared styles and static assets
- `lib/` — vendored browser libraries such as CodeMirror and xterm
- `src/` — AppUI browser source, components, and features

Repository-only documentation, tests, bundle generation, and version metadata
live in `dev/` and `tests/` alongside this README. They are not required to serve AppUI.

Pages load `/appui/loader.js`, retain the promise returned by
`AppUIAssets.load(...)`, and initialize through `AppUI.createApp(...)`.

Pages can split their own JavaScript into native ES modules without a build
step. Load the entry point after the required bundles are ready:

```html
<script>
window.AppUIReady.then(() => AppUIAssets.loadModule('app.js?v=1'));
</script>
```

`loadModule` resolves URLs relative to the page, preserves explicit version
queries, shares concurrent imports, and returns the module namespace. Native
imports load dependencies relative to each module. Failures reject the promise
and clear the loader's pending entry. Use a new version URL after fixing a
cached module failure. Asset diagnostics include module loading events.

Keep page state and feature logic in the page directory. Imported modules run
in strict mode and have their own scope; expose any API needed by inline UI
actions explicitly on `window`.

For v2 app operations, use the shared API transport after the foundation bundle
has loaded:

```javascript
const result = await AppUI.services.api.operation('office/teams', 'messages', {
  conversation_id: id,
}, {signal, timeout: 30000});
if (result.error) showError(result.error);
```

The operation helper sends JSON with POST, preserves application result fields,
and returns `{ok: false, error}` for HTTP, network, decode, timeout, cancellation,
or malformed-response failures. It also normalizes the framework's `_error`
field. It reuses trace headers and abort cleanup from the existing API client;
the existing `request`, `get`, and `post` contracts are unchanged.

Use `AppUI.utils.text.esc`, `AppUI.utils.core.copyText(text,
{fallbackOnError: true})`, and `AppUI.utils.core.downloadText(text, filename,
mimeType)` instead of page-local escaping, clipboard fallback, or object-URL
download implementations. Teams and Room Finder illustrate native feature
modules; Teams keeps shared state and cross-feature actions in its entry module,
while Room Finder's stateless renderers import their formatting/dialog helpers.

Load the optional `recentRuns` bundle for a compact recent-run list:

```javascript
const runs = AppUI.components.RecentRuns.create(container, {
  title: 'Recent Analyses',
  onSelect: record => openReport(record.name),
});
runs.update(AppUI.components.RecentRuns.merge(running, completed));
// When the owning view is removed:
runs.destroy();
```

The component merges duplicate names with running records first, displays status
and stale indicators, and uses keyboard-accessible buttons with text-only labels.
Pages own API requests and navigation. Pass a third argument to `merge` to change
the default limit of ten records.

`AppUI.features.FileExplorer` exposes the shared tree's path reveal options.
Use `explorer.expandTo(path)` to reveal a file through its ancestors, or
`explorer.expandTo(path, {includeSelf: true})` to expand the selected folder too.
The same option is available on `AppUI.components.Tree.expandTo` instances.

`AppUI.components.ContextMenu.show(position, items)` accepts a mouse event,
`{clientX, clientY}`, or `{x, y}`. Pages provide actions; the component handles
viewport positioning, keyboard dismissal, outside clicks, and listener cleanup.

Load `streamEvents` for incremental server-sent event framing:

```javascript
const parser = AppUI.services.streamEvents.create(({event, data}) => {
  handleEvent(event, JSON.parse(data));
});
parser.push(decodedChunk);
parser.finish(); // Flush the final event at EOF; repeated calls are harmless.
```

The parser retains partial lines across chunks and handles CRLF, multiline data,
comments, and a leading BOM. Pages own transport, cancellation, and payloads.
Consumer errors propagate; callers decide how to handle invalid JSON.

Use `AppUI.utils.storage.session.getCached(key, ttlMs, fallback)` and
`setCached(key, data)` for tab-scoped JSON caches. Entries use `{ts, data}`;
expired or corrupt entries and unavailable storage return the fallback. Writes
return a boolean and tolerate quota restrictions. Pages choose keys and TTLs.

`AppUI.components.Dialog.show({body, onClose})` accepts a DOM node or an HTML
string. `onClose` runs once after cleanup for buttons, Escape, backdrop dismissal,
or programmatic closure. This lets pages settle confirmation promises without
implementing a separate modal lifecycle.

`AppUI.components.Splitter.bind(handle, {onStart, onMove, onEnd, cursor})` binds an existing pane handle using pointer capture. It restores cursor and selection styles on release or cancellation; call its idempotent `destroy()` on teardown. Pages own geometry and saved preferences. Available in `workspaceComponents`.

Sidebar collections use `leftSidebar.tabs` or `rightSidebar.tabs`. Shared types include `file-explorer` and `ai-sidebar`:

```js
leftSidebar: {tabs: [
  {id: 'files', label: 'Files', type: 'file-explorer',
   config: {roots, backend, onSelect}, onMount: explorer => { files = explorer; }},
  {id: 'ai', label: 'AI', type: 'ai-sidebar', config: {context, tools}}
]}
```

File browser tabs load the named `fileExplorer` bundle on first mount, forward explorer options (including custom backends and route configuration), and destroy the instance when the tab host is removed. `onMount` receives the instance for page-owned commands. AI sidebar tabs use the existing shared chat feature; pages supply their context and tools.

`type: "chat"` mounts the plain `AppUI.components.Chat` conversation widget with `config` options and optional `onMount(chat)`. It loads the chat bundle lazily and calls the widget?s idempotent `destroy()` on removal. Use `ai-sidebar` for the integrated assistant controls.

`AppUI.components.Tabs.bind({container, panels, onSwitch})` binds existing `[data-tab]` buttons and panels, preserving markup while providing keyboard navigation, ARIA selection, visibility, and idempotent listener cleanup. It does not call `onSwitch` for the initial selection.

`AppUI.components.Dialog.close(overlay)` closes the specific overlay returned by `show()`, even when another dialog is above it. Calling `close()` without an argument still closes the topmost dialog.

Sidebar `ai-sidebar` tabs load the `aiSidebar` bundle lazily when needed and skip mounting if their host is removed before loading finishes. Loading `fileExplorer` also loads its shared tree controls through `workspaceComponents`.

`AppUI.utils.files` provides shared browser file utilities in the foundation bundle:

- `bytesFromBase64(base64)` decodes into a `Uint8Array` without text encoding.
- `blobFromBase64(base64, mime)` wraps those bytes in a `Blob`; MIME defaults to
  `application/octet-stream`, and an explicit empty MIME remains empty.
- `readBase64(file)` returns the raw base64 payload and rejects read failures.
- `captureDrop(dataTransfer)` snapshots entry handles and flat files synchronously
  during a drop event, before the browser can clear the transfer object.
- `readEntries(entries, {mapFile})` walks nested directories across all entry
  batches. It awaits optional `mapFile(file, relativePath)` results and skips
  unreadable entries. The default result is `{file, path}`.
- `readDrop(dataTransfer, options)` captures immediately and walks entries, using
  flat files when entry handles are unavailable. Results follow read completion
  order; callers can sort them for display.

The `aiSidebar` bundle depends on `chatSurface` for the shared chat engine and
surface. Tool, prompt-library, model-config, and context dialogs are separate
instance factories; see [ChatSurface modules](src/content/CHAT_SURFACE.md).

`AppUI.utils.asyncCache.create({ttlMs, cacheIf})` provides instance-local promise
coalescing. `get(key, load)` shares a pending request and optionally reuses its
successful result for `ttlMs` milliseconds. The default TTL is zero, which only
coalesces pending work. `cacheIf(value)` can exclude unavailable/error results;
rejected loads are never cached. `clear(key)` or `clear()` drops cached/pending
ownership without cancelling the underlying work, so an older completion cannot
overwrite a newer value. Workspace's GitLab and self-filesystem adapters use it.

`AppUILifecycle.createFrameTask(callback, {fallbackDelay: 16})` owns coalesced frame work. Call `schedule()` to queue at most one callback, `cancel()` to discard pending work, and `destroy()` for permanent cleanup. It falls back to a timer when animation frames are unavailable and ignores canceled callbacks delivered late. Register `task.destroy` with the owning scope. Virtual scrolling, sidebar-tab overflow, split-pane ratio initialization and breadcrumb initialization share this helper.

The `chatSurface` bundle loads `chat-surface-attachments.js` before surface composition. Its controller owns attachment chips, file conversion, picker/drop/paste entry points and listener cleanup. The surface retains pending attachment state for request shaping and background jobs; destroyed controllers ignore late file-read and conversion replies.

`chat-surface-backends.js` owns ChatSurface bootstrap/fallback discovery and backend-selector listeners. It preserves server-default, requested, ready, available and first-backend precedence. Request generations prevent older discovery replies from replacing newer state, and destruction removes selector listeners and ignores pending replies.

`chat-surface-request.js` owns ChatSurface request shaping and bounded project-document loading. It reads current attachment state, consumes it through a setter, and snapshots the effective system/tool settings for request details. Project-document generations keep older or post-destroy replies from replacing current context.

ChatSurface location subscriptions and idle indicator refresh belong to `chat-surface-location.js`. The surface starts and destroys that controller; it owns one workspace-change listener and one idle timer, skips idle work while hidden/streaming, and ignores callbacks after destruction.

ChatSurface background-job badge and dialog refreshes use `AppUIPollRefresh` for coalescing and cancellation. Badge polling pauses while hidden; the open jobs dialog retains its existing polling behavior. Closed/destroyed views ignore late replies, and background-start replies cannot clear a destroyed composer or reopen its jobs dialog.

FileExplorer in-place folder refreshes live in `features/file-explorer/folder-reload.js`. Each folder owns its latest pending result; a full rebuild or destroy invalidates pending updates, including asynchronous child augmentation. The listing cache also rejects cache writes from superseded or invalidated reads.

FileExplorer persisted expansion setup lives in `features/file-explorer/expansion-state.js`. It seeds explicitly expanded roots while preserving existing choices; deep-link builds temporarily use root-only state and restore the saved map in a `finally` block, including when tree construction fails.

FileExplorer session-cache prebuilding lives in `features/file-explorer/session-prebuild.js`, separate from DOM initialization. It shares the listing cache's backend key function, preserves backend references and expanded-root state, honors `noPersistCache`, and stops cached path cycles before recursion.

FileExplorer header/toolbar DOM and search placement live in `features/file-explorer/chrome.js`. The helper owns toolbar and hover listeners; the explorer destroys it with the tree. Search placement restores a previously hidden empty header when it becomes a search-only header.

`AppUIAssets.load('folderPicker')` provides `AppUIFolderPicker.create({container,
startPath, sourceLabel, listDirectories})` for selecting an absolute folder path.
The host supplies `listDirectories(path) -> Promise<string[]>`; the component
owns the path input, root/Go controls, cached lazy expansion and selection.
`get()` returns the selected or typed path. Call `destroy()` when its view closes;
late listing replies and detached controls then become inert. New navigation
ignores older replies. The `workspaceFolderPicker` bundle also loads this control.
Workspace's SSH source chooser injects its own auth_ssh listing adapter and
filters hidden entries/files before passing directory names to the picker.

The same `folderPicker` bundle provides `AppUIFlatFolderPicker.create({container,
startPath, sourceLabel, listFolders, makeMatcher, cacheKey})` for a pre-flattened
folder source. `listFolders(base)` returns `[{path, depth}]` relative to that
base; optional `makeMatcher(query)` returns a path predicate (the default is
`AppUITextUtils.makeMatcher`). It preserves explicit
Browse, debounced filtering, direct absolute-path selection, a 500-row display
limit and per-base cache. `get()`, `setStart(path)` and `destroy()` control the
picker. Old navigation replies cannot replace current rows; destroy cancels
filtering and disables detached controls. Workspace injects its VFS tree adapter
and releases the picker on dialog close or SSH-account replacement.

`AppUITextUtils.makeMatcher(query, {stringify})` compiles a case-insensitive
substring-or-regex predicate once for repeated filtering. Regex metacharacters
trigger regex parsing; invalid or incomplete patterns fall back to literal
substring matching. Empty queries match everything. By default falsy values
become empty text; `stringify: String` preserves literal conversions when a
caller needs them. Workspace filters and the shared workspace-folder picker
use this same implementation.

`AppUIFileUtils.flatChildren(entries, prefix, {folders, normalize, skipEmpty})`
partitions flat `{name, ...}` file records into immediate directory names and
`{name, entry}` file children. Pass an already-normalized relative prefix;
`normalize` converts each file/folder path (default `String`). Explicit `folders`
can include empty directories. Empty file names are skipped unless `skipEmpty`
is false. Original file objects remain available as `entry`, so adapters retain
their own metadata and sorting. Directory deduplication handles reserved object
keys safely. Workspace archive previews and the AppUI file-storage backend use
this shared projection through `AppUI.utils.files` / `AppUIFileUtils`.

## DataTable controls

Load `dataTable` and create `AppUIDataTable` with `columns` (stable `id`s) and `items`. Tables include a case-insensitive **Find in table** field (Ctrl/Cmd+F while focus is inside the table), column filters through the header context menu, and a **Columns** checkbox chooser. Active filters have a dotted underline on the header label; there are no per-column filter buttons. Right-click a header, or focus it and press Shift+F10, for sorting, filtering, hide/show and move actions. Drag a header onto another header to change their order. At least one column remains visible.

`setSearch(text)`, `getSearch()`, `setFilter(id,text)`, `clearFilters()`, `setColumnVisible(id,visible)`, `moveColumn(id,targetId)`, `getColumns()` and `resetColumns()` expose the same behavior. Find and filters operate over all loaded items before sorting and the display cap, including virtual rows; hidden-column filters stay active. CSV/XLSX exports use the visible columns in the chosen order.

Set `stateKey` to persist order and visibility in localStorage (search terms and data are never saved). `onColumnsChange(columns)` receives changes. `controls:false` hides the toolbar, `reorderable:false` disables interactive ordering, and column `filterable:false` / `searchable:false` disable those features for a field. `resetColumns()` restores the declared order and initial visibility.

Numeric column filters offer inclusive minimum/maximum inputs and two synchronized native range sliders. Blank bounds are open-ended. Numeric detection uses underlying `getValue` results (including comma-formatted numeric strings), so formatted distance/review displays filter numerically. Missing and nonfinite values are excluded by an active range. Set column `filterType:"number"` to force range availability or `filterStep` for a slider increment. Programmatic form: `table.setFilter("price", {type:"range", min:100, max:500})`; either bound can be `null`. Text filters remain strings and can be selected in the same popup.

## Shared table UI, separate row adapters

The `tableControls` bundle supplies `AppUITableControls` (find, header menus, column chooser, keyboard and drag/drop bindings), `AppUITableColumns` (column order/visibility and localStorage view preferences), and `AppUITableFilter` (the same text/range editor and filter labels). Both `AppUIDataTable` and `AppUIBigTable` depend on this bundle and compose these components; changes to that UI reach both renderers.

DataTable applies filters/sort to loaded objects; BigTable projects visible columns onto original source indices and requests row blocks from its host. BigTable adapters provide `onSearch`, `onFilter`, `onFilters`, `onSort`, and optional `columnStats(name)` (min/max/top values for sliders). The Parquet/DuckDB workbench translates shared range descriptors into safely quoted SQL and find text into literal case-insensitive contains conditions. It retains its advanced SQL, statistics, cell-copy menus and server export. Column layouts use a source/table-specific `stateKey`, and changing order/visibility does not reload the dataset.

Both expose `getColumns`, `setColumnVisible`, `moveColumn`, `resetColumns` and `showColumns`. Parquet's grid headers use the shared filter editor; the separate advanced Filters dialog preserves range descriptors and provides an Edit action back to that editor. The legacy `filterRow` on standalone BigTable remains opt-in for compatibility.


## URL form deep links (urlFields)
Load the existing AppUI `urlFields` feature. Declare a destination schema with
field selectors, length bounds and optional allowed values/pattern/URL checks.
Use `AppUIUrlFields.link(appPath, values, schema)` to create a relative link and
`AppUIUrlFields.prefill(formRoot, schema, {focus:"#manual-field"})` after the
destination has mounted and loaded defaults. `read(schema)` returns validated
single-occurrence fields for custom presentation logic. This is one-time input
initialization, not two-way routing and not an operation dispatcher.
Sensitive fields, raw selectors, hidden/button/file/password inputs, disabled
or readonly fields are not eligible. No automatic submit, synthetic change
events, secret URL values or credential-bearing nested URLs in the strict API.
Legacy apply/init remain for existing controls, with sensitive fields blocked.
Credential Store uses the shared credentialSchema, preserves provider-only
links, and requires manual token entry and confirmed save. A same-origin login
redirect retains only approved public credential metadata; other app forms
need an explicit login-preservation contract.

### Remote browser viewer diagnostics
Load the existing `remoteBrowserViewer` bundle and opt in with
`AppUIRemoteBrowserViewer.create({session, transport, debugger: {readFocus, boundedInput: true}})`.
The optional `readFocus(session)` callback returns a bounded field category and
page-focus flag; without it the debugger still reports local input and transport
acknowledgements. Set `boundedInput` only for transports supporting the Linux
viewer input protocol. Existing consumers without the debugger option retain
their input behavior. The diagnostic panel reports input counts, mouse click
target class, press/release acknowledgements, latency and frame dimensions.
It retains no typed content, key names, coordinates, screenshots or session IDs.
Navigation addresses omit query and fragment; backends may mark a sanitized
public path with `url_redacted: true`, otherwise only the origin is displayed.
