/* Workflow prompt presentation; transport and prompt state stay in the controller. */
window._AppUIWorkflowPromptView = {
  create({ parent, idOf, onRespond, onDispose }) {
    const banner = document.createElement('div');
    banner.id = 'wf-prompt-banner';
    banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99998;display:none';
    document.body.appendChild(banner);
    const owner = AppUILifecycle.createViewScope({ host: banner, parent, pagehide: false });
    const views = AppUILifecycle.createKeyedScopes({ parent: owner });
    owner.add(views);
    const drafts = new Map();
    owner.add(() => drafts.clear());
    const style = document.createElement('style');
    style.textContent = `
      #wf-prompt-banner { font-family: var(--font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif); }
      .wf-prompt-item { display:flex; align-items:center; gap:12px; padding:10px 16px; background:var(--bg-elevated, #1e1e2e); border-bottom:2px solid var(--accent, #4a9eff); color:var(--text-primary, #e0e0e0); font-size:13px; animation: wf-prompt-slide 0.3s ease; }
      .wf-prompt-item .wf-prompt-icon { font-size:18px; flex-shrink:0; }
      .wf-prompt-item .wf-prompt-msg { flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .wf-prompt-item .wf-prompt-wf { font-size:10px; color:var(--text-muted, #888); margin-left:4px; }
      .wf-prompt-item .wf-prompt-actions { display:flex; gap:6px; flex-shrink:0; }
      .wf-prompt-item .wf-prompt-btn { padding:5px 12px; border:none; border-radius:4px; cursor:pointer; font-size:12px; font-weight:600; transition:opacity 0.2s; }
      .wf-prompt-item .wf-prompt-btn:hover { opacity:0.85; }
      .wf-prompt-item .wf-prompt-btn:disabled { opacity:0.4; cursor:default; }
      .wf-prompt-btn-approve { background:var(--color-success, #4caf50); color:var(--text-inverse, #fff); }
      .wf-prompt-btn-reject { background:var(--bg-hover, #666); color:var(--text-inverse, #fff); }
      .wf-prompt-btn-input { background:var(--bg-primary, #0d0d1a); color:var(--text-primary, #e0e0e0); border:1px solid var(--border, #333) !important; min-width:120px; font-weight:400 !important; }
      .wf-prompt-choices { display:flex; gap:4px; flex-wrap:wrap; }
      .wf-prompt-choices button { padding:4px 10px; font-size:11px; border:1px solid var(--border, #333); border-radius:3px; background:var(--bg-primary, #0d0d1a); color:var(--text-primary, #e0e0e0); cursor:pointer; }
      .wf-prompt-choices button:hover { border-color:var(--accent, #4a9eff); color:var(--accent, #4a9eff); }
      @keyframes wf-prompt-slide { from { transform:translateY(-100%); opacity:0; } to { transform:translateY(0); opacity:1; } }
    `;
    document.head.appendChild(style);
    owner.add(() => {
      banner.remove();
      style.remove();
      onDispose?.();
    });

    function text(className, value) {
      const node = document.createElement('span');
      node.className = className;
      node.textContent = value;
      return node;
    }
    function createPrompt(prompt, row, states) {
      const id = idOf(prompt),
        mode = prompt.type || prompt.mode || 'confirm';
      const state = states.get(id),
        disabled = !!state;
      const card = document.createElement('div'),
        message = text('wf-prompt-msg', prompt.message || 'Workflow requires input');
      card.className = 'wf-prompt-item';
      card.dataset.promptId = id;
      if (prompt.workflow) message.appendChild(text('wf-prompt-wf', '(' + prompt.workflow + ')'));
      const controls = document.createElement('div');
      controls.className = 'wf-prompt-actions';
      card.append(text('wf-prompt-icon', '\u2753'), message, controls);
      if (state?.status === 'responded') {
        card.style.opacity = '0.5';
        message.textContent = state.action === 'reject' ? '\u2717 Rejected' : '\u2713 Responded';
      }
      const toolbar = AppUI.components.Toolbar.create({
        container: controls,
        signal: row.signal,
        label: 'Workflow prompt response'
      });
      toolbar.element.style.cssText += ';padding:0;border:0;background:transparent';
      row.add(toolbar);
      function button(label, action, value, className = '') {
        const control = toolbar.append({
          label,
          disabled,
          className: ['wf-prompt-btn', className].filter(Boolean).join(' '),
          action: () => {
            if (row.current())
              onRespond(prompt, action, typeof value === 'function' ? value() : value, row);
          }
        });
        control.dataset.run = id;
        control.dataset.action = action;
        if (value !== undefined && typeof value !== 'function')
          control.dataset.value = String(value);
        return control;
      }
      if (['confirm', 'approve', 'approval'].includes(mode)) {
        button('\u2713 Yes', 'approve', undefined, 'wf-prompt-btn-approve');
        button('\u2717 No', 'reject', undefined, 'wf-prompt-btn-reject');
      } else if (mode === 'input') {
        const input = toolbar.append({
          type: 'input',
          value: drafts.has(id) ? drafts.get(id) : (state?.value ?? prompt.default ?? ''),
          onInput: (value) => drafts.set(id, value),
          placeholder: 'Type response...',
          className: 'wf-prompt-btn wf-prompt-btn-input'
        });
        input.dataset.run = id;
        input.setAttribute('aria-label', 'Workflow response');
        button('Send', 'respond', () => input.value, 'wf-prompt-btn-approve');
        button('Cancel', 'reject', undefined, 'wf-prompt-btn-reject');
        row.listen(input, 'keydown', (event) => {
          if (event.key === 'Enter' && !event.isComposing) {
            event.preventDefault();
            onRespond(prompt, 'respond', input.value, row);
          }
        });
      } else if (mode === 'choice') {
        for (const value of Array.isArray(prompt.options) ? prompt.options : [])
          button(String(value), 'respond', String(value));
        button('Cancel', 'reject', undefined, 'wf-prompt-btn-reject');
      }
      return card;
    }
    function render(prompts, states) {
      if (!owner.current()) return;
      const present = new Set(prompts.map(idOf));
      for (const id of drafts.keys()) if (!present.has(id)) drafts.delete(id);
      const rows = views.begin('rows');
      banner.replaceChildren();
      banner.style.display = prompts.length ? 'block' : 'none';
      if (!prompts.length) return;
      const grid = AppUI.components.GridView.create({
        container: banner,
        signal: rows.signal,
        columns: 1,
        gap: 0,
        padding: 0,
        viewMode: 'grid',
        persistKey: false,
        selectable: false,
        renderItem: (prompt, row) => createPrompt(prompt, row, states)
      });
      rows.add(grid);
      grid.setItems(prompts);
    }
    return { render, current: () => owner.current(), destroy: () => owner.destroy() };
  }
};
