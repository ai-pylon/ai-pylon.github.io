/* Keyboard focus and activation for AppUI tree rows. */
var AppUITreeKeyboard = (() => {
  function bind({container, listen}) {
    // Keyboard navigation
    container.tabIndex = 0;
    container.setAttribute('role', 'tree');
    container.style.outline = 'none';
    let _focusIdx = -1;

    function _getVisibleRows() {
      return [...container.querySelectorAll('.tree-row')].filter(row => !row.closest('[hidden]'));
    }

    function _setFocus(idx) {
      const rows = _getVisibleRows();
      if (idx < 0 || idx >= rows.length) return;
      rows.forEach(r => r.classList.remove('focused'));
      _focusIdx = idx;
      rows[idx].classList.add('focused');
      rows[idx].scrollIntoView({block: 'nearest'});
    }

    const keyHandler = listen(container, 'keydown', (e) => {
      const rows = _getVisibleRows();
      if (!rows.length) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        _setFocus(Math.min(_focusIdx + 1, rows.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        _setFocus(Math.max(_focusIdx - 1, 0));
      } else if (e.key === 'Enter' && _focusIdx >= 0 && _focusIdx < rows.length) {
        e.preventDefault();
        rows[_focusIdx].click();
      } else if (e.key === 'ArrowRight' && _focusIdx >= 0 && _focusIdx < rows.length) {
        e.preventDefault();
        const twist = rows[_focusIdx].querySelector('.twisty');
        if (twist && rows[_focusIdx].classList.contains('tree-folder') && rows[_focusIdx].getAttribute('aria-expanded') === 'false') twist.click();
      } else if (e.key === 'ArrowLeft' && _focusIdx >= 0 && _focusIdx < rows.length) {
        e.preventDefault();
        const twist = rows[_focusIdx].querySelector('.twisty');
        if (twist && rows[_focusIdx].getAttribute('aria-expanded') === 'true') twist.click();
      }
    });

    // Focus style
    if (!document.getElementById('_tree-kb-css')) {
      const s = document.createElement('style');
      s.id = '_tree-kb-css';
      s.textContent = '.tree-row.focused{outline:1px solid var(--accent);outline-offset:-1px;border-radius:3px}';
      document.head.appendChild(s);
    }

    return {destroy() { container.removeEventListener('keydown', keyHandler); }};
  }
  return {bind};
})();
window.AppUITreeKeyboard = AppUITreeKeyboard;
