/* Private floating-sidebar DOM; the dock controller owns state and geometry. */
window._AppUISidebarDockView = {
  create({side,title,element,owner,position,onMinimize,onDock,onRestore}) {
    const {width,height,top,left} = position;
    // Create floating panel
    const panel = document.createElement('section');
    panel.className = `appui-sidebar-dock-panel appui-sidebar-dock-${side}`;
    panel.style.cssText = `position:fixed;z-index:9990;top:${top}px;left:${left}px;width:${width}px;height:${height}px;`;
    panel.setAttribute('aria-label', title || `${side} sidebar (floating)`);

    // Header with title and dock button
    const header = document.createElement('header');
    header.className = 'appui-sidebar-dock-header';
    const titleElement = document.createElement('span');
    titleElement.className = 'appui-sidebar-dock-title';
    titleElement.textContent = title || (side === 'left' ? 'Left Panel' : 'Right Panel');
    header.appendChild(titleElement);

    const controls = document.createElement('span');
    controls.className = 'appui-sidebar-dock-controls';

    const minimizeBtn = document.createElement('button');
    minimizeBtn.type = 'button';
    minimizeBtn.className = 'appui-sidebar-dock-btn';
    minimizeBtn.title = 'Minimize to button';
    minimizeBtn.textContent = '−';
    owner.listen(minimizeBtn, 'click', () => { if (!owner.destroyed) onMinimize(); });
    controls.appendChild(minimizeBtn);

    const dockBtn = document.createElement('button');
    dockBtn.type = 'button';
    dockBtn.className = 'appui-sidebar-dock-btn';
    dockBtn.title = 'Dock back to sidebar';
    dockBtn.textContent = side === 'left' ? '⏴' : '⏵';
    owner.listen(dockBtn, 'click', () => { if (!owner.destroyed) onDock(); });
    controls.appendChild(dockBtn);

    header.appendChild(controls);
    panel.appendChild(header);

    // Minimized floating bar (hidden by default)
    const minBar = document.createElement('button');
    minBar.type = 'button';
    minBar.className = `appui-sidebar-dock-minbar appui-sidebar-dock-minbar-${side}`;
    minBar.title = title || (side === 'left' ? 'Left Panel' : 'Right Panel');
    minBar.textContent = (title || (side === 'left' ? 'Left' : 'Right'));
    minBar.hidden = true;
    owner.listen(minBar, 'click', () => { if (!owner.destroyed) onRestore(); });
    document.body.appendChild(minBar);

    // Content area — move sidebar children here
    const content = document.createElement('div');
    content.className = 'appui-sidebar-dock-content';
    // Keep the docked-side control out of the floating header's hit area.
    Array.from(element.childNodes).forEach(child => {
      if (!child.classList?.contains('appui-sidebar-undock-btn')) content.appendChild(child);
    });
    panel.appendChild(content);

    // Resize handle (bottom-right corner)
    const resizeHandle = document.createElement('div');
    resizeHandle.className = 'appui-sidebar-dock-resize';
    panel.appendChild(resizeHandle);

    document.body.appendChild(panel);

    return {panel,header,resizeHandle};
  }
};
