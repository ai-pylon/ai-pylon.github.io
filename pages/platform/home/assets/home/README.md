# Home page modules

`../home.js` imports `main.js`, which mounts after `AppUIReady`.
Private native modules divide the launchpad's responsibilities:

- `state.js`: fleet/UI state, preferences, navigation helpers, and API calls.
- `dashboard.js`: hero, search input, fleet pulse, pins, and recents.
- `explorer.js`: VIS decoration, explorer setup, and read-only tool execution.
- `bar.js`: group, app, and layout filters.
- `tree.js`: sidebar tree model, rendering, and selection reveal.
- `tree-menu.js`: context actions, reload, health, and JSON detail dialogs.
- `endpoints.js`: endpoint/capability summaries.
- `details.js`: application details.
- `search.js`: quick matches, command palette, and layout toggle.
- `data.js`: fleet/endpoint refresh and polling callbacks.
- `main.js`: shell, shortcuts, and scoped pollers.

The stable `page` object owns the shell/explorer handles and view scope.
Cross-module calls stay inside handlers so circular function imports initialize
safely. Shared AppUI services own API transport, delayed searches, polling, and
clipboard behavior. Home's scope cleans up pollers and input work on removal.
Behavior baselines and fixture-backed browser tests live in
`dev/apps/platform/home/`.
