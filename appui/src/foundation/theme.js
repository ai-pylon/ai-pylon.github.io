/* AppUI theme service: keeps the shell's theme state in sync.
   Supports per-page theme overrides (stored separately from global preference). */
var AppUITheme = window.AppUITheme || (function() {
  const storageKey = 'appui-theme';
  const _pageName = (window.location.pathname.match(/\/pages\/([^/]+)/) || [])[1] || '';
  const _pageKey = _pageName ? 'appui-theme-' + _pageName : '';

  function get() {
    // Per-page override takes priority
    if (_pageKey) {
      var pageTheme = AppUIStorage.get(_pageKey);
      if (pageTheme) return pageTheme;
    }
    return document.documentElement.getAttribute('data-theme')
      || document.documentElement.dataset.theme
      || AppUIStorage.get(storageKey)
      || AppUIStorage.get('ui-theme')
      || 'light';
  }

  function set(theme) {
    const next = theme === 'light' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    AppUIStorage.set(storageKey, next);
    return next;
  }

  function setForPage(theme) {
    const next = theme === 'light' ? 'light' : 'dark';
    if (_pageKey) AppUIStorage.set(_pageKey, next);
    return set(next);
  }

  function clearPageOverride() {
    if (_pageKey) AppUIStorage.remove(_pageKey);
  }

  function restore() {
    // Check per-page override first
    if (_pageKey) {
      var pageTheme = AppUIStorage.get(_pageKey);
      if (pageTheme) return set(pageTheme);
    }
    const saved = AppUIStorage.get(storageKey) || AppUIStorage.get('ui-theme');
    return set(saved || 'light');
  }

  function toggle() {
    const next = get() === 'dark' ? 'light' : 'dark';
    if (_pageKey) AppUIStorage.set(_pageKey, next);
    return set(next);
  }

  return {get, set, setForPage, clearPageOverride, restore, toggle, pageName: _pageName};
})();
window.AppUITheme = AppUITheme;
