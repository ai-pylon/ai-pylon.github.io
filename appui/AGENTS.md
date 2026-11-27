# AppUI source and portable distributions

Read the repository AGENTS.md first. `appui-shim.js` is generated from ordered
`src/portable-shim/*.js` sources declared in `artifacts.json`. The account
distributions use `src/account/` common parts plus auth or claimed-ID policy
parts. `artifacts.json` also declares the generated SysDoc Viewer account mirror;
the same builder updates and checks it. Do not edit any generated
distribution directly. The parts retain its original closures, so some are
not individually executable scripts.

After source changes, run:

```
py -3 framework/appui/dev/build_artifacts.py
py -3 framework/appui/dev/build_artifacts.py --check
py -3 framework/appui/dev/check_bundles.py
node --test framework/appui/tests/test_runtime.js
node --test framework/appui/tests/test_services.js
node --test framework/appui/tests/test_networking.js
py -3 framework/appui/tests/test_browser.py
py -3 framework/appui/tests/test_browser.py --minify
node --check framework/appui/appui-shim.js
node --check framework/appui/account.js
node --check framework/appui/account-claimed.js
```

The framework serves declared distributions through the existing asset builder
in a worker, with source-driven caching, content ETags and revalidation. Default
shim output stays unminified for compatibility; `?minify=1` opts in. Hosted
building does not write the distribution. The on-disk file stays self-contained
for publishing/mirroring; the builder's `--check` rejects drift from its maintained parts.

The portable shim and full runtime have compatibility differences. Refactoring
must preserve each deployment's public API/behavior and be checked in a browser.
Do not add an independent copy of a general helper to a page.

## Management UI
- UI-001: Framework management pages use shared AppUI loader, shell or documented shell-less entry, API/dialog/clipboard/theme tokens. Consult AppUI Guide; security-sensitive public OAuth consent may remain standalone with restrictive CSP.
- UI-002: Verify real browser load, assets, editing, confirm/cancel and responsive layout.

- UI-003: Use existing AppUIUrlFields.link/read/prefill with an explicit field schema for cross-app form links; never route secrets or operations through URL parameters. Preserve manual review and confirmation. Verify links through login as well as an already authenticated page.
