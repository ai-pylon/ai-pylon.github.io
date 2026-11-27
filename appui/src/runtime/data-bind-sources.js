/* DataBind source registration, persisted restoration and queued prefetch parameters. */
(function() {
  'use strict';
  window._AppUIDataBindSources = {
    create({_sources,refresh,push,_idbGet,_fetchIfNeeded,_fetchSource,budget}) {
      var _eventBusHandlers = [], _prefetchQueue = Object.create(null);
      function source(name, config) {
        _sources[name]?._dispose?.();
        if (_sources[name]?._retryTimer != null) clearTimeout(_sources[name]._retryTimer);
        _sources[name] = {
          fetch: config.fetch,
          params: config.params || {},
          ttl: config.ttl || 0,
          staleWhileRevalidate: config.staleWhileRevalidate || false,
          retries: typeof config.retries === 'number' ? config.retries : 3,
          retryDelay: config.retryDelay || 1000,
          _retryCount: 0,
          _retryTimer: null,
          data: null,
          fetchedAt: 0,
          promise: null,
          error: null,
          batchKey: config.batchKey || null,
          toolName: config.toolName || null,
          persist: config.persist || false,
        };

        // SSE Integration: auto-subscribe to AppUIEventBus if configured
        var eventBinding;
        if (config.eventBus) {
          var eb = config.eventBus;
          var handler = function() { refresh(name); };
          eb.bus.on(eb.channel, eb.event || null, handler);
          eventBinding = { bus: eb.bus, channel: eb.channel, event: eb.event || null, handler: handler };
          _eventBusHandlers.push(eventBinding);
        }

        // IndexedDB persistence: try to load cached data before fetching
        var registered = _sources[name];
        if (config.persist) {
          _idbGet(name).then(function(cached) {
            if (_sources[name] === registered && cached && cached.data != null) {
              var age = Date.now() - (cached.fetchedAt || 0);
              var ttl = cached.ttl || config.ttl || 0;
              if (ttl === 0 || age < ttl) {
                // Only use cached data if source hasn't been populated yet
                if (_sources[name].data == null) {
                  push(name, cached.data);
                }
              }
            }
          });
        }

        // If this source was prefetched, data is already available — skip fetch
        if (_prefetchQueue[name]) {
          var prefetchParams = _prefetchQueue[name];
          delete _prefetchQueue[name];
          // Merge prefetch params if source was registered without explicit params
          if (prefetchParams !== true && typeof prefetchParams === 'object') {
            var pKeys = Object.keys(prefetchParams);
            for (var i = 0; i < pKeys.length; i++) {
              if (!config.params || !(pKeys[i] in config.params)) {
                _sources[name].params[pKeys[i]] = prefetchParams[pKeys[i]];
              }
            }
          }
        }

        // If elements already waiting for this source, fetch now
        _fetchIfNeeded(name);
        var disposed = false;
        registered._dispose = function() {
          if (disposed) return; disposed = true;
          registered._request = null;
          if (registered._retryTimer != null) {clearTimeout(registered._retryTimer); registered._retryTimer = null;}
          if (eventBinding) {
            eventBinding.bus.off?.(eventBinding.channel, eventBinding.event, eventBinding.handler);
            _eventBusHandlers = _eventBusHandlers.filter(function(binding) {return binding !== eventBinding;});
          }
          if (_sources[name] === registered) {delete _sources[name]; budget.forget(name);}
        };
        return registered._dispose;
      }

      function prefetch(name, params) {
        var src = _sources[name];
        if (src) {
          // Source already registered — force a fetch (like refresh but without requiring elements)
          if (params) src.params = params;
          src.fetchedAt = 0;
          src.promise = null;
          src._retryCount = 0;
          if (src._retryTimer != null) { clearTimeout(src._retryTimer); src._retryTimer = null; }
          return _fetchSource(name);
        }
        // Source not yet registered — store in prefetch queue
        _prefetchQueue[name] = params || true;
        return Promise.resolve(null);
      }
      return {source,prefetch};
    },
  };
})();
