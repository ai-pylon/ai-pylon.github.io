/* Memory budget and displayed-source-aware eviction for declarative bindings. */
window._AppUIDataBindBudget = (() => {
  function create({getSources,getDisplayed}) {
    const sizes=Object.create(null);
    let limit=10*1024*1024;
    function _estimateSize(name, data) {
      try {
        var size = JSON.stringify(data).length;
        sizes[name] = size;
      } catch(e) {
        sizes[name] = 0;
      }
    }

    function _getTotalCacheSize() {
      var total = 0;
      var keys = Object.keys(sizes);
      for (var i = 0; i < keys.length; i++) {
        total += sizes[keys[i]] || 0;
      }
      return total;
    }

    function _evictIfNeeded() {
      if (_getTotalCacheSize() <= limit) return;
      const sources = getSources();
      var displayed = getDisplayed();
      // Build eviction candidates: sources with data that aren't currently displayed
      var candidates = [];
      var names = Object.keys(sources);
      for (var i = 0; i < names.length; i++) {
        var n = names[i];
        var s = sources[n];
        if (s.data && !displayed[n]) {
          candidates.push({ name: n, fetchedAt: s.fetchedAt });
        }
      }
      // Sort oldest first
      candidates.sort(function(a, b) { return a.fetchedAt - b.fetchedAt; });
      // Evict until under limit
      for (var j = 0; j < candidates.length; j++) {
        if (_getTotalCacheSize() <= limit) break;
        var evictName = candidates[j].name;
        sources[evictName].data = null;
        sources[evictName].fetchedAt = 0;
        delete sizes[evictName];
      }
    }

    return {_estimateSize,_evictIfNeeded,forget:name=>{delete sizes[name];},
      get limit(){return limit;},set limit(value){limit=value;_evictIfNeeded();},
    };
  }
  return {create};
})();
