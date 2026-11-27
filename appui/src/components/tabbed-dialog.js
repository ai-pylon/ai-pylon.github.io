/**
 * UI/TabbedDialog  --  a modal dialog whose body is a set of TABS.
 *
 * Composes the existing AppUIDialog (modal + buttons + stacking) with the
 * existing AppUITabNavigation.bind (keyboard + ARIA + panel show/hide), so a
 * page can open a tabbed dialog without re-wiring the strip/panes/active-state
 * by hand (the pattern several pages had duplicated inline).
 *
 * Layout the helper builds for you inside the dialog body:
 *   +- Title ------------------------- [✕] -+
 *   | [ Tab A ][ Tab B ][ Tab C ]            |   <- .ui-tab buttons (role=tab)
 *   |  <active pane content>                 |   <- .ui-tab-panel (role=tabpanel)
 *   +---------------------------------------+
 *   |                           [Close]     |
 *   +---------------------------------------+
 *
 * Usage:
 *   const dlg = AppUITabbedDialog.open({
 *     title: 'Credentials',
 *     width: '560px',
 *     active: 'shared',                 // initial tab id (default: first)
 *     tabs: [
 *       { id:'shared', label:'🔑 Shared account', render(pane){ pane.append(...) } },
 *       { id:'site',   label:'🌐 Per-site',        render(pane){ ... } },
 *       { id:'netrc',  label:'📄 Remote ~/.netrc',  render(pane){ ... } },
 *     ],
 *     buttons: [{ text:'Close' }],      // optional; defaults to a single Close
 *   });
 *   dlg.activate('site');   // switch programmatically
 *   dlg.close();            // close the dialog
 *
 * Each tab's `render(pane, api)` runs LAZILY the first time its tab is shown
 * (so a heavy tab pays nothing until opened); `api` is {activate, close}.
 * `render` may return a cleanup function, called when the dialog closes.
 *
 * Returns: { overlay, activate(id), active(), close(), tabsApi } or null (when
 * a supplied AbortSignal was already aborted, mirroring AppUIDialog.show).
 */
var AppUITabbedDialog = window.AppUITabbedDialog || (function() {
  'use strict';

  function _escape(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g,
      c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function open(opts) {
    opts = opts || {};
    const Dialog = window.AppUIDialog;
    const bindTabs = window.AppUITabNavigation && window.AppUITabNavigation.bind;
    if (!Dialog || !Dialog.show) throw new Error('AppUITabbedDialog: AppUIDialog is required');

    const tabs = (opts.tabs || []).filter(t => t && t.id);
    if (!tabs.length) throw new Error('AppUITabbedDialog: at least one tab is required');
    const initial = tabs.some(t => t.id === opts.active) ? opts.active : tabs[0].id;

    // Build the dialog BODY ourselves (AppUIDialog appends a DOM node as-is):
    //   a .ui-tab strip of role=tab buttons + one .ui-tab-panel per tab.
    const body = document.createElement('div');
    body.className = 'ui-tabbed-dialog';

    const strip = document.createElement('div');
    strip.className = 'ui-tab-strip';
    strip.style.cssText = 'display:flex;gap:2px;flex-wrap:wrap;margin:-4px -4px 10px;';
    tabs.forEach(t => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ui-tab';
      b.dataset.tab = t.id;
      // label may be an HTML string (icons) — it's author-supplied, not user data.
      b.innerHTML = (t.labelHtml != null) ? t.labelHtml : _escape(t.label || t.id);
      strip.appendChild(b);
    });
    body.appendChild(strip);

    const panes = tabs.map(t => {
      const p = document.createElement('div');
      p.className = 'ui-tab-panel';
      p.dataset.tab = t.id;
      body.appendChild(p);
      return p;
    });

    // Lazy per-tab render (idempotent) + collect any cleanup fns.
    const rendered = Object.create(null);
    const cleanups = [];
    let api = null;   // assigned after show(); passed to render callbacks
    function _fill(id) {
      if (rendered[id]) return;
      rendered[id] = true;
      const tab = tabs.find(t => t.id === id);
      const pane = panes[tabs.indexOf(tab)];
      if (tab && pane && typeof tab.render === 'function') {
        try {
          const ret = tab.render(pane, api);
          if (typeof ret === 'function') cleanups.push(ret);
        } catch (e) { /* a broken tab must not break the dialog */ }
      }
    }

    let tabsApi = null;
    function _runCleanups() {
      cleanups.splice(0).forEach(fn => { try { fn(); } catch (e) { /* ignore */ } });
      if (tabsApi && tabsApi.destroy) { try { tabsApi.destroy(); } catch (e) { /* ignore */ } }
    }

    const overlay = Dialog.show({
      title: opts.title || '',
      body,
      width: opts.width || '520px',
      closable: opts.closable,
      signal: opts.signal,
      buttons: opts.buttons || [{ text: 'Close' }],
      onClose: () => { _runCleanups(); if (opts.onClose) opts.onClose(); },
    });
    if (!overlay) return null;   // signal already aborted — nothing opened

    function activate(id) {
      _fill(id);
      if (tabsApi && tabsApi.switch) tabsApi.switch(id);
      else _manualPaint(id);
    }
    // Fallback paint when the tab binder isn't present (defensive — foundation
    // always ships it, but keep the dialog usable regardless).
    function _manualPaint(id) {
      strip.querySelectorAll('.ui-tab').forEach(b =>
        b.classList.toggle('active', b.dataset.tab === id));
      panes.forEach(p => {
        const on = p.dataset.tab === id;
        p.classList.toggle('active', on);
        p.hidden = !on;
      });
    }

    api = { activate, close: () => Dialog.close(overlay) };

    if (bindTabs) {
      try {
        tabsApi = bindTabs({
          container: strip,
          panels: panes,
          onSwitch: ({ id }) => _fill(id),
        });
      } catch (e) { tabsApi = null; }
    }
    // Ensure the chosen initial tab is rendered + shown (bind auto-activates the
    // first/.active button, but we also want LAZY render of exactly `initial`).
    activate(initial);

    return {
      overlay,
      activate,
      active: () => (tabsApi && tabsApi.active) ? tabsApi.active() : initial,
      close: () => Dialog.close(overlay),
      tabsApi,
    };
  }

  return { open };
})();
window.AppUITabbedDialog = AppUITabbedDialog;
