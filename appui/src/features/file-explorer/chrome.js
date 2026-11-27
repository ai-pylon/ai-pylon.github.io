/* FileExplorer header/toolbar layout and owned DOM interactions. */
window._AppUIFileExplorerChrome = (() => {
  function create({container, opts, createFolder, chooseFiles, refresh}) {
    const scope = AppUILifecycle.createScope();
    function listen(selector, type, handler) {
      const element = container.querySelector(selector);
      if (element) scope.listen(element, type, handler);
    }
      // The container is a flex column so the .fe-tree child is the sole SCROLLER
      // (fills the height under the header + scrolls its overflow). Without this
      // the tree had no bounded height → content overflowed its parent with NO
      // scrollbar (the reported "left sidebar tree without a vertical scrollbar").
      try {
        container.style.display = 'flex';
        container.style.flexDirection = 'column';
        if (!container.style.height) container.style.height = '100%';
        container.style.minHeight = '0';
      } catch (e) { /* best-effort */ }
      container.innerHTML = `
        <div class="fe-header" style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;font-size:13px;font-weight:600;flex:0 0 auto">
          ${(opts.headerTitle === '' || opts.headerTitle === false) ? '<span></span>' : ('<span>' + (opts.headerTitle || '📁 Files') + '</span>')}
          <span class="fe-toolbar" style="display:flex;gap:2px">
            <button class="fe-btn" data-action="new-folder" title="New folder" style="border:none;background:none;cursor:pointer;font-size:12px;padding:2px 4px;border-radius:3px;opacity:0.6">📁+</button>
            <button class="fe-btn" data-action="upload" title="Upload files" style="border:none;background:none;cursor:pointer;font-size:12px;padding:2px 4px;border-radius:3px;opacity:0.6">⬆</button>
            <button class="fe-btn" data-action="refresh" title="Refresh" style="border:none;background:none;cursor:pointer;font-size:12px;padding:2px 4px;border-radius:3px;opacity:0.6">🔄</button>
          </span>
        </div>
        <div class="fe-tree" style="flex:1 1 auto;min-height:0;overflow:auto"></div>
      `;

      // Toolbar buttons
      if (Array.isArray(opts.toolbarActions)) {
        container.querySelectorAll('.fe-btn').forEach(button => {if (!opts.toolbarActions.includes(button.dataset.action)) button.remove();});
      }
      // COLLAPSE an EMPTY header: when there's no title and no toolbar buttons
      // left, the .fe-header is a blank ~33px bar that only adds vertical pressure
      // (a page may hide the title + clear toolbarActions to rely on a right-click
      // menu). Hide it so the tree gets the full height (removes a spurious outer
      // scrollbar).
      try {
        const _hdr = container.querySelector('.fe-header');
        const _noTitle = (opts.headerTitle === '' || opts.headerTitle === false);
        const _noBtns = !_hdr || !_hdr.querySelector('.fe-btn');
        const _noSearch = (opts.searchable === false) || !_hdr || !_hdr.querySelector('.tree-search');
        if (_hdr && _noTitle && _noBtns && _noSearch) { _hdr.style.display = 'none'; }
      } catch (e) { /* best-effort */ }
      listen('[data-action="new-folder"]', 'click', () => createFolder());
      listen('[data-action="upload"]', 'click', () => chooseFiles(''));
      listen('[data-action="refresh"]', 'click', refresh);

      // Hover effect for toolbar buttons
      container.querySelectorAll('.fe-btn').forEach(btn => {
        scope.listen(btn, 'mouseenter', () => { btn.style.opacity = '1'; btn.style.background = 'var(--hover-bg, var(--bg-hover))'; });
        scope.listen(btn, 'mouseleave', () => { btn.style.opacity = '0.6'; btn.style.background = 'none'; });
      });

    function placeSearchInHeader() {
      if (scope.destroyed) return;
      // Optionally relocate the tree's filter field INTO the header row (so the
      // filter leads the panel in place of a title). The tree creates its search
      // input as a sibling just before the .fe-tree container; move it into the
      // .fe-header (before the toolbar) and let it flex to fill the row.
      if (opts.searchInHeader) {
        const hdr = container.querySelector('.fe-header');
        const search = container.querySelector('.tree-search');
        const toolbar = hdr && hdr.querySelector('.fe-toolbar');
        if (hdr && search) {
          if (hdr.style.display === 'none') hdr.style.display = 'flex';
          search.style.margin = '0 8px 0 0';
          search.style.flex = '1';
          const titleSpan = hdr.querySelector('span:not(.fe-toolbar)');
          if (titleSpan) titleSpan.remove();   // the filter stands in for the title
          hdr.insertBefore(search, toolbar || null);
        }
      }

    }
    return {placeSearchInHeader, destroy: () => scope.destroy()};
  }
  return {create};
})();
