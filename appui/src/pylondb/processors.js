/* pylon/appui/pylondb/processors.js — API client for Python processors.
 *
 * Bridges AppUIPylonTypes.actions() to the Python-side processor system.
 * Actions are fetched from pylondb.actions and executed via pylondb.run_action.
 *
 * The Python side (apps/pylondb/type_plugins.py + builtin_processors.py)
 * owns the actual processor logic. This JS file is a thin client.
 */
(function () {
  'use strict';

  var PT = window.AppUIPylonTypes;
  if (!PT) return;

  var _api = function (tool, params, options) {
    return fetch('/api/' + tool.replace(/\./g, '/'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params || {}),
      ...(options?.signal?{signal:options.signal}:{}),
    }).then(function (r) { return r.json(); });
  };

  // Cache fetched actions per (db, node_id) to avoid re-fetching
  var _actionsCache = {};
  var _CACHE_TTL = 30000; // 30s

  /**
   * Fetch available actions for a node from the Python processor registry.
   * Returns a promise resolving to [{name, label, icon, description, type}].
   */
  function fetchActions(db, nodeId, options) {
    var key = db + ':' + nodeId;
    var cached = _actionsCache[key];
    if (cached && Date.now() - cached.time < _CACHE_TTL) {
      return Promise.resolve(cached.actions);
    }
    return _api('pylondb.actions', { db: db, node_id: nodeId },options).then(function (data) {
      if(options?.signal?.aborted)return [];
      var result = data.result || data;
      var actions = result.actions || [];
      _actionsCache[key] = { actions: actions, time: Date.now() };
      return actions;
    }).catch(function () { return []; });
  }

  /**
   * Run an action on a node via the Python processor.
   * Returns a promise resolving to the action result.
   */
  function runAction(db, nodeId, actionName, params) {
    return _api('pylondb.run_action', {
      db: db,
      node_id: nodeId,
      action: actionName,
      params: params || {},
    }).then(function (data) {
      return data.result || data;
    });
  }

  const history=window._AppUIPylonProcessorHistory.create(PT);
  const results=window._AppUIPylonProcessorResults.create(PT);
  const menu=window._AppUIPylonProcessorMenu.create({PT,fetchActions,runAction,history,results});

  // Expose for direct use by pages
  window.AppUIPylonProcessors = {
    fetchActions: fetchActions,
    runAction: runAction,
    renderActionMenu: menu.render,
  };

})();
