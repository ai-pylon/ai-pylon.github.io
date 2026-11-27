// Page/session screenshot caching with shared in-flight request coalescing.
(function (global) {
  "use strict";
  function create(deps) {
    var api = deps.api, shotCache = {};
    // Only pending requests are shared: later bulk loads may include new shots.
    var pendingShots = deps.asyncCache.create(), pendingRuns = deps.asyncCache.create();
  function shotURL(runId, index) {
    var key = runId + "#" + index;
    if (shotCache[key]) return Promise.resolve(shotCache[key]);
    // persist across case/run switches within the tab session (perf #27): run
    // screenshots are immutable, so a session cache avoids re-fetching the same
    // base64 image when re-viewing a case/run. Falls back to in-memory + network.
    var sess = deps.getSession();
    var skey = "pa-shot:" + key;
    if (sess) {
      var cached = sess.getCached(skey, 6 * 60 * 60 * 1000, null);
      if (cached) { shotCache[key] = cached; return Promise.resolve(cached); }
    }
    return pendingShots.get(key, function () {
      return api("shot", { run_id: runId, index: index }).then(function (s) {
        var url = s.ok ? ("data:" + s.mime + ";base64," + s.data_b64) : "";
        shotCache[key] = url;
        if (sess && url) { try { sess.setCached(skey, url); } catch (e) {} }
        return url;
      });
    });
  }

  // perf #19: fetch ALL of a run's screenshots in ONE op and seed the in-memory
  // + session caches, so the filmstrip renders from cache (no N per-image
  // round-trips / +33% base64 each). Returns a promise that resolves when seeded
  // (best-effort: a failure just falls back to per-shot shotURL()).
  function prefetchShots(runId) {
    var sess = deps.getSession();
    return pendingRuns.get(runId, function () {
      return api("shots", { run_id: runId }).then(function (r) {
        if (!r || !r.ok) return false;
        (r.shots || []).forEach(function (s) {
          var key = runId + "#" + s.i;
          var url = "data:" + (r.mime || "image/jpeg") + ";base64," + s.data_b64;
          shotCache[key] = url;
          if (sess) { try { sess.setCached("pa-shot:" + key, url); } catch (e) {} }
        });
        return true;
      }).catch(function () { return false; });
    });
  }

    return { shotURL: shotURL, prefetchShots: prefetchShots };
  }
  global.PageAutomationShots = { create: create };
})(window);
