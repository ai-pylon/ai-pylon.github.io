  function paintButton() {
    var btn = document.getElementById('aui-account-btn');
    if (!btn) return;
    btn.innerHTML = '<span class="aui-account-icon">\u25CB</span><span class="aui-account-name">' + esc(current) + '</span>';
    btn.title = 'Account: ' + current + ' — click to change or switch apps';
  }

  function _onAccountClick() { openDialog(); }

