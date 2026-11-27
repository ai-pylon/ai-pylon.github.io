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
