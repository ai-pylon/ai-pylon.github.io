/* GENERATED portable AppUI shim — authored in src/portable-shim/*.js.
 *
 * ⚠️ Vendored into each AppForge target's web/ (as appui-shim.js) via that
 * target's mirror.json. DO NOT edit the per-page copies under
 * pages/documents/<app>/appui-shim.js — edit the framework source parts, run
 * dev/framework/appui/build_artifacts.py, then let the mirror re-vendor it.
 * (Historically each page carried its own copy; they diverged — remote_ws grew
 * the status-log/toast facility the others lacked. This is the superset.)
 *
 * Minimal self-contained AppUI shim.
 *
 * The SysDoc viewer was written against the ai-pylon "AppUI" shell
 * (AppUI.createApp({...})). That shell is a platform asset served from
 * /appui/* by the ai-pylon web server on port 9090 — which does not exist in
 * the single-container AppForge deployment.
 *
 * This shim reimplements ONLY the surface app.js actually uses:
 *   AppUI.createApp({ id, title, leftSidebar:{width,tabs[]}, rightSidebar:{...},
 *                     content:{render(el)}, statusBar:{}, menu:{...}, onAction,
 *                     onReady }) -> { setStatus, toggleLeftSidebar,
 *                                     toggleRightSidebar }
 *
 * It mounts into the region elements the page provides (#app-menubar,
 * #app-left, #app-content, #app-right, #app-statusbar) and keeps the ai-app-*
 * class names the viewer's CSS and menu toggles reference.
 */
(function () {
  'use strict';

  // ---- Shared AppUI STATUS LOG --------------------------------------------
  // A status BAR that also keeps a rolling HISTORY (so transient messages — e.g.
  // per-file upload progress — don't need a toast each). AppUI.setStatus(text)
  // writes the bar's text span + appends to history; a bottom-right 📋 button
  // opens the history in a dialog. Part of AppUI so every shim-based page shares
  // the same status facility instead of ad-hoc toasts.
  var _STATUS_LOG = [];
  var _STATUS_MAX = 200;
  function _statusTextEl() {
    var sb = document.getElementById('app-statusbar');
    if (!sb) return null;
    var el = document.getElementById('aui-status-text');
    if (!el) {
      sb.style.display = 'flex'; sb.style.alignItems = 'center';
      el = document.createElement('span');
      el.id = 'aui-status-text';
      el.className = 'aui-status-text';
      sb.insertBefore(el, sb.firstChild);
    }
    return el;
  }
  function _statusSet(text) {
    text = text == null ? '' : String(text);
    var el = _statusTextEl();
    if (el) el.textContent = text;
    if (text) {
      _STATUS_LOG.push({ t: new Date(), text: text });
      if (_STATUS_LOG.length > _STATUS_MAX) _STATUS_LOG.shift();
    }
  }
  function _esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function _statusShowLog() {
    var body;
    if (_STATUS_LOG.length) {
      body = '<div style="max-height:420px;overflow:auto;font:11px/1.7 ui-monospace,monospace">' +
        _STATUS_LOG.slice().reverse().map(function (e) {
          return '<div><span style="color:var(--text-muted,#888);margin-right:8px">' +
            e.t.toLocaleTimeString() + '</span>' + _esc(e.text) + '</div>';
        }).join('') + '</div>';
    } else {
      body = '<p style="color:var(--text-muted,#888)">No status messages yet.</p>';
    }
    if (window.AppUIDialog && (AppUIDialog.show || AppUIDialog.open)) {
      (AppUIDialog.show || AppUIDialog.open).call(AppUIDialog, { title: 'Status log', body: body, width: '560px' });
    }
  }
  // Minimal shared TOAST — a transient top-right message for WARNINGS/ERRORS
  // (routine progress uses the status bar instead). Self-contained (no AppUI
  // notifications runtime on the shim). Auto-dismisses; errors linger longer.
  function _toast(msg, type) {
    try {
      var host = document.getElementById('aui-toast-host');
      if (!host) {
        host = document.createElement('div');
        host.id = 'aui-toast-host';
        host.className = 'aui-toast-host';
        document.body.appendChild(host);
      }
      var t = document.createElement('div');
      t.className = 'aui-toast aui-toast-' + (type || 'info');
      t.textContent = String(msg == null ? '' : msg);
      host.appendChild(t);
      // Force reflow then show (CSS transition).
      void t.offsetWidth; t.classList.add('is-shown');
      var ttl = (type === 'error') ? 7000 : (type === 'warn' ? 5000 : 3000);
      setTimeout(function () {
        t.classList.remove('is-shown');
        setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 250);
      }, ttl);
    } catch (e) { /* best-effort */ }
  }

  // Mount the 📋 log button in the status bar's RIGHT slot (bottom-right).
  function _mountStatusLogButton() {
    var sb = document.getElementById('app-statusbar');
    if (!sb || document.getElementById('aui-status-log-btn')) return;
    sb.style.display = 'flex'; sb.style.alignItems = 'center';
    var spacer = document.createElement('span');
    spacer.style.cssText = 'flex:1 1 auto';
    var btn = document.createElement('button');
    btn.id = 'aui-status-log-btn';
    btn.type = 'button';
    btn.className = 'aui-status-log-btn';
    btn.title = 'Status log (history)';
    btn.setAttribute('aria-label', 'Open status log');
    btn.textContent = '📋';
    btn.addEventListener('click', function (e) { e.stopPropagation(); _statusShowLog(); });
    sb.appendChild(spacer);
    sb.appendChild(btn);
  }

  function buildMenu(menubar, menu, onAction) {
    // PRESERVE the right-aligned slot (the account widget lives here, appended
    // by the page's syncAccount / buildAccount). replaceChildren() would wipe
    // it, so detach it first and re-append after rebuilding the menu groups —
    // otherwise a rebuild() (e.g. when admin status flips) makes the top-right
    // account button vanish.
    var right = menubar.querySelector('.ai-app-menu-right');
    menubar.replaceChildren();
    Object.keys(menu || {}).forEach(function (menuName) {
      var menuDef = menu[menuName] || [];
      // A menu group may carry a visibility predicate via a leading
      // {menuWhen:fn} marker OR an array-level _when; hide the whole group when
      // false (e.g. the Admin menu for non-admins).
      var menuWhen = menuDef._when || (menuDef[0] && menuDef[0].menuWhen) || null;
      if (typeof menuWhen === 'function' && !menuWhen()) return;
      var items = menuDef.filter(function (it) { return !it.menuWhen; });

      const group = document.createElement('div');
      group.className = 'ai-menu-group';

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ai-menu-title';
      button.textContent = menuName;

      const list = document.createElement('div');
      list.className = 'ai-menu-list';
      list.hidden = true;

      items.forEach(function (item) {
        if (item.separator) {
          const sep = document.createElement('div');
          sep.className = 'ai-menu-sep';
          list.appendChild(sep);
          return;
        }
        // Per-item visibility predicate.
        if (typeof item.when === 'function' && !item.when()) return;
        const entry = document.createElement('button');
        entry.type = 'button';
        entry.className = 'ai-menu-item';
        entry.dataset.id = item.id;
        const labelSpan = document.createElement('span');
        labelSpan.className = 'ai-menu-item-label';
        entry.appendChild(labelSpan);
        if (item.shortcut) {
          entry.classList.add('has-shortcut');
          const sc = document.createElement('span');
          sc.className = 'ai-menu-item-shortcut';
          sc.textContent = item.shortcut;
          entry.appendChild(sc);
        }
        const setLabel = function () {
          let prefix = '';
          if (typeof item.checked === 'function') {
            prefix = item.checked() ? '\u2713 ' : '\u2003';
          }
          labelSpan.textContent = prefix + item.label;
        };
        setLabel();
        entry.addEventListener('click', function () {
          list.hidden = true;
          try {
            if (typeof onAction === 'function') onAction(menuName, item.id);
          } finally {
            setLabel();
          }
        });
        list.appendChild(entry);
      });

      // Open THIS menu: close all others, refresh checkmarks, show it.
      function openThis() {
        menubar.querySelectorAll('.ai-menu-list').forEach(function (l) { if (l !== list) l.hidden = true; });
        list.querySelectorAll('.ai-menu-item').forEach(function (it) {
          const def = (menu[menuName] || []).find(function (d) { return d.id === it.dataset.id; });
          if (def && typeof def.checked === 'function') {
            const lbl = it.querySelector('.ai-menu-item-label') || it;
            lbl.textContent = (def.checked() ? '\u2713 ' : '\u2003') + def.label;
          }
        });
        list.hidden = false;
      }
      button.addEventListener('click', function (event) {
        event.stopPropagation();
        const wasHidden = list.hidden;
        if (wasHidden) openThis(); else list.hidden = true;
      });
      // Hover-switch: once ANY top menu is open, moving the mouse onto another
      // top-menu title opens it (menu-bar behaviour matching the shared AppUI).
      button.addEventListener('mouseenter', function () {
        var anyOpen = menubar.querySelector('.ai-menu-list:not([hidden])');
        if (anyOpen && list.hidden) openThis();
      });

      group.appendChild(button);
      group.appendChild(list);
      menubar.appendChild(group);
    });

    // Re-attach the preserved right-aligned account slot (if any) so it stays
    // visible after a rebuild.
    if (right) menubar.appendChild(right);

    document.addEventListener('click', function () {
      menubar.querySelectorAll('.ai-menu-list').forEach(function (l) {
        l.hidden = true;
      });
    });

    // Return a controller mirroring the shared `pylon/appui` Menu API so the
    // page (and an LLM / keyboard dispatcher) can drive the menu uniformly:
    //   trigger(menuName, itemId)  → invoke an item's action programmatically
    //   getActions()               → flat [{menu,id,label}] capability list
    return {
      trigger: function (menuName, itemId) {
        var list = (menu && menu[menuName]) || [];
        var item = null;
        for (var i = 0; i < list.length; i++) { if (list[i].id === itemId) { item = list[i]; break; } }
        if (!item) return false;
        if (typeof onAction === 'function') onAction(menuName, itemId);
        return true;
      },
      getActions: function () {
        var out = [];
        Object.keys(menu || {}).forEach(function (menuName) {
          (menu[menuName] || []).forEach(function (it) {
            if (it && !it.separator && it.id) out.push({ menu: menuName, id: it.id, label: it.label });
          });
        });
        return out;
      },
      getDefinition: function () { return menu; },
      rebuild: function () { return buildMenu(menubar, menu, onAction); },
    };
  }

  // Account area: a right-aligned widget in the menubar (mirrors the full AppUI's
  // ``ai-app-menu-right`` slot). Part of AppUI itself so every app gets a
  // consistent top-right account indicator without reimplementing it per page.
  // config.account = { signedIn, displayName, user, onSignIn(), onSignOut() }.
  // Returns an update(acct) fn so the app can refresh it after login/logout.
  function buildAccount(menubar, account) {
    if (!menubar) return function () {};
    var right = menubar.querySelector('.ai-app-menu-right');
    if (!right) {
      right = document.createElement('div');
      right.className = 'ai-app-menu-right';
      menubar.appendChild(right);
    }
    function render(acct) {
      acct = acct || {};
      right.replaceChildren();
      if (!account) return;
      var wrap = document.createElement('div');
      wrap.className = 'ai-account';
      if (acct.signedIn) {
        var who = document.createElement('button');
        who.type = 'button';
        who.className = 'ai-account-user';
        who.title = 'View account info';
        who.textContent = '\uD83D\uDC64 ' + (acct.displayName || acct.user || 'signed in');
        who.addEventListener('click', function () { if (typeof acct.onProfile === 'function') acct.onProfile(); });
        var out = document.createElement('button');
        out.type = 'button'; out.className = 'ai-account-btn'; out.textContent = 'Sign out';
        out.addEventListener('click', function () { if (typeof acct.onSignOut === 'function') acct.onSignOut(); });
        wrap.append(who, out);
      } else {
        var inb = document.createElement('button');
        inb.type = 'button'; inb.className = 'ai-account-btn ai-account-signin'; inb.textContent = 'Sign in';
        inb.addEventListener('click', function () { if (typeof acct.onSignIn === 'function') acct.onSignIn(); });
        wrap.appendChild(inb);
      }
      right.appendChild(wrap);
    }
    render(account);
    return render;
  }

  function buildSidebar(host, spec, side) {
    host.replaceChildren();
    if (!spec || !Array.isArray(spec.tabs) || !spec.tabs.length) {
      host.classList.add('ai-app-hidden');
      return;
    }
    // Lay the sidebar out as a flex COLUMN so the fixed tab row + the flex:1
    // panel stack correctly and the panel (hence the tree) fills the height and
    // can scroll.
    host.style.display = 'flex';
    host.style.flexDirection = 'column';
    host.style.minHeight = '0';
    // Restore a persisted width, else the spec default.
    const storeKey = 'sysdoc_viewer.sidebar.' + side;
    let width = spec.width || 220;
    try {
      const saved = parseInt(localStorage.getItem(storeKey), 10);
      if (saved > 0) width = saved;
    } catch (e) { /* storage unavailable */ }
    host.style.width = width + 'px';

    const tabStrip = document.createElement('div');
    tabStrip.className = 'ai-tab-strip';
    // Slide-nav: flank the strip with ◂ ▸ buttons that scroll it when the tabs
    // overflow the (narrow) sidebar. Always visible; disabled when nothing to scroll.
    const tabRow = document.createElement('div');
    tabRow.className = 'ai-tab-row';
    tabRow.style.cssText = 'display:flex;align-items:stretch;min-width:0;flex:0 0 auto;position:relative';
    tabStrip.style.cssText = 'flex:1 1 auto;min-width:0;overflow-x:auto;overflow-y:hidden;scrollbar-width:none';
    function _nav(dir, glyph, label) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'ai-tab-nav'; b.textContent = glyph;
      b.title = label; b.setAttribute('aria-label', label); b.tabIndex = -1;
      // ABSOLUTELY positioned OVERLAY on the strip's edge — NOT a flex sibling.
      // As a flex sibling, hiding/showing the arrows changed the strip's width,
      // which re-triggered the ResizeObserver → a feedback loop the browser
      // silently drops (so _updateNav stopped running and the arrows were stuck
      // visible even when the tabs fit). Out of flow, the strip always keeps full
      // width and toggling arrows never resizes it → correct measure, no loop.
      b.style.cssText = 'position:absolute;top:0;bottom:0;' + (dir < 0 ? 'left:0;' : 'right:0;') +
        'width:18px;border:0;padding:0;cursor:pointer;z-index:2;display:none;' +
        'background:var(--shell-chrome,var(--bg-elevated,rgba(245,245,245,.92)));' +
        'color:var(--text-muted,#888);font-size:11px;line-height:1';
      b.addEventListener('click', function (e) {
        e.preventDefault();
        const step = Math.max(40, Math.round(tabStrip.clientWidth * 0.8));
        tabStrip.scrollBy({ left: dir * step, behavior: 'smooth' });
      });
      return b;
    }
    const navPrev = _nav(-1, '\u25C2', 'Scroll tabs left');
    const navNext = _nav(1, '\u25B8', 'Scroll tabs right');
    function _updateNav() {
      // Arrows are absolute overlays (see _nav) → toggling them does NOT resize
      // the strip, so there's no ResizeObserver feedback loop and we can run
      // SYNCHRONOUSLY. (An earlier rAF-deferred version risked a stuck
      // "_navScheduled" flag when rAF didn't fire — e.g. a backgrounded tab —
      // which froze the arrows. Synchronous + idempotent is simpler and robust.)
      const of = tabStrip.scrollWidth - tabStrip.clientWidth > 1;
      if (!of) { navPrev.style.display = 'none'; navNext.style.display = 'none'; return; }
      const x = tabStrip.scrollLeft;
      navPrev.style.display = (x <= 1) ? 'none' : '';
      navNext.style.display = (x >= (tabStrip.scrollWidth - tabStrip.clientWidth - 1)) ? 'none' : '';
    }
    tabStrip.addEventListener('scroll', _updateNav, { passive: true });
    // MOUSE-WHEEL navigation: scrolling the wheel over the tab strip scrolls it
    // HORIZONTALLY (a vertical wheel is the natural gesture over a horizontal
    // overflow strip). Only when there's actually overflow — otherwise let the
    // event bubble (so a trackpad scroll over a non-overflowing strip doesn't get
    // swallowed). preventDefault stops the page/panel from also scrolling.
    tabStrip.addEventListener('wheel', function (e) {
      if (tabStrip.scrollWidth - tabStrip.clientWidth <= 1) return;   // nothing to scroll
      const delta = (Math.abs(e.deltaY) > Math.abs(e.deltaX)) ? e.deltaY : e.deltaX;
      if (!delta) return;
      e.preventDefault();
      tabStrip.scrollBy({ left: delta, behavior: 'auto' });
    }, { passive: false });
    const panel = document.createElement('div');
    panel.className = 'ai-tab-panel';
    // The panel is a flex COLUMN filling remaining height so the per-tab pane
    // (flex:1) + any tree host inside it get a real height and can SCROLL.
    panel.style.cssText = 'flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden';

    // PER-TAB persistent panels. The old code re-rendered EVERY tab into ONE
    // shared ``panel`` on each activate — so switching tabs (or any re-render)
    // clobbered the content with another tab's output (content-bleed, lost
    // context menus, "same list"). Now each tab gets its OWN pane, rendered ONCE
    // (lazy) then just shown/hidden — so a tab's tree + bindings survive.
    const _panes = {};
    const activate = function (tab, button) {
      tabStrip.querySelectorAll('.ai-tab').forEach(function (b) {
        b.classList.remove('is-active');
      });
      button.classList.add('is-active');
      try { button.scrollIntoView({ inline: 'nearest', block: 'nearest' }); } catch (e) {}
      const id = tab.id || tab.label;
      Object.keys(_panes).forEach(function (k) { _panes[k].style.display = 'none'; });
      let pane = _panes[id];
      if (!pane) {
        pane = document.createElement('div');
        pane.className = 'ai-tab-pane';
        pane.style.cssText = 'display:flex;flex-direction:column;flex:1;min-height:0;overflow:auto';
        panel.appendChild(pane);
        _panes[id] = pane;
        if (typeof tab.render === 'function') tab.render(pane);   // render ONCE
      }
      pane.style.display = '';
      if (typeof tab.activate === 'function') tab.activate();
    };

    spec.tabs.forEach(function (tab) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ai-tab';
      button.dataset.tabId = tab.id || tab.label;
      button.textContent = tab.label;
      button.addEventListener('click', function () {
        activate(tab, button);
      });
      tabStrip.appendChild(button);
      if (tab.active) {
        setTimeout(function () { activate(tab, button); }, 0);
      }
    });

    tabRow.appendChild(navPrev);
    tabRow.appendChild(tabStrip);
    tabRow.appendChild(navNext);
    host.appendChild(tabRow);
    host.appendChild(panel);
    try { requestAnimationFrame(_updateNav); } catch (e) { setTimeout(_updateNav, 0); }
    setTimeout(_updateNav, 120);   // backstop: rAF may be deferred (background tab) or fire pre-layout
    if (typeof ResizeObserver === 'function') { try { new ResizeObserver(_updateNav).observe(tabStrip); } catch (e) {} }

    // Allow programmatic tab activation (e.g. switch to Files after a drop).
    host._activateTab = function (tabId) {
      const idx = spec.tabs.findIndex(function (t) { return (t.id || t.label) === tabId; });
      if (idx < 0) return false;
      const btn = tabStrip.querySelectorAll('.ai-tab')[idx];
      if (btn) { activate(spec.tabs[idx], btn); return true; }
      return false;
    };

    // Drag-to-resize handle on the inner edge (right edge for the left sidebar,
    // left edge for the right sidebar). Width is clamped and persisted.
    const handle = document.createElement('div');
    handle.className = 'ai-resize-handle ai-resize-' + side;
    handle.setAttribute('role', 'separator');
    handle.setAttribute('aria-orientation', 'vertical');
    handle.setAttribute('aria-label', side + ' sidebar width');
    host.appendChild(handle);
    const MIN = 140, MAX = 560;
    handle.addEventListener('mousedown', function (e) {
      e.preventDefault();
      const startX = e.clientX, startW = host.getBoundingClientRect().width;
      document.body.style.userSelect = 'none';
      const onMove = function (ev) {
        const delta = ev.clientX - startX;
        let w = side === 'left' ? startW + delta : startW - delta;
        w = Math.max(MIN, Math.min(MAX, w));
        host.style.width = w + 'px';
      };
      const onUp = function () {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.style.userSelect = '';
        try { localStorage.setItem(storeKey, String(Math.round(host.getBoundingClientRect().width))); } catch (e2) { /* storage unavailable */ }
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  const AppUI = {
    createApp: function (config) {
      const menubar = document.getElementById('app-menubar');
      const content = document.getElementById('app-content');
      const left = document.getElementById('app-left');
      const right = document.getElementById('app-right');
      const statusbar = document.getElementById('app-statusbar');

      if (config.title) document.title = config.title;
      var _menuCtl = menubar ? buildMenu(menubar, config.menu, config.onAction) : null;
      // Expose a shared-AppUI-compatible Menu facade so callers/LLM can
      // trigger menu actions + enumerate capabilities uniformly.
      if (_menuCtl) {
        AppUI.components = AppUI.components || {};
        AppUI.components.Menu = {
          trigger: _menuCtl.trigger,
          getActions: _menuCtl.getActions,
          getDefinition: _menuCtl.getDefinition,
          rebuild: _menuCtl.rebuild,
        };
      }
      var _updateAccount = menubar ? buildAccount(menubar, config.account) : function () {};
      if (left) buildSidebar(left, config.leftSidebar, 'left');
      if (right) buildSidebar(right, config.rightSidebar, 'right');

      if (content && config.content && typeof config.content.render === 'function') {
        content.replaceChildren();
        config.content.render(content);
      }

      const shell = {
        setStatus: function (text) {
          _statusSet(text);
        },
        showStatusLog: function () { _statusShowLog(); },
        toggleLeftSidebar: function () {
          if (left) left.classList.toggle('ai-app-hidden');
        },
        toggleRightSidebar: function () {
          if (right) right.classList.toggle('ai-app-hidden');
        },
        activateLeftTab: function (tabId) {
          if (left && left._activateTab) return left._activateTab(tabId);
          return false;
        },
        activateRightTab: function (tabId) {
          if (right && right._activateTab) return right._activateTab(tabId);
          return false;
        },
        updateAccount: function (acct) { try { _updateAccount(acct); } catch (e) { /* no-op */ } },
        menu: _menuCtl,
      };

      // The real framework AppUI exposes the sidebar toggles on the GLOBAL
      // AppUI (see pylon/appui/src/index.js), and app.js's View menu calls
      // AppUI.toggleLeftSidebar()/toggleRightSidebar() accordingly. The shim
      // previously only put them on the returned shell, so the global calls
      // were undefined and the View→"Toggle sidebar" items silently no-op'd.
      // Mirror the contract: delegate the global methods to the current shell.
      AppUI.toggleLeftSidebar = function () { return shell.toggleLeftSidebar(); };
      AppUI.toggleRightSidebar = function () { return shell.toggleRightSidebar(); };
      // Shared status facility on the GLOBAL AppUI + the bottom-right log button.
      AppUI.setStatus = function (text) { return _statusSet(text); };
      AppUI.showStatusLog = function () { return _statusShowLog(); };
      AppUI.toast = function (text, type) { return _toast(text, type); };
      // Log-only (append to history WITHOUT writing the bar text) — for a page
      // that renders its own status text span but still wants its messages in
      // the shared 📋 history.
      AppUI.logStatus = function (text) {
        if (text) { _STATUS_LOG.push({ t: new Date(), text: String(text) });
          if (_STATUS_LOG.length > _STATUS_MAX) _STATUS_LOG.shift(); }
      };
      // Render the page's STATUS BAR content (previously ignored by the shim, so
      // pages passing statusBar:{left,right} had NO buttons — and the only
      // clickable thing in the bar was the shim's log button, so every intended
      // status-bar click hit the log). Honor {left,right} as a render(container)
      // fn or an Element; left-aligned, then a flex spacer, then right-aligned.
      if (statusbar && config.statusBar) {
        statusbar.style.display = 'flex'; statusbar.style.alignItems = 'center';
        var _mountRegion = function (spec, align) {
          if (!spec) return;
          var host = document.createElement('span');
          host.className = 'ai-app-status-' + align;
          host.style.cssText = 'display:flex;align-items:center;gap:4px' + (align === 'right' ? ';margin-left:auto' : '');
          if (typeof spec === 'function') { try { spec(host); } catch (e) {} }
          else if (spec && spec.nodeType) host.appendChild(spec);
          else if (spec && spec.render) { try { spec.render(host); } catch (e) {} }
          statusbar.appendChild(host);
        };
        _mountRegion(config.statusBar.left, 'left');
        _mountRegion(config.statusBar.right, 'right');
      }

      // The shared 📋 status-log button is opt-OUT (window.APPUI_NO_STATUS_LOG_BTN
      // or config.statusLogButton === false) so a page that owns its status bar
      // isn't given a stray log button that hijacks clicks.
      if (!(window.APPUI_NO_STATUS_LOG_BTN || config.statusLogButton === false)) {
        try { _mountStatusLogButton(); } catch (e) { /* no statusbar region */ }
      }

      if (typeof config.onReady === 'function') {
        // Match AppUI: onReady fires after the shell is mounted.
        setTimeout(function () {
          config.onReady();
        }, 0);
      }
      return shell;
    },
  };

  window.AppUI = AppUI;

  // ---- AppUIDialog: one framework-level modal primitive -------------------
  // So every app's dialogs share ONE design (overlay + card + title + body +
  // right-aligned actions + an inline error line) instead of bespoke per-page
  // boxes. API:
  //   var dlg = AppUIDialog.open({
  //     title, render(body, dlg) | bodyHTML,
  //     actions: [{ label, primary, danger, onClick(dlg) }],  // onClick may return
  //                                                            // false to keep open
  //     onClose, width });
  //   dlg.error(msg) -> show inline error (keeps dialog open)
  //   dlg.close()
  // AppUIDialog.form({title, fields:[{name,label,type,placeholder,value}],
  //                   submitLabel, onSubmit(values, dlg)}) -> builds a form dialog.
  var _openDialog = null;
  var AppUIDialog = {
    open: function (opts) {
      opts = opts || {};
      if (_openDialog) { try { _openDialog.close(); } catch (e) {} }
      var ov = document.createElement('div');
      ov.className = 'ai-dialog-ov';
      var card = document.createElement('div');
      card.className = 'ai-dialog';
      if (opts.width) card.style.maxWidth = (typeof opts.width === 'number' ? opts.width + 'px' : opts.width);
      var head = document.createElement('div'); head.className = 'ai-dialog-head';
      var h = document.createElement('h3'); h.className = 'ai-dialog-title'; h.textContent = opts.title || '';
      var x = document.createElement('button'); x.type = 'button'; x.className = 'ai-dialog-x'; x.textContent = '\u2715'; x.title = 'Close';
      head.append(h, x);
      // Use a <form> for the body so password inputs are form-contained (quiets
      // the Chromium "Password field is not contained in a form" warning and
      // lets password managers work). Submit is prevented; the primary action
      // handles Enter.
      var body = document.createElement('form'); body.className = 'ai-dialog-body';
      body.addEventListener('submit', function (e) {
        e.preventDefault();
        var prim = foot.querySelector('.ai-dialog-primary'); if (prim) prim.click();
      });
      var err = document.createElement('div'); err.className = 'ai-dialog-err'; err.setAttribute('role', 'alert'); err.hidden = true;
      var foot = document.createElement('div'); foot.className = 'ai-dialog-foot';
      card.append(head, body, err, foot);
      ov.appendChild(card);
      document.body.appendChild(ov);

      var dlg = {
        el: ov, body: body,
        error: function (msg) { err.textContent = msg || ''; err.hidden = !msg; },
        close: function () { try { document.body.removeChild(ov); } catch (e) {} if (_openDialog === dlg) _openDialog = null; if (typeof opts.onClose === 'function') opts.onClose(); },
      };
      _openDialog = dlg;

      if (typeof opts.render === 'function') opts.render(body, dlg);
      else if (opts.bodyHTML != null) body.innerHTML = opts.bodyHTML;

      (opts.actions || []).forEach(function (a) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'ai-dialog-btn' + (a.primary ? ' ai-dialog-primary' : '') + (a.danger ? ' ai-dialog-danger' : '');
        b.textContent = a.label;
        b.addEventListener('click', function () {
          dlg.error('');
          var keep = (typeof a.onClick === 'function') ? a.onClick(dlg) : undefined;
          if (keep !== false && !a.keepOpen) dlg.close();
        });
        foot.appendChild(b);
      });

      x.addEventListener('click', function () { dlg.close(); });
      ov.addEventListener('mousedown', function (e) { if (e.target === ov && opts.dismissable !== false) dlg.close(); });
      ov.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') dlg.close();
        // Enter is handled by the <form> submit (so it fires once, and a
        // textarea's Enter stays a newline).
      });
      // Focus the first input or the primary action.
      setTimeout(function () {
        var f = body.querySelector('input,select,textarea') || foot.querySelector('.ai-dialog-primary');
        if (f) f.focus();
      }, 0);
      return dlg;
    },
    form: function (opts) {
      opts = opts || {};
      return AppUIDialog.open({
        title: opts.title, width: opts.width,
        render: function (body) {
          if (opts.intro) { var p = document.createElement('p'); p.className = 'ai-dialog-hint'; p.textContent = opts.intro; body.appendChild(p); }
          (opts.fields || []).forEach(function (f) {
            var wrap = document.createElement('label'); wrap.className = 'ai-dialog-field';
            if (f.label) { var lb = document.createElement('span'); lb.className = 'ai-dialog-label'; lb.textContent = f.label; wrap.appendChild(lb); }
            var inp;
            if (f.type === 'textarea') { inp = document.createElement('textarea'); }
            else { inp = document.createElement('input'); inp.type = f.type || 'text'; }
            inp.id = 'aidlg-' + f.name; inp.name = f.name;
            if (f.placeholder) inp.placeholder = f.placeholder;
            if (f.value != null) inp.value = f.value;
            // Per-field autocomplete so password managers label fields correctly
            // (e.g. 'username' + 'current-password'); defaults to 'off'.
            inp.setAttribute('autocomplete', f.autocomplete || 'off');
            wrap.appendChild(inp);
            body.appendChild(wrap);
          });
        },
        actions: [
          { label: opts.cancelLabel || 'Cancel' },
          { label: opts.submitLabel || 'OK', primary: true, keepOpen: true, onClick: function (dlg) {
              var values = {};
              (opts.fields || []).forEach(function (f) { var el = document.getElementById('aidlg-' + f.name); values[f.name] = el ? el.value : ''; });
              if (typeof opts.onSubmit === 'function') opts.onSubmit(values, dlg);
            } },
        ],
      });
    },
    // --- shared-AppUI-compatible API ------------------------------------
    // The platform `pylon/appui` dialog exposes show/confirm/prompt (+ form).
    // Mirroring that surface here (mapped onto `open`) keeps call sites
    // PORTABLE: code written against show/confirm/prompt works against both
    // this shim and the shared component, so an eventual convergence onto the
    // shared dialog is a drop-in rather than a rewrite. See IMPROVEMENTS_TODO
    // "convergence". `open`/`form` remain the native (richer) API.
    show: function (opts) {
      opts = opts || {};
      // Shared contract: {title, body, buttons:[{text, action, primary}], width, closable}
      var actions = (opts.buttons || [{ text: 'OK' }]).map(function (btn) {
        return {
          label: btn.text, primary: btn.primary, danger: btn.danger,
          keepOpen: btn.keepOpen,
          onClick: function (dlg) { if (typeof btn.action === 'function') return btn.action(dlg); },
        };
      });
      return AppUIDialog.open({
        title: opts.title, width: opts.width,
        dismissable: opts.closable !== false,
        bodyHTML: (typeof opts.body === 'string') ? opts.body : undefined,
        render: (typeof opts.body === 'function') ? opts.body
              : (opts.body && opts.body.nodeType ? function (b) { b.appendChild(opts.body); } : undefined),
        actions: actions,
      });
    },
    confirm: function (message, onYes, opts) {
      opts = opts || {};
      return AppUIDialog.show({
        title: opts.title || 'Confirm',
        body: '<p class="ai-dialog-hint">' + String(message == null ? '' : message)
              .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</p>',
        buttons: [
          { text: opts.cancelLabel || 'Cancel' },
          { text: opts.okLabel || 'OK', primary: true, action: function () { if (typeof onYes === 'function') onYes(); } },
        ],
      });
    },
    prompt: function (message, def, onValue, opts) {
      opts = opts || {};
      return AppUIDialog.form({
        title: opts.title || message || 'Enter a value',
        intro: opts.title ? message : undefined,
        fields: [{ name: 'value', label: opts.label || '', value: def || '', placeholder: opts.placeholder || '' }],
        submitLabel: opts.okLabel || 'OK', cancelLabel: opts.cancelLabel || 'Cancel',
        onSubmit: function (vals, dlg) { if (typeof onValue === 'function') onValue(vals.value); dlg.close(); },
      });
    },
    close: function () { if (_openDialog) _openDialog.close(); },
  };
  window.AppUIDialog = AppUIDialog;
})();

// ---- AppUIRouter: minimal namespaced query-string router -----------------
// The AppForge pod doesn't load the full /appui foundation router, but the
// shared AppUIFileExplorer uses AppUIRouter.create(id).set/get to persist the
// selected file path to the URL (deep-link + refresh-survive). This shim
// provides the SAME contract + URL format (``?appui.<id>.<key>=<value>``) so
// selecting a file in the tree updates the URL and a reload reveals it. If the
// real foundation router is already loaded, keep it.
(function () {
  if (window.AppUIRouter && window.AppUIRouter.create) return;
  // Optional SHORT ALIASES: map a verbose router param (appui.<id>.<key>) to a
  // short query param (e.g. ?wpath=). When an alias is registered, get() reads
  // EITHER form and set() writes the SHORT one — so the address bar stays short
  // with NO promote→verbose→normalize round-trip (which caused a visible URL
  // flicker on refresh). Registered via AppUIRouter.alias(appId, key, short).
  var _aliases = {};   // (appId + '.' + key) -> shortParamName
  function _aliasKey(appId, key) { return (appId || 'page') + '.' + key; }
  function create(appId, onRoute) {
    var prefix = 'appui.' + (appId || 'page') + '.';
    function notify() { try { if (typeof onRoute === 'function') onRoute(); } catch (e) {} }
    var api = {
      get: function (key) {
        try {
          var q = new URLSearchParams(window.location.search);
          var v = q.get(prefix + key);
          if (v != null) return v;
          var sh = _aliases[_aliasKey(appId, key)];
          return sh ? q.get(sh) : null;
        } catch (e) { return null; }
      },
      set: function (key, value, opts) {
        opts = opts || {};
        try {
          var url = new URL(window.location.href);
          var sh = _aliases[_aliasKey(appId, key)];
          var name = sh || (prefix + key);   // write the SHORT alias when registered
          url.searchParams.delete(prefix + key);
          if (sh) url.searchParams.delete(sh);
          if (value === undefined || value === null || value === '') { /* cleared above */ }
          else url.searchParams.set(name, String(value));
          history[opts.replace ? 'replaceState' : 'pushState'](history.state, '', url);
          if (!opts.silent) notify();
        } catch (e) { /* best-effort */ }
      },
      getHash: function (key) {
        try { return new URLSearchParams(window.location.hash.replace(/^#/, '')).get(key); }
        catch (e) { return null; }
      },
    };
    window.addEventListener('popstate', notify);
    return api;
  }
  function alias(appId, key, shortName) { _aliases[_aliasKey(appId, key)] = shortName; }
  window.AppUIRouter = { create: create, alias: alias };
})();

// ---- AppUIContextMenu: shared-contract right-click menu ------------------
// Mirrors the platform `pylon/appui` components/context-menu.js API so the page
// can build structured item arrays instead of hand-rolled HTML + positioning,
// and so an eventual convergence onto the shared component is a drop-in:
//   AppUIContextMenu.show(event|{x,y}, [{label, action, danger, disabled,
//                                        separator, submenu:[...]}], {onCommand})
// Item.command + {onCommand} is supported for parity (command dispatch); most
// callers use item.action. Styled by the pod's existing `.fs-menu`/`.fs-danger`
// CSS (self-contained element, appended to <body>).
(function () {
  var menu = null, sub = null, bindTimer = null;
  // Keep the shared platform component when its bundle is already loaded.
  if (window.AppUIContextMenu?.show && window.AppUIContextMenu?.close) return;
  function close() {
    if (bindTimer) { clearTimeout(bindTimer); bindTimer = null; }
    if (sub) { try { sub.remove(); } catch (e) {} sub = null; }
    if (menu) { try { menu.remove(); } catch (e) {} menu = null; }
    document.removeEventListener('pointerdown', onOutside, true);
    document.removeEventListener('keydown', onKey, true);
  }
  function onOutside(e) { if (menu && !menu.contains(e.target) && (!sub || !sub.contains(e.target))) close(); }
  function onKey(e) { if (e.key === 'Escape') close(); }

  function _build(items, onCommand) {
    var el = document.createElement('div');
    el.className = 'fs-menu ai-ctxmenu';
    (items || []).forEach(function (item) {
      if (!item || item.separator) { el.appendChild(document.createElement('hr')); return; }
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = item.label || '';
      if (item.disabled) b.disabled = true;
      if (item.danger) b.className = 'fs-danger';
      if (item.submenu) {
        b.classList.add('ai-ctx-has-sub');
        b.addEventListener('mouseenter', function () { _openSub(b, item.submenu, onCommand); });
        b.addEventListener('click', function (e) { e.stopPropagation(); _openSub(b, item.submenu, onCommand); });
      } else {
        b.addEventListener('mouseenter', function () { if (sub) { try { sub.remove(); } catch (e) {} sub = null; } });
        b.addEventListener('click', function () {
          if (b.disabled) return;
          close();
          if (item.command && typeof onCommand === 'function') onCommand(item.command, item.params || {}, { type: 'context-menu', item: item });
          else if (typeof item.action === 'function') item.action();
        });
      }
      el.appendChild(b);
    });
    return el;
  }
  function _place(el, x, y) {
    document.body.appendChild(el);
    var px = Math.min(x || 0, window.innerWidth - el.offsetWidth - 8);
    var py = Math.min(y || 0, window.innerHeight - el.offsetHeight - 8);
    el.style.position = 'fixed';
    el.style.left = Math.max(8, px) + 'px';
    el.style.top = Math.max(8, py) + 'px';
  }
  function _openSub(parentBtn, items, onCommand) {
    if (sub) { try { sub.remove(); } catch (e) {} sub = null; }
    sub = _build(items, onCommand);
    var r = parentBtn.getBoundingClientRect();
    _place(sub, r.right - 2, r.top);
  }
  function show(ev, items, opts) {
    opts = opts || {};
    close();
    var x = (ev && ev.clientX != null) ? ev.clientX : (ev && ev.x != null ? ev.x : 0);
    var y = (ev && ev.clientY != null) ? ev.clientY : (ev && ev.y != null ? ev.y : 0);
    menu = _build(items, opts.onCommand);
    _place(menu, x, y);
    bindTimer = setTimeout(function () {
      bindTimer = null;
      if (!menu) return;
      document.addEventListener('pointerdown', onOutside, true);
      document.addEventListener('keydown', onKey, true);
    });
    return menu;
  }
  window.AppUIContextMenu = { show: show, close: close };
})();
