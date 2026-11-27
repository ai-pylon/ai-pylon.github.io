/**
 * page-utils.js — Common page patterns: API fetch, toasts, tabs, loading, debounce.
 * AppUIPageUtils.api(path, body, opts)  AppUIPageUtils.showError/showSuccess/showInfo(msg)
 * AppUIPageUtils.tabSwitcher(el, cfg)   AppUIPageUtils.bindTabs(root, btnSel, panelSel, prefix, onChange)
 * AppUIPageUtils.withLoading(el, promise)
 * AppUIPageUtils.onInput(el, fn, delay) AppUIPageUtils.confirm(msg)
 */
const AppUIPageUtils = (function() {
  'use strict';

  async function api(path, body, opts) {
    opts = opts || {};
    if (window.AppUIApi) return window.AppUIApi.request(path, body, opts);
    var headers = {}, fo = {signal: opts.signal};
    if (body == null) { fo.method = 'GET'; }
    else { fo.method = 'POST'; headers['Content-Type'] = 'application/json'; fo.body = JSON.stringify(body); }
    fo.headers = headers;
    try { var r = await fetch(path, fo); if (!r.ok) throw new Error('HTTP ' + r.status); return await r.json(); }
    catch (e) { return {_error: e.name === 'AbortError' ? 'Request timed out' : e.message}; }
  }

  function showError(msg) { window.AppUIToast ? AppUIToast.error(msg) : console.error('[AppUIPageUtils]', msg); }
  function showSuccess(msg) { window.AppUIToast ? AppUIToast.success(msg) : console.log('[AppUIPageUtils]', msg); }
  function showInfo(msg) { window.AppUIToast ? AppUIToast.info(msg) : console.info('[AppUIPageUtils]', msg); }

  function tabSwitcher(container, config) {
    var tabs = config.tabs || [], defaultId = config.default || (tabs[0] && tabs[0].id) || '';
    var activeId = '', buttons = {};
    var bar = document.createElement('div'); bar.className = 'pu-tab-bar'; bar.setAttribute('role', 'tablist');
    var panel = document.createElement('div'); panel.className = 'pu-tab-panel'; panel.setAttribute('role', 'tabpanel');
    container.appendChild(bar); container.appendChild(panel);
    tabs.forEach(function(tab) {
      var btn = document.createElement('button');
      btn.className = 'pu-tab-btn'; btn.textContent = tab.label || tab.id;
      btn.setAttribute('role', 'tab'); btn.dataset.tabId = tab.id;
      btn.addEventListener('click', function() { switchTo(tab.id); });
      bar.appendChild(btn); buttons[tab.id] = btn;
    });
    function switchTo(id) {
      if (activeId === id) return; activeId = id;
      Object.keys(buttons).forEach(function(k) {
        buttons[k].classList.toggle('pu-tab-active', k === id);
        buttons[k].setAttribute('aria-selected', k === id ? 'true' : 'false');
      });
      panel.innerHTML = '';
      var t = tabs.find(function(x) { return x.id === id; });
      if (t && t.render) t.render(panel);
    }
    switchTo(defaultId);
    return {switchTo: switchTo, active: function() { return activeId; }};
  }

  async function withLoading(el, p) {
    var s = document.createElement('div'); s.className = 'pu-loading';
    s.innerHTML = '<div class="pu-spinner"></div>';
    el.style.position = el.style.position || 'relative'; el.appendChild(s);
    try { return typeof p === 'function' ? await p() : await p; }
    finally { if (s.parentNode) s.parentNode.removeChild(s); }
  }

  function onInput(el, fn, delay) {
    const h = AppUILifecycle.debounce(e => fn(e.target.value, e), delay || 300);
    el.addEventListener('input', h);
    return function() { el.removeEventListener('input', h); h.destroy(); };
  }

  async function confirm(msg) { return window.confirm(msg); }

  // Bind existing DOM tab buttons to panels (for pages with pre-built HTML tabs).
  // Buttons must have data-tab attribute, panels are identified by prefix+tabId.
  // Returns {switchTo(id), active()}.
  function bindTabs(root, btnSelector, panelSelector, panelIdPrefix, onChange) {
    var buttons = root.querySelectorAll(btnSelector);
    var panels = root.querySelectorAll(panelSelector);
    var activeId = '';
    buttons.forEach(function(btn) {
      btn.addEventListener('click', function() { switchTo(btn.dataset.tab); });
    });
    function switchTo(id) {
      if (activeId === id) return;
      activeId = id;
      buttons.forEach(function(b) { b.classList.toggle('active', b.dataset.tab === id); });
      panels.forEach(function(p) { p.classList.toggle('active', p.id === panelIdPrefix + id); });
      if (onChange) onChange(id);
    }
    var cur = root.querySelector(btnSelector + '.active');
    if (cur) activeId = cur.dataset.tab;
    return {switchTo: switchTo, active: function() { return activeId; }};
  }

  // Inject minimal styles
  if (typeof document !== 'undefined') {
    var st = document.createElement('style'); st.textContent =
      '.pu-tab-bar{display:flex;gap:2px;border-bottom:1px solid var(--border);padding:0 4px;margin-bottom:8px}' +
      '.pu-tab-btn{background:none;border:none;border-bottom:2px solid transparent;padding:6px 12px;cursor:pointer;color:var(--text-secondary);font-size:12px}' +
      '.pu-tab-btn:hover{color:var(--text-primary)}' +
      '.pu-tab-btn.pu-tab-active{color:var(--accent);border-bottom-color:var(--accent)}' +
      '.pu-loading{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.4);z-index:100;border-radius:inherit}' +
      '.pu-spinner{width:24px;height:24px;border:3px solid var(--border);border-top-color:var(--accent);border-radius:50%;animation:pu-spin .6s linear infinite}' +
      '@keyframes pu-spin{to{transform:rotate(360deg)}}';
    (document.head || document.documentElement).appendChild(st);
  }

  return {api:api, showError:showError, showSuccess:showSuccess, showInfo:showInfo,
    tabSwitcher:tabSwitcher, bindTabs:bindTabs, withLoading:withLoading, onInput:onInput, confirm:confirm};
})();
if (typeof window !== 'undefined') window.AppUIPageUtils = AppUIPageUtils;
