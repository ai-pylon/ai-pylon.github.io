# AppUI Guide page modules

`../appui_guide.js` imports `main.js`; there is no generated bundle or build step.
The native modules retain explicit private imports and one readiness-gated mount.

- `state.js`: transport, DOM helpers, bundle inventory, and live shell handle.
- `helpers.js`: shared-cache adapter, refresh controls, and delayed filters.
- `gallery.js`: renders EVERY component from the framework catalog (`catalog` op ->
  `framework/appui_catalog.py`), grouped by its `framework/appui/src` folder, and
  lazily mounts the component's co-located `<name>.demo.js` (via `AppUIDemos`).
  Nothing is listed by hand here - a new component or demo shows up by itself.
- `catalog.js`: full component inventory and coverage filters.
- `apps.js`: app grouping, details, health, and sidebar preview.
- `scaffold.js`: application/component scaffolding with confirmation gates.
- `docs.js`, `sidebars.js`: document and sidebar inventories.
- `main.js`: section navigation, test exports, and shell initialization.

Use `setApp()` to update the shared shell handle; imported `app` is a live
binding. Keep cross-feature calls inside handlers during circular initialization.
Gallery owners dispose observer/delayed work and any cleanup returned by a demo.
Catalog/App filters use AppUI's cancellable lifecycle debounce. Baselines and
browser checks live in `dev/apps/platform/appui_guide/`.
