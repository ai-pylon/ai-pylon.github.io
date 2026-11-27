  var _accountStyleExtra = ".aui-acct-err{color:#b91c1c;font-size:12px;margin-top:6px;}";
  function _mountAccountBehavior(btn) {
    btn.setAttribute('aria-label', 'Account');
    btn.addEventListener('click', _onAccountClick);
    if (!window._auiAcctRepaint) {
      window._auiAcctRepaint = true;
      window.addEventListener('appui:account-change', paintButton);
    }
  }

