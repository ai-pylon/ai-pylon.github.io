/* Versioned AppUI template contract. */
var AppUITemplate = window.AppUITemplate || (function() {
  const VERSION = '1.1.0';
  const REQUIRED_REGIONS = [
    'app-menubar', 'app-main', 'app-left', 'app-content',
    'app-content-top', 'app-content-body', 'app-content-bottom',
    'app-right', 'app-statusbar',
  ];

  function supports(version) {
    const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version || '');
    return !!match && Number(match[1]) === 1;
  }

  function mount(documentRef = document) {
    const version = documentRef.querySelector('meta[name="app-template"]')?.content;
    if (!supports(version)) {
      throw new Error(`AppUI supports app-template >=${VERSION} <2.0.0; found ${version || 'none'}.`);
    }
    const regions = {};
    REQUIRED_REGIONS.forEach(id => {
      const matches = documentRef.querySelectorAll(`#${id}`);
      if (matches.length !== 1) {
        throw new Error(`AppUI template ${VERSION} requires exactly one #${id}; found ${matches.length}.`);
      }
      regions[id] = matches[0];
    });
    return {version, regions};
  }

  return {VERSION, REQUIRED_REGIONS, supports, mount};
})();
window.AppUITemplate = AppUITemplate;
