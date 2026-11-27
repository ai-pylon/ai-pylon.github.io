# platform/tool_catalog page

AppUI-conventional page (no build step; native ES modules loaded with `AppUIAssets.loadModule`):

| module | role |
|---|---|
| `catalog.js` | entry: `AppUI.createApp` layout (menu, left tabs **Tools** / **Apps**, content top bar + views, status bar), `AppUIRouter` URL state, AI host hooks (`catalog.chain`), declared AI sidebar |
| `try-view.js` | **Tools** view: catalog landing (groups, search) and Try-It (schema form, preview / confirmed run, recent calls, add to chain, curl) |
| `chain-view.js` | **Chain builder**: canvas + inspector + output (AppUISplit), per-parameter **route picker**, run / run-to-here, save / load |
| `chain-bindings.js` | pure routing logic: `{{stepN.path}}` references, typed whole-value routes, schema coercion, output-field discovery, validation, ref remapping on move / remove |
| `chain-graph.js` | SVG pipeline graph with labelled route wires |
| `dependency-view.js` / `dependency-model.js` | **Dependency graph** (the app list renders into the left **Apps** tab) |
| `api-view.js` | **API reference**: OpenAPI table per group / app (`openapi` op), curl, download |
| `tool_catalog.css` | styles (theme variables only) |

URL: `?view=tools|chain|graph|api&tool=<id>&group=<scope>&node=<app>` - every view change is a history entry.
Views mount once and stay mounted (the chain survives switching). Calls go through `AppUI.services.api.operation`;
the catalog's own ops are read-only, tools are called through the normal op edge.

Every new module needs a `page_assets` entry in the manifest.

Tests: `node apps/platform/tool_catalog/tests/chain_bindings.test.mjs` (routing logic);
live browser: `node dev/apps/platform/tool_catalog/ui_smoke.js [--shots <dir>]`.
