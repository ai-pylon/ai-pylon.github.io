/**
 * Content/Chat Prompt Store  --  a tiny SHARED favourites store for saved
 * prompts/messages, usable from BOTH the AI sidebar and the standalone LLM
 * page so a user's favourites follow them across surfaces.
 *
 * Each favourite: {id, name, prompt, group?, tags?}  (``prompt`` holds the
 * message/system text; ``group`` is an optional folder/category string; ``tags``
 * is an optional string[] for cross-cutting filtering). Older entries without
 * group/tags are treated as group '' (Ungrouped) and no tags — fully
 * backward-compatible.
 *
 * Backing: AppUIConfigStore when present (server-persisted, key
 * ``ai_prompt_library_custom`` — the SAME key the sidebar's prompt library
 * uses, so on a given surface they coincide) PLUS a fixed localStorage mirror
 * under the same key, so a second surface open in the same browser sees the
 * list immediately even if the two surfaces initialised AppUIConfigStore with
 * different page namespaces. Reads merge the two by id (config store wins).
 *
 * This is intentionally additive and standalone — it does NOT touch the
 * sidebar's existing _AISidebarPrompts; that keeps the live sidebar untouched.
 *
 * Exposes: window.AppUIChatPromptStore
 *   { list, add, update, delete, get, groups, tags, STORAGE_KEY }
 */
(function() {
  'use strict';

  const STORAGE_KEY = 'ai_prompt_library_custom';

  function _parse(raw) {
    if (raw == null) return [];
    try {
      const v = typeof raw === 'string' ? JSON.parse(raw) : raw;
      return Array.isArray(v) ? v : [];
    } catch { return []; }
  }

  // Read from AppUIConfigStore (if present) and the localStorage mirror, then
  // merge by id (config-store entries win; mirror fills in anything missing).
  function _readAll() {
    const fromCfg = window.AppUIConfigStore
      ? _parse(AppUIConfigStore.get(STORAGE_KEY, '[]')) : [];
    const fromLs = window.AppUIStorage
      ? _parse(AppUIStorage.getJSON(STORAGE_KEY, [])) : [];
    if (!fromCfg.length) return fromLs;
    if (!fromLs.length) return fromCfg;
    const seen = new Set(fromCfg.map(p => p && p.id));
    return fromCfg.concat(fromLs.filter(p => p && !seen.has(p.id)));
  }

  function _writeAll(list) {
    const json = JSON.stringify(list);
    if (window.AppUIConfigStore) { try { AppUIConfigStore.set(STORAGE_KEY, json); } catch {} }
    if (window.AppUIStorage) { try { AppUIStorage.set(STORAGE_KEY, json); } catch {} }
  }

  function _id() {
    return 'fav_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
  }

  function _norm(p) {
    if (!p || typeof p !== 'object') return p;
    const tags = Array.isArray(p.tags)
      ? p.tags.map(t => String(t).trim()).filter(Boolean) : [];
    return {id: p.id, name: p.name, prompt: p.prompt,
            group: (p.group == null ? '' : String(p.group).trim()), tags};
  }

  function list() { return _readAll().map(_norm); }

  function get(id) {
    const p = _readAll().find(x => x && x.id === id);
    return p ? _norm(p) : null;
  }

  function add(name, prompt, opts) {
    opts = opts || {};
    const entry = _norm({id: _id(), name: String(name || '').trim() || 'Untitled',
      prompt: String(prompt ?? ''), group: opts.group || '', tags: opts.tags || []});
    const all = _readAll();
    all.push(entry);
    _writeAll(all);
    return entry;
  }

  function update(id, patch) {
    patch = patch || {};
    const all = _readAll();
    const i = all.findIndex(p => p && p.id === id);
    if (i < 0) return null;
    const cur = _norm(all[i]);
    if (patch.name != null) cur.name = String(patch.name).trim() || 'Untitled';
    if (patch.prompt != null) cur.prompt = String(patch.prompt);
    if (patch.group != null) cur.group = String(patch.group).trim();
    if (patch.tags != null) cur.tags = Array.isArray(patch.tags)
      ? patch.tags.map(t => String(t).trim()).filter(Boolean) : cur.tags;
    all[i] = cur;
    _writeAll(all);
    return cur;
  }

  // Distinct groups (sorted; '' = Ungrouped kept out of the named list).
  function groups() {
    const s = new Set();
    _readAll().forEach(p => { const g = (p && p.group || '').trim(); if (g) s.add(g); });
    return [...s].sort((a, b) => a.localeCompare(b));
  }
  // Distinct tags across all favourites (sorted).
  function tags() {
    const s = new Set();
    _readAll().forEach(p => (Array.isArray(p && p.tags) ? p.tags : []).forEach(t => { const v = String(t).trim(); if (v) s.add(v); }));
    return [...s].sort((a, b) => a.localeCompare(b));
  }

  function remove(id) {
    const all = _readAll();
    const next = all.filter(p => p && p.id !== id);
    if (next.length !== all.length) _writeAll(next);
    return next.length !== all.length;
  }

  window.AppUIChatPromptStore = {STORAGE_KEY, list, get, add, update, delete: remove, groups, tags};
})();
