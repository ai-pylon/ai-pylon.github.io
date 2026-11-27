/* Feedback — SHARED renderer body.
 *
 * This is the one implementation of the feedback surface. Both the page and the
 * sidebar renderers (render-page.js / render-sidebar.js) call into it, passing
 * only a small chrome flag. Keeping the real logic here means the two surfaces
 * can DIVERGE (different files, different chrome) while SHARING everything that
 * matters — and re-unifying is just "both call this with the same args".
 *
 * Exposes: window.FeedbackRender.shared(host, ctx, opts) -> cleanup
 *          window.FeedbackRender.esc / acctUser / submit  (shared helpers)
 */
window.FeedbackRender = window.FeedbackRender || {};
(function () {
  'use strict';

  function esc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }

  function acctUser() {
    try { return (window.AppUIAccount && AppUIAccount.user && AppUIAccount.user()) || 'guest'; }
    catch (_e) { return 'guest'; }
  }

  // Submit a feedback body to the issue tracker. Prefer this app's same-origin
  // relay op, then issue_report directly, then the fleet /v1/issues. {ok,id,error}.
  async function submit(body) {
    const tries = [
      {url: '/v1/apps/platform/feedback/submit'},
      {url: '/v1/apps/platform/issue_report/submit'},
      {url: '/v1/issues'},
    ];
    for (const t of tries) {
      try {
        const r = await fetch(t.url, {
          method: 'POST', credentials: 'same-origin',
          headers: {'Content-Type': 'application/json', 'X-User': acctUser()},
          body: JSON.stringify(body),
        });
        if (!r.ok && r.status === 404) continue;
        const j = await r.json().catch(() => ({}));
        const id = j.id || (j.result && j.result.id);
        if (r.ok || id || j.ok) return {ok: !!(r.ok || id || j.ok), id, error: j.error};
      } catch (_e) { /* try next */ }
    }
    return {ok: false, error: 'issue tracker unreachable'};
  }

  // The shared feedback surface. opts.compact → tighter chrome (sidebar).
  function shared(host, ctx, opts) {
    opts = opts || {};
    if (!(window.AppUIFeedback && window.AppUIFeedback.renderTab)) {
      host.innerHTML = '<div style="padding:12px;color:var(--text-muted);font-size:12px">Feedback component unavailable (load the "feedback" bundle).</div>';
      return () => { host.replaceChildren(); };
    }
    const cfg = (ctx && ctx.config) || {};
    const compact = !!opts.compact;
    const inner = document.createElement('div');
    inner.style.cssText = (ctx.mode === 'page' && !compact)
      ? 'max-width:640px;margin:0 auto;height:100%;display:flex;flex-direction:column'
      : 'height:100%;display:flex;flex-direction:column';
    host.replaceChildren(inner);

    AppUIFeedback.renderTab(inner, Object.assign({
      converter: cfg.converter || 'feedback',
      kinds: [['bug', 'Bug'], ['feature', 'Idea / request'], ['other', 'Other']],
      esc, acctUser,
      trackerUrl: cfg.trackerUrl || null,
      intro: cfg.intro || (compact
        ? 'Report a bug or idea — filed into the tracker.'
        : 'Report a bug or share an idea — it is filed into the issue tracker.'),
      buildContext: () => Object.assign({
        page_url: location.href,
        surface: ctx.mode,                 // 'page' or 'sidebar' — provenance
        host_app: cfg.hostApp || null,
      }, (typeof cfg.buildContext === 'function' ? (cfg.buildContext() || {}) : {})),
      pickObject: typeof cfg.pickObject === 'function' ? cfg.pickObject : undefined,
      submit: cfg.submit || submit,
    }, cfg.feedbackOptions || {}));

    if (ctx.setStatus) ctx.setStatus('Feedback ready');
    return () => { host.replaceChildren(); };
  }

  window.FeedbackRender.shared = shared;
  window.FeedbackRender.esc = esc;
  window.FeedbackRender.acctUser = acctUser;
  window.FeedbackRender.submit = submit;
})();
