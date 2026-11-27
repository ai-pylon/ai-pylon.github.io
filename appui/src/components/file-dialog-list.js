/* File picker rows use the shared GridView lifecycle and selection controls. */
window._AppUIFileDialogList = (() => {
  function create({container, entries, filter, showHidden, path, formatSize, onNavigate, onSelect, onOpen, onContext}) {
    const icons = {docx:'📄',doc:'📄',pptx:'📊',ppt:'📊',xlsx:'📈',xls:'📈',pdf:'📕',json:'📋',md:'📝',txt:'📃',py:'🐍',js:'📜',puml:'🔀'};
    const directory = entry => entry.type === 'dir' || entry.is_dir;
    const rows = [...entries.filter(directory), ...entries.filter(entry => !directory(entry))]
      .map(entry => {
        const name = entry.name || entry.path.split(/[/\\]/).pop();
        return {name, path:entry.path || path + '/' + name, directory:!!directory(entry), size:entry.size};
      }).filter(entry => entry.directory ? showHidden || !entry.name.startsWith('.')
        : !filter?.length || filter.some(ext => entry.name.toLowerCase().endsWith(ext.toLowerCase())));
    container.replaceChildren();
    if (!rows.length) {
      const empty = document.createElement('div');
      empty.style.cssText = 'padding:16px;color:var(--text-muted);font-size:12px';
      empty.textContent = 'Empty directory'; container.appendChild(empty);
      if (filter) {
        const note = document.createElement('div');
        note.style.cssText = 'padding:0 16px;color:var(--text-muted);font-size:10px';
        note.textContent = 'Filter: ' + filter.join(', '); container.appendChild(note);
      }
      return {destroy() {}};
    }
    const view = AppUIGridView.create({container, viewMode:'grid', columns:1, persistKey:false,
      renderItem(entry) {
        const row = document.createElement('div');
        row.className = 'fd-item ' + (entry.directory ? 'fd-dir' : 'fd-file');
        row.dataset.path = entry.path; row.dataset.name = entry.name;
        row.style.cssText = 'padding:5px 16px;cursor:pointer;display:flex;align-items:center;gap:8px;font-size:12px';
        const icon = document.createElement('span');
        const extension = (entry.name.split('.').pop() || '').toLowerCase();
        icon.textContent = entry.directory ? '📁' : (Object.hasOwn(icons, extension) ? icons[extension] : '📄');
        const label = document.createElement('span'); label.textContent = entry.name; label.style.flex = '1';
        row.append(icon, label);
        if (!entry.directory && entry.size) {
          const size = document.createElement('span'); size.textContent = formatSize(entry.size);
          size.style.cssText = 'color:var(--text-muted);font-size:10px'; row.appendChild(size);
        }
        return row;
      },
      onSelect: entry => entry.directory ? onNavigate(entry.path) : onSelect(entry.path),
      onDblClick: entry => { if (!entry.directory) onOpen(entry.path); },
      onContextMenu: (entry, event) => { event.preventDefault(); onContext(event, entry.path, entry.directory ? 'dir' : 'file'); },
    });
    view.setItems(rows);
    const grid = container.querySelector('.ui-grid-view-container');
    if (grid) { grid.style.gap = '0'; grid.style.padding = '0'; }
    return view;
  }
  return {create};
})();
