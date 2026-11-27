/* Coalesced source requests and ownership checks for DataBind batch transport. */
window._AppUIDataBindBatch = (() => {
  function create({sourceFor,fetchSource,push}) {
    const _batchQueue=Object.create(null),_batchScheduled=Object.create(null);
    function enqueue(name,src) {
      if (!_batchQueue[src.batchKey]) _batchQueue[src.batchKey] = [];
      // Avoid duplicates in the queue
      var queued = _batchQueue[src.batchKey].find(function(item) { return item.name === name; });
      if (!queued || queued.source !== src) {
        if (queued) _batchQueue[src.batchKey].splice(_batchQueue[src.batchKey].indexOf(queued), 1);
        var ticket = {}; src._request = ticket;
        _batchQueue[src.batchKey].push({ name: name, toolName: src.toolName, params: src.params, source: src, ticket: ticket });
      }
      _scheduleBatch(src.batchKey);
    }
    function _scheduleBatch(batchKey) {
      if (_batchScheduled[batchKey]) return;
      _batchScheduled[batchKey] = true;
      Promise.resolve().then(function() {
        _batchScheduled[batchKey] = false;
        var items = (_batchQueue[batchKey] || []).filter(function(item) { return sourceFor(item.name) === item.source && item.source._request === item.ticket; });
        _batchQueue[batchKey] = [];
        if (items.length === 0) return;
        if (items.length === 1) { fetchSource(items[0].name); return; }
        // Batch fetch via /run
        var tools = items.map(function(item) { return { name: item.toolName, params: item.params }; });
        fetch('/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tools: tools, parallel: true })
        }).then(function(r) { return r.json(); })
          .then(function(data) {
            var results = data.results || [];
            items.forEach(function(item, i) {
              if (sourceFor(item.name) === item.source && item.source._request === item.ticket && results[i] != null) push(item.name, results[i]);
            });
          }).catch(function(err) {
            // Fallback: fetch each source individually
            items.forEach(function(item) { if (sourceFor(item.name) === item.source && item.source._request === item.ticket) fetchSource(item.name); });
          });
      });
    }

    return {enqueue};
  }
  return {create};
})();
