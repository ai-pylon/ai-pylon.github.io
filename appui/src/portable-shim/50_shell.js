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

