/**
 * Event Log — shared live status log for any AppUI page.
 * 
 * Usage:
 *   const log = new AppUIEventLog({maxEntries: 100});
 *   log.add('Something happened');
 *   log.add('Error occurred', 'error');
 *   // Auto-shows in statusbar, click to open dialog
 *   // Or bind to AppUIEventBus:
 *   log.bindEvents(bus, 'migration', (data) => data.event + ': ' + data.data?.file);
 */
(function() {
  'use strict';

  function AppUIEventLog(opts) {
    opts = opts || {};
    this._entries = [];
    this._max = opts.maxEntries || 200;
    this._statusEl = null;
    this._dialogEl = null;

    // Auto-bind to statusbar — but only open on clicks to the bar's OWN empty
    // area, NOT on interactive controls inside it (buttons/links/inputs). The
    // previous unconditional bar-wide listener hijacked every status-bar button
    // click (e.g. sidebar/view-mode toggles) and popped this dialog instead.
    var self = this;
    setTimeout(function() {
      self._statusEl = document.querySelector('.ai-app-status');
      if (self._statusEl) {
        self._statusEl.addEventListener('click', function(ev) {
          // Ignore clicks that landed on (or inside) an interactive control.
          if (ev.target && ev.target.closest &&
              ev.target.closest('button,a,input,select,textarea,[role="button"],label')) return;
          self.showDialog();
        });
      }
    }, 500);
  }

  AppUIEventLog.prototype.add = function(msg, level) {
    var entry = {
      time: new Date().toLocaleTimeString(),
      msg: msg,
      level: level || 'info'
    };
    this._entries.push(entry);
    if (this._entries.length > this._max) this._entries.shift();

    // Update statusbar
    if (this._statusEl) this._statusEl.textContent = msg;

    // Update dialog if open
    this._updateDialog();
  };

  AppUIEventLog.prototype.clear = function() {
    this._entries = [];
    this._updateDialog();
  };

  AppUIEventLog.prototype.getEntries = function() {
    return this._entries.slice();
  };

  AppUIEventLog.prototype.showDialog = function() {
    if (typeof AppUIDialog === 'undefined') return;
    var body = '<div id="eventlog-dialog" style="max-height:400px;overflow-y:auto;font-family:monospace;font-size:11px;line-height:1.8"></div>';
    AppUIDialog.show({title: 'Event Log', body: body, width: '600px'});
    this._updateDialog();
  };

  AppUIEventLog.prototype._updateDialog = function() {
    var el = document.getElementById('eventlog-dialog');
    if (!el) return;
    var colors = {info: 'inherit', error: 'var(--color-error)', warn: 'var(--color-warning)'};
    el.innerHTML = this._entries.map(function(e) {
      var c = colors[e.level] || 'inherit';
      return '<div style="color:' + c + '"><span style="color:var(--text-muted);margin-right:8px">' + e.time + '</span>' + e.msg.replace(/</g, '&lt;') + '</div>';
    }).join('');
    el.scrollTop = el.scrollHeight;
  };

  AppUIEventLog.prototype.bindEvents = function(eventSource, channel, formatter) {
    var self = this;
    if (!eventSource) return;
    eventSource.onmessage = function(e) {
      try {
        var d = JSON.parse(e.data);
        if (d.channel && d.channel !== channel) return;
        var msg = formatter ? formatter(d) : (d.event + ': ' + JSON.stringify(d.data).substring(0, 80));
        if (msg) self.add(msg, d.event === 'error' ? 'error' : 'info');
      } catch(ex) {}
    };
  };

  // Export
  window.AppUIEventLog = AppUIEventLog;

  // Auto-init: create a default instance for any page with events. Opt-OUT via
  // window.APPUI_NO_EVENT_LOG (a page that owns its status bar doesn't want a
  // default status-bar event-log overlay).
  setTimeout(function() {
    if (window.APPUI_NO_EVENT_LOG) return;
    if (!window.AppUIEventLogDefault) {
      window.AppUIEventLogDefault = new AppUIEventLog();
      window.AppUIEventLogDefault.add('Event log ready');
    }
  }, 1000);
})();
