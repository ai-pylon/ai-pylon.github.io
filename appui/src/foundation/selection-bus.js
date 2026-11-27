/**
 * AppUISelectionBus  --  a tiny shared "current selection" channel.
 *
 * A page and the embedded panels (AI chat, inspectors) often need to agree on
 * "what is selected right now" WITHOUT knowing about each other: a page view
 * publishes its current selection, and any observer (the AI chat's context(),
 * a sibling view, a future "clickable cited tool") reads/subscribes. This is
 * the small shared event the two-way-selection-sync feature (#6) needs.
 *
 * It is namespaced by a SCOPE string (e.g. 'platform/tool_catalog') so independent
 * pages don't cross-talk. A selection is a plain { kind, id, label?, data? }.
 *
 *   const bus = AppUISelectionBus.scope('platform/tool_catalog');
 *   bus.set({ kind: 'node', id: 'file/vfs', label: 'vfs' });   // a view selects
 *   const cur = bus.get();                                     // another reads
 *   const off = bus.subscribe((sel) => { ...highlight sel... });// react to changes
 *   off();                                                     // unsubscribe
 *
 * Deliberately dependency-free (no EventBus/SSE) — it's in-page, synchronous,
 * and additive. Setting an equal selection (same kind+id) is a no-op (no churn).
 */
window.AppUISelectionBus = (function () {
  const _scopes = Object.create(null);

  function scope(name) {
    const key = String(name || 'default');
    let s = _scopes[key];
    if (s) return s;
    let current = null;
    const subs = new Set();
    const same = (a, b) => (!a && !b) || (a && b && a.kind === b.kind && a.id === b.id);
    s = {
      /** The current selection, or null. */
      get() { return current; },
      /** Set the selection; notifies subscribers unless unchanged. */
      set(sel) {
        const next = sel || null;
        if (same(current, next)) return;
        current = next;
        for (const fn of subs) { try { fn(current); } catch (_e) { try { console.warn('AppUISelectionBus subscriber threw:', _e); } catch (_e2) {} } }
      },
      /** Clear the selection. */
      clear() { s.set(null); },
      /** Subscribe to changes; returns an unsubscribe fn. */
      subscribe(fn) {
        if (typeof fn !== 'function') return function () {};
        subs.add(fn);
        return function () { subs.delete(fn); };
      },
    };
    _scopes[key] = s;
    return s;
  }

  return { scope };
})();
