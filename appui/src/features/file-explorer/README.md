# file-explorer — backends, roots, and `subPath`

The AppUI file-explorer (`core.js`) is backend-agnostic: it renders a tree and
delegates all I/O to a **backend adapter**.

The feature bundle loads these internal modules before `core.js`:

- `node-model.js` owns root identity, tree keys, node shapes, ordering, and icons.
  It reads the live root list so runtime root changes keep the same rules.
- `routing.js` owns URL persistence, owner-qualified paths, cold-tree reveal,
  and restoration retries. A tree getter keeps navigation attached to the
  owning instance's current tree.
- `expansion.js` owns lazy loading for storage, collection, and virtual nodes,
  including unavailable-backend retries and page augmentation hooks.
- `file-actions.js` owns delete, rename, folder destination selection, and
  recursive copies/moves across backend instances, including binary transfers.
- `uploads.js` owns file reading, dropped-directory traversal, file/folder
  pickers, upload progress, optimistic tree insertion, and file/folder creation.
  Browser traversal and base64 reading delegate to shared `AppUIFileUtils`.
- `drag-drop.js` owns each instance's drag source, modifier handling, external
  drops, and delegation to page link/transfer hooks.

- `listing-cache.js` owns each explorer's in-memory listing cache, session
  persistence, expiration, eviction, and invalidation.
- `properties.js` owns the Properties dialog, editable metadata, and reference
  information/actions. Backend resolution and navigation are injected by core.
- `context-menu.js` assembles menus from node type, capabilities, and page hooks;
  core supplies the file actions and selection callbacks.

`core.js` wires the modules and owns tree lifecycle and refresh. These
internal factories share no instance state; the public `AppUIFileExplorer.create`
API and backend contracts remain the entry points for pages. Load the
`fileExplorer` bundle through `AppUIAssets.load('fileExplorer')` so its internal
dependencies arrive in order.

Several backend adapters ship here:

| Adapter | File | Source |
|---|---|---|
| `AppUIFileBackend.fileStorage` | `backend-file-storage.js` | the `file_storage` app's `/v1/files` API |
| `AppUIFileBackend.vfs` | `backend-vfs.js` | in-memory virtual FS |
| `AppUIFileBackend.localDir` | `backend-local-dir.js` | a local directory |
| `AppUIFileBackend.collections` | `backend-collections.js` | grouped collections |

## Backend contract

A backend is created by `create(opt)` and returns an object with:

- `__id` — a **distinct per-instance id**. The explorer caches listings keyed on
  `__id + path` (in memory and `sessionStorage` as `fe_ls_<__id>|<path>`), so two
  instances of the SAME adapter targeting DIFFERENT accounts/scopes MUST have
  different `__id`s or their listings collide. `fileStorage` keys it on
  `fs2:<user>:<shareScope>:<subPath>`.
- `caps` — `{ rename, mkdir, upload, multiUser }` capability flags.
- `roots()` → `[{ name, path, icon, writable }]`
- `list(path)` → `{ entries: [{ name, type:'dir'|'file', path, id, shared }] }`
- `read(node)` / `readBlob(node)` / `write(path, content, opts)`
- `mkdir(path)` / `delete(node)` / `rename(from, to)`
- `fileMeta(node)` — size/created/content_type/id for the Properties dialog.

Mutations (`write`/`mkdir`/`delete`/`rename`) MUST invalidate the explorer cache
so the tree reflects the change. The explorer's `invalidateCache(path)` clears
BOTH the in-memory `_fileLsCache` and the persistent `sessionStorage`
`fe_ls_*` entries, scoped to `path`; it is called from every mutating UI path
(upload/mkdir/delete/rename). Backends additionally reset their own
`_cache = null` after a write.

## fileStorage adapter options (`create(opt)`)

- `user` — string or getter → "my storage" owner (the `X-User` scope). The
  listing passes `?user=` too, so an authenticated SESSION on the server can't
  shadow a shared/common root (the server honours `?user=common` as a public
  read regardless of session).
- `shareScope` — show "another user's storage" (a share): surface only names
  under this prefix from the viewer's own `shared[]` set.
- `rootName` / `ownerLabel` — display label for the root.
- `subPath` — **scope a root to a specific SUBFOLDER of the account**.

### `subPath` — mounting one subfolder as a root

`subPath` lets a root show ONLY a subfolder of an account instead of the whole
namespace. The adapter keeps only names under `<user>/<subPath>/` and strips
that whole prefix, so the subfolder's contents appear at the ROOT of the tree.

Example (the plantuml page mounts the shared PlantUML examples, not all of
`common`) — the backend takes `subPath`; the root spec carries the display
`name`/`writable`:

```js
host.addRoot({
  name: 'examples', path: '', icon: '📚', writable: false,
  backend: AppUIFileBackend.fileStorage({
    user: 'common',
    subPath: 'plantuml_python/examples',
  }),
});
```

This surfaces `common/plantuml_python/examples/*` as a clean `examples/` root.
Because `subPath` is part of `__id` (`fs2:common::plantuml_python/examples`), its
listing cache never collides with an unscoped `common` root.

## onSelect carries the owning backend

When a file is selected, the explorer passes the owning **backend + id** to
`onSelect` so the host reads the bytes from the CORRECT account (a prior bug read
from the session user instead of the root's account). Hosts should use the
provided backend/id rather than re-deriving one from the path.

## Owner-prefix stripping ("my storage")

`file_storage` namespaces stored names under the owner id (`<user>/path`). The
adapter strips the leading `<user>/` so a user's files appear at the root of "My
storage" rather than nested under a redundant `<user>` folder. The real file
`id` is unchanged, so `read()`/`rename()` still resolve.
