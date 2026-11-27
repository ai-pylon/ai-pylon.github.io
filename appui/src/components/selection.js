/**
 * AppUISelection  --  multi-select for table/list rows
 *
 * Usage:
 *   const sel = AppUISelection.create({
 *     container: document.getElementById('fileRows'),
 *     rowSelector: '.file-row',
 *     onSelectionChange: (selected) => { console.log(selected.length, 'items selected'); }
 *   });
 *   sel.handleClick(row, event);  // Ctrl/Shift/normal click handling
 *   sel.selectAll();
 *   sel.deselectAll();
 *   sel.getSelected();  // returns Set of selected elements
 *   sel.count();
 *
 * Options:
 *   - container: DOM element containing the selectable rows
 *   - rowSelector: CSS selector for selectable rows (default: '.file-row')
 *   - activeClass: CSS class applied to selected rows (default: 'selected')
 *   - onSelectionChange(selectedSet): called whenever selection changes
 *   - onFocus(row): called when the focus row changes (for keyboard navigation)
 */
const AppUISelection = (function() {
  'use strict';

  function create(opts) {
    opts = opts || {};
    const container = opts.container;
    if (!container) throw new Error('AppUISelection: container is required');

    const rowSelector = opts.rowSelector || '.file-row';
    const activeClass = opts.activeClass || 'selected';

    let selectedRows = new Set();
    let focusedRow = null;
    const owner = AppUILifecycle.createScope();
    owner.add(() => {
      selectedRows.forEach(row => row.classList.remove(activeClass));
      selectedRows.clear(); focusedRow = null;
    });
    if (opts.signal) {
      owner.listen(opts.signal, 'abort', () => owner.destroy(), {once: true});
      if (opts.signal.aborted) owner.destroy();
    }

    function _getRows() {
      if (owner.destroyed) return [];
      return [...container.querySelectorAll(rowSelector)];
    }

    function _getRowIndex(row) {
      return _getRows().indexOf(row);
    }

    function _notify() {
      if (owner.destroyed) return;
      if (opts.onSelectionChange) opts.onSelectionChange(selectedRows);
    }

    function _setFocus(row) {
      if (owner.destroyed) return;
      focusedRow = row;
      if (row) {
        row.scrollIntoView({ block: 'nearest' });
        if (opts.onFocus) opts.onFocus(row);
      }
    }

    /**
     * Handle a click event on a row with Ctrl/Shift/normal logic.
     * @param {HTMLElement} row - The clicked row element
     * @param {MouseEvent} event - The click event
     */
    function handleClick(row, event) {
      if (owner.destroyed) return;
      const rows = _getRows();

      if (event.ctrlKey || event.metaKey) {
        // Toggle individual row
        if (selectedRows.has(row)) {
          row.classList.remove(activeClass);
          selectedRows.delete(row);
        } else {
          row.classList.add(activeClass);
          selectedRows.add(row);
        }
        _setFocus(row);
      } else if (event.shiftKey && focusedRow) {
        // Range select
        const from = _getRowIndex(focusedRow);
        const to = rows.indexOf(row);
        if (from < 0 || to < 0) return;
        const [lo, hi] = from < to ? [from, to] : [to, from];
        deselectAll();
        if (owner.destroyed) return;
        for (let i = lo; i <= hi; i++) {
          rows[i].classList.add(activeClass);
          selectedRows.add(rows[i]);
        }
      } else {
        // Normal click  --  select only this row
        deselectAll();
        if (owner.destroyed) return;
        row.classList.add(activeClass);
        selectedRows.add(row);
        _setFocus(row);
      }
      _notify();
    }

    function selectAll() {
      _getRows().forEach(r => {
        r.classList.add(activeClass);
        selectedRows.add(r);
      });
      _notify();
    }

    function deselectAll() {
      if (owner.destroyed) return;
      selectedRows.forEach(r => r.classList.remove(activeClass));
      selectedRows.clear();
      _notify();
    }

    function invertSelection() {
      _getRows().forEach(r => {
        if (selectedRows.has(r)) {
          r.classList.remove(activeClass);
          selectedRows.delete(r);
        } else {
          r.classList.add(activeClass);
          selectedRows.add(r);
        }
      });
      _notify();
    }

    function getSelected() {
      return selectedRows;
    }

    function count() {
      return selectedRows.size;
    }

    function getFocused() {
      return focusedRow;
    }

    function setFocused(row) {
      _setFocus(row);
    }

    /**
     * Move focus up/down by delta rows. Selects the new row (simple selection).
     * @param {number} delta - Number of rows to move (+1 = down, -1 = up)
     * @param {boolean} extend - If true, extend selection (shift behavior)
     */
    function moveFocus(delta, extend) {
      const rows = _getRows();
      if (!rows.length) return;
      let idx = focusedRow ? rows.indexOf(focusedRow) : -1;
      idx = Math.max(0, Math.min(rows.length - 1, idx + delta));
      const row = rows[idx];
      if (!extend) {
        deselectAll();
        if (owner.destroyed) return;
        row.classList.add(activeClass);
        selectedRows.add(row);
      } else {
        row.classList.add(activeClass);
        selectedRows.add(row);
      }
      _setFocus(row);
      _notify();
    }

    /**
     * Select rows matching a predicate.
     * @param {function} predicate - (row) => boolean
     */
    function selectByPredicate(predicate) {
      for (const r of _getRows()) {
        if (owner.destroyed) return;
        const matches = predicate(r);
        if (owner.destroyed) return;
        if (matches) {
          r.classList.add(activeClass);
          selectedRows.add(r);
        }
      }
      _notify();
    }

    function clear() {
      deselectAll();
      focusedRow = null;
    }

    return {
      handleClick,
      selectAll,
      deselectAll,
      invertSelection,
      getSelected,
      count,
      getFocused,
      setFocused,
      moveFocus,
      selectByPredicate,
      clear,
      destroy: () => owner.destroy(),
    };
  }

  return { create };
})();
window.AppUISelection = AppUISelection;
