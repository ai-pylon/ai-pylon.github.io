# ai-pylon.github.io (`pylon-client`)

Public static client assets and daemon distribution for **AI Pylon**, hosted via GitHub Pages at `https://ai-pylon.github.io/`.

## Layout

- `catalogs/` — Declarative app registry (`catalog.json`, `config.json`, `profiles/`)
- `appui/` — Shared AppUI browser runtime and loader
- `pages/` — Static app UIs (`<group>/<name>/`)
- `daemons/` — Client/server daemon code and one-line installers (`install.ps1`, `install.sh`)
- `tools/` — `generate_catalogs.py` and `build_pages.py` (with built-in secret scan gate)

## Build & Local Preview

```bash
python tools/build_pages.py --out _site --api-origin https://pylon-server.duckdns.org --serve 8088
```
