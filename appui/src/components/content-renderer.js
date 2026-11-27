/* Declarative content specs delegate to optional AppUI components at render time. */
window._AppUIContentRenderer = (() => {
  function render(spec, area, onCommand) {
    if (!spec) {
      if (area.classList.contains('appui-content-top') || area.classList.contains('appui-content-bottom')) {
        area.hidden = true;
      }
      return;
    }
    const toolbar = window.AppUIToolbar;
    const header = window.AppUIHeader;
    const splitter = window.AppUISplit;
    const multiSplit = window.AppUIMultiSplit;
    const dataView = window.AppUIDataView;
    if (isColumnsSpec(spec) && splitter) {
      const columns = spec.columns || spec;
      // Array of panes → N-column multi-split
      if (Array.isArray(columns) && multiSplit) {
        return multiSplit.create({
          container: area,
          panes: columns,
          direction: spec.direction || 'horizontal',
          minSize: spec.minSize,
          sizes: spec.sizes,
          storageKey: spec.storageKey,
          swappable: spec.swappable,
          className: ['appui-content-columns', spec.className].filter(Boolean).join(' '),
        });
      }
      return splitter.create(Object.assign({}, columns, {
        container: area,
        className: ['appui-content-columns', columns.className].filter(Boolean).join(' '),
        primary: columns.primary || columns.left,
        secondary: columns.secondary || columns.right,
        primaryLabel: columns.primaryLabel || columns.leftLabel,
        secondaryLabel: columns.secondaryLabel || columns.rightLabel,
      }));
    } else if (spec.type === 'toolbar' && toolbar) {
      return toolbar.create(Object.assign({}, spec, {
        container: area,
        onCommand: spec.onCommand || onCommand,
      }));
    } else if (spec.type === 'header' && header) {
      return header.create(Object.assign({}, spec, {
        container: area,
        onCommand: spec.onCommand || onCommand,
      }));
    } else if (spec.type === 'split' && splitter) {
      return splitter.create(Object.assign({}, spec, {container: area}));
    } else if (spec.type === 'data-view' && dataView) {
      return dataView.create(Object.assign({}, spec, {container: area}));
    } else if (spec.type === 'tabs' && spec.tabs) {
      // Tabbed content: { type: 'tabs', tabs: [{id, label, render}, ...] }
      var Tabs = window.AppUISidebarTabs;
      if (Tabs) return Tabs.create({container: area, storageKey: spec.storageKey || '', tabs: spec.tabs, onTabChange: spec.onTabChange});
      // Fallback: render all panels stacked
      (spec.tabs || []).forEach(function(tab) { if (tab.render) tab.render(area); });
    } else if (spec.type === 'data-table') {
      var DataTable = window.AppUIDataTable;
      if (DataTable) return DataTable.create(Object.assign({}, spec, {container: area}));
    } else if (spec.type === 'accordion' && spec.sections) {
      // Collapsible sections: { type: 'accordion', sections: [{id, label, render, open}] }
      return window._AppUIContentAccordion.create(area, spec);
    } else if (typeof spec === 'function') return spec(area);
    else if (spec.render) return spec.render(area);
    else if (typeof spec === 'string') area.innerHTML = spec;
    else if (spec instanceof Node) area.appendChild(spec);
  }

  function isColumnsSpec(spec) {
    return !!spec && (spec.type === 'columns' || (!spec.type && !!spec.columns));
  }

  return {render, isColumnsSpec};
})();
