/* Feedback app — thin wiring of the page/sidebar surfaces onto AppUIPanelApp.
 *
 * The renderers live in their own files (loaded before this by index.htm):
 *   render-shared.js  → FeedbackRender.shared  (the one real body)
 *   render-page.js    → FeedbackRender.page     (def.mountPage)
 *   render-sidebar.js → FeedbackRender.sidebar  (def.mountSidebar)
 *
 * This file only ASSEMBLES the def and wires it:
 *   - def.mount        = shared body (fallback; used if an override is absent)
 *   - def.mountPage    = page surface
 *   - def.mountSidebar = sidebar surface
 * Delete render-page.js/render-sidebar.js + drop the override(s) to re-unify.
 *
 * SURFACE PREVIEW (b): index.htm reads ?surface=sidebar and sets
 * window.__FEEDBACK_SURFACE so you can preview the SIDEBAR surface in a full
 * browser tab (dev affordance) — the same def, mounted as a sidebar into the
 * content area. Default is the page surface.
 */

const FEEDBACK_APP = {
  id: 'platform/feedback',
  title: 'Feedback',
  sidebarType: 'feedback',
  // shared fallback body — both surfaces fall back here if their override is gone
  mount(host, ctx) { return window.FeedbackRender.shared(host, ctx, {compact: ctx.mode === 'sidebar'}); },
  // per-surface overrides (separate files; divergeable)
  mountPage(host, ctx) { return window.FeedbackRender.page(host, ctx); },
  mountSidebar(host, ctx) { return window.FeedbackRender.sidebar(host, ctx); },
};

// Register the sidebar type so ANY page can embed feedback as a sidebar tab.
// This is SAFE to run when loaded as a sidebar asset into another app — it only
// registers a type + exposes the def; it does NOT touch the host page.
if (window.AppUIPanelApp) {
  try { window.AppUIPanelApp.registerSidebarType(FEEDBACK_APP); } catch (_e) {}
}
window.FeedbackApp = FEEDBACK_APP;

// Mount as a PAGE *only* when this script is running on the feedback app's OWN
// page. When this file is loaded as a sidebar ASSET into a DIFFERENT app (via
// the gallery / embedSidebar), calling AppUI.createApp() here would rebuild that
// host's shell and WIPE its page — so we must NOT bootstrap a page in that case.
(function _maybeBootstrapPage() {
  var isOwnPage = false;
  try {
    var b = document.body;
    isOwnPage = !!(b && (b.getAttribute('data-page-id') === 'documents-feedback'
      || /\/apps\/documents\/feedback\/?($|[?#])/.test(location.pathname + location.search)));
  } catch (_e) { isOwnPage = false; }
  if (!isOwnPage) return;   // loaded as a sidebar asset elsewhere → do nothing

  var _surface = (window.__FEEDBACK_SURFACE || 'page');
  if (window.AppUIPanelApp && _surface === 'sidebar') {
    window.AppUI.createApp({
      id: FEEDBACK_APP.id, title: FEEDBACK_APP.title + ' (sidebar preview)',
      content: {render: el => window.AppUIPanelApp.mountInto(FEEDBACK_APP, el, {mode: 'sidebar', config: {}})},
      statusBar: {left: 'Sidebar preview'},
    });
  } else if (window.AppUIPanelApp) {
    window.AppUIPanelApp.page(FEEDBACK_APP);
  } else {
    window.AppUI.createApp({
      id: FEEDBACK_APP.id, title: FEEDBACK_APP.title,
      content: {render: el => FEEDBACK_APP.mount(el, {mode: 'page', config: {}})},
      statusBar: {left: 'Ready'},
    });
  }
})();
