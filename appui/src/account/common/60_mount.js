  function mount() {
    if (document.getElementById('aui-account-btn')) return;
    injectStyles();
    var btn = document.createElement('button');
    btn.id = 'aui-account-btn';
    btn.type = 'button';
    btn.className = 'aui-account-btn ai-app-user';
    _mountAccountBehavior(btn);
    var menubar = document.getElementById('app-menubar') || document.querySelector('.ai-app-menubar');
    if (menubar) {
      btn.classList.add('aui-account-inmenubar');
      menubar.appendChild(btn);
      // An AppUI shell may populate/replace the menubar AFTER this runs, wiping
      // the button. Observe the menubar and re-append if our button goes missing.
      if (!menubar._auiAccountObserved) {
        menubar._auiAccountObserved = true;
        try {
          var obs = new MutationObserver(function () {
            if (!document.getElementById('aui-account-btn') && menubar.isConnected) {
              menubar.appendChild(btn);
              paintButton();
            }
          });
          obs.observe(menubar, { childList: true });
        } catch (e) { /* ignore */ }
      }
    } else {
      btn.classList.add('aui-account-floating');  // fixed top-right
      document.body.appendChild(btn);
    }
    paintButton();
  }

