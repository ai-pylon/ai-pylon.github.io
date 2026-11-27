/** Scope document styles under a caller-owned root; external imports are omitted. */
var AppUIDocumentStyles = (() => {
  function scope(cssText, { selector = '.fs-doc', omitDarkMedia = false } = {}) {

    // Parse via a detached <style> so the browser gives us structured rules.
    var tmp = document.createElement('style'); tmp.textContent = cssText || '';
    document.head.appendChild(tmp);
    var sheet = tmp.sheet, out = '';
    var scopeSel = function (sel) {
      return sel.split(',').map(function (s) {
        s = s.trim(); if (!s) return s;
        // Map document-global selectors onto the scope root itself.
        if (/^(html|body|:root)\b/i.test(s)) {
          var rest = s.replace(/^(html|body|:root)/i, '').trim();
          return rest ? (selector + ' ' + rest) : selector;
        }
        return selector + ' ' + s;
      }).join(', ');
    };
    var walk = function (rules) {
      var txt = '';
      [].slice.call(rules || []).forEach(function (r) {
        if (r.type === 1) {   // style rule
          txt += scopeSel(r.selectorText) + '{' + r.style.cssText + '}';
        } else if (r.type === 4 || r.type === 12) {   // @media / @supports
          // DROP `@media (prefers-color-scheme: dark)` blocks. The preview
          // forces the doc background light/transparent (see the override
          // below), but prefers-color-scheme matches the OS/browser — so a
          // doc's dark-mode palette (e.g. silver #e8ebef headings meant for a
          // dark page) would paint light-on-light = unreadable. Rendering the
          // doc's LIGHT (default) palette matches the light preview surface.
          if (omitDarkMedia && r.type === 4 && /prefers-color-scheme\s*:\s*dark/i.test(r.conditionText || '')) {
            return;   // skip the dark-scheme block entirely
          }
          txt += '@' + (r.type === 4 ? 'media ' + r.conditionText : 'supports ' + r.conditionText) + '{' + walk(r.cssRules) + '}';
        } else if (r.cssText && r.type !== 3) {   // keyframes/font-face/etc: keep as-is (not layout-global)
          txt += r.cssText;
        }
      });
      return txt;
    };
    try { out = walk(sheet.cssRules); } catch (e) { out = ''; }
    document.head.removeChild(tmp);
    return out;
    }
  return { scope };
})();
if (typeof window !== 'undefined') window.AppUIDocumentStyles = AppUIDocumentStyles;
