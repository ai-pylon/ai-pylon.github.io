/* Shared preview plugin registry. Include this before preview plugins. */
(function (global) {
  'use strict';
  const plugins = [];
  const escape = value => { const node = document.createElement('span'); node.textContent = value == null ? '' : String(value); return node.innerHTML; };
  function ensureStyle() {
    if (document.getElementById('shared-preview-style')) return;
    const style = document.createElement('style'); style.id = 'shared-preview-style';
    style.textContent = '.preview-text{margin:0;white-space:pre-wrap;word-break:break-word;font:12px/1.55 ui-monospace,Consolas,monospace}.preview-code{margin:0;font:12px/1.5 ui-monospace,Consolas,monospace;overflow:auto}.preview-code-line{display:grid;grid-template-columns:48px 1fr;min-width:max-content}.preview-code-number{color:#778092;text-align:right;padding:0 10px 0 4px;border-right:1px solid #303643;user-select:none}.preview-code-source{padding-left:10px;white-space:pre}.preview-json{font:12px/1.5 ui-monospace,Consolas,monospace}.preview-json details{margin-left:12px}.preview-json summary{cursor:pointer;color:#83bfff}.preview-json .key{color:#83bfff}.preview-json .string{color:#9bd39b}.preview-json .number{color:#e8bf79}.preview-json .boolean{color:#d4a6ff}.preview-json .null{color:#9099aa}.preview-markdown{font:14px/1.6 system-ui,sans-serif}.preview-markdown h1,.preview-markdown h2,.preview-markdown h3{color:#dce9f8;margin:16px 0 8px}.preview-markdown h1{font-size:1.5em}.preview-markdown h2{font-size:1.25em}.preview-markdown h3{font-size:1.08em}.preview-markdown p{margin:0 0 10px}.preview-markdown ul{margin:0 0 10px;padding-left:22px}.preview-markdown pre{padding:10px;background:#111319;border:1px solid #303643;border-radius:4px;overflow:auto}.preview-markdown code{font:12px ui-monospace,Consolas,monospace}.preview-markdown :not(pre)>code{padding:1px 4px;background:#252b35;border-radius:3px}.preview-markdown blockquote{margin:8px 0;padding-left:10px;border-left:3px solid #4c6f91;color:#aeb7c8}.preview-image{display:block;max-width:100%;height:auto;margin:auto}.preview-dialog{position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.62);display:flex;align-items:center;justify-content:center;padding:4vh 4vw}.preview-dialog-card{width:min(1100px,100%);height:min(820px,100%);background:#1c2028;border:1px solid #3b4352;border-radius:7px;display:flex;flex-direction:column;box-shadow:0 16px 60px #000}.preview-dialog-head{display:flex;gap:10px;align-items:center;padding:10px 12px;border-bottom:1px solid #303643;font:12px ui-monospace,Consolas,monospace;color:#85c8ff}.preview-dialog-title{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.preview-dialog-close{border:0;background:transparent;color:#d9dde7;font-size:20px;cursor:pointer}.preview-dialog-body{padding:14px;overflow:auto;flex:1}';
    document.head.appendChild(style);
  }
  function register(plugin) { plugins.push(plugin); }
  function render(container, input) {
    ensureStyle(); container.replaceChildren();
    const value = typeof input === 'string' ? { content: input, path: '' } : (input || {});
    const plugin = [...plugins].reverse().find(item => item.name !== 'text' && item.test(value)) || plugins.find(item => item.name === 'text');
    if (plugin) plugin.render(container, value);
  }
  function openDialog(input, options) {
    ensureStyle();
    const settings = options || {};
    const overlay = document.createElement('div'); overlay.className = 'preview-dialog';
    const card = document.createElement('section'); card.className = 'preview-dialog-card';
    const head = document.createElement('div'); head.className = 'preview-dialog-head';
    const title = document.createElement('span'); title.className = 'preview-dialog-title'; title.textContent = settings.title || (input && input.path) || 'Preview';
    const close = document.createElement('button'); close.className = 'preview-dialog-close'; close.type = 'button'; close.textContent = '×'; close.title = 'Close preview';
    const body = document.createElement('div'); body.className = 'preview-dialog-body';
    const dismiss = () => { document.removeEventListener('keydown', onKey); overlay.remove(); };
    const onKey = event => { if (event.key === 'Escape') dismiss(); };
    close.onclick = dismiss; overlay.onclick = event => { if (event.target === overlay) dismiss(); };
    head.append(title, close); card.append(head, body); overlay.appendChild(card); document.body.appendChild(overlay); document.addEventListener('keydown', onKey);
    render(body, input); return { close: dismiss, element: overlay };
  }
  function mount(target, input, options) { return options && options.mode === 'dialog' ? openDialog(input, options) : render(target, input); }
  global.AppUIPreview = { register, render, mount, openDialog, escape, plugins };
}(window));
