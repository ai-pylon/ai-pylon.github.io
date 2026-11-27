/* Private DOM, styles and viewport placement for shared context menus. */
window._AppUIContextMenuView = (()=>{
  function injectStyles() {
    if (document.getElementById('ui-context-menu-css')) return;
    const style = document.createElement('style');
    style.id = 'ui-context-menu-css';
    style.textContent = `
      .ui-context-menu {
        position: fixed;
        z-index: 99999;
        background: var(--bg-elevated, #fff);
        border: 1px solid var(--border, #ddd);
        border-radius: 6px;
        box-shadow: var(--shadow-md, 0 2px 5px rgba(0,0,0,.2));
        min-width: 160px;
        padding: 4px 0;
        font-size: 13px;
        /* A long menu (many actions) can exceed the viewport — cap it to the
           visible height and let it SCROLL instead of overflowing off-screen
           (items below the fold were unreachable). The max-height is refined
           per-open to the actual space at the click point (see position()). */
        max-height: calc(100vh - 16px);
        overflow-y: auto;
        overflow-x: hidden;
        overscroll-behavior: contain;
      }
      .ui-context-menu button {
        display: block;
        width: 100%;
        text-align: left;
        padding: 7px 14px;
        border: none;
        background: none;
        cursor: pointer;
        font: inherit;
        color: var(--text-primary, #222);
      }
      .ui-context-menu button:hover:not(:disabled) { background: var(--bg-hover, #f0f0f0); }
      .ui-context-menu button:disabled { opacity: 0.4; cursor: default; }
      .ui-context-menu button.danger { color: var(--color-error); }
      .ui-context-menu button.danger:hover:not(:disabled) { background: var(--bg-hover); }
      .ui-context-menu button.has-submenu::after { content: '▸'; float: right; opacity: 0.5; }
      .ui-context-menu hr { margin: 4px 0; border: none; border-top: 1px solid var(--border-light); }
    `;
    document.head.appendChild(style);
  }
  function menu() {
    const element=document.createElement('div');element.className='ui-context-menu';return element;
  }
  function row(item,submenus) {
    const button=document.createElement('button');button.type='button';button.textContent=item.label||'';
    button.disabled=!!item.disabled;
    if(item.danger)button.classList.add('danger');
    if(item.submenu&&submenus)button.classList.add('has-submenu');
    return button;
  }
  function dimensions(element) {
    return {width:element.offsetWidth,height:element.offsetHeight,viewportWidth:window.innerWidth,viewportHeight:window.innerHeight};
  }
  function applyPosition(element,{left,top}) {element.style.left=`${left}px`;element.style.top=`${top}px`;}
  function position(element,x,y) {
    // VIEWPORT-AWARE HEIGHT: when the menu is taller than the space at the click
    // point, cap its height to the larger of (space below) / (space above) the
    // click so it scrolls within the viewport instead of extending off-screen.
    // Reset any prior cap first (the element is reused across opens), measure,
    // then place via the shared fitter using the (possibly capped) height.
    const MARGIN = 8;
    try {
      element.style.maxHeight = '';
      const vh = window.innerHeight;
      const natural = element.offsetHeight;
      const below = vh - y - MARGIN;        // room if opened downward from the click
      const above = y - MARGIN;             // room if opened upward from the click
      const avail = Math.max(below, above);
      if (natural > avail) element.style.maxHeight = `${Math.max(120, avail)}px`;
    } catch (e) { /* best-effort — fall back to the CSS calc() cap */ }
    applyPosition(element,window._AppUIPopupPlacement.fit({x,y,...dimensions(element)}));
  }
  function positionSubmenu(element,rect) {
    try {
      element.style.maxHeight = '';
      const vh = window.innerHeight;
      if (element.offsetHeight > vh - 16) element.style.maxHeight = `${vh - 16}px`;
    } catch (e) {}
    applyPosition(element,window._AppUIPopupPlacement.submenu({anchor:rect,gap:2,...dimensions(element)}));
  }
  return {injectStyles,menu,row,position,positionSubmenu,separator:()=>document.createElement('hr')};
})();
