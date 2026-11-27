  function openDialog() {
    var links = FLEET.map(function (a) {
      var here = appIsHere(a);
      var href = appHref(a);
      return '<li class="aui-acct-app' + (here ? ' is-here' : '') + '">' +
        '<a href="' + esc(href) + '"' + (here ? ' aria-current="page"' : '') + '>' +
        esc(a.label) + (here ? ' <span class="aui-acct-here">· here</span>' : '') + '</a></li>';
    }).join('');
    var bodyHtml = _accountDialogBody(links);

    if (window.AppUIDialog && AppUIDialog.show) {
      AppUIDialog.show({ title: 'Account', buttons: [], body: bodyHtml });
      wireDialog();
    } else {
      // Minimal fallback: a positioned panel.
      var old = document.getElementById('aui-acct-fallback');
      if (old) old.remove();
      var panel = document.createElement('div');
      panel.id = 'aui-acct-fallback';
      panel.className = 'aui-acct-fallback';
      panel.innerHTML = '<div class="aui-acct-fallback-inner"><button type="button" id="aui-acct-x" class="aui-acct-save" style="float:right">×</button>' + bodyHtml + '</div>';
      document.body.appendChild(panel);
      var x = document.getElementById('aui-acct-x');
      if (x) x.addEventListener('click', function () { panel.remove(); });
      wireDialog();
    }
  }

