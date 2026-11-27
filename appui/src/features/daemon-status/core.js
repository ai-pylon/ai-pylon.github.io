/* AppUI service-status -- aggregate right-status-bar indicator for daemons and standalones.
 *
 * Uses AppUIEventBus 'daemons' channel for real-time state updates (no polling).
 * Falls back to a single /servers?fast=1 fetch on mount for initial state.
 */
const AppUIDaemonStatus = (function() {
  'use strict';

  function mount(container, options) {
    if (!container) throw new Error('AppUIDaemonStatus: container is required');
    const opts = Object.assign({icon: '\u25CF', label: '', pollInterval: 0}, options || {});
    const configured = opts.services || [opts.service, ...(opts.requires || [])];
    const services = configured.filter(Boolean).map(service => {
      if (typeof service === 'string') return {name: service};
      return Object.assign({}, service, {name: service.name || service.service});
    }).filter(service => service.name);
    if (!services.length) throw new Error('AppUIDaemonStatus: service or services is required');

    const button = document.createElement('button');
    button.type = 'button'; button.className = 'ai-app-daemon-status is-checking';
    button.textContent = opts.icon; container.appendChild(button);
    const owner = AppUILifecycle.createViewScope({host:container});
    const reads = AppUILifecycle.createKeyedScopes({parent:owner,pagehide:false});
    owner.add(reads);
    const labelFor = service => service.label || service.name.replace(/^(?:daemons|standalones)\//, '');
    let lastStatuses = services.map(service => ({name: service.name, label: labelFor(service), state: 'checking', checkedAt: null, data: null, error: '', url: ''}));

    function setState(state, message) {
      button.classList.remove('is-checking', 'is-online', 'is-offline');
      button.classList.add(`is-${state}`); button.title = message; button.setAttribute('aria-label', message);
    }

    function updateUI() {
      if (!owner.current()) return;
      const online = lastStatuses.filter(status => status.state === 'online').length;
      const state = online === services.length ? 'online' : (online > 0 ? 'online' : 'offline');
      const label = opts.label || (services.length === 1 ? lastStatuses[0].label : 'Service dependencies');
      setState(state, `${label}: ${online}/${services.length} connected \u2014 click for details`);
      updateRestartVisibility();
    }

    // Initial state: resolve ports then probe each service directly
    async function fetchInitialState() {
      if (!owner.current()) return;
      const read = reads.begin('refresh');
      setState('checking', `Checking ${services.length} service${services.length === 1 ? '' : 's'}\u2026`);
      try {
        // Get ports from the fast /ports endpoint
        const portsResp = await fetch('/ports', { signal: AbortSignal.any([read.signal,AbortSignal.timeout(3000)]) });
        const allPorts = await portsResp.json();
        if (!read.current()) return;

        // Probe each service directly via its port
        const statuses = await Promise.all(services.map(async (service) => {
          const label = labelFor(service);
          const port = allPorts[service.name];
          if (!port) return {name: service.name, label, state: 'offline', checkedAt: new Date(), data: null, error: 'No port', url: ''};
          const url = `http://127.0.0.1:${port}`;
          try {
            await fetch(`${url}/status`, { signal: AbortSignal.any([read.signal,AbortSignal.timeout(2000)]) });
            return {name: service.name, label, state: 'online', checkedAt: new Date(), data: {port}, error: '', url};
          } catch (_) {
            return {name: service.name, label, state: 'offline', checkedAt: new Date(), data: {port}, error: 'Not responding', url};
          }
        }));
        if (read.current()) lastStatuses = statuses;
      } catch (error) {
        if (!read.current()) return;
        lastStatuses = services.map(service => ({name: service.name, label: labelFor(service), state: 'offline', checkedAt: new Date(), data: null, error: error.message, url: ''}));
      } finally { read.destroy(); }
      updateUI();
    }

    // AppUIEventBus listener for real-time updates
    let eventBus = null;
    function setupEventBus() {
      if (typeof window.AppUIEventBus === 'undefined') {
        // AppUIEventBus not loaded yet, fallback to one-time poll only
        return;
      }
      try {
        eventBus = new window.AppUIEventBus(['daemons']);
        eventBus.on('daemons', function(event) {
          if (!owner.current()) return;
          const data = event.data || event;
          const name = data.name || '';
          const eventType = data.type || event.type || '';
          // Update status for matching service
          for (let i = 0; i < lastStatuses.length; i++) {
            if (lastStatuses[i].name === name) {
              if (eventType === 'started') {
                lastStatuses[i].state = 'online';
                lastStatuses[i].error = '';
                lastStatuses[i].checkedAt = new Date();
              } else if (eventType === 'stopped' || eventType === 'crashed') {
                lastStatuses[i].state = 'offline';
                lastStatuses[i].error = eventType;
                lastStatuses[i].checkedAt = new Date();
              }
            }
          }
          updateUI();
        });
      } catch (e) {
        // AppUIEventBus unavailable, no-op
      }
    }

    function showDialog() {
      if (owner.current()) window._AppUIDaemonStatusDetails.show({statuses:lastStatuses,label:opts.label,parent:owner});
    }

    // Restart button
    let restartBtn = null;
    if (opts.showRestart !== false && services.length === 1) {
      restartBtn = document.createElement('button');
      restartBtn.type = 'button';
      restartBtn.className = 'ai-app-daemon-restart hidden';
      restartBtn.textContent = '\u21BB';
      restartBtn.title = 'Restart service';
      restartBtn.setAttribute('aria-label', 'Restart ' + labelFor(services[0]));
      container.appendChild(restartBtn);
      owner.listen(restartBtn, 'click', async (e) => {
        if (!owner.current()) return;
        e.stopPropagation();
        restartBtn.classList.add('is-spinning');
        restartBtn.disabled = true;
        try {
          await fetch('/control', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'restart', name: services[0].name })
          });
        } catch (err) {
          console.warn('[daemon-status] Restart failed:', err.message);
        } finally {
          if (owner.current()) {
            restartBtn.classList.remove('is-spinning');
            restartBtn.disabled = false;
          }
        }
      });
    }
    function updateRestartVisibility() {
      if (!restartBtn) return;
      const anyOnline = lastStatuses.some(s => s.state === 'online');
      restartBtn.classList.toggle('hidden', !anyOnline);
    }

    // Manual refresh (for dialog click)
    async function refresh() { await fetchInitialState(); return lastStatuses.every(s => s.state === 'online'); }

    owner.listen(button, 'click', async () => { if (!owner.current()) return; await refresh(); showDialog(); });

    // Init: fetch once + subscribe to events
    fetchInitialState();
    setupEventBus();
    owner.add(() => {button.remove();restartBtn?.remove();});
    owner.add(() => eventBus?.close?.());

    return {
      refresh,
      destroy() { owner.destroy(); }
    };
  }
  return {mount};
})();
window.AppUIDaemonStatus = AppUIDaemonStatus;
