/**
 * AppUIPollRefresh — visibility-aware polling for pages.
 * @module poll-refresh
 */
var AppUIPollRefresh = (function() {
  'use strict';
  
  function create(fetchFn, intervalMs, opts) {
    opts = opts || {};
    var timer = null;
    var paused = false;
    var visibilityBound = false;
    var inFlight = false;
    var controller = null;
    var active = false;
    var generation = 0;
    
    function tick(manual, session) {
      if ((!active && !manual) || session !== generation) return;
      if (opts.stopWhen && opts.stopWhen()) { stop(); return; }
      if (paused || inFlight) return;
      const request = new AbortController();
      controller = request;
      inFlight = true;
      const settle = () => {
        if (session !== generation || controller !== request) return;
        inFlight = false;
        controller = null;
      };
      try {
        Promise.resolve(fetchFn({signal: controller.signal})).catch(function() {}).finally(settle);
      } catch(e) { settle(); }
    }

    function onVisibilityChange() {
      if (!active) return;
      paused = document.hidden;
      if (!paused && opts.refreshOnVisible) tick(false, generation);
    }

    function start() {
      stop();
      active = true;
      const session = generation;
      timer = setInterval(() => tick(false, session), intervalMs);
      // Pause when tab hidden
      if (opts.pauseOnHidden !== false && !visibilityBound) {
        document.addEventListener('visibilitychange', onVisibilityChange);
        visibilityBound = true;
        paused = document.hidden;
      }
    }
    
    function stop() {
      active = false;
      generation++;
      if (timer !== null) { clearInterval(timer); timer = null; }
      if (controller) controller.abort();
      controller = null;
      inFlight = false;
      if (visibilityBound) document.removeEventListener('visibilitychange', onVisibilityChange);
      visibilityBound = false;
    }
    function refresh() { tick(true, generation); }
    function setInterval_(ms) { intervalMs = ms; if (timer !== null) { stop(); start(); } }
    
    return { start: start, stop: stop, destroy: stop, refresh: refresh, setInterval: setInterval_ };
  }
  
  function start(fetchFn, intervalMs, opts) {
    var poller = create(fetchFn, intervalMs, opts);
    poller.start();
    return poller;
  }

  return { create: create, start: start };
})();

if (typeof window !== 'undefined') window.AppUIPollRefresh = AppUIPollRefresh;
