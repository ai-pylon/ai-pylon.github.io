/* Theme toggle button in the statusbar right section. */
window.AppUIShellThemeToggle = {
  mount(container) {
    const owner = AppUILifecycle.createScope();
    const btn = document.createElement('button');
    btn.className = 'ai-app-theme-toggle';
    btn.type = 'button';
    btn.title = 'Toggle dark/light theme';
    btn.setAttribute('aria-label', 'Toggle theme');
    const sync = theme => {
      btn.textContent = theme === 'light' ? '\u2600\uFE0F' : '\uD83C\uDF19';
      document.body.classList.toggle('light-theme', theme === 'light');
    };
    sync(AppUITheme.get());
    owner.listen(btn, 'click', () => {if (!owner.destroyed) sync(AppUITheme.toggle());});
    container.appendChild(btn);
    owner.add(() => btn.remove());
    return {element: btn, destroy: () => owner.destroy()};
  },
};
