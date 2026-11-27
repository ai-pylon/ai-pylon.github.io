/**
 * UI/Dialog  --  modal dialog, confirm, and prompt.
 *
 * Layout:
 *   +- Title -------------------- [✕] -+
 *   |                                    |
 *   |  Content                           |
 *   |                                    |
 *   +------------------------------------+
 *   |              [Cancel] [OK]         |
 *   +------------------------------------+
 *
 * Usage:
 *   AppUIDialog.show({title:'Confirm', body:'Are you sure?', buttons:[{text:'Yes',action:fn}]});
 *   AppUIDialog.confirm('Delete this?', () => doDelete());
 *   AppUIDialog.prompt('Enter name', 'default', (val) => rename(val));
 */
var AppUIDialog = window.AppUIDialog || (function() {
  // Stack of open dialogs (LIFO). Each entry: {overlay, keyHandler, focusTimer}.
  // Dialogs STACK — opening a new one renders it ABOVE the current instead of
  // replacing it, so a dialog can open another dialog (e.g. an image preview
  // over a detail dialog). ``close()`` closes only the TOPMOST; Escape /
  // overlay-click / a button close the dialog they belong to. Back-compat: the
  // public API (show/close/confirm/prompt/form) is unchanged; single-dialog
  // callers behave exactly as before.
  const _stack = [];
  let _dialogSerial = 0;
  const _BASE_Z = 99999;   // first dialog z-index; each stacked level adds +10

  function _top() { return _stack.length ? _stack[_stack.length - 1] : null; }

  const _background = new Map();
  let _backgroundObserver = null;
  function _isolate() {
    const top = _top();
    if (!top) {
      _backgroundObserver?.disconnect();
      _backgroundObserver = null;
      _background.forEach((value, element) => {
        if (value === null) element.removeAttribute('inert');
        else element.setAttribute('inert', value);
      });
      _background.clear();
      return;
    }
    Array.from(document.body.children).forEach(element => {
      if (!_background.has(element)) _background.set(element, element.getAttribute('inert'));
      if (element === top.overlay) element.removeAttribute('inert');
      else element.setAttribute('inert', '');
    });
    if (!_backgroundObserver) {
      _backgroundObserver = new MutationObserver(_isolate);
      _backgroundObserver.observe(document.body, {childList: true});
    }
  }
  function _focusable(box) {
    return Array.from(box.querySelectorAll('a[href],button,input,textarea,select,[tabindex],[contenteditable="true"]'))
      .filter(element => !element.matches(':disabled') && element.tabIndex >= 0 &&
        !element.closest('[inert]') && element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden');
  }
  function _focus(entry) {
    if (!entry || !entry.overlay.isConnected) return;
    const items = _focusable(entry.box);
    (items.find(element => element.matches('input,textarea,select')) ||
      items.find(element => element.classList.contains('ui-dialog-primary')) || items[0] || entry.box).focus();
  }

  function show(opts) {
    if (opts.signal?.aborted) {opts.onClose?.();return null;}
    const closable = opts.closable !== false;
    const opener = document.activeElement;

    // Do NOT close existing dialogs — stack on top. z-index rises per level so
    // the new overlay (and its darkening backdrop) sits above the ones below.
    const z = _BASE_Z + _stack.length * 10;
    const {overlay,box,content,titleBar}=window._AppUIDialogView.create({opts,z,
      titleId:'ui-dialog-title-'+(++_dialogSerial),onClose:()=>_closeOverlay(overlay),
      onAction:button=>{
        if(!overlay.isConnected||!_stack.some(entry=>entry.overlay===overlay)||opts.signal?.aborted)return;
        if(button.action?.()===false)return;
        _closeOverlay(overlay);
      }
    });
    // Close on a genuine OUTSIDE click only. A click whose target is the overlay
    // can be the TAIL of a text-selection drag that STARTED inside the box and
    // ended on the overlay (mousedown in box → drag → mouseup on overlay fires a
    // `click` targeted at the overlay) — that must NOT close the dialog. So we
    // require the pointer to have gone DOWN on the overlay itself, not inside the
    // box. Track the mousedown origin and only close when both down and up/click
    // happened on the overlay backdrop.
    let _downOnOverlay = false;
    overlay.addEventListener('mousedown', (e) => { _downOnOverlay = (e.target === overlay); });
    overlay.addEventListener('click', (e) => {
      const ok = _downOnOverlay && e.target === overlay && closable;
      _downOnOverlay = false;
      if (ok) _closeOverlay(overlay);
    });
    document.body.appendChild(overlay);

    const drag = _AppUIDialogDrag.bind({overlay, box, titleBar});

    box.tabIndex = -1;
    const focusTimer = setTimeout(() => {
      if (_top()?.overlay === overlay) _focus(_top());
    }, 50);

    // Escape closes only the TOP dialog (this one, while it stays on top).
    const keyHandler = (e) => {
      if (_top()?.overlay !== overlay) return;
      if (e.key === 'Tab') {
        const items = _focusable(box);
        const index = items.indexOf(document.activeElement);
        if (!items.length || index < 0 || (!e.shiftKey && index === items.length - 1) || (e.shiftKey && index === 0)) {
          e.preventDefault();
          (items[e.shiftKey ? items.length - 1 : 0] || box).focus();
        }
      }
      if (e.key === 'Escape' && closable) {
        e.preventDefault();
        e.stopImmediatePropagation();
        _closeOverlay(overlay);
      }
    };
    document.addEventListener('keydown', keyHandler, true);
    const focusHandler = event => {
      if (_top()?.overlay === overlay && !box.contains(event.target)) _focus(_top());
    };
    document.addEventListener('focusin', focusHandler);

    // Stop keyboard shortcuts from leaking out of dialog inputs (except Escape)
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') return; // let Escape bubble to close the dialog
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') {
        e.stopPropagation();
      }
    });

    const abortHandler = () => _closeOverlay(overlay);
    _stack.push({overlay, box, opener, drag, keyHandler, focusHandler, focusTimer, onClose: opts.onClose, signal:opts.signal, abortHandler});
    _isolate();
    _focus(_top());
    opts.signal?.addEventListener('abort', abortHandler, {once:true});
    if (opts.signal?.aborted) abortHandler();
    return overlay;
  }

  // Tear down a specific overlay (from its own close button / backdrop / Escape),
  // regardless of stack position, and remove it from the stack.
  function _closeOverlay(overlay) {
    for (let i = _stack.length - 1; i >= 0; i--) {
      if (_stack[i].overlay === overlay) {
        const entry = _stack[i];
        const wasTop = entry === _top();
        entry.drag.destroy();
        if (entry.focusTimer != null) clearTimeout(entry.focusTimer);
        entry.signal?.removeEventListener('abort', entry.abortHandler);
        document.removeEventListener('keydown', entry.keyHandler, true);
        document.removeEventListener('focusin', entry.focusHandler);
        try { entry.overlay.remove(); } catch (_e) { /* ignore */ }
        _stack.splice(i, 1);
        _isolate();
        if (wasTop) {
          const top = _top();
          if (entry.opener?.isConnected && !entry.opener.closest('[inert]') && (!top || top.box.contains(entry.opener))) entry.opener.focus();
          else _focus(top);
        }
        if (entry.onClose) entry.onClose();
        return;
      }
    }
  }

  // With an overlay, close that instance; otherwise close the topmost dialog.
  function close(overlay) {
    if (overlay) { _closeOverlay(overlay); return; }
    const t = _top();
    if (t) _closeOverlay(t.overlay);
  }

  const {confirm, confirmAsync, prompt, form} = _AppUIDialogForms.create({show, close});
  const job = _AppUIDialogJob.create({show,close});

  return { show, close, confirm, confirmAsync, prompt, form, job };
})();
window.AppUIDialog = AppUIDialog;
