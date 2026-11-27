/**
 * AppUIHostHooks  --  a tiny named registry for PAGE-PROVIDED host hooks.
 *
 * The manifest sidebar contract lets an app DECLARE (in its manifest's
 * `sidebars_shown`) which gallery sidebars a page embeds, so adding e.g. the AI
 * chat to a page is a MANIFEST edit, not code. But some sidebars need live page
 * FUNCTIONS they can't get from a static manifest — the AI chat's `context()`
 * (a per-turn snapshot of the page) and `onAction(type, payload)` (where a
 * chat-emitted action is applied). A JSON manifest can't carry a function.
 *
 * This registry bridges that gap WITHOUT coupling the manifest to code: the
 * page registers its live hooks under a stable KEY, and the manifest entry
 * references that key via `host_hooks`. At mount time the shell resolves the
 * key → the registered `{ context, onAction, system, ... }` and passes them to
 * the sidebar. A sidebar whose provider declares no `needs_host` (apphost
 * `_one_sidebar_spec`) is a pure drop-in and ignores all of this.
 *
 *   // page code, once, early:
 *   AppUIHostHooks.register('catalog.chain', {
 *     context: () => currentChainSnapshot(),
 *     onAction: (type, payload) => applyChainAction(type, payload),
 *     system: 'You are the chain assistant…',
 *   });
 *
 *   // manifest (platform/tool_catalog):
 *   "sidebars_shown": [
 *     { "type": "ai-sidebar", "position": "right", "host_hooks": "catalog.chain" }
 *   ]
 *
 * register() returns an unregister() for teardown; registering the same key
 * replaces the prior entry (last writer wins) so a page re-mount is safe.
 */
window.AppUIHostHooks = (function () {
  const _hooks = Object.create(null);

  /** Register page hooks under `key`. Returns an unregister() fn. */
  function register(key, hooks) {
    if (!key || typeof key !== 'string') throw new Error('AppUIHostHooks.register: string key required');
    if (!hooks || typeof hooks !== 'object') throw new Error('AppUIHostHooks.register: hooks object required');
    _hooks[key] = hooks;
    return function unregister() { if (_hooks[key] === hooks) delete _hooks[key]; };
  }

  /** The hooks registered under `key`, or null. */
  function get(key) { return (key && _hooks[key]) || null; }

  /** True if something is registered under `key`. */
  function has(key) { return !!(key && _hooks[key]); }

  /** Remove any registration under `key`. */
  function unregister(key) { if (key && _hooks[key]) delete _hooks[key]; }

  /**
   * Resolve a sidebar's `needs_host` declaration against the hooks registered
   * under `key`, producing the subset of host functions/values the provider
   * accepts. `needsHost` is the provider spec's `needs_host` object, e.g.
   * { context: "optional", onAction: "optional", system: "optional" }. Returns
   * a plain object with only the matching keys that the page actually provided;
   * missing OPTIONAL hooks are simply omitted (the sidebar works without them),
   * and a missing REQUIRED hook is reported via `missing` so a caller can warn.
   */
  function resolve(needsHost, key) {
    const hooks = get(key);
    const out = {}, missing = [];
    if (!needsHost || typeof needsHost !== 'object') return { host: out, missing };
    for (const name of Object.keys(needsHost)) {
      const requirement = needsHost[name];   // "optional" | "required" | true
      const required = requirement === 'required' || requirement === true;
      const value = hooks ? hooks[name] : undefined;
      if (value !== undefined && value !== null) out[name] = value;
      else if (required) missing.push(name);
    }
    return { host: out, missing };
  }

  return { register, get, has, unregister, resolve };
})();
