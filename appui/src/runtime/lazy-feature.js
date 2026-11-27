/** Deferred native modules with one initialized feature instance per caller. */
(function (global) {
  if (global.AppUILazyFeature) return;

  function create(options) {
    if (!options || typeof options.src !== 'string' || !options.src.trim()) {
      throw new TypeError('Lazy feature requires a module URL');
    }
    var initialize = options.initialize;
    if (initialize !== undefined && typeof initialize !== 'function') {
      throw new TypeError('Lazy feature initialize must be a function');
    }
    var url = new URL(options.src, document.baseURI).href;
    var pending;
    var nativeRetries = 0;

    function load() {
      if (!pending) {
        pending = Promise.resolve().then(function () {
          if (global.AppUIAssets && global.AppUIAssets.loadModule) {
            return global.AppUIAssets.loadModule(url);
          }
          var requestUrl = url;
          if (nativeRetries) {
            var retryUrl = new URL(url);
            retryUrl.searchParams.set('_appui_retry', nativeRetries);
            requestUrl = retryUrl.href;
          }
          return import(requestUrl).catch(function (error) {
            nativeRetries++;
            throw error;
          });
        }).then(function (module) {
          return initialize ? initialize(module) : module;
        }).catch(function (error) {
          // Network and initialization failures may be retried on the next action.
          pending = null;
          throw error;
        });
      }
      return pending;
    }

    function call(name, args) {
      return load().then(function (feature) {
        if (!feature || typeof feature[name] !== 'function') {
          throw new TypeError('Lazy feature has no method: ' + name);
        }
        return feature[name].apply(feature, args || []);
      });
    }

    function mount(name, host, options) {
      options = options || {};
      var destroyed = false, owned;
      function release(value) {
        if (typeof value === 'function') value();
        else if (value && typeof value.destroy === 'function') value.destroy();
      }
      host.textContent = options.loadingText || 'Loading…';
      var ready = load().then(function (feature) {
        if (destroyed) return;
        if (!feature || typeof feature[name] !== 'function') {
          throw new TypeError('Lazy feature has no method: ' + name);
        }
        return feature[name](host);
      }).then(function (cleanup) {
        if (destroyed) release(cleanup);
        else owned = cleanup;
      }).catch(function (error) {
        if (destroyed) return;
        if (options.onError) options.onError(error, host);
        else host.textContent = 'Unable to open this panel. Open it again to retry.';
      });
      return { ready: ready, destroy: function () {
        if (destroyed) return;
        destroyed = true;
        var cleanup = owned;
        owned = null;
        release(cleanup);
      } };
    }

    return { load: load, call: call, mount: mount };
  }

  window.AppUILazyFeature = { create: create };
})(window);
