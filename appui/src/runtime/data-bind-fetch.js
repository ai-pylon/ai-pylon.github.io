/* Private single-source fetch, retry and persistence pipeline for DataBind. */
window._AppUIDataBindFetch = {
  create({sourceFor,dom,distribute:_distribute,notify:_notify,notifyError:_notifyError,budget,persist:_idbPut}) {
    const {_estimateSize,_evictIfNeeded}=budget;
    function fetchSource(name) {
      var src = sourceFor(name);
      if (!src || !src.fetch) return Promise.resolve(null);
  
      // Request deduplication: if a fetch is already in flight, return existing promise
      if (src.promise) return src.promise;
  
      // staleWhileRevalidate: serve cached data immediately, then refresh in background
      if (src.staleWhileRevalidate && src.data != null) {
        _distribute(name, src.data);
      }
  
      dom.loading(name,src);
  
      var ticket = {}; src._request = ticket;
      var current = function() { return sourceFor(name) === src && src._request === ticket; };
      src.promise = Promise.resolve().then(function() {return current() ? src.fetch(src.params) : null;}).then(function(data) {
        if (!current()) return data;
        src.data = data;
        src.fetchedAt = Date.now();
        src.error = null;
        src.promise = null;
        src._retryCount = 0;
        if (src._retryTimer != null) { clearTimeout(src._retryTimer); src._retryTimer = null; }
        _estimateSize(name, data);
        _evictIfNeeded();
        // IndexedDB persistence
        if (src.persist) {
          _idbPut(name, { data: data, fetchedAt: src.fetchedAt, ttl: src.ttl });
        }
        _distribute(name, data);
        _notify(name, data);
        return data;
      }).catch(function(err) {
        if (!current()) return null;
        src.error = err;
        src.promise = null;
        // Retry with exponential backoff
        if (src._retryCount < src.retries) {
          var delay = src.retryDelay * Math.pow(2, src._retryCount);
          src._retryCount++;
          _notifyError(name, err, src._retryCount, true);
          dom.retrying(name);
          src._retryTimer = setTimeout(function() {
            if (!current()) return;
            src._retryTimer = null;
            fetchSource(name);
          }, delay);
        } else {
          // All retries exhausted
          _notifyError(name, err, src._retryCount, false);
          src._retryCount = 0;
          dom.error(name);
        }
        return null;
      });
  
      return src.promise;
    }
  
    return {fetch:fetchSource};
  }
};
