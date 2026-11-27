(function () {
  'use strict';
  const API = '/v1/apps/platform/log/';
  const api = async (op, args = {}) => {
    const result = await AppUIApi.request(API + op, args);
    if (!result?.ok) throw new Error(result?.error || result?._error || 'Log request failed');
    return result;
  };
  window.AppUIReady.then(() => {
    let root, table, current = [], cursor = null, generation = 0, poller, ticks = 0;
    const app = AppUI.createApp({id: 'platform-log', title: 'Logs', content: {render(el) {
      root = el;
      el.classList.add('log-page');
      el.innerHTML = '<form class="log-filters">' +
        '<label>App / service<select name="store"><option value="*">All apps and services</option><option value="framework">Framework</option><option value="">From source</option></select></label>' +
        '<label>Day (local time)<input type="date" name="day"></label>' +
        '<button type="button" data-action="today">Today</button><button type="button" data-action="all-days">All days</button>' +
        '<label>Level<select name="level"><option value="">All levels</option><option>debug</option><option>info</option><option>warn</option><option>error</option><option>critical</option><option value="warn,error,critical">Warnings and errors</option><option value="error,critical">Errors only</option></select></label>' +
        '<label>Source<select name="source"><option value="">All sources</option></select></label>' +
        '<label>From<input type="datetime-local" name="since"></label><label>Until<input type="datetime-local" name="until"></label>' +
        '<label>Search<input name="text" type="search" placeholder="Message or fields"></label>' +
        '<label>Endpoint<input name="endpoint" placeholder="All endpoints"></label>' +
        '<label>Trace ID<input name="trace_id" placeholder="Any trace"></label>' +
        '<label class="log-live"><input type="checkbox" name="live" checked>Live refresh</label>' +
        '<label class="log-live"><input type="checkbox" name="alerts" checked>Error notifications</label>' +
        '<button type="submit">Apply</button><button type="button" data-action="older">Load older</button>' +
        '<button type="button" data-action="csv">CSV</button><button type="button" data-action="xlsx">XLSX</button></form>' +
        '<div class="log-health" role="status"></div><div class="log-table"></div>' +
        '<div class="log-detail" role="region" aria-label="Selected log entry" hidden></div>';
      table = AppUIDataTable.create({container: el.querySelector('.log-table'), items: [], getId: row => row.id,
        maxRows: 5000, stickyHeader: true, empty: 'No matching logs', columns: [
          {id:'id', label:'ID', sortable:true, width:'80px'},
          {id:'ts', label:'Time', sortable:true, width:'185px', render: row => new Date(row.ts * 1000).toLocaleString(), exportValue: row => new Date(row.ts * 1000).toISOString()},
          {id:'store', label:'App / service', sortable:true, filterable:true, width:'170px', render: row => (row.store || '').replace(/^apps\//, ''), exportValue: row => (row.store || '').replace(/^apps\//, '')},
          {id:'level', label:'Level', sortable:true, filterable:true, width:'90px'},
          {id:'source', label:'Source', sortable:true, filterable:true, width:'170px'},
          {id:'origin', label:'Origin', sortable:true, width:'100px'},
          {id:'endpoint', label:'Endpoint', sortable:true, width:'160px'},
          {id:'reports', label:'Report', sortable:true, width:'120px',
           getValue: row => (row.reports || []).map(r => 'ISS-' + r.number).join(' '),       // the issue report(s) tracking this error
           exportValue: row => (row.reports || []).map(r => 'ISS-' + r.number + ' ' + r.status).join(', '),
           render: row => {
             const box = document.createElement('span');
             (row.reports || []).forEach((r, i) => {
               if (i) box.append(' ');
               const link = document.createElement('a');
               link.href = '/apps/platform/issue_report/?id=' + encodeURIComponent(r.number);
               link.target = '_blank'; link.textContent = 'ISS-' + r.number + ' ' + (r.status || '');
               link.title = 'issue report ISS-' + r.number + ' (' + (r.status || '?') + ') tracks this error';
               link.addEventListener('click', event => event.stopPropagation());
               box.append(link);
             });
             return box;
           }},
          {id:'message', label:'Message', sortable:true},
          {id:'trace_id', label:'Trace ID', sortable:true, width:'150px'}
        ], onRowClick: row => {
          // The fields of the selected entry go in ONE pane under the table (not an expandable row per record):
          // renderDetails switches the DataTable's virtual scrolling off, so a 5000-row day built 5000 DOM rows.
          const pane = el.querySelector('.log-detail');
          const details = document.createElement('pre');
          details.textContent = 'log ' + row.id + '  -  ' + (row.level || '') + '  ' + (row.source || '') + '\n' +
            (row.fingerprint ? 'fingerprint: ' + row.fingerprint + '   (py -3 tools/logs.py show ' + row.fingerprint + ')\n' : '') +
            'Message: ' + (row.message || '') + '\n\n' + JSON.stringify(row.fields || {}, null, 2);
          pane.replaceChildren(details);
          pane.hidden = false;
        }});
    }}, statusbar: {}});
    const form = root.querySelector('form');
    const initial = new URLSearchParams(location.search);
    function localDay(date = new Date()) {
      return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
    }
    form.elements.day.value = initial.has('day') ? initial.get('day') : localDay();
    for (const key of ['source', 'level', 'trace_id', 'text']) {
      if (initial.has(key) && key !== 'source') form.elements[key].value = initial.get(key);
    }
    if (initial.has('source')) form.elements.store.value = '';
    if (initial.has('store')) form.elements.store.add(new Option(initial.get('store'), initial.get('store'), true, true));
    if (initial.has('source')) form.elements.source.add(new Option(initial.get('source'), initial.get('source'), true, true));
    form.elements.alerts.addEventListener('change', async () => {
      try {await api('configure_alerts', {enabled: form.elements.alerts.checked, confirm: true}); await metadata();}
      catch (error) {health.textContent = error.message;}
    });
    const health = root.querySelector('.log-health');
    function filters() {
      const values = Object.fromEntries(new FormData(form));
      delete values.live;
      delete values.alerts;
      // ?report=ISS-12 (a deep link from the issue page): only the entries that issue tracks - across ALL days
      const report = initial.get('report');
      if (report) {values.report = report; values.aggregate = true; delete values.store; delete values.day;}
      const day = values.day;
      delete values.day;
      if (values.store === '*') {delete values.store; values.aggregate = true;}
      for (const key of ['since', 'until']) {
        if (values[key]) values[key] = new Date(values[key]).getTime() / 1000;
        else delete values[key];
      }
      if (day) {
        const start = new Date(day + 'T00:00:00');
        const end = new Date(start);
        end.setDate(end.getDate() + 1);
        values.since = Math.max(values.since ?? -Infinity, start.getTime() / 1000);
        values.until = Math.min(values.until ?? Infinity, end.getTime() / 1000 - 0.001);
      }
      return values;
    }
    let liveKey = null, liveAfter = null;
    async function refresh(older = false, live = false) {
      const epoch = ++generation;
      try {
        const base = filters(), key = JSON.stringify(base);
        // ROUND4 #33: a LIVE tick with unchanged filters asks only for rows after the newest one shown (the store
        // supports after=<id>, ascending) instead of re-reading the whole 300-row window every 3 s.
        if (live && !older && key === liveKey && liveAfter != null && current.length) {
          const inc = await api('query', {...base, after: liveAfter, limit: 300});
          if (epoch !== generation || !root.isConnected) return;
          if (!inc.has_more) {
            const fresh = (inc.items || []).slice().reverse();
            if (fresh.length) {
              current = fresh.concat(current).slice(0, 5000);
              table.setItems(current);
            }
            if (inc.next_after != null) liveAfter = inc.next_after;
            return;
          }
          // more than a page arrived: fall through to a full reload
        }
        const args = {...base, limit: 300};
        if (older && cursor) args.before = cursor;
        const result = await api('query', args);
        if (epoch !== generation || !root.isConnected) return;
        current = (older ? current.concat(result.items) : result.items).slice(0, 5000);
        if (!older) { liveKey = key; liveAfter = result.next_after ?? null; }
        cursor = result.has_more && current.length < 5000 ? result.next_before : null;
        table.setItems(current);
        root.querySelector('[data-action="older"]').disabled = !cursor;
        app.setStatus(current.length + ' records loaded | ' + (form.elements.day.value || 'All days') + ' | ' +
          (result.aggregate ? 'All apps and services' : form.elements.store.selectedOptions[0]?.textContent || 'From source'));
      } catch (error) {health.textContent = error.message; app.setStatus('Log query failed');}
    }
    async function metadata() {
      try {
        const selectedFilters = filters(), key = JSON.stringify(selectedFilters);
        const [sources, status] = await Promise.all([api('sources', selectedFilters), api('status')]);
        if (key !== JSON.stringify(filters()) || !root.isConnected) return;
        const storeSelect = form.elements.store, owner = storeSelect.value;
        storeSelect.replaceChildren(new Option('Framework', 'framework'), new Option('All apps and services', '*'), new Option('From source', ''));
        for (const store of status.stores || []) if (store !== 'framework') storeSelect.add(new Option(store.replace(/^apps\//, ''), store));
        if (owner && !Array.from(storeSelect.options).some(option => option.value === owner)) storeSelect.add(new Option(owner, owner));
        storeSelect.value = owner;
        const select = form.elements.source, value = select.value;
        select.replaceChildren(new Option('All sources', ''));
        for (const source of sources.items) select.add(new Option(source.source + ' (' + source.count + ')', source.source));
        if (value && !Array.from(select.options).some(option => option.value === value)) select.add(new Option(value, value));
        select.value = value;
        form.elements.alerts.checked = status.alerts?.enabled !== false;
        health.textContent = status.stores.length + ' apps/services | ' + (status.layout === 'shared_monthly' ? 'shared monthly SQLite' : status.format === 'sqlite' ? 'monthly SQLite' : status.format) + ' | queue ' + status.queued + ' | dropped ' + status.dropped +
          ' | retention ' + status.retention_days + ' days / ' + status.max_records + ' records per app/month' +
          (status.last_error ? ' | Writer error: ' + status.last_error : '') +
          (status.alerts ? ' | alerts ' + status.alerts.delivered + ' / suppressed ' + status.alerts.suppressed + ' / failed ' + status.alerts.failed : '') +
          (status.alert_queue?.last_error ? ' | Alert error: ' + status.alert_queue.last_error : '');
      } catch (error) {health.textContent = error.message;}
    }
    form.elements.store.addEventListener('change', () => {form.elements.source.value = ''; refresh(); metadata();});
    function selectDay(day) {
      form.elements.day.value = day;
      form.elements.since.value = '';
      form.elements.until.value = '';
      refresh(); metadata();
    }
    form.elements.day.addEventListener('change', () => selectDay(form.elements.day.value));
    root.querySelector('[data-action="today"]').onclick = () => selectDay(localDay());
    root.querySelector('[data-action="all-days"]').onclick = () => selectDay('');
    form.addEventListener('submit', event => {event.preventDefault(); refresh(); metadata();});
    root.querySelector('[data-action="older"]').onclick = () => {form.elements.live.checked = false; refresh(true);};
    root.querySelector('[data-action="csv"]').onclick = () => table.exportCsv({filename:'pylon-logs'});
    root.querySelector('[data-action="xlsx"]').onclick = () => table.exportXlsx({filename:'pylon-logs', sheetName:'Logs'});
    poller = AppUIPollRefresh.start(() => {
      if (++ticks % 5 === 0) metadata();
      return form.elements.live.checked ? refresh(false, true) : Promise.resolve();
    }, 3000,
      {stopWhen: () => !root.isConnected});
    metadata(); poller.refresh();
    window.addEventListener('pagehide', () => table.destroy(), {once:true});
  }).catch(error => {document.getElementById('app-content-body').textContent = error.message;});
})();
