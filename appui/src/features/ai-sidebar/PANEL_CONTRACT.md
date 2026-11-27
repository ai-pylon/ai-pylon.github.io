# AI chat panel — the page-integration contract

How a page embeds the AI chat and lets it ACT on the page, end to end. This is
the convention the catalog Tool-Chain page uses and the one every new page
should follow instead of re-hand-rolling the sidebar.

The pieces (all shipped, all live-verified):

- `chat-panel.js` — `AppUIChatPanel.mount(host, opts)` turnkey panel
- `host-hooks.js` — `AppUIHostHooks` named registry (page fns ↔ manifest)
- apphost `sidebars_shown` / `needs_host` — the manifest contract
- `panel-app.js` — `mountDeclaredSidebars` + the gallery embed

---

## 1. The `context()` provider convention

A page exposes a `context()` that returns a **compact, CURRENT snapshot** of
what the user is looking at — the selection, the focused node, the open file,
the current chain — as a short string. The panel calls it **once per send** and
appends the result to the system prompt, so the assistant always sees the live
page state without the user restating it.

Rules of a good `context()`:

- **Compact.** Return the few facts that matter THIS turn, not a full dump.
  The catalog page returns the step list + which step is selected, e.g.
  `Current chain (2 steps, selected step 1):\n  step 1: …\n  step 2: …`.
- **Current.** Read live page state at call time (it runs per send). Don't
  cache a stale snapshot.
- **Cheap.** It runs every turn; keep it O(visible state), not O(whole model).
- **A string** (or a Promise of one). Non-strings are coerced.

### Size cap + change gate (automatic)

`AppUIChatPanel` wraps your `context()` with:

- a **size cap** — default 8000 chars (`opts.contextMaxChars`; `0` = uncapped),
  truncating with a `… [context truncated at N chars]` marker so a large
  snapshot can't crowd the window or resend kilobytes each turn;
- a **change gate** — when your `context()` returns the identical snapshot as
  last turn, the cached capped string is reused without re-capping/re-hashing.

So a page `context()` can be written simply; the panel handles the policy.

### User-pinned extras (collected context)

Per-turn `context()` is for the AUTOMATIC current snapshot. For things the USER
deliberately pins ("send this selection to the AI"), the ai-sidebar already has
the **collected-context** model (`collected-context.js`): right-click selection
→ "Send to AI", or the `addContext(label, content)` API. Those accumulate and
are appended alongside `context()`. Keep the two separate: `context()` =
ephemeral current view; collected context = sticky user-chosen extras.

---

## 2. The structured-ACTION contract

So the chat can DO things on the page, not just return prose, the model emits a
fenced block and the panel dispatches it to your `onAction(type, payload, raw)`:

    ```action
    {"type":"chain.set","steps":[{"tool":"knowledge/knowledge_base.search","params":{"query":"X"}}]}
    ```

- Multiple blocks per reply are allowed; each is parsed as JSON.
- Parsing is tolerant — a malformed block is skipped, never thrown into chat.
- Actions only **POPULATE** the page. The panel NEVER auto-runs a write op;
  your `onAction` should populate/preview and leave the user to press Run.

The catalog page handles `chain.set` / `chain.append` → the chain builder's
`hydrate` / `append`.

---

## 3. Wiring it: manifest + host-hook registry (the "manifest edit, not code")

A page declares WHICH sidebars it shows in its **manifest**, and supplies the
live functions through a named registry — so adding the chat is a manifest edit.

### Supply side (the provider) — `needs_host`

The sidebar provider's manifest block declares what page functions it can take:

```json
"sidebar": {
  "type": "ai-sidebar", "label": "AI Chat", "bundle": "aiSidebar",
  "needs_host": { "context": "optional", "system": "optional", "onAction": "optional" }
}
```

`apphost._one_sidebar_spec` surfaces `needs_host` in `GET /v1/sidebars`. A
sidebar with no `needs_host` is a pure drop-in.

### Demand side (the page) — `sidebars_shown`

The consuming page's manifest declares the sidebars to embed and the registry
KEY that carries its live hooks:

```json
"sidebars_shown": [
  { "type": "ai-sidebar", "position": "right", "host_hooks": "catalog.chain",
    "config": { "title": "Chain Assistant", "catalogBase": "/v1/apps/platform/tool_catalog" } }
]
```

`apphost._sidebars_shown` surfaces this in `GET /v1/apps`.

### The bridge — `AppUIHostHooks`

A JSON manifest can't carry a function, so the page registers its live hooks
under the `host_hooks` key, once, early (the `system` prompt itself now lives in
the manifest chat profile — see §4 — so it's NOT passed here):

```js
AppUIHostHooks.register('catalog.chain', {
  context:  () => currentChainSnapshot(),
  onAction: (type, payload) => applyChainAction(type, payload),
});
```

Then the shell mounts the declared tabs:

```js
await AppUIAssets.load('aiSidebar');
const dispose = await AppUIPanelApp.mountDeclaredSidebars({ appId: 'platform/tool_catalog' });
// dispose() on teardown; AppUIHostHooks.register returns an unregister() too.
```

`mountDeclaredSidebars` resolves each `type` against the gallery, calls
`AppUIHostHooks.resolve(needs_host, host_hooks)` to pick the hooks the provider
accepts (optional ones omitted if absent, required ones warned), merges them
into the embed config, and — for `ai-sidebar` — mounts via `AppUIChatPanel` so
the context cap + action contract apply.

### Gallery UX

The sidebar gallery (`AppUIPanelApp.openGallery({ pageContext })`) shows each
provider's `needs_host` as a "wants: …" line, with an inline system-prompt field
and a "use this page's context" toggle for providers that accept them — so a
user adding a panel can supply the special-handling bits at embed time.

---

## Direct mounting (no manifest)

A page can also mount the panel directly without the manifest contract:

```js
const panel = AppUIChatPanel.mount(hostEl, {
  system, context: () => snapshot(), onAction, title, configKey, contextMaxChars,
});
panel.destroy();   // on teardown
```

Prefer the manifest route (#3) for new pages — it keeps "which panels a page
shows" declarative and discoverable.

---

## 4. CHAT PROFILES — the system prompt + tool scope live in the manifest

The newest layer. Instead of hardcoding a system prompt + tool scope in page JS
(the `AI_SYSTEM` string in older examples), an app DECLARES a **chat profile**
in its manifest — the single, server-side, discoverable source for "how this
app uses the chat". This is the SUPPLY side of the prompt/scope; the page still
supplies only the LIVE functions (`context`/`onAction`) via `AppUIHostHooks`.

### Declare it (manifest)

```json
"chat_profile": {
  "id": "platform/tool_catalog.chain",
  "label": "Chain Assistant", "title": "Chain Assistant",
  "backend": "kiro",
  "scope": ["platform/tool_catalog", "knowledge", "ai", "file/vfs"],
  "actions": ["chain.set", "chain.append", "catalog.focus"],
  "needs_host": { "context": "optional", "onAction": "optional" },
  "example_prompts": [
    {"prompt": "Build a 2-step chain: search KB for X then summarize.", "action": "chain.set"},
    {"prompt": "What tools can search email?", "expect": "mail"}
  ],
  "system": "You are the Tool Catalog assistant… emit a chain.set action…"
}
```

An app may declare one `chat_profile` OR a `chat_profiles` array. apphost
aggregates them fleet-wide (`chat_profiles()` / `chat_profile(id)`), the same
pattern as `sidebars()`. The llm app exposes them:

- `POST /v1/apps/ai/llm_server/profiles` → list every profile. Pass
  `{summary:true}` for a LIGHTWEIGHT listing (id/label/scope/example_prompts +
  a `has_system` flag, NO full system prompt) — use it for a gallery/picker over
  all N profiles so you don't ship N multi-KB prompts.
- `POST /v1/apps/ai/llm_server/profile {id, resolve?}` → one profile (+ with
  `resolve:true`, its tool scope resolved against the catalog for preview, and a
  `warnings` array when a scope pattern resolves to no tool or the prompt is
  empty). The resolved scope is cached per (patterns, fleet signature).

Profile fields (normalized by apphost `_one_chat_profile`): `id` (defaults to
the app id), `label`, `title`, `placeholder`, `system`, `scope` (catalog scope
patterns), `backend`, `model`, `actions` (doc/validation), `mandatory`
(per-profile always-on tools), `needs_host`, `example_prompts`, `tool_mode`.

`tool_mode` — how the chat reaches its tools (VIS_TODO #7):
- `"scoped"` (default): every in-scope tool's description is injected into the
  system prompt each turn (10–26K chars for today's profiles).
- `"vis"`: the model navigates `vis://tool_catalog` (vis_search / vis_open),
  LOADS the few tools it needs and calls them — a ~1–3K char preamble. The
  profile's `scope` (+ the always-on tools) still bounds what it may load/call;
  navigation itself is never refused. The stream picks the mode up from the
  profile via the `pool` id the surface sends (no page change); a request can
  force it with `dynamic_tools=1|0`. Each turn emits a `meta` SSE frame
  `{tool_mode, scope_tools, preamble_chars}` (ignored by the UI).

### Mount it (page)

`AppUIChatPanel.mountProfile(host, profileId, opts)` fetches the profile and
mounts with its `system`/`scope`/`backend` — the caller's explicit `opts` win,
and the LIVE hooks (`context`/`onAction`/`confirmAction`/`currentLocation`) come
from `opts`. The profile fetch is memoized per id and runs in PARALLEL with the
aiSidebar bundle load (one combined round-trip, not two serial):

```js
AppUIChatPanel.mountProfile(hostEl, 'platform/tool_catalog.chain', {
  context: () => snapshot(),
  onAction: (type, payload) => applyAction(type, payload),
  // optional structured current-view hook (first-class; shows the 📍 button +
  // labeled WORKSPACE-VIEW block on ANY page, not just the workspace):
  currentLocation: () => ({ file, folder, root }),
});
```

Or declaratively: add `"profile": "<id>"` to the `sidebars_shown` entry (#3) and
`mountDeclaredSidebars` calls `mountProfile` for you:

```json
"sidebars_shown": [
  { "type": "ai-sidebar", "position": "right",
    "profile": "platform/tool_catalog.chain", "host_hooks": "catalog.chain" }
]
```

For a page that OWNS its right sidebar (tabbed), add the chat as a 2nd tab whose
`render(host)` lazy-loads `feedback`+`aiSidebar` then calls `mountProfile` (see
`knowledge/3gpp` and `office/teams`). For a self-contained bespoke HTML page
(no AppUI shell), declare the profile SUPPLY-side only (no `sidebars_shown`) —
it's still discoverable in the gallery and usable via `llm.profile`.

### Grounding a chat in an OPEN DOCUMENT (reusable `docContext`)

A page that renders a (possibly large) document and wants its assistant grounded
in **what the user sees + the document structure**, able to **fetch more on
demand**, should not hand-roll it — use the shared helper:

```js
const dc = AppUIChatPanel.docContext({
  getRoot:     () => state.docShadow || document.getElementById('output'), // the rendered-doc root (element OR shadowRoot)
  getScroller: () => document.getElementById('output'),  // what decides "visible" (optional)
  docLabel:    () => currentFileName(),                  // optional
  idPrefix: 'myapp-h-', kind: 'document',                // optional
});
AppUIChatPanel.mountProfile(hostEl, '<profile id>', {
  system: dc.system, context: dc.context, onAction: dc.onAction,
  examplePrompts: dc.examplePrompts,
});
// on load of a DIFFERENT document: dc.reset();   // clears fetched-chapter staging
```

`docContext` returns `{system, context, onAction, examplePrompts, reset}`:
- `context()` each turn sends: the doc label, a bounded CHAPTER OUTLINE (the
  rendered `h1..h6` → `[{id,level,title}]`, shallow levels first, capped with a
  "+N more" note), the CURRENTLY-VISIBLE text (blocks intersecting the scroller),
  and the full text of any chapter the model previously requested.
- `onAction('doc.chapter', {id|title})` stages that section's text into the NEXT
  `context()` turn and scrolls the page to it — so the model navigates a huge
  spec instead of the page dumping it all. The `system` prompt instructs the
  model to emit a ```action `{"type":"doc.chapter","id":"…"}` block when it needs
  a chapter it can't see. (`doc.*` is in the panel's accepted ACTION_TYPE set.)

Reference consumer: `apps/documents/sysdoc_converter/page/viewer/modules/assistant.js`
(~55 lines of page wiring over the helper). Tool-grounded apps (MOM, 3gpp, gdrive)
do NOT need this — they look data up via their ops; `docContext` is for free-text
document pages.


### example_prompts double as acceptance tests

Each `example_prompts` entry is `{prompt, expect?, action?}`.
`tools/verify_chat_profiles.py [profile_id] [--backend kiro|ericai] [--both]
[--tools vis|scoped] [--static] [--compare-tools] [--host URL]`
runs every profile's examples through the real chat stream (in the profile's
declared `tool_mode`; `--compare-tools` A/Bs both modes, `--static` reports each
mode's preamble size without a model) and checks
`expect`/`action` in the reply — the "the system prompt actually works" gate.

`expect` has two forms (the simple one is a WEAK smoke check — it only proves the
prose contains a word, so it passes even on an echoed or HALLUCINATED answer;
prefer the structured form for real output verification):

- **simple** — a string or `[strings]`: each must appear in the reply prose
  (case-insensitive substring). Good enough for "is the reply on-topic", nothing
  more.
- **structured** — an object asserting against the actual TOOL EVIDENCE the turn
  produced (the verifier captures the stream's `tool` events), so a reply is
  checked for GROUNDING, not just wording:
  - `tool: "<id|suffix>"` — a tool that MUST have been called (e.g.
    `"mom.search"`); proves the answer came from a real call, not a hallucination.
  - `tool_output: [strings]` — substrings that must appear in a tool's OUTPUT
    (the real data) — the strongest check; catches a wrong-but-plausible prose
    answer whose data the tools never returned.
  - `not_text: [strings]` — substrings that must be ABSENT (reject an "I
    couldn't find…" non-answer that a plain `expect` would still pass).
  - `text: [strings]` — prose substrings (same as the simple form).
  - `min_tools: N` — at least N tool calls happened.

  Example (the MOM assistant):
  `{"prompt":"what sources are loaded?","expect":{"tool":"mom.sources","tool_output":["GNBDU"],"not_text":["couldn't find"]}}`

`--both` runs each example on kiro AND ericai and DIFFs the pass/fail, so you
pick the default backend knowingly. Keep prompts explicit (e.g. "Switch the page
to the diff view" to exercise a nav action, not "show me the diff" which the
model reads as "read a diff"). The action-match tolerance (fenced ```json /
untyped chain drift) is pinned by a hermetic unit — `tools/test_chat_action_spec.py`
— and the `expect` evaluator (incl. the tool-grounding assertions) by
`tools/test_expect_eval.py`; both run in CI so the verifier can't silently drift.

A `chat_profile` / `sidebars_shown.profile` is also contract-checked:
`tools/check_app_contracts.py` (CI) fails if a `sidebars_shown[].profile`
references a profile no app declares, or a profile's `needs_host` has an unknown
key (known: context / system / onAction / onResponse / hostActions /
confirmAction / currentLocation / promptVars).

`promptVars: () => ({name: value})` fills `{name}` placeholders in the profile's
`example_prompts` starter chips (the chip shows "this <name>", a click fills the
value; a prompt the page cannot fill is not offered). An example may carry
`"vars": {name: test value}` for `tools/verify_chat_profiles.py` (or pass
`--context name=value`).

### Backend notes (verified)

- **Data/content actions** (`chain.set`/`append`, Marp generation) + grounded
  tool answers work on **kiro**.
- **UI-navigation actions** (`git.view`, `kb.open`, `catalog.focus`, `vfs.open`)
  work on both, but see per-turn variance; kiro needs a clean session (see the
  pool note below) — early "kiro refuses UI actions" reports were actually the
  prompt-contamination bug, now fixed.
- ericai has occasional per-turn scoped-tool-dispatch flakiness (MIGRATION #170).

### ⚠️ Session isolation (`pool`) — one client line still TODO

The kiro backend reuses warm drivers from a shared pool, and a driver sends its
system prompt ONCE (`_system_sent`). Without isolation, app B's chat on the same
driver inherits app A's prompt (MIGRATION #174). Fixed server+transport side:
pass a stable `pool` key (the profile id) and each profile pins its OWN kiro
driver. `AppUIChatStream.transports.systemLlm` maps `reqBody.pool` → `?pool=`;
`chat_stream` passes it as `pool_id` to kiro (plain + tool-loop paths). The last
link: the chat surface's `buildReqBody` must set `req.pool = <profile id>`. (It
was mid-refactor into `chat-surface-request.js` when this shipped — add that one
line there.) Until then, the first-turn auto-reset covers new chats.


---

## 5. Assistant messages carry `tool_calls` + `reasoning` (render contract)

An assistant message is NOT just its final-answer `content`. A tool turn also
produces, and PERSISTS on the message:

- `reasoning` — the model's self-decision narration (its "Let me pull the
  CgSwitch MOC detail to ground this." before a tool call). Captured
  server-side by `_text_tool_loop` (`core.py`): the prose before each round's
  tool-directive marker is accumulated and returned as `result.reasoning`, then
  emitted in the stream `done` event (`stream_asgi.py`). The client
  (`chat-stream.js`) prefers this authoritative `d.reasoning` over subtracting
  the final answer from the streamed text — so the reasoning survives even when
  it arrived INLINE with the directive and never streamed as its own token.
- `tool_calls` — `[{name, args, status?, output?}]`, one per catalog call the
  turn made (de-duped per-turn server-side so a repeated identical call isn't
  re-dispatched).

**The live bubble** (`chat-stream-view.js`) renders TWO stable, order-fixed
regions inside the assistant bubble: `.ai-chat-tools` (tool-status rows,
inserted first) and `.ai-chat-prose` (reasoning + answer markdown, always
below). Keeping them as two dedicated containers means rendering the prose never
wipes the tool rows and new rows never interleave into the prose.

**On RE-RENDER** (session load / replay / full page reload), `addMessage`
(`chat-ui.js`) REBUILDS both regions from the message's stored `toolCalls` +
`reasoning` — it does NOT flatten to `content`. Consecutive identical
`(name,args)` tool calls are collapsed into one row with a `×N` attempt count.
Each tool row's OUTPUT is shown in its collapsible `.tool-detail`
(`AppUICore.markToolDone(el, output)`), not just a border tint.

⚠️ **Do not reintroduce the flatten-to-content bug.** Any edit to the render
path (`addMessage`, `renderFinal`, the history view) MUST keep rebuilding the
tools + prose regions from the persisted fields. A message rendered from
`content` alone silently drops the (precious) reasoning + tool-call info the
user asked to see. The regression is guarded by `tools/test_chat_render_persist.py`.

---

## 6. One-flag PAGE AGENT — the assistant sees + acts on the page (`page_agent`)

An assistant can SEE the live page (hierarchically, on demand) and ACT on its
DOM (fill/click/select/check/read) with **one flag** — no per-page `context()`
/ `onAction` wiring. Two shared browser-side helpers back it (a server tool
cannot read an app's own live DOM, so this is all page-side):

- **`AppUIPageIntrospect`** (`page-introspect.js`) — exposes the page as a TREE
  the model pulls NODE BY NODE across turns via a `page.inspect {path}` action.
  Each turn it pushes only a compact ROOT OUTLINE (regions + child counts) plus
  the nodes the model has expanded, and an "Actionable fields / Buttons on
  screen" quick-reference (selector + value/label) so the common fill/click is
  ONE-SHOT. Built-in DOM scanner reads the standard regions (`#app-menubar`,
  `#app-right` tabs, `#app-content-body` sections/status/controls) with zero
  node code; a page may pass its own `nodes(path)` for a richer hierarchy.
- **`AppUIPageActions`** (`page-actions.js`) — the generic DOM verbs the model
  emits as fenced `action` blocks: `page.fill {selector,value,append?}`,
  `page.click {selector}`, `page.select {selector,value|label}`,
  `page.check {selector,checked?}`, `page.read {selector,all?}`. Safety: opt into
  exactly the `verbs` you want; a `root()` scope restricts actions to elements
  inside the app's region; optional `guard(el,type)` veto + `confirm(type,
  payload,el)` user-gate. It only acts on the single control the model names.

### Turn it on

Declare it in the profile manifest (static, declarative config only):

```json
"chat_profile": {
  "id": "myapp.assistant",
  "actions": ["page.inspect","page.fill","page.click","page.select","page.check","page.read"],
  "page_agent": true,            // or { "verbs": ["fill","read"], "quickFields": true }
  "system": "… tell the model page.* are ACTIONS (fenced blocks), not tools …"
}
```

`mountProfile` then auto-creates both helpers and wires `context()` + `onAction`.
A page supplies the function-only bits a manifest can't carry (the `root()`
scope, `guard`, `confirm`, `onRead`, or a custom `nodes`) via `opts.pageAgent`:

```js
AppUIChatPanel.mountProfile(hostEl, 'myapp.assistant', {
  pageAgent: { root: () => document.getElementById('app-main') },
});
```

If the host ALSO supplies its own `context`/`onAction`, the page agent COMPOSES:
the host context is prepended to the live page tree, and a host `onAction` runs
FIRST (so it can own a custom action) before the agent handles the `page.*`
verbs. The system prompt MUST state that `page.*` are ACTIONS emitted as fenced
blocks, never catalog tools (the model otherwise tries to `catalog_detail` them).

Reference consumer: the knowledge/vis Bench page-agent testbed
`apps/knowledge/vis/page/bench/page-agent.htm` (profile `knowledge/vis.pageagent`;
folded from the retired `platform/pageintrospect`, NEXT5 #3) — menu + multi-tab
sidebar + content form; its assistant inspects the tree and fills/clicks/selects
controls.
### SEE the page as pixels (`page.see` → the vision leg)

Structure (the tree + quick-ref) covers *what controls exist*; when the model
needs *how the page LOOKS* (layout, alignment, colour, an error banner, whether
something is visually off) it emits:

```action
{"type":"page.see","hint":"is the Reason field flagged as an error?"}
```

The page captures a screenshot and POSTs it to the llm app's `describe_image`
op (EricAI `tag:multimodal`); the returned text appears in the NEXT turn under
"WHAT THE PAGE LOOKS LIKE", so the TEXT model effectively sees the page without
being multimodal itself. Two capture paths:

- **silent** (default) — `html2canvas` (vendored, lazy-loaded once per page,
  served `immutable`). A multi-strategy capture ladder (the app region, the full
  `body`, `documentElement` sized to the real viewport, and a
  `foreignObjectRendering` pass) keeps the LARGEST non-blank result — this now
  produces a usable silent screenshot even for the AppUI flex/shadow-DOM shell
  (previously those blanked). A still-blank result (a heavy shadow/transform
  shell) is detected by pixel-sampling and the model is told to request the exact
  path instead of being fed a white image.
- **exact** (`{"type":"page.see","exact":true}`) — `getDisplayMedia`, a one-time
  tab-share prompt; pixel-true, the guaranteed-fidelity path. Use when silent
  blanks or a precise visual judgment matters.

Performance: the capture is downscaled (longest edge ≤1280px, JPEG ~0.5) before
upload, and the description is CACHED by a cheap page signature + hint — a repeat
`page.see` with no visual change returns instantly (a mutating action invalidates
the cache). `describe_image` reuses a pooled HTTP session and a tight token cap.

### RECORD a flow → replay it WITHOUT CDP (the agentic→scripted bridge)

`AppUIPageActions` can RECORD the mutating actions it performs
(fill/select/click/check — observe actions like see/inspect/read are not
recorded) and hand the trace to `platform/page_automation.from_actions`, which
synthesizes a replayable CASE. The case replays **in the same page via
`replayCase()` — no CDP, no daemon**: each step re-runs through the same scoped,
guarded `onAction` path, so a replay is exactly as safe as a live action.

```js
const agent = panel.pageAgent.actions;      // the AppUIPageActions handle
agent.startRecording();
// … the assistant (or the user) performs a flow …
await agent.recordAndSave('my_flow', { title: 'My Flow', url: location.pathname });
// later, on any visit to this page:
await agent.replayCaseById('my_flow');
```

**Reusable Record / Save / Replay bar (#9):** instead of hand-wiring the above,
turn on `pageAgent.recordBar` and `mountProfile` injects three hostActions-bar
buttons (Record ⏺ / Save flow 💾 / Replay ▶) bound to the agent — so ANY
page-agent app gets the affordance, not just a demo page. `recordBar:{autoRecord:
true}` starts recording on mount so a flow is capturable without clicking Record
first; `caseId` pins the saved/replayed case id (else a timestamped id is used):

```js
AppUIChatPanel.mountProfile(hostEl, 'myapp.assistant', {
  pageAgent: { root: () => document.getElementById('app-main'),
               recordBar: { autoRecord: true } },
});
```

- **Selector hardening (#11):** `from_actions` scores each recorded selector; a
  brittle one (an `nth-child`, a deep descendant chain, a bare tag) comes back in
  `warnings` so the recorder can flag it — a replay on a re-rendered page may
  miss it. Prefer `#id` / `[data-testid]` / `[aria-label]` / `[name=]` hooks.
- **Semantic steps (#12):** a confirm-gated SUBMIT must NOT be recorded as a raw
  `page.click` on the submit control — that would replay a direct irreversible
  click, bypassing the app's confirm. Record it as a SEMANTIC action instead
  (`{semantic:true, action:"page.apply"}`), and wire `opts.onSemantic(action,
  payload)` on the actions helper so `replayCase` re-dispatches the semantic verb
  through the app's own confirm-gated path. `page.apply`/`page.plan`-style verbs
  stay semantic; only plain DOM mutations are recorded as generic verbs.

### The canonical action FORMAT + parser tolerance (uniform across backends)

There is ONE canonical format — a fenced `action` block with a `{"type":"page.*",
…}` JSON object — and both LLM backends are driven THROUGH IT:

- **ericai** can do structured tool-calls, but a page action cannot round-trip
  through a server tool (the server can't await a DOM reply), so page actions go
  through the text stream like everything else.
- **kiro** is a free-text ACP agent that cannot do structured tool-calls at all
  (`kiro.py` drops `tools`), so it relies ENTIRELY on the text parser.

Because models drift, `parseActions`/`stripActions` (in `chat-panel.js`) tolerate
SIX shapes and normalize them all to the canonical action: `{type}`,
`{action}`/`{kind}` alias, the single-key envelope `{"page.fill":{…}}`, the
verb-prefixed `page.fill {json}` / `page.fill({json})`, the `<actions>…</actions>`
wrapper, and the XML-attr `<action name="page.fill">{json}`. Each shape is behind
a cheap guard regex so a plain prose reply does no brace-walking; `stripActions`
reuses the spans `parseActions` already found (one pass) to clean the display
text. Multiple actions in one reply all dispatch, IN ORDER. Keep the profile's
system prompt leading with the canonical format + 1–2 examples to minimise drift.

### Guard destructive controls — a REQUIREMENT for a confirm-gated write

Any page-agent app whose page has a confirm-gated/irreversible SUBMIT (Apply,
Submit, Delete, Sign in, Pay, …) **MUST prevent a generic `page.click` from
hitting that control directly** — otherwise the model bypasses the confirm with a
raw click. Two mechanisms:

- app-specific `guard(el,type)` — return `false` to veto (e.g. the leave page
  vetoes clicks on `#lv-apply`/`#lv-plan`/sign-in so the model must use the
  semantic `page.apply`, which keeps the confirm dialog);
- the built-in **opt-in default guard** — pass `defaultGuard: true` to veto a
  click whose target id/text/name matches Apply/Submit/Delete/Sign-in/Confirm/
  Pay/… unless allowlisted (`allowClick`: a fn or an array of selectors). It is
  off by default so existing semantic-path adopters aren't broken; turn it on for
  a new confirm-gated app.

### CDP-free replay vs the CDP engine

`replayCase` handles a LINEAR mutation list (fill/select/check/click/navigate/
wait + the semantic steps) in the user's own tab. The server-side
`page_automation` CDP interpreter is still the engine for the richer flows —
secret typing, extract/capture (cookies/bearer), per-screen `when`/`classify`
branching, the diagnose/patterns feedback loop — against the daemon-owned managed
Edge. Record→replay in-page is the quick path; promote to a CDP case when a flow
needs secrets, data capture, or run-to-run branching.

## 7. Add a page agent to your app in minutes (the recipe)

1. **Manifest** — in the app's `chat_profile`, list the `page.*` verbs under
   `actions`, turn the agent on, and lead the `system` prompt with the canonical
   format:

   ```json
   "chat_profile": {
     "id": "myapp.assistant",
     "backend": "ericai",
     "actions": ["page.inspect","page.see","page.fill","page.click","page.select","page.check","page.read"],
     "page_agent": true,
     "system": "You assist on the MyApp page. To act, emit ONE fenced action block and nothing else, e.g.\n```action\n{\"type\":\"page.fill\",\"selector\":\"#field\",\"value\":\"…\"}\n```\npage.* are ACTIONS (fenced blocks the page performs), NEVER catalog tools. Inspect the page with page.inspect before claiming a control exists."
   }
   ```

2. **Mount** — point a right-sidebar panel at the profile and pass the
   function-only bits a manifest can't carry (scope `root`, `guard`/`confirm`,
   `onRead`, `onSemantic`, custom `nodes`):

   ```js
   AppUIChatPanel.mountProfile(hostEl, 'myapp.assistant', {
     pageAgent: {
       root: () => document.getElementById('app-main'),   // scope actions here
       defaultGuard: true,                                 // veto raw destructive clicks
       // guard: (el, type) => /* app-specific veto */,
       // onSemantic: (action, pl) => applyMySemanticAction(action, pl),
     },
   });
   ```

3. **(optional) Semantic submit** — if the page has a confirm-gated write, keep
   it behind a semantic verb (e.g. `page.apply`) rather than letting the model
   click the submit button, and wire `onSemantic` so a recorded replay goes
   through the same confirm.

That's it — the assistant can now inspect the page hierarchically, see it via a
vision model, fill/click/select/check scoped controls, and (with recording on)
capture a flow into a replayable case. Verify with the hermetic suites
(`tools/test_page_actions.js`, `test_page_introspect.js`, `test_chat_action_parse.js`,
`test_page_agent_wiring.js`) and the deterministic browser e2e
(`tools/e2e_leave_action_apply.py`).
