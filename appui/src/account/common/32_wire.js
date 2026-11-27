  function wireDialog() {
    var input = document.getElementById('aui-acct-input');
    var save = document.getElementById('aui-acct-save');
    function commit() {
      var v = input && input.value.trim();
      if (v) { setUser(v);
        // Update the app links in the open dialog to carry the new id.
        document.querySelectorAll('.aui-acct-app a').forEach(function (a) {
          try { var u = new URL(a.href); u.searchParams.set('user', v); a.href = u.href; } catch (e) {} });
        if (window.AppUINotifications) AppUINotifications.show('Account: ' + v, 'success');
      }
    }
    if (save) save.addEventListener('click', commit);
    if (input) input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); commit(); } });
    _wireSessionActions();
  }

