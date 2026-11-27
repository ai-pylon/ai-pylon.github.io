/* Optional IndexedDB persistence for DataBind; errors remain non-blocking. */
window._AppUIDataBindCache=(function(){
  function create(){
    // ── IndexedDB persistence ──
    var _idb = null;           // IndexedDB database instance
    var _idbReady = null;      // Promise that resolves when IDB is open
    var _IDB_STORE = 'databind-cache';
    var _IDB_NAME = 'databind';
    var _IDB_VERSION = 1;

    // ── IndexedDB helpers (non-blocking, silent on failure) ──

    function _initIDB() {
      if (_idbReady) return _idbReady;
      _idbReady = new Promise(function(resolve) {
        try {
          var req = indexedDB.open(_IDB_NAME, _IDB_VERSION);
          req.onupgradeneeded = function(e) {
            var db = e.target.result;
            if (!db.objectStoreNames.contains(_IDB_STORE)) {
              db.createObjectStore(_IDB_STORE);
            }
          };
          req.onsuccess = function(e) { _idb = e.target.result; resolve(_idb); };
          req.onerror = function() { resolve(null); };
        } catch(e) { resolve(null); }
      });
      return _idbReady;
    }

    function _idbGet(key) {
      return _initIDB().then(function(db) {
        if (!db) return null;
        return new Promise(function(resolve) {
          try {
            var tx = db.transaction(_IDB_STORE, 'readonly');
            var store = tx.objectStore(_IDB_STORE);
            var req = store.get(key);
            req.onsuccess = function() { resolve(req.result || null); };
            req.onerror = function() { resolve(null); };
          } catch(e) { resolve(null); }
        });
      });
    }

    function _idbPut(key, value) {
      return _initIDB().then(function(db) {
        if (!db) return;
        try {
          var tx = db.transaction(_IDB_STORE, 'readwrite');
          var store = tx.objectStore(_IDB_STORE);
          store.put(value, key);
        } catch(e) { /* silent */ }
      });
    }

    return {get:_idbGet,put:_idbPut};
  }
  return {create};
})();
