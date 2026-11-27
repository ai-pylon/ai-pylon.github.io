/* Private expandable record rendering for DataTable. */
const _AppUIDataTableDetails = (() => {
  let detailSerial = 0;
  function create({opts,columns,detailId,expandedDetails,columnValue}) {
    function detailRow(item, row, context) {
      const wrapper = document.createElement('div'), panel = document.createElement('div'), trigger = document.createElement('button');
      wrapper.className = 'appui-dt-record'; panel.className = 'appui-dt-details'; trigger.className = 'appui-dt-detail-toggle';
      trigger.type = 'button'; trigger.style.cssText = 'margin-right:6px;padding:2px 6px;cursor:pointer';
      const id = detailId(item), label = String(opts.detailLabel?.(item) ?? columnValue(item, columns[0]) ?? 'row');
      panel.id = 'appui-dt-details-' + ++detailSerial;
      trigger.setAttribute('aria-controls', panel.id); panel.style.cssText = 'padding:8px 12px;border-bottom:1px solid var(--border)';
      let detailsScope;
      function clear() {detailsScope?.destroy(); detailsScope = null; panel.replaceChildren();}
      context.add(clear);
      function apply() {
        const open = expandedDetails.has(id);
        panel.hidden = !open; trigger.textContent = open ? '\u25BC' : '\u25B6';
        trigger.setAttribute('aria-expanded', String(open)); trigger.setAttribute('aria-label', (open ? 'Collapse ' : 'Expand ') + label);
        clear();
        if (!open || !context.current()) return;
        const scope = AppUILifecycle.createViewScope({parent:context,pagehide:false,
          isCurrent:()=>detailsScope===scope}); detailsScope = scope;
        const details = {signal: scope.signal, current: scope.current,
          add: cleanup => scope.add(cleanup), listen(target, type, listener, options) {
            return scope.listen(target, type, function (...args) {if (details.current()) return listener.apply(this, args);}, options);
          }};
        const result = opts.renderDetails(item, details);
        if (!details.current()) return;
        if (result instanceof Node) panel.appendChild(result); else if (result != null) panel.textContent = String(result);
      }
      context.listen(trigger, 'click', event => {
        event.stopPropagation();
        if (expandedDetails.has(id)) expandedDetails.delete(id); else expandedDetails.add(id);
        apply();
        if (context.current()) opts.onDetailsToggle?.(item, expandedDetails.has(id));
      });
      const column = columns.findIndex(column => column.id === opts.detailColumn), cell = row.children[column >= 0 ? column : 0];
      if (cell) cell.prepend(trigger); else row.appendChild(trigger);
      wrapper.append(row, panel); apply(); return wrapper;
    }

    return detailRow;
  }
  return {create};
})();
window._AppUIDataTableDetails = _AppUIDataTableDetails;
