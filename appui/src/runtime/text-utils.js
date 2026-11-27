/**
 * AppUITextUtils — shared text manipulation for all pages.
 * @module text-utils
 */
var AppUITextUtils = (function() {
  'use strict';
  
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  
  // Plain queries match substrings; regex-looking queries compile once.
  // An incomplete regex falls back to literal matching while the user types.
  function makeMatcher(query, {stringify = value => String(value || '')} = {}) {
    query = String(query || '').trim();
    if (!query) return () => true;
    if (/[\\^$.*+?()[\]{}|]/.test(query)) {
      try {
        const expression = new RegExp(query, 'i');
        return value => expression.test(stringify(value));
      } catch (_) {}
    }
    const lower = query.toLowerCase();
    return value => stringify(value).toLowerCase().includes(lower);
  }

  function truncate(s, max, suffix) {
    s = String(s || '');
    suffix = suffix || '...';
    max = max || 100;
    return s.length <= max ? s : s.substring(0, max - suffix.length) + suffix;
  }
  
  function formatTime(ts, opts) {
    if (!ts) return '-';
    opts = opts || {};
    var d = typeof ts === 'number' ? new Date(ts > 1e12 ? ts : ts * 1000) : new Date(ts);
    if (isNaN(d.getTime())) return String(ts);
    if (opts.relative) return _relative(d);
    if (opts.timeOnly) return d.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
    return d.toLocaleDateString([], {month:'short', day:'numeric'}) + ' ' +
           d.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit', second:'2-digit'});
  }
  
  function _relative(d) {
    var s = Math.floor((Date.now() - d.getTime()) / 1000);
    if (s < 60) return s + 's ago';
    if (s < 3600) return Math.floor(s/60) + 'm ago';
    if (s < 86400) return Math.floor(s/3600) + 'h ago';
    return Math.floor(s/86400) + 'd ago';
  }
  
  function formatLatency(ms) {
    if (ms == null) return '-';
    if (ms < 1000) return ms + 'ms';
    if (ms < 60000) return (ms / 1000).toFixed(1) + 's';
    return (ms / 60000).toFixed(1) + 'min';
  }

  function formatBytes(value) {
    value = Number(value) || 0;
    if (value <= 0) return '0 B';
    var units = ['B', 'KB', 'MB', 'GB', 'TB'];
    var index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
    return (value / Math.pow(1024, index)).toFixed(index ? 1 : 0) + ' ' + units[index];
  }

  function formatRelative(ts, opts) {
    opts = opts || {};
    if (!ts) return opts.empty || '';
    var d = new Date(ts);
    if (isNaN(d.getTime())) return String(ts);
    var seconds = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
    if (seconds < 60) return opts.justNow === false ? seconds + 's ago' : 'just now';
    if (seconds < 3600) return Math.floor(seconds / 60) + 'm ago';
    if (seconds < 86400) return Math.floor(seconds / 3600) + 'h ago';
    if (opts.yesterday && seconds < 172800) return 'Yesterday';
    var days = Math.floor(seconds / 86400);
    if (days < (opts.cutoffDays || 7)) return days + 'd ago';
    return d.toLocaleDateString();
  }
  
  /** @deprecated Use sanitizeDom for HTML or esc for plain text. */
  function sanitizeHtml(html, maxLen) {
    if (!html) return '';
    var safe = sanitizeDom(String(html));
    if (maxLen) {
      var tmp = document.createElement('div');
      tmp.innerHTML = safe;
      var text = tmp.textContent || '';
      if (text.length > maxLen) {
        safe = esc(text.substring(0, maxLen)) + '...';
      }
    }
    return safe;
  }
  
  /**
   * STRUCTURAL sanitizer for HTML that will be assigned to innerHTML when its
   * source is not trusted — e.g. rendered markdown of an LLM answer that was
   * grounded on arbitrary document text. Unlike sanitizeHtml (a regex pass), it
   * parses the markup into an INERT document (DOMParser: no scripts run, no
   * resources load) and rebuilds it from an allowlist: unknown elements are
   * unwrapped (their text kept), active ones (script/iframe/form/…) dropped with
   * their content, every attribute outside a small allowlist removed (so no
   * on* handlers, quoted or not), and href/src restricted to http(s), mailto,
   * same-origin paths, fragments and data:image. Returns safe HTML.
   */
  var _SAFE_TAGS = {A:1,ABBR:1,B:1,BLOCKQUOTE:1,BR:1,CODE:1,DEL:1,DIV:1,EM:1,H1:1,H2:1,H3:1,H4:1,
    H5:1,H6:1,HR:1,I:1,IMG:1,KBD:1,LI:1,MARK:1,OL:1,P:1,PRE:1,S:1,SPAN:1,STRONG:1,SUB:1,SUP:1,
    TABLE:1,TBODY:1,TD:1,TFOOT:1,TH:1,THEAD:1,TR:1,U:1,UL:1,DETAILS:1,SUMMARY:1};
  var _DROP_TAGS = {SCRIPT:1,STYLE:1,IFRAME:1,OBJECT:1,EMBED:1,LINK:1,META:1,BASE:1,FORM:1,INPUT:1,
    BUTTON:1,SELECT:1,TEXTAREA:1,SVG:1,MATH:1,TEMPLATE:1,NOSCRIPT:1,FRAME:1,FRAMESET:1,APPLET:1,
    AUDIO:1,VIDEO:1,SOURCE:1,TITLE:1,HEAD:1};
  var _SAFE_ATTRS = {href:1,src:1,alt:1,title:1,class:1,style:1,colspan:1,rowspan:1,align:1,
    border:1,cellpadding:1,cellspacing:1,start:1,open:1};
  var _SAFE_URL = /^(https?:|mailto:|#|\/(?!\/)|\.{1,2}\/|data:image\/(png|jpeg|gif|webp);)/i;
  function sanitizeDom(html) {
    if (!html) return '';
    var doc;
    try { doc = new DOMParser().parseFromString('<body>' + html + '</body>', 'text/html'); }
    catch (e) { return esc(String(html)); }
    (function clean(node) {
      var kids = Array.prototype.slice.call(node.childNodes);
      for (var i = 0; i < kids.length; i++) {
        var el = kids[i];
        if (el.nodeType === 3) continue;                       // text
        if (el.nodeType !== 1) { node.removeChild(el); continue; }   // comments etc.
        var tag = el.tagName.toUpperCase();
        if (_DROP_TAGS[tag]) { node.removeChild(el); continue; }
        clean(el);
        if (!_SAFE_TAGS[tag]) {                                // unwrap: keep the content
          while (el.firstChild) node.insertBefore(el.firstChild, el);
          node.removeChild(el);
          continue;
        }
        var attrs = Array.prototype.slice.call(el.attributes);
        for (var j = 0; j < attrs.length; j++) {
          var name = attrs[j].name.toLowerCase(), val = attrs[j].value || '';
          var ok = !!_SAFE_ATTRS[name];
          if (ok && (name === 'href' || name === 'src')) ok = _SAFE_URL.test(val.trim());
          if (ok && name === 'style') ok = !/url\s*\(|expression\s*\(|@import|behavior\s*:/i.test(val);
          if (!ok) el.removeAttribute(attrs[j].name);
        }
        if (tag === 'A' && el.hasAttribute('href') && !/^#/.test(el.getAttribute('href'))) {
          el.setAttribute('target', '_blank');
          el.setAttribute('rel', 'noopener noreferrer');
        }
      }
    })(doc.body);
    return doc.body.innerHTML;
  }

  /** Append literal text with case-insensitive query matches in native mark elements. */
  function appendHighlight(host, text, query) {
    const doc = host.ownerDocument || document;
    text = String(text ?? '');
    query = String(query ?? '');
    if (!query) {host.appendChild(doc.createTextNode(text)); return host;}
    const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    let cursor = 0;
    for (const match of text.matchAll(pattern)) {
      host.appendChild(doc.createTextNode(text.slice(cursor, match.index)));
      const mark = doc.createElement('mark');
      mark.textContent = match[0];
      host.appendChild(mark);
      cursor = match.index + match[0].length;
    }
    host.appendChild(doc.createTextNode(text.slice(cursor)));
    return host;
  }

  function parseJsonObject(text) {
    const cleaned=text.replace(/```json\n?/g,'').replace(/```/g,'').trim();
    const match=cleaned.match(/\{[\s\S]*\}/);
    return match?JSON.parse(match[0]):null;
  }

  return { makeMatcher, esc: esc, truncate: truncate, formatTime: formatTime, formatLatency: formatLatency, formatBytes: formatBytes, formatRelative: formatRelative, sanitizeHtml: sanitizeHtml, sanitizeDom: sanitizeDom, appendHighlight, parseJsonObject };
})();

// Also expose globally for backward compatibility
if (typeof window !== 'undefined') window.AppUITextUtils = AppUITextUtils;
