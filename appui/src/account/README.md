# Shared portable account runtime

`common/` owns storage bridging, fleet navigation, account-dialog mechanics,
styles and mounting. `auth/` adds session resolution, sign-in/out and its
identity/presentation policies. `claimed/` retains the Viewer identity policy
without including session code or probing an authentication backend.

The ordered lists in `../../artifacts.json` produce two self-contained scripts:
`account.js` and `account-claimed.js`. These parts share one closure and are not
independently loadable modules. The portable artifact builder also publishes the
claimed variant to the SysDoc Viewer path declared in `mirrors`.

Run `py -3 dev/framework/appui/build_artifacts.py` after editing parts. CI runs
`--check` to detect stale outputs, including app mirrors. Browser comparisons
against the original scripts live in
`dev/framework/js_refactor/tests/browser_account_variants.py`.

Preserve the deployment policies: authenticated accounts default to guest and
filter retired IDs; the claimed-only Viewer defaults to alice and accepts those
IDs. Both retain their existing public APIs and legacy storage bridge.
