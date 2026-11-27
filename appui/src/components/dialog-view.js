/* Private DOM construction for shared modal dialogs. */
window._AppUIDialogView = {
  create({opts,z,titleId,onClose,onAction}) {
    const title = opts.title || '';
    const body = opts.body || '';
    const buttons = opts.buttons || [{text: 'OK'}];
    const width = opts.width || '420px';
    const closable = opts.closable !== false;
    const overlay = document.createElement('div');
    overlay.className = 'ui-dialog-overlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:' + z + ';background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;font-family:system-ui,sans-serif;';

    const box = document.createElement('div');
    box.className = 'ui-dialog-box';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.style.cssText = 'background:var(--bg-elevated);border:1px solid var(--border);border-radius:8px;width:' + width + ';max-width:90vw;max-height:80vh;display:flex;flex-direction:column;box-shadow:var(--shadow-lg);color:var(--text-primary);overflow:hidden;';

    // Title bar
    const titleBar = document.createElement('div');
    titleBar.style.cssText = 'display:flex;align-items:center;padding:10px 16px;border-bottom:1px solid var(--border);flex-shrink:0;cursor:move;user-select:none;touch-action:none;';
    const titleEl = document.createElement('span');
    titleEl.id = titleId;
    box.setAttribute('aria-labelledby', titleEl.id);
    titleEl.style.cssText = 'font-weight:600;font-size:14px;flex:1;';
    titleEl.textContent = title;
    titleBar.appendChild(titleEl);
    if (closable) {
      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.setAttribute('aria-label', 'Close dialog');
      closeBtn.style.cssText = 'background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:18px;padding:0 4px;line-height:1;border-radius:4px;';
      closeBtn.textContent = '✕';
      closeBtn.onmouseenter = function() { this.style.color = 'var(--text-primary)'; this.style.background = 'var(--bg-hover)'; };
      closeBtn.onmouseleave = function() { this.style.color = 'var(--text-muted)'; this.style.background = 'none'; };
      closeBtn.onclick = function() { onClose(); };
      titleBar.appendChild(closeBtn);
    }
    box.appendChild(titleBar);

    // Content area
    const content = document.createElement('div');
    content.className = 'ui-dialog-content';
    content.style.cssText = 'padding:16px;flex:1;overflow-y:auto;font-size:13px;line-height:1.6;';
    if (body && typeof body.nodeType === 'number') content.appendChild(body);
    else content.innerHTML = body;
    box.appendChild(content);

    // Bottom button area
    if (buttons.length > 0) {
      const footer = document.createElement('div');
      footer.style.cssText = 'display:flex;align-items:center;justify-content:flex-end;gap:8px;padding:10px 16px;border-top:1px solid var(--border);flex-shrink:0;';
      // Which button gets the accent (primary) styling: honor an explicit
      // `primary:true` flag on any button when one is declared — so the POSITIVE
      // action (Apply/Save/OK) is highlighted regardless of position. Only fall
      // back to "first button is primary" when NO button declares the flag
      // (keeps legacy dialogs that relied on first-is-primary unchanged).
      const flaggedPrimary = buttons.findIndex(b => b && b.primary);
      const primaryIndex = flaggedPrimary >= 0 ? flaggedPrimary : 0;
      buttons.forEach((b, i) => {
        const btn = document.createElement('button');
        const isPrimary = i === primaryIndex;
        if (isPrimary) btn.className = 'ui-dialog-primary';
        btn.style.cssText = isPrimary
          ? 'background:var(--accent);color:var(--text-inverse);border:none;border-radius:4px;padding:6px 18px;cursor:pointer;font-size:13px;font-weight:500;'
          : 'background:var(--bg-secondary);color:var(--text-primary);border:1px solid var(--border);border-radius:4px;padding:6px 18px;cursor:pointer;font-size:13px;';
        btn.textContent = b.text || 'OK';
        btn.disabled = !!b.disabled;
        btn.onclick = () => { if (!btn.disabled) onAction(b); };
        footer.appendChild(btn);
      });
      box.appendChild(footer);
    }

    overlay.appendChild(box);
    return {overlay,box,content,titleBar};
  }
};
