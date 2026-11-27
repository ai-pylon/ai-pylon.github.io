  function _wireSessionActions() {
    // Signed-in dialog: Sign out.
    var out = document.getElementById('aui-acct-signout');
    if (out) out.addEventListener('click', function () {
      try { if (window.AppUIDialog && AppUIDialog.close) AppUIDialog.close(); } catch (e) {}
      var fb = document.getElementById('aui-acct-fallback'); if (fb) fb.remove();
      signOut();
    });
    // Signed-out dialog: a "Sign in" link that opens the LDAP sign-in flow.
    var si = document.getElementById('aui-acct-signin-link');
    if (si) si.addEventListener('click', function (e) {
      e.preventDefault();
      try { if (window.AppUIDialog && AppUIDialog.close) AppUIDialog.close(); } catch (ex) {}
      var fb2 = document.getElementById('aui-acct-fallback'); if (fb2) fb2.remove();
      signIn();
    });
  }

