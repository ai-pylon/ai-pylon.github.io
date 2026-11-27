/**
 * restart-banner.js — NEXT4 #6: a thin top strip while a host restart is
 * pending (framework admin_ops publishes on the 'system' EventBus channel:
 * restart_pending / restart_aborted / restart_now). The restart waits for
 * in-flight chat turns and long ops, so the user sees why and can finish.
 * Rides the shared SSE worker; no polling. Opt out: window.__RESTART_BANNER = false.
 */
(function () {
  'use strict';
  if (window.AppUIRestartBanner || window.__RESTART_BANNER === false) return;
  let bar = null;
  let hideTimer = null;

  function show(text, tone) {
    if (!document.body) return;
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'appui-restart-banner';
      bar.setAttribute('role', 'status');
      bar.setAttribute('aria-live', 'polite');
      bar.style.cssText = [
        'position:fixed', 'top:0', 'left:0', 'right:0', 'z-index:999998',
        'padding:4px 16px', 'font:12px/1.5 system-ui,sans-serif', 'text-align:center',
        'color:var(--text-inverse,#fff)', 'opacity:0.95', 'pointer-events:none'
      ].join(';');
      document.body.appendChild(bar);
    }
    bar.style.background = tone === 'ok' ? 'var(--color-success,#2e7d32)'
      : tone === 'bad' ? 'var(--color-danger,#c62828)' : 'var(--color-warning,#b26a00)';
    bar.textContent = text;
    clearTimeout(hideTimer);
  }
  function hide(after) {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => { if (bar) { bar.remove(); bar = null; } }, after || 0);
  }
  function why(d) { return d && d.reason ? ' (' + d.reason + ')' : ''; }

  function connect() {
    if (typeof window.AppUIEventBus !== 'function') return;
    const bus = new window.AppUIEventBus(['system']);
    bus.on('system', 'restart_pending', (d) => {
      const busy = d && (d.inflight || d.jobs)
        ? ' — waiting for ' + (d.inflight || 0) + ' in-flight request(s)' + (d.jobs ? ', ' + d.jobs + ' job(s)' : '')
        : '';
      const left = d && d.deadline_in_s != null ? ', up to ' + d.deadline_in_s + ' s' : '';
      show('Host restart pending' + why(d) + busy + left, 'warn');
    });
    bus.on('system', 'restart_now', (d) => { show('Host restarting now' + why(d) + ' — reconnecting…', 'bad'); hide(30000); });
    bus.on('system', 'restart_aborted', (d) => { show('Host restart aborted — still busy' + why(d), 'ok'); hide(8000); });
    window.AppUIRestartBanner = { bus, show, hide };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', connect, { once: true });
  else setTimeout(connect, 0);
})();
