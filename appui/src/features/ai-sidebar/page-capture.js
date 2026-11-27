/* Screenshot primitives shared by the page-action controller. */
window._AppUIPageCapture = (() => {
  // --- screenshot capture (for page.see) -----------------------------------
  // SILENT default: html2canvas (vendored, lazy-loaded) — rasterizes the DOM
  // with INLINED COMPUTED STYLES, so a styled app renders correctly (the raw
  // SVG-foreignObject trick renders blank for styled apps because external/
  // shadow CSS doesn't apply inside the clone). Falls back to the SVG trick if
  // html2canvas can't load. EXACT path: getDisplayMedia (true painted pixels,
  // one-time screen-share). All return a Promise<dataURL|null>.

  // lazy-load the vendored html2canvas (same pattern as CodeMirror): memoized,
  // guards on window.html2canvas. Resolves to the fn or null.
  var _h2cPromise = null;
  function _ensureHtml2Canvas() {
    if (window.html2canvas) return Promise.resolve(window.html2canvas);
    if (window.AppUIScriptLoader && window.AppUIScriptLoader.load) {
      return Promise.resolve().then(function () {
        return window.AppUIScriptLoader.load('/appui/lib/html2canvas/html2canvas.min.js', 'html2canvas');
      }).then(function (capture) { return capture || null; }).catch(function () { return null; });
    }
    if (_h2cPromise) return _h2cPromise;
    _h2cPromise = (function () {
      try {
        if (window.AppUIAssets && typeof window.AppUIAssets.loadScript === 'function') {
          return Promise.resolve(window.AppUIAssets.loadScript('/appui/lib/html2canvas/html2canvas.min.js'))
            .then(function () { return window.html2canvas || null; })
            .catch(function () { return null; });
        }
      } catch (_e) { /* fall through */ }
      return Promise.resolve(null);
    })();
    return _h2cPromise;
  }

  // Preferred silent capture via html2canvas; null if it can't load/run OR the
  // result is blank. Tries the given region AND the viewport and keeps the
  // LARGER (by area) non-blank result — AppUI layout regions often have a
  // COLLAPSED measured box (flex-fill / absolute fill), so the region alone can
  // yield a tiny strip, while some layouts render better from the viewport.
  // Honest caveat: html2canvas is unreliable on complex flex/transform layouts
  // (it may blank or clip); the caller falls back to the SVG trick, then guides
  // the model to page.see{exact:true} (getDisplayMedia) for guaranteed fidelity.
  function _h2cShot(h2c, el, w, h, extra) {
    var o = { logging: false, backgroundColor: '#ffffff', scale: 1, useCORS: true, imageTimeout: 3000 };
    if (w) { o.width = w; o.windowWidth = w; }
    if (h) { o.height = h; o.windowHeight = h; }
    if (extra) { for (var k in extra) { if (Object.prototype.hasOwnProperty.call(extra, k)) o[k] = extra[k]; } }
    return h2c(el, o).then(function (cv) {
      try {
        // BLANK-DETECT: html2canvas can return a FULL-SIZE but mostly-white
        // canvas when it can't render the app's content (shadow DOM / complex
        // shell-composed layout — the AppUI case). Sample a pixel grid; if
        // <~3% of samples differ from the first, treat it as blank (null) so the
        // caller falls through to the SVG trick / the exact-capture guidance
        // rather than feeding the vision model a white page.
        var ctx = cv.getContext && cv.getContext('2d');
        if (ctx) {
          var W = cv.width, H = cv.height, sx = Math.max(1, Math.floor(W / 28)), sy = Math.max(1, Math.floor(H / 28));
          var first = null, varied = 0, n = 0;
          for (var yy = 2; yy < H; yy += sy) {
            for (var xx = 2; xx < W; xx += sx) {
              var p = ctx.getImageData(xx, yy, 1, 1).data; n++;
              var key = p[0] + ',' + p[1] + ',' + p[2];
              if (first === null) first = key; else if (key !== first) varied++;
            }
          }
          if (n > 16 && varied < Math.max(6, n * 0.03)) return null;   // blank
        }
      } catch (_e) { /* getImageData may be unavailable; accept the url */ }
      try { return { url: cv.toDataURL('image/jpeg', 0.7), area: (cv.width || 0) * (cv.height || 0) }; }
      catch (_e2) { return null; }
    }).catch(function () { return null; });
  }
  function _captureHtml2Canvas(node) {
    return _ensureHtml2Canvas().then(function (h2c) {
      if (!h2c) return null;
      var el = node || document.getElementById('app-main') || document.body;
      // #6 — the AppUI shell lays its regions out with flex-fill / absolute-fill,
      // so a region's getBoundingClientRect can measure COLLAPSED and html2canvas
      // then rasterizes a tiny/blank strip. Try SEVERAL strategies and keep the
      // LARGEST non-blank result (each shot self-rejects a blank canvas → null):
      //   (a) document.body as-is (full viewport; reliable dims, content may be white)
      //   (b) the app region as-is
      //   (c) documentElement with EXPLICIT viewport dims + scroll reset — forces
      //       html2canvas to size to the real window instead of a collapsed box
      //   (d) a foreignObjectRendering pass on the region (some shadow/flex
      //       layouts render under the native path when the clone path blanks)
      // Honest caveat: on a heavily shadow-DOM/transform shell all silent paths
      // can still blank; the caller then guides the model to page.see{exact:true}.
      var vw = 0, vh = 0;
      try { vw = window.innerWidth || (document.documentElement && document.documentElement.clientWidth) || 0; } catch (_e) {}
      try { vh = window.innerHeight || (document.documentElement && document.documentElement.clientHeight) || 0; } catch (_e) {}
      var docEl = (document.documentElement || document.body);
      var shots = [
        _h2cShot(h2c, document.body || docEl, 0, 0),
        _h2cShot(h2c, el, 0, 0),
      ];
      if (vw && vh) {
        shots.push(_h2cShot(h2c, docEl, vw, vh, { scrollX: 0, scrollY: 0, x: 0, y: 0 }));
      }
      // foreignObjectRendering can throw on some engines → guard per-shot (the
      // shot already .catch→null, and _h2cShot wraps h2c() in a .then chain).
      shots.push(_h2cShot(h2c, el, 0, 0, { foreignObjectRendering: true }));
      return Promise.all(shots).then(function (results) {
        var best = null;
        results.forEach(function (s) { if (s && s.url && (!best || s.area > best.area)) best = s; });
        return best && best.area > 60000 ? best.url : null;
      }).catch(function () { return null; });
    }).catch(function () { return null; });
  }

  function _rasterizeDom(node) {
    return new Promise(function (resolve) {
      try {
        var el = node || document.getElementById('app-main') || document.body;
        var rect = el.getBoundingClientRect();
        var w = Math.min(1600, Math.ceil(rect.width) || el.scrollWidth || 1200);
        var h = Math.min(1400, Math.ceil(rect.height) || el.scrollHeight || 800);
        // clone the node inline so the foreignObject renders it standalone.
        var clone = el.cloneNode(true);
        // inline a minimal set of computed styles the serialized copy loses is
        // out of scope — foreignObject uses the document's own stylesheets, which
        // apply to same-origin <style>/<link> rules, so most app CSS still works.
        var xml = new XMLSerializer().serializeToString(clone);
        var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '">' +
                  '<foreignObject width="100%" height="100%">' +
                  '<div xmlns="http://www.w3.org/1999/xhtml">' + xml + '</div>' +
                  '</foreignObject></svg>';
        var img = new Image();
        img.onload = function () {
          try {
            var cv = document.createElement('canvas'); cv.width = w; cv.height = h;
            var ctx = cv.getContext('2d');
            ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h);
            ctx.drawImage(img, 0, 0);
            // BLANK-DETECT: the SVG-foreignObject path renders the cloned DOM
            // WITHOUT the app's external/shadow stylesheets, so a heavily-styled
            // app can rasterize to a near-blank canvas. Feeding the vision model
            // a blank image is worse than useless, so sample a grid of pixels and
            // if the result is near-uniform, treat the capture as FAILED (null) —
            // the caller then tells the model to use page.see{exact:true}.
            try {
              var sx = Math.max(1, Math.floor(w / 24)), sy = Math.max(1, Math.floor(h / 24));
              var seen0 = null, varied = 0, n = 0;
              for (var yy = 2; yy < h; yy += sy) {
                for (var xx = 2; xx < w; xx += sx) {
                  var px = ctx.getImageData(xx, yy, 1, 1).data; n++;
                  var key = px[0] + ',' + px[1] + ',' + px[2];
                  if (seen0 === null) seen0 = key; else if (key !== seen0) varied++;
                }
              }
              if (n > 8 && varied < Math.max(3, n * 0.02)) { resolve(null); return; }  // <2% varied → blank
            } catch (_e) { /* getImageData may taint; fall through and return the url */ }
            resolve(cv.toDataURL('image/png'));
          } catch (_e) { resolve(null); }   // taint → SecurityError
        };
        img.onerror = function () { resolve(null); };
        img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
      } catch (_e) { resolve(null); }
    });
  }

  // #23 — downscale a captured dataURL so the vision payload is small: cap the
  // LONGEST edge at ~1280px and re-encode JPEG at ~0.5. A UI-STRUCTURE
  // description doesn't need full-res pixels, and a smaller base64 = faster
  // upload + cheaper multimodal tokens. Returns a Promise<dataURL> (passes the
  // original through unchanged if it's already small or anything fails).
  function _downscaleDataUrl(url, maxEdge, quality) {
    maxEdge = maxEdge || 1280; quality = (quality == null) ? 0.5 : quality;
    return new Promise(function (resolve) {
      if (!url || typeof url !== 'string') { resolve(url); return; }
      try {
        var img = new Image();
        img.onload = function () {
          try {
            var w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
            if (!w || !h) { resolve(url); return; }
            var longest = Math.max(w, h);
            if (longest <= maxEdge) { resolve(url); return; }   // already small
            var s = maxEdge / longest;
            var cw = Math.max(1, Math.round(w * s)), ch = Math.max(1, Math.round(h * s));
            var cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
            var ctx = cv.getContext('2d');
            ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, cw, ch);
            ctx.drawImage(img, 0, 0, cw, ch);
            resolve(cv.toDataURL('image/jpeg', quality));
          } catch (_e) { resolve(url); }
        };
        img.onerror = function () { resolve(url); };
        img.src = url;
      } catch (_e) { resolve(url); }
    });
  }

  // #7/#21 — a CHEAP page signature so a repeated page.see with no visual change
  // skips the (heavy) capture+describe and returns the cached description. Reads
  // only plain properties (no rasterize): url path + the content area's visible
  // text length + field/button counts + a coarse scroll bucket. A real visual
  // change (new field, navigation, scrolled content) flips it; a no-op re-ask
  // doesn't. Best-effort — returns '' when document is unavailable (then we
  // never cache-hit, which is safe).
  function _pageSignature(scope) {
    if (typeof document === 'undefined') return '';
    try {
      var root = scope || document.getElementById('app-main') || document.body;
      var loc = '';
      try { loc = (location && (location.pathname + location.hash)) || ''; } catch (_e) {}
      var txtLen = 0, nf = 0, nb = 0;
      try { txtLen = (root && (root.innerText || root.textContent) || '').length; } catch (_e) {}
      try { nf = root ? root.querySelectorAll('input,select,textarea').length : 0; } catch (_e) {}
      try { nb = root ? root.querySelectorAll('button').length : 0; } catch (_e) {}
      var scroll = 0;
      try { scroll = Math.round((window.scrollY || 0) / 200); } catch (_e) {}
      return [loc, txtLen, nf, nb, scroll].join('|');
    } catch (_e) { return ''; }
  }

  // getDisplayMedia one-shot: prompt (once) → grab a single frame → stop tracks.
  // Pixel-true. Requires a user gesture the FIRST time; returns null if denied /
  // unavailable.
  function _captureDisplay() {
    return new Promise(function (resolve) {
      try {
        if (!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia)) { resolve(null); return; }
        navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 1 }, audio: false }).then(function (stream) {
          var track = stream.getVideoTracks()[0];
          var done = function (url) { try { stream.getTracks().forEach(function (t) { t.stop(); }); } catch (_e) {} resolve(url); };
          var finish = function (bmp) {
            try {
              var cv = document.createElement('canvas');
              cv.width = bmp.width || 1280; cv.height = bmp.height || 800;
              cv.getContext('2d').drawImage(bmp, 0, 0);
              done(cv.toDataURL('image/jpeg', 0.6));
            } catch (_e) { done(null); }
          };
          // ImageCapture is the clean one-frame grab; fall back to a <video>.
          if (window.ImageCapture) {
            try { new window.ImageCapture(track).grabFrame().then(finish, function () { done(null); }); return; } catch (_e) {}
          }
          var v = document.createElement('video'); v.srcObject = stream; v.muted = true;
          v.onloadedmetadata = function () { v.play().then(function () {
            setTimeout(function () {
              try {
                var cv = document.createElement('canvas'); cv.width = v.videoWidth; cv.height = v.videoHeight;
                cv.getContext('2d').drawImage(v, 0, 0); done(cv.toDataURL('image/jpeg', 0.6));
              } catch (_e) { done(null); }
            }, 250);
          }, function () { done(null); }); };
        }, function () { resolve(null); });   // user denied
      } catch (_e) { resolve(null); }
    });
  }

  return {_captureHtml2Canvas, _rasterizeDom, _downscaleDataUrl, _pageSignature, _captureDisplay};
})();
