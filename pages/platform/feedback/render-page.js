/* Feedback — PAGE surface renderer (def.mountPage).
 *
 * The full-page surface. Today it is a thin wrapper over the shared body with
 * roomy chrome — but it lives in its OWN file so the page can DIVERGE from the
 * sidebar freely (e.g. add a page-only header, a wider layout, a history list)
 * without touching the sidebar. To re-unify, delete this file and drop
 * def.mountPage so the page falls back to def.mount (the shared body).
 *
 * Exposes: window.FeedbackRender.page(host, ctx) -> cleanup
 */
window.FeedbackRender = window.FeedbackRender || {};
(function () {
  'use strict';
  window.FeedbackRender.page = function page(host, ctx) {
    return window.FeedbackRender.shared(host, ctx, {compact: false});
  };
})();
