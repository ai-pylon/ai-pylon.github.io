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

