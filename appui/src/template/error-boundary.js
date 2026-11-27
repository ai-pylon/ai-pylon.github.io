/**
 * Error Boundary — catches unhandled errors during page initialization and
 * renders a helpful error screen instead of a blank page.
 *
 * Attaches to window.AppUIReady so that pages using the standard
 * `AppUIReady.then(() => ...)` pattern get automatic error handling.
 */
(function() {
  function renderErrorBoundary(error) {
    const container = document.getElementById('app-content-body');
    if (!container) return;
    const message = error?.message || String(error || 'Unknown error');
    const stack = error?.stack || '';
    container.innerHTML = '';
    const panel = document.createElement('div');
    panel.className = 'appui-error-boundary';
    panel.setAttribute('role', 'alert');
    panel.innerHTML =
      '<div class="appui-error-boundary__icon">⚠️</div>' +
      '<h2 class="appui-error-boundary__title">Page failed to load</h2>' +
      '<p class="appui-error-boundary__message">' + escapeHtml(message) + '</p>' +
      '<button class="appui-error-boundary__retry" type="button">Retry</button>' +
      '<details class="appui-error-boundary__details"><summary>Details</summary>' +
      '<pre class="appui-error-boundary__stack">' + escapeHtml(stack) + '</pre></details>';
    const style = document.createElement('style');
    style.textContent =
      '.appui-error-boundary{display:flex;flex-direction:column;align-items:center;justify-content:center;' +
      'height:100%;padding:var(--space-xl,24px);text-align:center;font-family:var(--font-family,system-ui,sans-serif);color:var(--text-primary,#ddd)}' +
      '.appui-error-boundary__icon{font-size:48px;margin-bottom:var(--space-md,12px)}' +
      '.appui-error-boundary__title{margin:0 0 var(--space-sm,8px);font-size:var(--font-xl,20px);font-weight:600;color:var(--text-primary,#ddd)}' +
      '.appui-error-boundary__message{margin:0 0 var(--space-lg,16px);font-size:var(--font-md,14px);color:var(--color-error,#f44336);' +
      'max-width:600px;word-break:break-word}' +
      '.appui-error-boundary__retry{padding:var(--space-sm,8px) var(--space-lg,16px);font-size:var(--font-md,14px);' +
      'background:var(--accent,#6c63ff);color:var(--text-inverse,#fff);border:none;border-radius:var(--radius-md,6px);cursor:pointer;' +
      'transition:background var(--transition-fast,0.1s ease)}' +
      '.appui-error-boundary__retry:hover{background:var(--accent-hover,#7b73ff)}' +
      '.appui-error-boundary__details{margin-top:var(--space-lg,16px);max-width:700px;width:100%;text-align:left}' +
      '.appui-error-boundary__details summary{cursor:pointer;font-size:var(--font-sm,12px);color:var(--text-muted,#888);' +
      'padding:var(--space-xs,4px) 0}' +
      '.appui-error-boundary__stack{margin:var(--space-sm,8px) 0 0;padding:var(--space-md,12px);' +
      'background:var(--bg-secondary,#1e1e2e);border:1px solid var(--border,#333);border-radius:var(--radius-md,6px);' +
      'font-family:var(--font-mono,monospace);font-size:var(--font-xs,11px);color:var(--text-secondary,#aaa);' +
      'overflow:auto;max-height:300px;white-space:pre-wrap;word-break:break-all}';
    panel.prepend(style);
    panel.querySelector('.appui-error-boundary__retry').addEventListener('click', function() { location.reload(); });
    container.appendChild(panel);
  }

  function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // Patch AppUIReady to attach an error boundary catch handler.
  // Pages use: AppUIReady.then(() => loadScript('app.js'))
  // If the chain rejects, the boundary catches it.
  const ready = window.AppUIReady;
  if (ready && typeof ready.then === 'function') {
    const original = ready.then.bind(ready);
    window.AppUIReady = new Promise(function(resolve, reject) {
      ready.then(resolve, reject);
    });
    // Preserve the .then interface but attach a catch to any derived chain
    const origThen = window.AppUIReady.then.bind(window.AppUIReady);
    window.AppUIReady.then = function() {
      return origThen.apply(window.AppUIReady, arguments).catch(function(error) {
        console.error('[AppUI Error Boundary]', error);
        renderErrorBoundary(error);
      });
    };
  }

  // Global fallback: catch uncaught errors during init that bypass the promise chain
  window.addEventListener('error', function(event) {
    if (document.querySelector('.appui-error-boundary')) return;
    console.error('[AppUI Error Boundary] Uncaught error:', event.error || event.message);
    renderErrorBoundary(event.error || new Error(event.message));
  });
  window.addEventListener('unhandledrejection', function(event) {
    if (document.querySelector('.appui-error-boundary')) return;
    console.error('[AppUI Error Boundary] Unhandled rejection:', event.reason);
    renderErrorBoundary(event.reason instanceof Error ? event.reason : new Error(String(event.reason)));
  });
})();

