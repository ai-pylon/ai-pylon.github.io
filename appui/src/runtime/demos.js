/* Registry for component gallery demos, so a gallery never lists components by hand.
 *
 * A component keeps its demo NEXT TO ITS SOURCE as `<name>.demo.js`; the AppUI catalog
 * (framework/appui_catalog.py) finds every *.demo.js and reports its URL per component.
 * A gallery loads that file on demand and mounts what it registered.
 *
 * Usage:
 *   // framework/appui/src/components/rating.demo.js
 *   AppUIDemos.register({global: 'AppUIRating', what: 'A star rating input.',
 *     code: "AppUIRating.create({container: host, value: 3});",
 *     needs: ['toolbar'],                       // optional extra bundles (the component's own bundle is implied)
 *     demo(host, kit) { return AppUIRating.create({container: host, value: 3}); }});
 *
 *   // a gallery
 *   await AppUIDemos.load('/appui/src/components/rating.demo.js');
 *   const cleanup = AppUIDemos.mount('AppUIRating', host);   // -> function | {destroy} | undefined
 *
 * kit = {el(tag, attrs, html), btn(label, onClick), esc(text)} - tiny DOM helpers for demos.
 */
const AppUIDemos = (() => {
  const registry = new Map();
  const loads = new Map();
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
  const kit = {
    esc,
    el(tag, attrs, html) {
      const node = document.createElement(tag);
      if (attrs) Object.keys(attrs).forEach(k => node.setAttribute(k, attrs[k]));
      if (html != null) node.innerHTML = html;
      return node;
    },
    btn(label, fn) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'btn sm'; b.textContent = String(label);
      b.addEventListener('click', ev => {
        try { fn(ev); } catch (e) { window.AppUIToast?.error?.(String(e)); }
      });
      return b;
    },
  };
  function register(spec) {
    if (!spec || !spec.global || typeof spec.demo !== 'function') throw new Error('AppUIDemos.register needs {global, demo}');
    if (!registry.has(spec.global)) registry.set(spec.global, Object.freeze({...spec}));
    return registry.get(spec.global);
  }
  function load(url) {
    if (!url) return Promise.resolve();
    if (!loads.has(url)) {
      const p = (window.AppUIAssets?.loadScript ? window.AppUIAssets.loadScript(url) : new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = url; s.onload = resolve; s.onerror = () => reject(new Error('could not load ' + url));
        document.head.appendChild(s);
      })).catch(error => { loads.delete(url); throw error; });
      loads.set(url, p);
    }
    return loads.get(url);
  }
  function mount(global, host) {
    const spec = registry.get(global);
    if (!spec) throw new Error('no demo registered for ' + global);
    return spec.demo(host, kit);
  }
  return {register, load, mount, kit, get: g => registry.get(g) || null, all: () => [...registry.values()]};
})();
window.AppUIDemos = AppUIDemos;
