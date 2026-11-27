/**
 * PylonDB client — shared query helper for PylonDB-backed pages.
 * @module pylondb-client
 */
var AppUIPylonDBClient = (function() {
  'use strict';
  
  function create(dbPath) {
    function query(sql, params, opts) {
      opts = opts || {};
      return fetch('/api/pylondb/file_query', {
        method: 'POST',
        signal: opts.signal,
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ db_path: dbPath, sql: sql, params: params || [], limit: opts.limit || 5000 })
      }).then(function(r) { return r.json(); })
        .then(function(d) { return d.rows || []; })
        .catch(function() { return []; });
    }
    
    function tables() {
      return query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
    }
    
    function schema(tableName) {
      return query('PRAGMA table_info(' + tableName + ')');
    }
    
    function count(tableName) {
      return query('SELECT count(*) as cnt FROM ' + tableName).then(function(r) { return r.length ? r[0].cnt : 0; });
    }
    
    function setDbPath(p) { dbPath = p; }
    function getDbPath() { return dbPath; }
    
    return { query: query, tables: tables, schema: schema, count: count, setDbPath: setDbPath, getDbPath: getDbPath };
  }
  
  return { create: create };
})();

if (typeof window !== 'undefined') window.AppUIPylonDBClient = AppUIPylonDBClient;
