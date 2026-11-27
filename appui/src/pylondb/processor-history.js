/* Shared five-entry processor action history. */
window._AppUIPylonProcessorHistory = (() => {
  function create(PT) {
    var _actionHistory=[],_ACTION_HISTORY_MAX=5;
    function _pushHistory(action, nodeId, result) {
      _actionHistory.push({
        action: action,
        nodeId: nodeId,
        time: new Date().toLocaleTimeString(),
        result: result
      });
      if (_actionHistory.length > _ACTION_HISTORY_MAX) {
        _actionHistory.shift();
      }
    }

    /**
     * Build the HTML for the history toggle panel.
     */
    function _buildHistoryHtml() {
      if (!_actionHistory.length) return '<div style="font-size:10px;color:#555">No history yet</div>';
      var html = '';
      for (var i = _actionHistory.length - 1; i >= 0; i--) {
        var h = _actionHistory[i];
        var summary = h.action + ' (node ' + h.nodeId + ') @ ' + h.time;
        var body = '';
        if (h.result && h.result.error) {
          body = '<span style="color:#ff5370">' + PT.util.esc(h.result.error) + '</span>';
        } else {
          var data = (h.result && h.result.result) ? h.result.result : h.result;
          body = '<code style="font-size:9px">' + PT.util.esc(JSON.stringify(data || {}).substring(0, 150)) + '</code>';
        }
        html += '<div style="padding:2px 0;border-bottom:1px solid var(--border,#333)">'
          + '<div style="color:#888;font-size:10px">' + PT.util.esc(summary) + '</div>'
          + '<div style="font-size:10px;margin-top:1px">' + body + '</div>'
          + '</div>';
      }
      return html;
    }

    return {push:_pushHistory,html:_buildHistoryHtml};
  }
  return {create};
})();
