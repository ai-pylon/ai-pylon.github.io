/* Private DOM tagging, discovery and interaction for AppUIDebug. */
window._AppUIDebugDOM = {
  create() {
  var _tagged = false;

  function _generateAid(el) {
    // Build a meaningful ID from element context
    var parts = [];

    // 1. Closest section identifier
    var page = el.closest('[data-ai-page]');
    if (page) parts.push(page.dataset.aiPage);
    var region = el.closest('#app-left,#app-right,#app-content,#app-menubar,#app-statusbar');
    if (region && !page) parts.push(region.id.replace('app-', ''));

    // 2. Element role/type
    var tag = el.tagName.toLowerCase();
    if (tag === 'button') parts.push('btn');
    else if (tag === 'textarea') parts.push('textarea');
    else if (tag === 'input') parts.push('input-' + (el.type || 'text'));
    else if (tag === 'select') parts.push('select');
    else if (tag === 'a') parts.push('link');

    // 3. Identifying text
    var text = (el.textContent || '').trim().substring(0, 20).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '');
    if (text && text.length > 1) parts.push(text);
    
    // 4. Placeholder or aria-label
    if (el.placeholder) parts.push(el.placeholder.substring(0, 15).toLowerCase().replace(/[^a-z0-9]+/g, '-'));
    if (el.getAttribute('aria-label')) parts.push(el.getAttribute('aria-label').substring(0, 15).toLowerCase().replace(/[^a-z0-9]+/g, '-'));

    // 5. Class hints
    var cls = el.className || '';
    if (typeof cls === 'string') {
      if (cls.includes('send')) parts.push('send');
      if (cls.includes('chat')) parts.push('chat');
      if (cls.includes('input')) parts.push('input');
      if (cls.includes('clear')) parts.push('clear');
      if (cls.includes('stop')) parts.push('stop');
    }

    var aid = parts.filter(Boolean).join('-');
    // Deduplicate
    if (document.querySelector('[data-aid="' + aid + '"]') && document.querySelector('[data-aid="' + aid + '"]') !== el) {
      var idx = 2;
      while (document.querySelector('[data-aid="' + aid + '-' + idx + '"]')) idx++;
      aid = aid + '-' + idx;
    }
    return aid || null;
  }

  function tagAll() {
    var elements = document.querySelectorAll('button, input, textarea, select, a[href], [role="button"], [onclick]');
    var count = 0;
    elements.forEach(function(el) {
      if (el.dataset.aid) return; // Already tagged
      if (el.offsetHeight === 0 && el.offsetWidth === 0) return; // Hidden
      var aid = _generateAid(el);
      if (aid) {
        el.dataset.aid = aid;
        count++;
      }
    });
    _tagged = true;
    return count;
  }

  function describe() {
    if (!_tagged) tagAll();
    var elements = document.querySelectorAll('[data-aid]');
    var map = [];
    elements.forEach(function(el) {
      if (el.offsetHeight === 0 && el.offsetWidth === 0) return; // Skip hidden
      var rect = el.getBoundingClientRect();
      map.push({
        aid: el.dataset.aid,
        tag: el.tagName.toLowerCase(),
        text: (el.textContent || '').trim().substring(0, 30),
        value: el.value || '',
        placeholder: el.placeholder || '',
        disabled: el.disabled || false,
        visible: rect.height > 0,
        x: Math.round(rect.x + rect.width/2),
        y: Math.round(rect.y + rect.height/2),
      });
    });
    return map;
  }

  function find(aid) {
    if (!_tagged) tagAll();
    return document.querySelector('[data-aid="' + aid + '"]');
  }

  function click(aid) {
    var el = find(aid);
    if (!el) return {error: 'not found: ' + aid};
    el.click();
    return {ok: true, aid: aid, tag: el.tagName};
  }

  function type(aid, text) {
    var el = find(aid);
    if (!el) return {error: 'not found: ' + aid};
    el.focus();
    el.value = text;
    el.dispatchEvent(new Event('input', {bubbles: true}));
    return {ok: true, aid: aid, value: text};
  }

  function value(aid) {
    var el = find(aid);
    if (!el) return {error: 'not found: ' + aid};
    return {aid: aid, value: el.value, text: el.textContent?.substring(0, 100)};
  }

  function submit(aid) {
    // Type Enter on an element to submit
    var el = find(aid);
    if (!el) return {error: 'not found: ' + aid};
    el.focus();
    el.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true}));
    return {ok: true, aid: aid, action: 'enter'};
  }

  function listInteractive(filter) {
    if (!_tagged) tagAll();
    var elements = document.querySelectorAll('[data-aid]');
    var results = [];
    elements.forEach(function(el) {
      if (el.offsetHeight === 0) return;
      var aid = el.dataset.aid;
      if (filter && !aid.includes(filter)) return;
      results.push(aid);
    });
    return results;
  }

    return {tagAll,describe,find,click,type,value,submit,listInteractive};
  },
};
