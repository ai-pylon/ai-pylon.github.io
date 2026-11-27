/* AppUI API Inspector — tracks /api/* tool calls with timing and frequency analysis.
 *
 * Activated via View > API Inspector menu toggle.
 * Shows a floating panel with:
 *   - Live call log (URL, method, duration, response size)
 *   - Frequency summary (calls per endpoint, avg latency)
 *   - Warnings for duplicate/rapid calls
 */
const AppUIApiInspector = (function() {
  'use strict';

  let _enabled = false;
  let _panel = null;
  let _controls=null;
  let _activeTab='network';
  let _networkReport,_eventReport,_componentReport;
  let _log = [];       // [{url, method, startMs, durationMs, size, status, caller}]
  const network = window._AppUIApiInspectorNetwork.create({onEntry:_addEntry,onUpdate:_renderLog});
  const MAX_LOG = 200;

  let _eventBusHook = null;

  function _hookEventBus() {
    // Hook into the page's AppUIEventBus (if available) to show events in the inspector
    if (_eventBusHook) return;
    // Find the AppUIEventBus instance via the AppUI events interface or global
    const buses = [];
    // Check for AppUI-managed AppUIEventBus
    if (window._appInstance && window._appInstance.events && window._appInstance.events.bus) {
      buses.push(window._appInstance.events.bus);
    }
    // Check for any AppUIEventBus on the page
    if (typeof AppUIEventBus !== 'undefined') {
      // Create a monitoring-only bus that subscribes to all channels
      const monitorBus = new AppUIEventBus(['*']);
      monitorBus.onAny((channel, event, data, ts) => {
        if (!_enabled) return;
        _addEntry({
          url: `[event] ${channel}:${event}`,
          fullUrl: `eventbus://${channel}/${event}`,
          method: 'EVT',
          startMs: ts ? ts * 1000 : Date.now(),
          durationMs: 0,
          size: data ? JSON.stringify(data).length : 0,
          status: 200,
          caller: 'AppUIEventBus',
          isEvent: true,
        });
      });
      _eventBusHook = monitorBus;
    }
  }

  function _unhookEventBus() {
    if (_eventBusHook) {
      _eventBusHook.close();
      _eventBusHook = null;
    }
  }

  function enable() {
    if (_enabled) return;
    _enabled = true;
    _hookFetch();
    _hookEventBus();
    _showPanel();
  }

  function disable() {
    if (!_enabled) return;
    _enabled = false;
    _unhookFetch();
    _unhookEventBus();
    _hidePanel();
  }

  function toggle() {
    _enabled ? disable() : enable();
  }

  function isEnabled() { return _enabled; }

  function getLog() { return _log.slice(); }

  function clear() { _log = []; _renderLog(); }

  function _hookFetch() { network.enable(); }
  function _unhookFetch() { network.disable(); }

  function _addEntry(entry) {
    _log.push(entry);
    if (_log.length > MAX_LOG) _log.shift();
    _renderLog();
    _checkWarnings(entry);
  }

  // --- Warnings ---

  function _checkWarnings(entry) {
    // Duplicate rapid calls (same URL within 500ms)
    const recent = _log.filter(e => e.fullUrl === entry.fullUrl && entry.startMs - e.startMs < 500 && e !== entry);
    if (recent.length > 0) {
      entry.warning = `Rapid duplicate (${recent.length + 1}x in 500ms)`;
    }
    // Slow call
    if (entry.durationMs > 2000) {
      entry.warning = (entry.warning || '') + ` Slow: ${entry.durationMs}ms`;
    }
  }

  // --- Panel UI ---

  function _showPanel() {
    if (_panel) { _panel.style.display = ''; return; }
    _panel = window._AppUIApiInspectorControls.createPanel();

    document.body.appendChild(_panel);
    _activeTab='network';
    _controls=window._AppUIApiInspectorControls.create({
      container:_panel,getActive:()=>_activeTab,isCurrent:()=>_enabled,
      onSwitch:_switchTab,onClear:clear,onSummary:_showSummary,onClose:disable
    });
    _renderLog();
  }

  function _switchTab(tab) {
    if (!_panel) return;
    _activeTab=tab;_controls?.activate(tab);
    _panel.querySelectorAll('.api-insp-tab').forEach(function(t) {
      var isActive = t.dataset.tab === tab;
      t.classList.toggle('active', isActive);
      t.style.borderBottomColor = isActive ? 'var(--accent)' : 'transparent';
      t.style.color = isActive ? 'var(--text-primary)' : 'var(--text-muted)';
    });
    _panel.querySelectorAll('.api-insp-body').forEach(function(b) {
      b.style.display = b.dataset.panel === tab ? '' : 'none';
    });
    if (tab === 'events') _renderEvents();
    if (tab === 'components') _renderComponents();
  }

  function _renderEvents() {
    const body=_panel?.querySelector('[data-panel="events"]');if(!body)return;
    _eventReport ||= window._AppUIApiInspectorReports.create({container:body});
    return _eventReport.render(_log,'events');
  }

  function _renderComponents() {
    const body=_panel?.querySelector('[data-panel="components"]');if(!body)return;
    _componentReport ||= window._AppUIApiInspectorComponentTree.create({container:body});
    return _componentReport.render();
  }

  function _hidePanel() {
    if (_panel) { _panel.style.display = 'none'; }
  }

  function _renderLog() {
    const body=_panel?.querySelector('[data-panel="network"]');
    if(!body||body.style.display==='none')return;
    _networkReport ||= window._AppUIApiInspectorReports.create({container:body});
    return _networkReport.render(_log);
  }

  function _showSummary() {
    const body=_panel?.querySelector('[data-panel="network"]');if(!body)return;
    _networkReport ||= window._AppUIApiInspectorReports.create({container:body});
    return _networkReport.render(_log,'summary');
  }

  function destroy() {
    disable();
    _controls?.destroy();_controls=null;
    _networkReport?.destroy();_networkReport=null;
    _eventReport?.destroy();_eventReport=null;
    _componentReport?.destroy();_componentReport=null;
    if (_panel) { _panel.remove(); _panel = null; }
    _log = [];
  }

  return { enable, disable, toggle, isEnabled, getLog, clear, destroy };
})();
window.AppUIApiInspector = AppUIApiInspector;

// Auto-register toggle command (moved from adapter index.js)
if (window.AppUI?.registerCommand) {
  window.AppUI.registerCommand({
    id: 'view.api_inspector',
    run: () => AppUIApiInspector.toggle(),
  });
}
