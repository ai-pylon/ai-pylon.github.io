  function _accountDialogBody(links) {
    // Signed in via LDAP: show the authenticated identity + Sign out (NOT the
    // claimed-id editor — you can't just claim a different signum under LDAP).
    // Signed out (or AppForge claimed-id mode): the claimed-id picker.
    var identityHtml;
    if (_session.signedIn) {
      identityHtml =
        '<div class="aui-acct-ident">' +
        '<span class="aui-account-icon">\uD83D\uDC64</span> ' +
        '<strong>' + esc(_session.displayName || _session.user) + '</strong>' +
        (_session.user && _session.displayName ? ' <span class="aui-acct-here">(' + esc(_session.user) + ')</span>' : '') +
        '</div>' +
        '<div class="aui-acct-row" style="justify-content:flex-end">' +
        '<button type="button" id="aui-acct-signout" class="aui-acct-save">Sign out</button>' +
        '</div>' +
        '<p class="aui-acct-note">Signed in with your Ericsson signum (LDAP session).</p>';
    } else {
      identityHtml =
        '<label class="aui-acct-lbl" for="aui-acct-input">Account id</label>' +
        '<div class="aui-acct-row">' +
        '<input id="aui-acct-input" value="' + esc(current) + '" aria-label="Account id">' +
        '<button type="button" id="aui-acct-save" class="aui-acct-save">Change</button>' +
        '</div>' +
        '<p class="aui-acct-note">Scopes your file storage + saves across the fleet. ' +
        '<a href="#" id="aui-acct-signin-link">Sign in</a> with your signum for private files.</p>';
    }
    var bodyHtml =
      '<div class="aui-acct">' + identityHtml +
      '<div class="aui-acct-apps"><span class="aui-acct-lbl">Open another app as this account</span><ul>' + links + '</ul></div>' +
      '</div>';

    return bodyHtml;
  }

