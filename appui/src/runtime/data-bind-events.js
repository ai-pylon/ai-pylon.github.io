/* DataBind subscribers and disposable EventBus refresh connections. */
window._AppUIDataBindEvents = (() => {
  function create({sourceFor,refresh}) {
    const _listeners=Object.create(null),_errorCallbacks=Object.create(null);
    function on(name, callback) {
      if (!_listeners[name]) _listeners[name] = [];
      _listeners[name].push(callback);
      var src = sourceFor(name);
      if (src && src.data != null) callback(src.data);
      return function() {off(name, callback);};
    }

    function off(name, callback) {
      if (!_listeners[name]) return;
      _listeners[name] = _listeners[name].filter(function(cb) { return cb !== callback; });
    }


    function onError(name, callback) {
      if (!_errorCallbacks[name]) _errorCallbacks[name] = [];
      _errorCallbacks[name].push(callback);
      return () => offError(name,callback);
    }

    function offError(name, callback) {
      if (!_errorCallbacks[name]) return;
      _errorCallbacks[name] = _errorCallbacks[name].filter(function(cb) { return cb !== callback; });
    }

    function notifyError(name, error, retryCount, willRetry) {
      var cbs = _errorCallbacks[name] || [];
      var info = { source: name, error: error, retryCount: retryCount, willRetry: willRetry };
      cbs.forEach(function(cb) { try { cb(info); } catch(e) {} });
    }

    function notify(name, data) {
      var cbs = _listeners[name] || [];
      cbs.forEach(function(cb) { try { cb(data); } catch(e) {} });
    }


    function connectEventBus(bus, mapping) {
      const bindings=[];
      let disposed=false;
      Object.keys(mapping).forEach(function(sourceName) {
        var config = mapping[sourceName];
        var channel, event, transform;
        if (typeof config === 'string') {
          var parts = config.split('.');
          channel = parts[0];
          event = parts.slice(1).join('.');
        } else {
          channel = config.channel;
          event = config.event;
          transform = config.transform;
        }
        const handler=function(data) {
          if(disposed)return;
          if (transform) data = transform(data);
          refresh(sourceName);
        };
        bus.on(channel,event,handler);
        bindings.push({channel,event,handler});
      });
      return () => {
        if(disposed)return;disposed=true;
        bindings.forEach(({channel,event,handler})=>bus.off?.(channel,event,handler));
      };
    }


    return {on,off,onError,offError,notify,notifyError,connectEventBus};
  }
  return {create};
})();
