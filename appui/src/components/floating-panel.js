/* Reusable floating AI-chat panel. Each create call owns one panel and chat. */
const AppUIFloatingPanel = (() => {
  function create(options = {}) {
    const config = {position: 'bottom-right', icon: '🤖', title: 'AI Assistant', width: 380, height: 500, backend: 'kiro', placeholder: 'Ask anything…', ...options};
    let panel, button, chat, minimized = false, panelScope = null;
    injectStyles();

    function position() {
      const right = config.position.includes('right');
      const bottom = config.position.includes('bottom');
      return {right, bottom, edge: `${bottom ? 'bottom' : 'top'}:24px;${right ? 'right' : 'left'}:24px`};
    }
    function init() {
      destroy();
      const owner = AppUILifecycle.createScope();
      panelScope = owner;
      const place = position();
      button = document.createElement('button');
      button.type = 'button'; button.className = 'appui-floating-panel-button'; button.textContent = config.icon;
      button.style.cssText = `${place.edge};`; owner.listen(button, 'click', () => { if (!owner.destroyed) toggle(); }); document.body.appendChild(button);
      panel = document.createElement('section'); panel.className = 'appui-floating-panel';
      panel.style.cssText = `${place.edge.replace('24px', '80px')};width:${config.width}px;height:${config.height}px;`;
      const header = document.createElement('header'); header.className = 'appui-floating-panel-header';
      header.innerHTML = `<strong>${config.icon} ${config.title}</strong><span><button type="button" data-action="minimize" title="Minimize">−</button><button type="button" data-action="close" title="Close">×</button></span>`;
      const content = document.createElement('div'); content.className = 'appui-floating-panel-content'; panel.append(header, content); document.body.appendChild(panel);
      owner.listen(header.querySelector('[data-action="close"]'), 'click', () => { if (!owner.destroyed) close(); });
      owner.listen(header.querySelector('[data-action="minimize"]'), 'click', () => { if (!owner.destroyed) toggleMinimize(); });
      chat = AppUIChat.create({container: content, system: config.system, backend: config.backend, model: config.model, tools: config.tools, context: config.context, clipboard: config.clipboard, placeholder: config.placeholder});
      const ownedChat = chat;
      owner.add(typeof ownedChat?.destroy === 'function' ? ownedChat : () => ownedChat?.cancel?.());
      owner.add(makeDraggable(header, panel)); return api;
    }
    function open() { if (panel) panel.hidden = false; }
    function close() { if (panel) panel.hidden = true; }
    function toggle() { if (panel?.hidden) open(); else close(); }
    function toggleMinimize() { minimized = !minimized; panel?.classList.toggle('is-minimized', minimized); }
    function send(text) { chat?.send(text); }
    function clear() { chat?.clear(); }
    function prefill(text) { open(); const input = chat?.container?.querySelector('.ai-chat-input'); if (input) { input.value = text; input.focus(); } }
    function setContext(context) { config.context = context; chat?.setContext?.(context); }
    function getChat() { return chat; }
    function destroy() {
      const owner = panelScope, retiredPanel = panel, retiredButton = button;
      panelScope = null; panel = null; button = null; chat = null; minimized = false;
      try { owner?.destroy(); }
      finally { retiredPanel?.remove(); retiredButton?.remove(); }
    }
    function makeDraggable(handle, target) {
      return window.AppUIPointerGesture.bind(handle, {
        cursor: 'move',
        shouldStart: event => panel === target && !event.target.closest('button'),
        ...window.AppUIPointerGesture.positionHandlers(target,{onMove() {
          target.style.right = 'auto'; target.style.bottom = 'auto';
        }}),
      });
    }
    const api = {init, open, close, toggle, send, clear, prefill, setContext, getChat, destroy};
    return init();
  }
  function injectStyles() {
    if (document.getElementById('appui-floating-panel-styles')) return;
    const style = document.createElement('style'); style.id = 'appui-floating-panel-styles';
    style.textContent = '.appui-floating-panel-button{position:fixed;z-index:9998;width:48px;height:48px;border:0;border-radius:50%;background:var(--accent);color:var(--text-inverse);font-size:22px;cursor:pointer;box-shadow:var(--shadow-md)}.appui-floating-panel{position:fixed;z-index:9999;display:flex;flex-direction:column;min-width:280px;min-height:240px;max-width:calc(100vw - 48px);max-height:calc(100vh - 104px);overflow:hidden;border:1px solid var(--border);border-radius:12px;background:var(--bg-primary);box-shadow:var(--shadow-lg)}.appui-floating-panel[hidden]{display:none}.appui-floating-panel-header{display:flex;justify-content:space-between;align-items:center;padding:8px 14px;background:var(--bg-secondary);cursor:move}.appui-floating-panel-header button{border:0;background:none;color:inherit;font-size:18px;cursor:pointer}.appui-floating-panel-content{flex:1;min-height:0;display:flex}.appui-floating-panel.is-minimized{height:auto!important;min-height:0}.appui-floating-panel.is-minimized .appui-floating-panel-content{display:none}';
    document.head.appendChild(style);
  }
  return {create};
})();
window.AppUIFloatingPanel = AppUIFloatingPanel;
