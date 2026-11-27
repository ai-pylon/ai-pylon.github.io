/* Clipboard feedback for an existing button. Transport stays in AppUICore. */
var AppUICopyButton = window.AppUICopyButton || (() => {
  const states = new WeakMap();
  function reset(button) {
    const state = states.get(button);
    if (!state) return;
    clearTimeout(state.timer);
    button.textContent = state.label;
    states.delete(button); // Invalidate a clipboard write that is still pending.
  }

  // Resolves true only when the clipboard write succeeds. Repeated clicks keep
  // the original label; a late result from an older click cannot overwrite it.
  async function copy(button, text, {successText = 'Copied', errorText = 'Copy failed',
    duration = 1200, fallbackOnError = false} = {}) {
    const previous = states.get(button);
    clearTimeout(previous?.timer);
    const state = {label: previous ? previous.label : button.textContent, timer: null};
    states.set(button, state);
    let ok = false;
    try {
      await AppUICore.copyText(typeof text === 'function' ? text() : text, {fallbackOnError});
      ok = true;
    } catch (_error) { /* Report rejection on the button; never claim success. */ }
    if (states.get(button) !== state) return ok;
    button.textContent = ok ? successText : errorText;
    state.timer = setTimeout(() => {
      if (states.get(button) === state) reset(button);
    }, duration);
    return ok;
  }

  function bind(button, text, options) {
    const onClick = event => {
      event.preventDefault();
      if (!button.disabled && button.getAttribute('aria-disabled') !== 'true') copy(button, text, options);
    };
    button.addEventListener('click', onClick);
    let destroyed = false;
    return {destroy() {
      if (destroyed) return;
      destroyed = true;
      button.removeEventListener('click', onClick);
      reset(button);
    }};
  }
  return {copy, bind, reset};
})();
window.AppUICopyButton = AppUICopyButton;
