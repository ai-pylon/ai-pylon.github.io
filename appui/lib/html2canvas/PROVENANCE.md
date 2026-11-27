# html2canvas (vendored)

- **Library**: html2canvas
- **Version**: 1.4.1
- **License**: MIT — Copyright (c) 2022 Niklas von Hertzen <https://hertzen.com>
- **Upstream**: https://html2canvas.hertzen.com  (repo: https://github.com/niklasvh/html2canvas)
- **Source fetched**: https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js
- **sha256**: `e87e550794322e574a1fda0c1549a3c70dae5a93d9113417a429016838eab8cb`
- **Module shape**: UMD — sets `window.html2canvas` when loaded via a plain
  `<script>` / `AppUIAssets.loadScript`.

## Why it's here

The embedded AI assistant's `page.see` action (framework/appui/src/features/
ai-sidebar/page-actions.js) needs a SILENT screenshot of a styled app page (no
screen-share prompt). The built-in SVG-foreignObject rasterize renders blank for
heavily-styled apps (the app's external/shadow CSS doesn't apply inside the
foreignObject clone). html2canvas inlines COMPUTED styles, so it rasterizes a
styled page correctly. It's lazy-loaded ONLY when `page.see` runs (not in any
bundle), mirroring how CodeMirror is vendored under `appui/lib/` and loaded on
demand.

The `exact:true` path (getDisplayMedia, pixel-true, one-time screen-share) stays
the highest-fidelity option; html2canvas is the SILENT default that actually
works for styled DOM.

## Updating

Re-fetch the same versioned URL, re-check the sha256, re-run `node --check`, and
the `page.see` e2e (tools/e2e_leave_action_apply.py).
