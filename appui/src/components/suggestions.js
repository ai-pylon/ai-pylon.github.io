/* Keyboard and accessibility bindings for page-owned search/autocomplete data. */
const AppUISuggestions = (() => {
  const bindings = new WeakMap();
  let serial = 0;
  function bind(options) {
    const {input, container} = options;
    bindings.get(input)?.destroy();
    const scope = AppUI.services.lifecycle.createScope();
    const prefix = 'appui-suggestions-' + ++serial;
    const saved = ['role', 'aria-autocomplete', 'aria-expanded', 'aria-controls', 'aria-activedescendant']
      .map(name => [name, input.getAttribute(name)]);
    const originalDisplay = container.style.display, originalRole = container.getAttribute('role');
    const root = document.createElement('div'); root.id = prefix; root.setAttribute('role', 'listbox');
    container.appendChild(root); container.setAttribute('role', 'presentation');
    input.setAttribute('role', 'combobox'); input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-controls', prefix); input.setAttribute('aria-expanded', 'false');
    let items = [], rows = [], selected = -1, visible = false, blurTimer;
    const getLabel = options.getLabel || (item => String(item?.label ?? item?.name ?? item ?? ''));
    function paint() {
      rows.forEach((row, index) => {
        const active = index === selected;
        row.classList.toggle(options.activeClassName || 'appui-suggestion-active', active);
        row.setAttribute('aria-selected', String(active));
        if (!options.activeClassName) row.style.background = active ? 'var(--bg-active)' : '';
      });
      if (visible && rows[selected]) {
        input.setAttribute('aria-activedescendant', rows[selected].id);
        rows[selected].scrollIntoView?.({block: 'nearest'});
      } else input.removeAttribute('aria-activedescendant');
    }
    function open() {
      if (scope.destroyed) return;
      visible = true; container.style.display = 'block'; input.setAttribute('aria-expanded', 'true'); paint();
    }
    function close(reason = 'close') {
      if (scope.destroyed) return;
      const wasVisible = visible; visible = false;
      container.style.display = 'none'; input.setAttribute('aria-expanded', 'false'); paint();
      if (wasVisible && !scope.destroyed) options.onClose?.(reason);
    }
    function select(index) {
      if (scope.destroyed || !Number.isInteger(index) || index < 0 || index >= items.length) return;
      const item = items[index]; close('select');
      if (!scope.destroyed) options.onSelect?.(item, index);
    }
    function setItems(next, settings = {}) {
      if (scope.destroyed) return;
      items = Array.from(next || []); selected = options.selectFirst === false || !items.length ? -1 : 0;
      root.replaceChildren(); rows = [];
      if (!items.length && (settings.emptyText ?? options.emptyText)) {
        const empty = document.createElement('div'); empty.className = options.emptyClassName || 'appui-suggestions-empty';
        empty.textContent = settings.emptyText ?? options.emptyText; root.appendChild(empty);
      }
      items.forEach((item, index) => {
        const row = document.createElement('div'); row.id = prefix + '-' + index;
        row.className = options.itemClassName || 'appui-suggestion'; row.dataset.suggestionIndex = String(index);
        row.setAttribute('role', 'option');
        const content = options.renderItem?.(item, index);
        if (content?.nodeType) row.appendChild(content); else row.textContent = getLabel(item);
        if (!options.itemClassName) row.style.cssText = 'padding:6px 10px;cursor:pointer';
        root.appendChild(row); rows.push(row);
      });
      if (settings.open === false) close(); else open();
    }
    scope.listen(input, 'keydown', event => {
      if (!visible || event.isComposing) return;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        if (!items.length) return;
        const direction = event.key === 'ArrowDown' ? 1 : -1;
        selected = selected < 0 ? (direction > 0 || options.wrap === false ? 0 : items.length - 1) : selected + direction;
        if (options.wrap === false) selected = Math.max(0, Math.min(items.length - 1, selected));
        else selected = (selected + items.length) % items.length;
        event.preventDefault(); event.stopPropagation(); paint();
      } else if (event.key === 'Enter' && selected >= 0) {
        event.preventDefault(); event.stopPropagation(); select(selected);
      } else if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation(); close('escape');
      }
    }, true);
    scope.listen(root, 'mousedown', event => {if (event.target.closest?.('[data-suggestion-index]')) event.preventDefault();});
    scope.listen(root, 'click', event => {
      const row = event.target.closest?.('[data-suggestion-index]');
      if (row && root.contains(row)) select(Number(row.dataset.suggestionIndex));
    });
    scope.listen(input, 'blur', () => {clearTimeout(blurTimer); blurTimer = setTimeout(() => {if (!scope.destroyed) close('blur');}, options.blurDelay ?? 150);});
    scope.listen(input, 'focus', () => clearTimeout(blurTimer));
    const view = {setItems, open, close, get isOpen() {return visible;}, get items() {return items.slice();}, destroy: () => scope.destroy()};
    scope.add(() => {
      clearTimeout(blurTimer); root.remove(); container.style.display = originalDisplay;
      if (originalRole == null) container.removeAttribute('role'); else container.setAttribute('role', originalRole);
      for (const [name, value] of saved) {if (value == null) input.removeAttribute(name); else input.setAttribute(name, value);}
      if (bindings.get(input) === view) bindings.delete(input);
      items = rows = []; visible = false;
    });
    bindings.set(input, view); close(); return view;
  }
  return {bind};
})();
window.AppUISuggestions = AppUISuggestions;
