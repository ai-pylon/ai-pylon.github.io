/**
 * AppUIDataBind — declarative async data binding for AppUI pages.
 *
 * Elements declare what data they need via attributes. AppUIDataBind fetches,
 * caches, and distributes data. Elements show animated skeleton placeholders
 * until data arrives.
 *
 * HTML:
 *   <span data-bind="usage_history.rate_per_hour">Loading...</span>
 *   <span data-bind="usage_history.entries.length" data-format="number">--</span>
 *   <div data-bind="usage_history.by_model" data-render="table">Loading...</div>
 *
 * Attributes:
 *   data-bind="source.key.path"    — source name + dot-path into result
 *   data-format="number|size|date|credits|percent|json"  — optional formatter
 *   data-render="table|list|raw"   — for complex objects, render mode
 *   data-transform="fn_name"       — custom transform function name (on window)
 *   data-default="--"              — shown when value is null/undefined
 *   data-loading="Loading..."      — shown while fetching (default: element's initial content)
 *   data-error-class="text-error"  — class added on fetch error
 *
 * JS:
 *   // Register a data source (lazy — only fetched when elements need it)
 *   AppUIDataBind.source('usage_history', {
 *     fetch: function(params) { return callTool('usage_history', params); },
 *     params: { last: 60 },        // default params
 *     ttl: 30000,                   // cache for 30s
 *     staleWhileRevalidate: true,   // serve cached data immediately, refresh in background
 *     retries: 3,                   // retry failed fetches (default: 3)
 *     retryDelay: 1000,             // base retry delay in ms (default: 1000, exponential backoff)
 *     eventBus: { bus: myBus, channel: 'sessions', event: 'created' },
 *     batchKey: 'dashboard',        // batch with other sources sharing same key
 *     toolName: 'usage.history',    // tool name for batch /run call
 *   });
 *
 *   // Manually push data (from AppUIEventBus, WebSocket, etc.)
 *   AppUIDataBind.push('sessions', { sessions: [...], total: 500 });
 *
 *   // Refresh a source (re-fetch and re-distribute)
 *   AppUIDataBind.refresh('usage_history');
 *   AppUIDataBind.refresh('usage_history', { last: 1440 }); // with new params
 *
 *   // Scan DOM for new elements (after dynamic HTML insertion)
 *   AppUIDataBind.scan();
 *   AppUIDataBind.scan(containerEl);  // scan within a container
 *
 *   // Listen for data events
 *   AppUIDataBind.on('usage_history', function(data) { renderChart(data); });
 *
 *   // Integration with AppUIEventBus
 *   AppUIDataBind.connectEventBus(bus, {
 *     'sessions': 'sessions.created',  // source ← channel.event
 *   });
 */
var AppUIDataBind = (function() {
  'use strict';

  var _sources = Object.create(null);      // name → { fetch, params, ttl, data, fetchedAt, promise, error }

  const {get:_idbGet,put:_idbPut}=window._AppUIDataBindCache.create();


  const dom=window._AppUIDataBindDOM.create({sourceFor:name=>_sources[name],fetchIfNeeded:_fetchIfNeeded});
  const {scan,distribute:_distribute,displayedSources:_getDisplayedSources}=dom;

  const events=window._AppUIDataBindEvents.create({sourceFor:name=>_sources[name],refresh});
  const {on,off,onError,offError,notify:_notify,notifyError:_notifyError,connectEventBus}=events;
  const batch=window._AppUIDataBindBatch.create({sourceFor:name=>_sources[name],fetchSource:_fetchSource,push});
  const budget=window._AppUIDataBindBudget.create({getSources:()=>_sources,getDisplayed:_getDisplayedSources});
  const {_estimateSize,_evictIfNeeded}=budget;
  const fetcher=window._AppUIDataBindFetch.create({sourceFor:name=>_sources[name],dom,
    distribute:_distribute,notify:_notify,notifyError:_notifyError,budget,persist:_idbPut});
  const {source,prefetch}=window._AppUIDataBindSources.create({
    _sources,refresh,push,_idbGet,_fetchIfNeeded,_fetchSource,budget,
  });

  // ── Push data directly (from AppUIEventBus, etc.) ──

  function push(name, data) {
    if (!_sources[name]) {
      _sources[name] = { fetch: null, params: {}, ttl: 0, staleWhileRevalidate: false, retries: 3, retryDelay: 1000, _retryCount: 0, _retryTimer: null, data: null, fetchedAt: 0, promise: null, error: null, batchKey: null, toolName: null, persist: false };
    }
    _sources[name].data = data;
    _sources[name].fetchedAt = Date.now();
    _sources[name].error = null;
    _sources[name]._retryCount = 0;
    _estimateSize(name, data);
    _evictIfNeeded();
    _distribute(name, data);
    _notify(name, data);
  }

  // ── Refresh ──

  function refresh(name, params) {
    var src = _sources[name];
    if (!src) return Promise.resolve(null);
    if (params) src.params = params;
    src.fetchedAt = 0; // force re-fetch
    src.promise = null;
    src._retryCount = 0;
    if (src._retryTimer != null) { clearTimeout(src._retryTimer); src._retryTimer = null; }
    return _fetchSource(name);
  }

  // ── Refresh all ──

  function refreshAll() {
    Object.keys(_sources).forEach(function(name) { refresh(name); });
  }

  // ── Listeners ──

  function _fetchIfNeeded(name) {
    var src = _sources[name];
    if (!src || !src.fetch) return;
    if (src.promise) return; // already fetching
    if (src.ttl && src.data != null && (Date.now() - src.fetchedAt) < src.ttl) return; // cached

    // Batch fetch: queue sources with batchKey
    if (src.batchKey && src.toolName) {
      batch.enqueue(name,src);
      return;
    }

    _fetchSource(name);
  }

  // ── Batch scheduling ──

  function _fetchSource(name) {return fetcher.fetch(name);}

  // ── Prefetch API ──

  var _public = {
    source: source,
    push: push,
    refresh: refresh,
    refreshAll: refreshAll,
    scan: scan,
    on: on,
    off: off,
    onError: onError,
    offError: offError,
    connectEventBus: connectEventBus,
    prefetch: prefetch,
  };

  // maxCacheSize as a configurable property (default 10MB)
  Object.defineProperty(_public, 'maxCacheSize', {
    get: function() { return budget.limit; },
    set: function(v) { budget.limit = v; },
    enumerable: true,
    configurable: false
  });

  return _public;
})();
