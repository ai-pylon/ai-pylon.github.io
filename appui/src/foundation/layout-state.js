/* Per-app layout persistence with safe storage failure handling. */
var AppUILayoutState = window.AppUILayoutState || (function() {
  function create(appId) {
    const key = `pylon/appui/layout/${appId || 'page'}`;
    let value = read(key);
    return {
      get: name => value[name],
      all: () => Object.assign({}, value),
      set(name, next) { value[name] = next; write(key, value); },
      replace(next) { value = Object.assign({}, next); write(key, value); },
      clear() { value = {}; AppUIStorage.remove(key); },
    };
  }

  function read(key) { return AppUIStorage.getJSON(key, {}) || {}; }
  function write(key, value) { AppUIStorage.setJSON(key, value); }
  return {create};
})();
window.AppUILayoutState = AppUILayoutState;
