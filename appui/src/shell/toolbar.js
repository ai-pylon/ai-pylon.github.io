/* Declarative toolbar renderer; command dispatch is supplied by the shell. */
window.AppUIShellToolbar = {
  create({el, runCommand}) {
    return {
      render(container, items = [], onAction) {
        if (!container) return null;
        const bar = el('div', 'ai-app-toolbar');
        for (const item of items) {
          if (item.separator) { bar.appendChild(el('div', 'ai-app-toolbar-sep')); continue; }
          const button = el('button', `ai-app-toolbar-btn${item.primary ? ' ai-app-toolbar-primary' : ''}`);
          button.type = 'button'; button.title = item.tooltip || item.label || item.id; button.textContent = `${item.icon ? `${item.icon} ` : ''}${item.label || ''}`;
          button.disabled = !!item.disabled; if (item.id) button.dataset.action = item.id;
          button.addEventListener('click', () => { if (item.action) item.action(); else if (onAction) onAction(item.id); else if (item.command) runCommand(item.command); });
          bar.appendChild(button);
        }
        container.appendChild(bar); return bar;
      },
    };
  },
};
