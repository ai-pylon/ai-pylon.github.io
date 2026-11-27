# ChatSurface modules

Load `chatSurface` for the shared conversation surface, or `aiSidebar` for the
integrated sidebar. `aiSidebar` depends on `chatSurface`; it does not carry a
second copy of the chat engine or surface files.

`chat-surface.js` owns surface state, capability gating, request shaping,
transport integration, attachments, and mounting/cleanup. Controllers
receive explicit instance dependencies from core:

- `chat-surface-tools.js`: tool catalog tree, selection, prompt preview and apply.
- `chat-surface-prompts.js`: prompt library filtering, insertion and editing.
- `chat-surface-config.js`: backend/model/temperature settings and picker lifetime.
- `chat-surface-context.js`: custom system prompt and assembled/implicit context.
- `chat-surface-jobs.js`: job badge/dialog, result insertion and background turns.
- `chat-surface-history.js`: provider routing, filtered autosave, server sessions
  dialog and session loading. It reads the current chat engine through a getter;
  hosts retain their existing save/list/load/delete adapter contract.
- `chat-surface-location.js`: bounded workspace context, view-change detection,
  explicit share nudges and the current-workspace indicator. Engine and indicator
  getters follow replacements made during surface rendering.
- `chat-surface-preferences.js`: per-backend tool scope, model and temperature
  persistence, using the current engine through a getter.
- `chat-surface-dialogs.js`: details, engine history and transcript export.
  Export reports clipboard and popup failures and ignores late completion after
  surface destruction.
- `chat-surface-view.js`: capability-driven toolbar and view mounting, with owned
  button listeners and current-engine getters.
- `chat-surface-keyboard.js`: steering, shortcuts and slash submission. Destroy
  removes listeners and binding markers so detached inputs remain inert.
- `chat-surface-chips.js`: CONTEXT CHIPS (`CAP.contextChips`). ➕ Add context lists
  `ai/llm_server.context_providers` (apps declaring a manifest `chat_context` op),
  takes the provider's params and fetches `context_get` into a removable/refreshable
  chip; `addContextChip({uri,name,kind})` pins a file (named only). Chips are sent
  in every turn's system prompt and saved with the conversation (`meta.context_chips`).
  The two surfaces differ only in where context comes from: the AI SIDEBAR already
  sends its hosting page's live view (`context()` / `currentLocation`, shown as the
  fixed "📍 this page" chip, `contextChips.live`) plus the page DOM tools; the
  ai/llm_server PAGE has no host view, so the user adds apps' context with ➕.

The jobs controller reads the current badge button and attachments through
getters. It owns badge and dialog polling timers. Dialog close hooks stop their
polling, and surface destruction disposes all remaining jobs timers.

The public `AppUIChatSurface.create` API is unchanged. Chat/editor/backend
references that are assigned after module creation are supplied through getters.
Attachments reuse the foundation's `AppUIFileUtils.readBase64`.

## Page action modules

The `aiSidebar` bundle also supplies `AppUIPageActions`. Its public factory and
action API remain unchanged; the loader includes these private helpers first:

- `page-capture.js`: screenshot capture, sizing and page signatures. The shared
  script loader coalesces html2canvas loads and permits retries after failure.
- `page-actions-see.js`: screenshot/vision caching and invalidation.
- `page-actions-recording.js`: recording, saved cases and replay through the
  owning controller's guarded action dispatcher.

`page-actions.js` retains DOM scope checks, confirmation and action dispatch.
Consumers should load the bundle instead of loading individual source files.
