/* Private markup for stacked sidebar sections; state and routing stay in the controller. */
window._AppUISidebarSectionView = {
  section(def, isCollapsed) {
    const collapsible = def.collapsible !== false;
    const section = document.createElement('div');
    section.className = 'sidebar-section';
    section.dataset.sectionId = def.id;

    // Header
    const header = document.createElement('div');
    header.className = 'sidebar-section-header';

    if (collapsible) {
      const twisty = document.createElement('span');
      twisty.className = 'sidebar-section-twisty';
      twisty.textContent = isCollapsed ? '▸' : '▾';
      header.appendChild(twisty);
    }

    const label = document.createElement('span');
    label.className = 'sidebar-section-label';
    label.textContent = def.label || def.id;
    header.appendChild(label);

    if (def.badge) {
      const badge = document.createElement('span');
      badge.className = 'sidebar-section-badge';
      badge.textContent = def.badge;
      header.appendChild(badge);
    }

    section.appendChild(header);

    // Optional header tools (e.g. a "+" button): clicks must not collapse/expand the section.
    if (def.tools) {
      const tools = document.createElement('span');
      tools.className = 'sidebar-section-tools';
      ['click', 'keydown', 'dblclick'].forEach(type => tools.addEventListener(type, e => e.stopPropagation()));
      const made = typeof def.tools === 'function' ? def.tools(tools) : def.tools;
      [].concat(made || []).forEach(n => { if (n) tools.appendChild(n); });
      header.appendChild(tools);
    }

    // Panel
    const panel = document.createElement('div');
    panel.className = 'sidebar-section-panel';
    panel.hidden = isCollapsed;
    section.appendChild(panel);
    return {section, header, panel};
  }
};
