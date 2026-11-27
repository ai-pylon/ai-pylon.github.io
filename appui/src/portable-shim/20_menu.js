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

