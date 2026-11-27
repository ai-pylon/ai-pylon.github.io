/* Page-box measurement and fit-to-width for document previewers. */
window.AppUIDocumentLayout = (function () {
  'use strict';
  function fit(ph, c, paneW, preserveDeclaredBox) {
    var nw, nh;
    if (c.__natW > 1 && c.__natH > 1) { nw = c.__natW; nh = c.__natH; }
    else {
      // Measure the natural (unscaled) box. When _applyDeclaredBox PINNED an
      // explicit width/height on a dimensionless slide (stream head with no
      // `.page` rule), keep that box (position:relative) so we read the true
      // slide size (e.g. 1280×720) — NOT position:static, which would collapse
      // an absolutely-positioned-only slide back to the pane width (wrong
      // aspect). A page that already has CSS dims is measured the normal way.
      var _pinned = preserveDeclaredBox && !!(c.getAttribute && c.getAttribute('data-boxed'));
      c.style.transform = 'none';
      if (!_pinned) { c.style.position = 'static'; c.style.margin = '0'; }
      else { c.style.position = 'relative'; c.style.margin = '0'; }
      nw = c.offsetWidth || c.getBoundingClientRect().width;
      nh = Math.max(c.offsetHeight || 0, c.scrollHeight || 0) || c.getBoundingClientRect().height;
      if (nw > 1 && nh > 1) { c.__natW = nw; c.__natH = nh; }
    }
    if (nw > 1 && nh > 1) {
      var scale = Math.min(4, paneW / nw);
      c.style.position = 'absolute'; c.style.left = '0'; c.style.top = '0';
      c.style.transformOrigin = 'top left'; c.style.transform = 'scale(' + scale + ')';
      ph.style.width = Math.round(nw * scale) + 'px';
      ph.style.height = Math.round(nh * scale) + 'px';
      ph.style.maxWidth = '100%';
    }
  }

  function declaredDimensions(pg) {
    try {
      var w = 0, h = 0;
      var _len = function (s, prop) {
        var m = s.match(new RegExp('(?:^|;)\\s*' + prop + '\\s*:\\s*([\\d.]+)(px|pt)', 'i'));
        if (!m) return 0;
        var v = parseFloat(m[1]);
        return m[2].toLowerCase() === 'pt' ? v * 96 / 72 : v;
      };
      var st = pg.getAttribute && pg.getAttribute('style') || '';
      w = _len(st, 'width');
      h = _len(st, 'height') || _len(st, 'min-height');  // docx pages use min-height
      if ((!w || !h) && pg.getAttribute) {
        w = w || parseFloat(pg.getAttribute('width') || '0') || 0;
        h = h || parseFloat(pg.getAttribute('height') || '0') || 0;
      }
      // A page may size itself from an inner slide frame; peek one level.
      if ((!w || !h)) {
        var inner = pg.querySelector && pg.querySelector('[style*="width"][style*="height"]');
        if (inner) {
          var is = inner.getAttribute('style') || '';
          if (!w) w = _len(is, 'width');
          if (!h) h = _len(is, 'height');
        }
      }
      return (w > 1 && h > 1) ? { w: w, h: h } : null;
    } catch (e) { return null; }
  }
  return {fit: fit, declaredDimensions: declaredDimensions};
})();
