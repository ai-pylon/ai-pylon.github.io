/* Template-mounted statusbar slots. */
const AppUIStatusbarRegion = (function() {
  function create(element) {
    let main = null;
    let right = null;
    let defaults = null;
    function clearDefaults() {const previous = defaults; defaults = null; previous?.destroy();}
    return {
      mount({visible = true} = {}) {
        clearDefaults();
        element.replaceChildren(); element.hidden = !visible;
        if (!visible) { main = null; right = null; return {main, right}; }
        main = document.createElement('div'); main.className = 'ai-app-status-main';
        right = document.createElement('div'); right.className = 'ai-app-status-right';
        element.append(main, right);
        return {main, right};
      },
      mountDefault({component, sections} = {}) {
        if (!main || !right || !component?.create) return null;
        clearDefaults();
        const owner = AppUILifecycle.createScope(); defaults = owner;
        const statusBar = component.create({container: main, sections: sections || [{id: 'main', initial: 'Ready'}]});
        owner.add(statusBar);
        const mainSection = main.querySelector('#main');
        if (mainSection) mainSection.style.flex = '1';
        const logButton = component.mountLogButton?.(right, statusBar) || null;
        owner.add(logButton);
        return {statusBar, logButton};
      },
      destroy() { clearDefaults(); element.replaceChildren(); element.hidden = false; main = null; right = null; },
      get main() { return main; },
      get right() { return right; },
    };
  }
  return {create};
})();
window.AppUIStatusbarRegion = AppUIStatusbarRegion;
