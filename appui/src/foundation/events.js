/* Page-local event service. */
var AppUIEvents = window.AppUIEvents || (function() {
  function create() {
    let destroyed = false;
    const listeners = new Map();
    const disposers = [];

    function on(type, listener) {
      if (destroyed || typeof listener !== 'function') return () => {};
      const group = listeners.get(type) || new Set();
      group.add(listener);
      listeners.set(type, group);
      return () => off(type, listener);
    }

    function once(type, listener) {
      let unsubscribe = () => {};
      unsubscribe = on(type, detail => {
        unsubscribe();
        listener(detail);
      });
      return unsubscribe;
    }

    function off(type, listener) {
      const group = listeners.get(type);
      if (!group) return;
      group.delete(listener);
      if (!group.size) listeners.delete(type);
    }

    function emit(type, detail) {
      if (destroyed) return false;
      (listeners.get(type) || []).forEach(listener => listener(detail));
      (listeners.get('*') || []).forEach(listener => listener({type, detail}));
      return true;
    }

    function subscribeSSE(type, listener) {
      // Legacy SSE method removed — pages should use AppUIEventBus directly:
      //   const bus = new AppUIEventBus(['tools']);
      //   bus.on('tools', eventType, handler);
      console.warn('AppUIEvents.subscribeSSE is deprecated — use AppUIEventBus instead');
      return () => {};
    }

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      listeners.clear();
      disposers.splice(0).reverse().forEach(dispose => dispose());
    }

    return {on, once, off, emit, subscribeSSE, destroy, get destroyed() { return destroyed; }};
  }

  // Adapt an injected shared EventBus without coupling foundation to its bundle.
  function createConnected({channels,replay=0},Bus) {
    const bus=new Bus(channels,{replay});
    let destroyed=false;
    function onChannel(channel,event,listener) {
      if(destroyed || typeof listener!=='function')return()=>{};
      let subscribed=true;
      const handler=(...args)=>{if(!destroyed && subscribed)listener(...args);};
      bus.on(channel,event,handler);
      return()=>{if(!subscribed)return;subscribed=false;bus.off(channel,event,handler);};
    }
    function on(type,listener) {
      const parts=type.split(':');
      return onChannel(parts[0]||'*',parts[1]||'*',listener);
    }
    function onAny(listener) {
      if(destroyed || typeof listener!=='function')return()=>{};
      let subscribed=true;
      const handler=(...args)=>{if(!destroyed && subscribed)listener(...args);};
      bus.onAny(handler);
      return()=>{if(!subscribed)return;subscribed=false;bus.offAny?.(handler);};
    }
    return {on,onChannel,onAny,
      emit(type,detail) {
        if(destroyed)return false;
        const parts=type.split(':');
        return Bus.publish(parts[0]||type,parts[1]||type,detail);
      },
      get bus(){return bus;},get destroyed(){return destroyed;},
      destroy(){if(destroyed)return;destroyed=true;bus.close();},
    };
  }

  return {create,createConnected};
})();
window.AppUIEvents = AppUIEvents;
