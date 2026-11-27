/* Content top/body/bottom region controller. */
const AppUIContentRegion = (function() {
  function create({element, top, body, bottom}) {
    let content = null;
    return {
      mount(config) {
        if (typeof AppContent === 'undefined') {
          element.replaceChildren();
          config?.render?.(element);
          return null;
        }
        content?.destroy?.();
        content = AppContent.create({
          container: element,
          regions: {top, body, bottom},
          top: config?.top,
          body: config?.body || config?.render,
          bottom: config?.bottom,
          onCommand: config?.onCommand,
        });
        return content;
      },
      destroy() { content?.destroy?.(); content = null; [top, body, bottom].forEach(region => region.replaceChildren()); },
      get content() { return content; },
    };
  }
  return {create};
})();
window.AppUIContentRegion = AppUIContentRegion;
