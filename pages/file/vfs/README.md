# VFS page

`index.htm` loads `assets/vfs-mounts.js` before `assets/vfs.js`. The main
controller constructs `VFSMounts.create({api, esc, browse})` after AppUI is ready,
preserving the bundle-failure fallback when dependencies cannot load.

`vfs.js` owns URL/deep-link routing, listings, prefetch, file previews, and shell
wiring. `vfs-mounts.js` owns mount listing and health indicators, info/edit,
creation, unmount controls, and the transport wizard. Mount actions delegate
navigation through the supplied browse callback; they retain no current-path
state. The API callback retains its existing `{status, data}` response shape,
using `AppUIApi.requestResponse` for shared transport and request tracing.
Requests remain POST with no timeout; HTTP-error JSON stays available to callers,
and network/JSON parse failures reject.

Keep script order and asset query versions current when changing these files.
