  function _accountDialogBody(links) {
    var bodyHtml =
      '<div class="aui-acct">' +
      '<label class="aui-acct-lbl" for="aui-acct-input">Account id</label>' +
      '<div class="aui-acct-row">' +
      '<input id="aui-acct-input" value="' + esc(current) + '" aria-label="Account id">' +
      '<button type="button" id="aui-acct-save" class="aui-acct-save">Change</button>' +
      '</div>' +
      '<p class="aui-acct-note">Scopes your file storage + saves across the fleet. No password — a claimed id.</p>' +
      '<div class="aui-acct-apps"><span class="aui-acct-lbl">Open another app as this account</span><ul>' + links + '</ul></div>' +
      '</div>';

    return bodyHtml;
  }

