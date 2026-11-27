/* Numbered chapter navigation with owned rows and persisted collapse state. */
const ChapterTree = (() => {
  const bindings = new WeakMap();
  const inactive = () => ({
    render() {},
    refresh() {},
    setActive() {},
    getActive: () => null,
    getFlat: () => [],
    expandAll() {},
    collapseAll() {},
    reveal() {},
    setChapters() {},
    setGetStatus() {},
    current: () => false,
    destroy() {}
  });

  function create(container, options = {}) {
    const opts = {
      chapters: [],
      getStatus: () => 'empty',
      onSelect: null,
      active: null,
      storageKey: 'chapter-tree-collapsed:' + window.location.pathname,
      ...options
    };
    const el = typeof container === 'string' ? document.querySelector(container) : container;
    if (!el) return null;
    if (opts.signal?.aborted) return inactive();
    bindings.get(el)?.destroy();
    const root = document.createElement('div');
    root.className = 'ch-tree-root';
    root.tabIndex = 0;
    root.setAttribute('role', 'tree');
    root.setAttribute('aria-label', String(opts.label ?? 'Chapters'));
    el.replaceChildren(root);
    el.style.cssText = el.style.cssText || 'overflow-y:auto;font-size:12px;';
    const owner = AppUILifecycle.createViewScope({
      host: root,
      signal: opts.signal,
      isCurrent: () => bindings.get(el) === owner && (!opts.isCurrent || opts.isCurrent())
    });
    bindings.set(el, owner);
    let active = opts.active,
      focused = null,
      rowsScope,
      records = new WeakMap();
    const saved = AppUIStorage.getJSON(opts.storageKey, []);
    const collapsed = new Set(Array.isArray(saved) ? saved : []);
    owner.add(() => {
      rowsScope?.destroy();
      if (bindings.get(el) === owner) bindings.delete(el);
      root.remove();
    });

    function save() {
      AppUIStorage.setJSON(opts.storageKey, [...collapsed]);
    }
    function assignNumbers(chapters, prefix = '') {
      prefix = String(prefix);
      chapters.forEach((ch, index) => {
        ch._number =
          ch.number != null && ch.number !== ''
            ? ch.number
            : prefix
              ? prefix + '.' + (index + 1)
              : String(index + 1);
        if (ch.children?.length) assignNumbers(ch.children, ch._number);
      });
    }
    function visible() {
      return [...root.querySelectorAll('.ch-tree-item')];
    }
    function focus(id) {
      const row = visible().find((node) => records.get(node)?.id === id);
      if (row) {
        focused = id;
        row.focus();
        return true;
      }
      return false;
    }
    function render() {
      if (!owner.current()) return;
      const restore = root.contains(document.activeElement);
      rowsScope?.destroy();
      rowsScope = AppUILifecycle.createViewScope({ parent: owner, pagehide: false });
      records = new WeakMap();
      assignNumbers(opts.chapters);
      root.replaceChildren();
      renderLevel(opts.chapters, 0, rowsScope);
      if (restore && !focus(focused ?? active) && !focus(records.get(visible()[0])?.id))
        root.focus();
    }
    function select(id, ch) {
      if (!owner.current()) return;
      active = id;
      focused = id;
      opts.onSelect?.(id, ch);
      render();
    }
    function toggle(id) {
      if (!owner.current()) return;
      collapsed.has(id) ? collapsed.delete(id) : collapsed.add(id);
      save();
      render();
    }
    function renderLevel(chapters, depth, rows) {
      for (const ch of chapters) {
        const id = ch.id,
          hasChildren = !!ch.children?.length,
          isCollapsed = collapsed.has(id),
          isActive = active === id;
        const item = document.createElement('div');
        item.className = 'ch-tree-item' + (isActive ? ' active' : '');
        item.dataset.id = String(id);
        item.tabIndex = -1;
        item.setAttribute('role', 'treeitem');
        item.setAttribute('aria-level', String(depth + 1));
        item.setAttribute('aria-selected', String(isActive));
        if (hasChildren) item.setAttribute('aria-expanded', String(!isCollapsed));
        item.style.cssText = `display:flex;align-items:center;gap:4px;padding:4px 8px 4px ${8 + depth * 16}px;cursor:pointer;border-left:3px solid ${isActive ? 'var(--accent,#6c63ff)' : 'transparent'};background:${isActive ? 'var(--bg-active,#2a2a4a)' : 'transparent'};`;
        records.set(item, { id, ch, depth, hasChildren });
        const arrow = document.createElement('span');
        arrow.className = 'ch-tree-arrow';
        arrow.style.cssText =
          'width:14px;font-size:10px;color:var(--text-muted,#888);flex-shrink:0;text-align:center;';
        if (hasChildren) {
          arrow.textContent = isCollapsed ? '\u25b8' : '\u25be';
          rows.listen(arrow, 'click', (event) => {
            if (!rows.current()) return;
            event.stopPropagation();
            toggle(id);
          });
        }
        const dot = document.createElement('span'),
          colors = { filled: '#4caf50', partial: '#ff9800', empty: '#555' },
          status = opts.getStatus(id);
        dot.style.cssText = `width:7px;height:7px;border-radius:50%;background:${Object.hasOwn(colors, status) ? colors[status] : '#555'};flex-shrink:0;`;
        const number = document.createElement('span');
        number.style.cssText =
          'font-size:10px;color:var(--text-muted,#888);min-width:28px;flex-shrink:0;';
        number.textContent = ch._number;
        const title = document.createElement('span');
        title.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
        title.textContent = ch.title ?? '';
        item.append(arrow, dot, number, title);
        if (hasChildren) {
          const badge = document.createElement('span');
          badge.style.cssText =
            'font-size:9px;color:var(--text-muted,#666);padding:1px 4px;background:var(--bg-elevated,#333);border-radius:3px;';
          badge.textContent = ch.children.length;
          item.append(badge);
        }
        rows.listen(item, 'click', () => {
          if (rows.current()) select(id, ch);
        });
        rows.listen(item, 'focus', () => {
          if (rows.current()) focused = id;
        });
        rows.listen(item, 'mouseenter', () => {
          if (rows.current() && !isActive) item.style.background = 'var(--bg-hover,#2a2a3a)';
        });
        rows.listen(item, 'mouseleave', () => {
          if (rows.current() && !isActive) item.style.background = '';
        });
        root.append(item);
        if (hasChildren && !isCollapsed) renderLevel(ch.children, depth + 1, rows);
      }
    }
    owner.listen(root, 'keydown', (event) => {
      if (
        !owner.current() ||
        event.defaultPrevented ||
        event.isComposing ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey
      )
        return;
      const items = visible();
      if (!items.length) return;
      let index = items.indexOf(document.activeElement);
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        index =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? items.length - 1
              : event.key === 'ArrowDown'
                ? Math.min(items.length - 1, index + 1)
                : Math.max(0, index - 1);
        focus(records.get(items[index]).id);
        return;
      }
      index = Math.max(0, index);
      const record = records.get(items[index]);
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        select(record.id, record.ch);
        return;
      }
      if (event.key === 'ArrowRight' && record.hasChildren) {
        event.preventDefault();
        if (collapsed.has(record.id)) {
          toggle(record.id);
          focus(record.id);
        } else if (items[index + 1]) focus(records.get(items[index + 1]).id);
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        if (record.hasChildren && !collapsed.has(record.id)) {
          toggle(record.id);
          focus(record.id);
        } else
          for (let at = index - 1; at >= 0; at--) {
            const parent = records.get(items[at]);
            if (parent.depth < record.depth) {
              focus(parent.id);
              break;
            }
          }
      }
    });
    function getFlat(chapters = opts.chapters, result = []) {
      for (const ch of chapters) {
        result.push(ch);
        if (ch.children) getFlat(ch.children, result);
      }
      return result;
    }
    function findPath(chapters, id, path = []) {
      for (const ch of chapters) {
        const next = [...path, ch];
        if (ch.id === id) return next;
        if (ch.children) {
          const found = findPath(ch.children, id, next);
          if (found) return found;
        }
      }
      return null;
    }
    render();
    return {
      render,
      refresh: render,
      current: () => owner.current(),
      destroy: () => owner.destroy(),
      getFlat,
      getActive: () => active,
      setActive(id) {
        if (owner.current()) {
          active = id;
          render();
        }
      },
      expandAll() {
        if (owner.current()) {
          collapsed.clear();
          save();
          render();
        }
      },
      collapseAll() {
        if (owner.current()) {
          getFlat().forEach((ch) => {
            if (ch.children?.length) collapsed.add(ch.id);
          });
          save();
          render();
        }
      },
      reveal(id) {
        if (!owner.current()) return;
        const path = findPath(opts.chapters, id);
        if (path) {
          path.slice(0, -1).forEach((ch) => collapsed.delete(ch.id));
          save();
          render();
        }
      },
      setChapters(chapters) {
        if (owner.current()) {
          opts.chapters = chapters;
          render();
        }
      },
      setGetStatus(fn) {
        if (owner.current()) opts.getStatus = fn;
      }
    };
  }
  return { create };
})();
window.ChapterTree = ChapterTree;
