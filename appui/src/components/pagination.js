/* Controlled pagination controls; data requests remain with the caller. */
const AppUIPagination = (function() {
  const bindings = new WeakMap();
  let serial = 0;
  function integer(value, fallback, minimum = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(minimum, Math.floor(number)) : fallback;
  }
  function create(options = {}) {
    const container = typeof options.container === 'string'
      ? document.querySelector(options.container) : options.container;
    if (!container) throw new Error('AppUIPagination: container is required');
    let state = {offset: 0, limit: 50, total: 0, shown: 0, ...options.state};
    let destroyed = false;
    const scope = AppUILifecycle.createScope();
    const prefix = String(options.idPrefix ?? ('appui-pagination-' + ++serial));
    const api = {setState, getState: () => ({...state}), destroy};
    if (options.signal?.aborted) {destroyed = true; return api;}
    bindings.get(container)?.destroy();
    const toolbar = AppUIToolbar.create({container, label: String(options.label ?? 'Pagination')});
    const range = toolbar.append({id: prefix + '-range', type: 'text', label: ''});
    range.setAttribute('aria-live', 'polite');
    const limits = [...new Set((options.limits || [25, 50, 100, 200])
      .map(value => Number(value)).filter(value => Number.isFinite(value) && value > 0))];
    const limit = toolbar.append({id: prefix + '-limit', type: 'select',
      options: limits.map(value => ({value: String(value), label: String(value)})),
      onChange(value) {
        if (destroyed) return;
        setState({limit: integer(value, state.limit, 1), offset: 0});
        options.onPageSizeChange?.(state.limit);
      },
    });
    limit.setAttribute('aria-label', options.pageSizeLabel ?? 'Rows per page');
    const previous = toolbar.append({id: prefix + '-prev', label: options.previousLabel ?? 'Previous',
      action: () => {if (!previous.disabled) move(Math.max(0, state.offset - state.limit));}});
    const next = toolbar.append({id: prefix + '-next', label: options.nextLabel ?? 'Next',
      action: () => {if (!next.disabled) move(state.offset + state.limit);}});
    toolbar.append({id: prefix + '-refresh', label: options.refreshLabel ?? 'Refresh',
      action: () => {if (!destroyed) options.onRefresh?.();}});
    scope.add(() => toolbar.destroy());
    if (options.signal) scope.listen(options.signal, 'abort', destroy, {once: true});
    bindings.set(container, api);
    setState({});
    return api;

    function move(offset) {
      if (destroyed || offset === state.offset) return;
      setState({offset});
      options.onPageChange?.(state.offset);
    }
    function setState(patch = {}) {
      if (destroyed) return;
      state = {...state, ...patch};
      state.offset = integer(state.offset, 0);
      state.limit = integer(state.limit, 50, 1);
      state.total = integer(state.total, 0);
      state.shown = integer(state.shown, 0);
      const total = state.total.toLocaleString();
      range.textContent = !state.total ? '0 rows' : !state.shown || state.offset >= state.total
        ? '0 of ' + total
        : (state.offset + 1) + ' - ' + Math.min(state.offset + state.shown, state.total) + ' of ' + total;
      if (![...limit.options].some(option => option.value === String(state.limit))) {
        const option = document.createElement('option');
        option.value = String(state.limit); option.textContent = String(state.limit); limit.appendChild(option);
      }
      limit.value = String(state.limit);
      previous.disabled = state.offset === 0;
      next.disabled = state.offset + state.shown >= state.total;
    }
    function destroy() {
      if (destroyed) return;
      destroyed = true; scope.destroy();
      if (bindings.get(container) === api) bindings.delete(container);
    }
  }
  return {create};
})();
window.AppUIPagination = AppUIPagination;
