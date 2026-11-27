/* Internal shell utilities. Kept separate so shell/app.js owns orchestration only. */
window.AppUIShellHelpers = {
  create({getContentTarget, getHashRoutes}) {
    function el(tag, className) {
      const node = document.createElement(tag);
      if (className) node.className = className;
      return node;
    }
    async function fetchApi(path, body, options = {}) {
      return AppUIApi.request(path, body, options);
    }
    function renderBreadcrumb(container) {
      container ||= getContentTarget(); if (!container) return null;
      const parts = [...getHashRoutes()].filter(([, value]) => value).map(([key, value]) => ({key, value}));
      if (!parts.length) return null;
      const nav = el('nav', 'ai-app-breadcrumb'); nav.setAttribute('aria-label', 'Breadcrumb');
      parts.forEach((part, index) => { if (index) { const separator = el('span', 'ai-breadcrumb-sep'); separator.textContent = '›'; nav.appendChild(separator); } const item = el('span', 'ai-breadcrumb-item'); item.textContent = decodeURIComponent(part.value); item.title = `${part.key}=${part.value}`; nav.appendChild(item); });
      return nav;
    }
    return {el, fetchApi, renderBreadcrumb};
  },
};
