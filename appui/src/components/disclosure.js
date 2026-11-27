/* Bind an expandable section without replacing page or component markup. */
var AppUIDisclosure = window.AppUIDisclosure || (() => {
  let serial = 0;
  function bind({trigger, panel, expanded = !panel?.hidden, onToggle} = {}) {
    if (!trigger || !panel) throw new Error('Disclosure requires a trigger and panel');
    const scope = AppUILifecycle.createScope();
    let open = !!expanded;
    const native = trigger.tagName === 'BUTTON' || (trigger.tagName === 'INPUT' && ['button', 'submit', 'reset'].includes(trigger.type));
    if (!panel.id) panel.id = 'ui-disclosure-' + ++serial;
    trigger.setAttribute('aria-controls', panel.id);
    if (!native) {trigger.setAttribute('role', 'button'); trigger.tabIndex = 0;}
    else if (trigger.tagName === 'BUTTON' && !trigger.getAttribute('type')) trigger.type = 'button';

    function apply() {panel.hidden = !open; trigger.setAttribute('aria-expanded', String(open));}
    function setExpanded(value, notify = true) {
      if (scope.destroyed) return;
      const next = !!value, changed = next !== open;
      open = next; apply();
      if (changed && notify) onToggle?.(open);
    }
    function interactiveChild(event) {
      const control = event.target?.closest?.('button,a,input,select,textarea,[contenteditable="true"]');
      return control && control !== trigger && trigger.contains(control);
    }
    const toggle = () => setExpanded(!open);
    scope.listen(trigger, 'click', event => {
      if (!interactiveChild(event) && !trigger.disabled && trigger.getAttribute('aria-disabled') !== 'true') toggle();
    });
    if (!native) scope.listen(trigger, 'keydown', event => {
      if (event.isComposing || !['Enter', ' '].includes(event.key) || interactiveChild(event)) return;
      event.preventDefault();
      if (!event.repeat && !trigger.disabled && trigger.getAttribute('aria-disabled') !== 'true') toggle();
    });
    apply();
    return {setExpanded, toggle, expand: () => setExpanded(true), collapse: () => setExpanded(false),
      isExpanded: () => open, destroy: () => scope.destroy()};
  }
  return {bind};
})();
window.AppUIDisclosure = AppUIDisclosure;
