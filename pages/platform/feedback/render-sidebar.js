/* Feedback — SIDEBAR surface renderer (def.mountSidebar).
 *
 * The sidebar-panel surface. A sidebar has NO HTML document of its own — it is
 * rendered by the shell into a host page's <aside> via the registered sidebar
 * TYPE. This renderer lives in its own file so the sidebar can DIVERGE from the
 * page freely (e.g. a compact intro, an element picker a host injects) while
 * SHARING the real body. To re-unify, delete this file and drop
 * def.mountSidebar so the sidebar falls back to def.mount (the shared body).
 *
 * Exposes: window.FeedbackRender.sidebar(host, ctx) -> cleanup
 */
window.FeedbackRender = window.FeedbackRender || {};
(function () {
  'use strict';
  window.FeedbackRender.sidebar = function sidebar(host, ctx) {
    return window.FeedbackRender.shared(host, ctx, {compact: true});
  };
})();
