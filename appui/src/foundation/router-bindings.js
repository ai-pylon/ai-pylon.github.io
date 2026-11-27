/* Private DOM bindings for query-route controls. */
window._AppUIRouterBindings = {
  create({get, set}) {
    const scope=AppUILifecycle.createScope(),bindings=new Map();
    scope.add(()=>{bindings.forEach(binding=>binding.destroy());bindings.clear();});
    // Internal: bind a single element
    function _bindElement(el, key) {
      if(scope.destroyed)return;
      bindings.get(el)?.destroy();
      const owner=AppUILifecycle.createScope();bindings.set(el,owner);
      const tag = el.tagName.toLowerCase();
      // Restore from URL on bind
      const urlVal = get(key);
      if (urlVal !== null) _setElementValue(el, urlVal);

      // Listen for changes
      if (tag === 'select' || tag === 'input' || tag === 'textarea') {
        owner.listen(el,'change', () => {
          if(owner.destroyed)return;
          set(key, el.value, {replace: true, silent: false});
        });
        if (tag === 'input') {
          owner.listen(el,'input', () => {
            if(owner.destroyed)return;
            set(key, el.value, {replace: true, silent: true});
          });
        }
      } else {
        // Clickable element with data-url-value
        owner.listen(el,'click', () => {
          if(owner.destroyed)return;
          const val = el.dataset.urlValue || el.dataset.id || el.textContent.trim();
          set(key, val, {replace: false, silent: false});
          // Add active class
          const siblings = el.parentElement?.querySelectorAll(`[data-url-param="${key}"]`);
          siblings?.forEach(s => s.classList.remove('url-active'));
          el.classList.add('url-active');
        });
      }
    }

    // Internal: set element value/state from URL param
    function _setElementValue(el, val) {
      const tag = el.tagName.toLowerCase();
      if (tag === 'select' || tag === 'input' || tag === 'textarea') {
        el.value = val;
      } else {
        // For clickable elements, add active class if value matches
        const elVal = el.dataset.urlValue || el.dataset.id || el.textContent.trim();
        if (elVal === val) el.classList.add('url-active');
        else el.classList.remove('url-active');
      }
    }

    function bind(elOrContainer, paramName) {
      if (paramName) _bindElement(elOrContainer, paramName);
      else elOrContainer.querySelectorAll('[data-url-param]').forEach(el => _bindElement(el, el.dataset.urlParam));
    }
    function restore(container) {
      (container || document).querySelectorAll('[data-url-param]').forEach(el => {
        const val=get(el.dataset.urlParam);
        if(val !== null) _setElementValue(el,val);
      });
    }
    return {bind, restore, destroy:()=>scope.destroy()};
  },
};
