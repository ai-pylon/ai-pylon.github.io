  var _accountStyleExtra = "";
  function _mountAccountBehavior(btn) {
    btn.setAttribute('aria-label', 'Account — click to change or switch apps');
    btn.addEventListener('click', openDialog);
  }

