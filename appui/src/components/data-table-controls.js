/* Private standard controls for DataTable cells; row contexts own every binding. */
window._AppUIDataTableControls = (() => {
  const current = (context, isCurrent) => isCurrent() && context.current();

  function actions(cell, definition, item, context, isCurrent) {
    cell.classList.add('appui-dt-actions');
    const controls = typeof definition === 'function' ? definition(item) : definition;
    for (const action of controls || []) {
      if (!action || !current(context, isCurrent)) continue;
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = action.label ?? '';
      button.disabled = !!action.disabled;
      if (action.title != null) button.title = String(action.title);
      if (action.className) button.className = action.className;
      if (action.ariaLabel != null) button.setAttribute('aria-label', action.ariaLabel);
      if (action.ariaPressed != null) button.setAttribute('aria-pressed', String(action.ariaPressed));
      context.listen(button, 'click', (event) => {
        if (!current(context, isCurrent) || button.disabled) return;
        event.stopPropagation();
        action.action?.(item, event);
      });
      cell.appendChild(button);
    }
  }

  function checkbox(cell, definition, item, context, isCurrent) {
    const control = typeof definition === 'function' ? definition(item) : definition;
    if (!control || !current(context, isCurrent)) return;
    cell.classList.add('appui-dt-checkbox');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = !!control.checked;
    input.disabled = !!control.disabled;
    if (control.title != null) input.title = String(control.title);
    if (control.className) input.className = control.className;
    if (control.ariaLabel != null) input.setAttribute('aria-label', control.ariaLabel);
    context.listen(input, 'click', (event) => {
      if (current(context, isCurrent)) event.stopPropagation();
    });
    context.listen(input, 'change', (event) => {
      if (current(context, isCurrent) && !input.disabled) {
        control.onChange?.(item, !!input.checked, event);
      }
    });
    cell.appendChild(input);
  }

  return { actions, checkbox };
})();
