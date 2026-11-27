/* AppUIScreencastViewer — a live MIRROR of a remote/managed browser tab.
 *
 * Generic: the caller supplies how to fetch the latest frame and how to relay
 * input, so it works for any screencast source (system/cdp signin_* sessions,
 * a remote CDP agent, …). Polls ``shot()`` every ``intervalMs`` while the
 * viewer is in the DOM (it stops by itself once its container is removed, e.g.
 * when the hosting dialog closes), renders the JPEG frame, and maps a click on
 * the image to the frame's natural pixel coordinates.
 *
 *   const v = AppUIScreencastViewer.create({
 *     container,                                   // element to render into
 *     shot:  () => Promise<{img: base64jpeg, url?, needs_headful?, error?}>,
 *     input: (ev) => Promise,                      // ev = {kind:'click',x,y} | {kind:'type',text} | {kind:'key',key}
 *     intervalMs: 700,                             // frame poll period
 *     readOnly: false,                             // true = watch only, no input relay
 *     onStop: () => {},                            // called once when the viewer stops (container removed / stop())
 *   });
 *   v.stop();                                      // optional explicit stop
 *
 * Keyboard: with the viewer focused, printable keys are relayed as `type` and
 * Enter/Tab/Backspace/Escape/arrows as `key`.
 */
(function () {
  'use strict';

  const SPECIAL = new Set(['Enter', 'Tab', 'Backspace', 'Escape', 'ArrowUp', 'ArrowDown',
    'ArrowLeft', 'ArrowRight', 'Delete', 'Home', 'End']);

  function create(opts) {
    const o = opts || {};
    const host = o.container;
    if (!host) throw new Error('AppUIScreencastViewer: container required');
    const interval = Math.max(200, Number(o.intervalMs) || 700);
    const readOnly = !!o.readOnly;

    const wrap = document.createElement('div');
    wrap.className = 'appui-screencast';
    wrap.tabIndex = 0;
    wrap.setAttribute('role', 'application');
    wrap.setAttribute('aria-label', 'Live browser mirror' + (readOnly ? ' (view only)' : ''));
    wrap.style.cssText = 'display:flex;flex-direction:column;gap:6px;outline:none;min-height:120px';
    const bar = document.createElement('div');
    bar.className = 'appui-screencast-bar';
    bar.style.cssText = 'font-size:12px;opacity:.8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
    bar.textContent = 'connecting…';
    const img = document.createElement('img');
    img.alt = 'live browser frame';
    img.style.cssText = 'max-width:100%;border:1px solid var(--border,#8884);border-radius:4px;'
      + (readOnly ? '' : 'cursor:crosshair;');
    wrap.append(bar, img);
    host.appendChild(wrap);

    let timer = null;
    let stopped = false;
    let inflight = false;
    let frames = 0;
    let etag = '';
    let idle = 0;
    let period = interval;

    function setBar(text) { bar.textContent = text; bar.title = text; }

    async function tick() {
      if (stopped) return;
      if (!wrap.isConnected) { stop(); return; }
      if (inflight) return;
      inflight = true;
      try {
        // NEXT2 #64: send the etag of the frame on screen; an unchanged frame
        // comes back as {unchanged:true} (no image bytes) and, while the page
        // sits idle, the poll backs off (x2 per 5 unchanged, max 4x) — any
        // input or a changed frame snaps back to the base interval.
        const r = await o.shot(etag);
        if (stopped) return;
        if (r && r.unchanged) {
          idle += 1;
          if (idle % 5 === 0 && period < interval * 4) setPeriod(Math.min(interval * 4, period * 2));
        } else if (r && r.img) {
          img.src = 'data:image/jpeg;base64,' + r.img;
          etag = r.etag || '';
          frames += 1;
          idle = 0;
          if (period !== interval) setPeriod(interval);
          setBar((r.url || '') + (r.needs_headful ? '  ·  needs a visible window' : ''));
        } else if (r && (r.error || r._error)) {
          setBar('no frame: ' + (r.error || r._error));
        }
      } catch (e) {
        setBar('no frame: ' + ((e && e.message) || e));
      } finally {
        inflight = false;
      }
    }

    function setPeriod(ms) {
      period = ms;
      if (timer) { clearInterval(timer); timer = setInterval(tick, period); }
    }

    function relay(ev) {
      if (readOnly || typeof o.input !== 'function') return;
      idle = 0;
      if (period !== interval) setPeriod(interval);
      Promise.resolve(o.input(ev)).then(() => tick()).catch(() => {});
    }

    if (!readOnly) {
      img.addEventListener('click', (e) => {
        const rect = img.getBoundingClientRect();
        if (!rect.width || !img.naturalWidth) return;
        const x = Math.round((e.clientX - rect.left) * img.naturalWidth / rect.width);
        const y = Math.round((e.clientY - rect.top) * img.naturalHeight / rect.height);
        wrap.focus();
        relay({kind: 'click', x, y});
      });
      wrap.addEventListener('keydown', (e) => {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        if (SPECIAL.has(e.key)) { e.preventDefault(); relay({kind: 'key', key: e.key}); }
        else if (e.key && e.key.length === 1) { e.preventDefault(); relay({kind: 'type', text: e.key}); }
      });
    }

    function stop() {
      if (stopped) return;
      stopped = true;
      if (timer) { clearInterval(timer); timer = null; }
      if (typeof o.onStop === 'function') { try { o.onStop(); } catch (_e) { /* best-effort */ } }
    }

    tick();
    timer = setInterval(tick, interval);
    return {stop, element: wrap, frames: () => frames};
  }

  window.AppUIScreencastViewer = {create};
})();
