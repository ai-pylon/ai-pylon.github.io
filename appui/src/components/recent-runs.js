/* Compact, selectable recent runs. Pages own fetching and navigation. */
const AppUIRecentRuns = (() => {
  function merge(running, completed, limit = 10) {
    const records = [], seen = new Set();
    function add(items, defaultStatus) {
      for (const item of items || []) {
        const name = item.name || '';
        if (!name || seen.has(name)) continue;
        seen.add(name);
        records.push({name, status: item.status || defaultStatus, stale: !!item.stale,
          ...(item.subtitle != null ? {subtitle: item.subtitle} : {})});
      }
    }
    add(running, 'running');
    add(completed, 'done');
    return records.slice(0, Math.max(0, limit));
  }

  function statusColor(status, stale) {
    if (stale || status === 'failed' || status === 'error') return 'var(--color-error)';
    if (status === 'running' || status === 'started') return 'var(--color-info)';
    return 'var(--color-success)';
  }

  function create(container, options = {}) {
    if (!container) throw new Error('RecentRuns: container required');
    const element = document.createElement('section');
    element.className = 'appui-recent-runs';
    const heading = document.createElement('h3');
    heading.className = 'appui-recent-runs-title';
    heading.textContent = options.title || 'Recent Runs';
    const list = document.createElement('div');
    list.className = 'appui-recent-runs-list';
    element.append(heading, list);
    container.appendChild(element);
    let records = [], destroyed = false;

    function update(items) {
      if (destroyed) return;
      records = Array.from(items || []);
      list.replaceChildren();
      element.hidden = records.length === 0;
      records.forEach((record, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'appui-recent-run sidebar-item';
        button.dataset.recentRun = String(index);
        button.title = (record.status || '') + (record.stale ? ' (stale)' : '');
        button.setAttribute('aria-label', record.name + ': ' + button.title);
        const dot = document.createElement('span');
        dot.className = 'appui-recent-run-dot';
        dot.style.background = statusColor(record.status, record.stale);
        dot.setAttribute('aria-hidden', 'true');
        const label = document.createElement('span');
        label.className = 'appui-recent-run-name';
        label.textContent = record.name;
        if (record.subtitle != null && String(record.subtitle)) {
          const text = document.createElement('span');
          text.className = 'appui-recent-run-text';
          const subtitle = document.createElement('span');
          subtitle.className = 'appui-recent-run-subtitle';
          subtitle.textContent = String(record.subtitle);
          subtitle.title = String(record.subtitle);
          text.append(label, subtitle);
          button.append(dot, text);
        } else {
          button.append(dot, label);
        }
        list.appendChild(button);
      });
    }

    function select(event) {
      const button = event.target.closest?.('[data-recent-run]');
      if (!button || !list.contains(button)) return;
      const record = records[Number(button.dataset.recentRun)];
      if (record) options.onSelect?.(record);
    }
    element.addEventListener('click', select);
    update(options.items);
    return {
      element, update,
      destroy() {
        if (destroyed) return;
        destroyed = true;
        records = [];
        element.removeEventListener('click', select);
        element.remove();
      },
    };
  }
  return {create, merge, statusColor};
})();
window.AppUIRecentRuns = AppUIRecentRuns;
