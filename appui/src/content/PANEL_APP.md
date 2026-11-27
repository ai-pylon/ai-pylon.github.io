# PanelApp controllers

Load the `feedback` bundle to use `AppUIPanelApp`. Its public API supports page
and sidebar renderers, registration, discovery, embedding, the gallery and
manifest-declared panels. Consumers should load the bundle, not individual
implementation files.

The loader assembles these private controllers before the public core:

- `panel-discovery.js`: sidebar/profile discovery and ordered asset loading.
- `panel-embedding.js`: direct registered mounts, shell fallback and gallery
  placement, including profile-based chat panels.
- `panel-gallery.js`: provider/profile cards, local-spec merging and embed forms.
- `panel-declared.js`: manifest demands, host-hook resolution and aggregate
  cleanup.
- `panel-app.js`: renderer selection, page mounting, registered definitions and
  controller composition.

Embedding receives the definition registry and mount function explicitly.
Gallery and declarative mounting receive discovery/embedding functions. No
controller keeps a second registry or changes the public factory API. Discovery
uses `AppUIApi.requestResponse` to preserve raw JSON response semantics and the
existing empty-list behavior on transport failure.
