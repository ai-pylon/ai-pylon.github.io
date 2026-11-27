/**
 * content-tabs.js — AppUIContentTabs: a reusable CONTENT-AREA tab manager.
 *
 * Wraps a host element with a tab bar (framework AppUITabs) above a body div;
 * each open "document" (keyed by a path/id) is a tab, and the body shows the
 * active one. The PAGE owns rendering: it supplies onActivate(key, meta) which
 * is called for user tab switches and should render that document into
 * `manager.body`. The page renders newly opened documents itself. One visible
 * body) — simple + reuses the page's existing single-view render path.
 *
 * Also provides a persisted ON/OFF toggle (for a View-menu item) so a page can
 * turn the whole tab affordance off and render straight into the host.
 *
 *   const tabs = AppUIContentTabs.create({
 *     host, storageKey:'myapp.contentTabs', signal: owner.signal,
 *     onActivate(key, meta){ renderInto(tabs.body, key, meta); },
 *     onClose(key, meta){}, icon(key,meta){ return '📄'; },
 *     title(key, meta){ return meta.name; }, contextMenuItems(key, meta, actions){ return [...]; }
 *   });
 *   // on open/select of a document:
 *   const body = tabs.ensure();          // null when disabled → render into host directly
 *   if (body) tabs.open(path, {name});   // adds/activates without a second render
 *   tabs.enabled(); tabs.setEnabled(false);
 *   tabs.destroy();                    // releases controls and restores host style
 *
 * Requires window.AppUITabs. ensure() returns null when AppUITabs is absent or
 * the feature is toggled off, so the page can fall back to the raw host.
 */
const AppUIContentTabs = (function () {
  'use strict';

  function create(opts) {
    opts = opts || {};
    var host = opts.host;
    if (!host) throw new Error('AppUIContentTabs: host is required');
    var storageKey = opts.storageKey || 'appui.contentTabs';
    var onActivate = opts.onActivate || function () {};
    var onClose = opts.onClose || function () {};
    var iconFn = opts.icon || function () { return ''; };
    var titleFn = opts.title || function (key, meta) { return (meta && meta.name) || key; };
    var ctxItems = opts.contextMenuItems || null;

    var api = null, bar = null, body = null, suppress = false, destroyed = false;
    let view, menuOwner, menuRecord;
    var byId = Object.create(null);    // tabId -> {key, meta}
    var byKey = Object.create(null);   // key   -> tabId
    var initialStyle = {display: host.style.display, flexDirection: host.style.flexDirection, minHeight: host.style.minHeight};

    function release() {
      menuOwner?.destroy(); menuOwner=null; menuRecord=null;
      view?.destroy(); view=null;
      if (api) api.destroy();
      bar?.remove(); body?.remove();
      api = null; bar = null; body = null;
      byId = Object.create(null); byKey = Object.create(null);
    }
    function destroy() {
      if (destroyed) return;
      destroyed = true;
      opts.signal?.removeEventListener('abort', destroy);
      release(); Object.assign(host.style, initialStyle);
    }

    function _enabled() {
      try { return localStorage.getItem(storageKey) !== '0'; } catch (e) { return true; }
    }

    function ensure() {
      if (destroyed) return null;
      if (!_enabled()) return null;
      if (!(window.AppUITabs && window.AppUITabs.create)) return null;
      if (api && body && host.contains(bar)) return body;
      release();
      host.innerHTML = '';
      bar = document.createElement('div');
      bar.className = 'ai-tab-strip ws-content-tabs appui-content-tabs';
      bar.style.cssText = 'flex:0 0 auto;overflow-x:auto;overflow-y:hidden;white-space:nowrap';
      body = document.createElement('div');
      body.className = 'ws-content-body appui-content-body';
      body.style.cssText = 'flex:1 1 auto;min-height:0;display:flex;flex-direction:column';
      host.style.display = 'flex'; host.style.flexDirection = 'column'; host.style.minHeight = '0';
      host.appendChild(bar); host.appendChild(body);
      view=AppUILifecycle.createViewScope({host:bar,signal:opts.signal,pagehide:false});
      byId = Object.create(null); byKey = Object.create(null);
      api = window.AppUITabs.create({
        container: bar, newTabButton: false, draggable: true, contextMenu: !!ctxItems,
        onSwitch: function (tab) {
          if (suppress) return;
          var rec = byId[tab.id]; if (!rec) return;
          try { onActivate(rec.key, rec.meta); } catch (e) {}
        },
        onClose: function (tab) {
          var rec = byId[tab.id];
          if(rec && menuRecord===rec){menuOwner?.destroy();menuOwner=null;menuRecord=null;}
          if (rec) { delete byKey[rec.key]; delete byId[tab.id]; try { onClose(rec.key, rec.meta); } catch (e) {} }
          if (api && api.tabs && !api.tabs().length && body) body.innerHTML = '';
        },
        onContextMenu: ctxItems ? function (ev, tab, actions) {
          if(destroyed || !view?.current() || !byId[tab.id])return;
          ev.preventDefault();
          var rec = byId[tab.id] || {};
          menuOwner?.destroy();menuRecord=rec;
          const owner=AppUILifecycle.createViewScope({parent:view,host:bar,pagehide:false,isCurrent:()=>byId[tab.id]===rec});menuOwner=owner;
          const guard=items=>items.map(item=>({...item,
            ...(item.submenu?{submenu:guard(item.submenu)}:{}),
            ...(item.action?{action:(...args)=>{if(owner.current())return item.action(...args);}}:{})
          }));
          var items = ctxItems(rec.key, rec.meta, actions) || [];
          try {
            if (window.AppUIContextMenu && AppUIContextMenu.show) AppUIContextMenu.show(ev, guard(items), {signal:owner.signal});
            else actions.close();
          } catch (e) { try { actions.close(); } catch (e2) {} }
        } : undefined
      });
      return body;
    }

    // Open or activate a tab for `key`. Suppresses the onSwitch callback for the
    // activation itself (the caller already renders), so there's no double render.
    function open(key, meta) {
      if (!api) return;
      var id = byKey[key];
      suppress = true;
      try {
        if (id && api.get && api.get(id)) { api.switch(id); }
        else {
          var tab = api.add({ title: titleFn(key, meta), icon: iconFn(key, meta), data: { key: key } });
          byId[tab.id] = { key: key, meta: meta || {} };
          byKey[key] = tab.id;
          api.switch(tab.id);
        }
      } finally { suppress = false; }
    }

    function setEnabled(on) {
      if (destroyed) return null;
      try { localStorage.setItem(storageKey, on ? '1' : '0'); } catch (e) {}
      var active = null; try { active = api && api.active && api.active(); } catch (e) {}
      var rec = active && byId[active.id];
      release();
      try { host.innerHTML = ''; host.style.display = ''; } catch (e) {}
      // Caller re-renders the active doc (page knows how); expose the hint.
      return rec ? rec : null;
    }

    opts.signal?.addEventListener('abort', destroy, {once: true});
    if (opts.signal?.aborted) destroy();
    return {
      destroy: destroy,
      get body() { return body; },
      ensure: ensure, open: open, enabled: _enabled, setEnabled: setEnabled,
      active: function () { try { var a = api && api.active(); return a && byId[a.id]; } catch (e) { return null; } },
      has: function () { return !!api; }
    };
  }

  return { create: create };
})();

if (typeof window !== 'undefined') window.AppUIContentTabs = AppUIContentTabs;
if (typeof module !== 'undefined' && module.exports) module.exports = AppUIContentTabs;
