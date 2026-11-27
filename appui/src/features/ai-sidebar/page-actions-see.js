/* Page screenshot/vision flow and per-controller appearance cache. */
window._AppUIPageActionSee = (() => {
  function create({opts, allow, introspect, toastOn, _toast}) {
    const {_captureHtml2Canvas, _rasterizeDom, _downscaleDataUrl, _pageSignature, _captureDisplay} = window._AppUIPageCapture;
    let _lastSee = {sig:null, hint:null, desc:null};
    async function run(payload) {
        payload = payload || {};
        if (!allow['see']) return false;
        try {
          var scope = (typeof opts.root === 'function') ? opts.root() : null;
          var hintKey = String(payload.hint || payload.prompt || '');
          // #7/#21 — if the page hasn't visually changed since the last see with
          // the SAME hint, reuse the description (skip capture + multimodal). An
          // EXACT (getDisplayMedia) request always re-captures — the user opted
          // into a pixel-true look. force:true also bypasses the cache.
          if (!payload.exact && !payload.force && _lastSee.desc) {
            var sigNow = _pageSignature(scope);
            if (sigNow && sigNow === _lastSee.sig && hintKey === _lastSee.hint) {
              if (introspect && introspect.setSeen) introspect.setSeen(_lastSee.desc);
              if (toastOn) _toast('info', 'Page unchanged — reused the last look');
              return true;
            }
          }
          var url = null;
          if (payload.exact) {
            url = await _captureDisplay();
            if (!url && toastOn) _toast('info', 'page.see: screen-share not granted; using an approximate render');
          }
          // SILENT: html2canvas (styles inlined — works for styled apps) first,
          // then the SVG-foreignObject fallback (blank for styled apps, but a
          // last resort if html2canvas can't load).
          if (!url) url = await _captureHtml2Canvas(scope);
          if (!url) url = await _rasterizeDom(scope);
          if (!url) {
            // The silent rasterize couldn't produce a usable (non-blank) image —
            // the app's styles don't render inside the SVG-foreignObject clone.
            // Tell the model to request an EXACT (pixel-true) capture instead of
            // feeding it a blank/placeholder image.
            var msg = payload.exact
              ? '(could not capture a screenshot — the browser blocked it. Rely on the DOM outline / page.inspect instead.)'
              : '(a quick approximate screenshot came out blank for this page — its styling does not render in the silent capture. To actually SEE it, emit {"type":"page.see","exact":true}, which asks the user to share the tab once for a pixel-true capture. Otherwise rely on the DOM outline / page.inspect.)';
            if (introspect && introspect.setSeen) introspect.setSeen(msg);
            if (toastOn) _toast('info', 'page.see: approximate capture blank; suggest exact');
            return true;
          }
          var base = (opts.appBase || '/v1/apps/ai/llm_server');
          // #23 — shrink the payload before describe: cap the longest edge at
          // 1280px + JPEG 0.5. Smaller base64 = faster upload + cheaper tokens.
          var sendUrl = await _downscaleDataUrl(url, 1280, 0.5);
          // #8 — surface the screenshot the model is looking at to the USER too
          // (a chat thumbnail), via an optional onShot(dataUrl, meta) host hook,
          // so they see what the model saw. Best-effort; never blocks the describe.
          if (typeof opts.onShot === 'function') {
            try { opts.onShot(sendUrl, { exact: !!payload.exact, hint: hintKey }); } catch (_e) {}
          }
          var resp = await window.AppUIApi.requestResponse(base + '/describe_image', {
            data_url: sendUrl, prompt: payload.hint || payload.prompt || ''
          }, {method:'POST', timeout:null, decode:function (response) {return response.json();}})
            .then(function (result) {return result.data;}).catch(function () {return null;});
          var desc = resp && resp.ok && resp.description ? resp.description : '';
          // The SILENT rasterize can render blank/near-blank for a styled app (its
          // CSS doesn't apply inside the SVG-foreignObject clone), and the vision
          // model then reports "blank canvas"/"no elements"/empty. Detect that and
          // GUIDE to the exact capture instead of surfacing a useless description.
          var looksBlank = !desc
            || /\b(blank|empty|no (visible )?(interface|elements|content|ui))\b/i.test(desc);
          if (looksBlank && !payload.exact) {
            desc = '(a quick approximate screenshot did not render this page\'s '
                 + 'styling (it came out blank to the vision model). To actually '
                 + 'SEE the page, emit {"type":"page.see","exact":true} — the user '
                 + 'shares the tab once for a pixel-true capture. Otherwise use the '
                 + 'DOM outline / page.inspect.)';
          } else if (!desc) {
            desc = '(vision description unavailable: ' + ((resp && resp.error) || 'no response') + ')';
          }
          // #7/#21 — cache a REAL description (not a blank-guidance/error note)
          // keyed by the current page signature + hint, so an immediate repeat
          // see returns instantly without re-capturing.
          if (!looksBlank && desc && desc.indexOf('(') !== 0) {
            try { _lastSee = { sig: _pageSignature(scope), hint: hintKey, desc: desc }; } catch (_e) {}
          }
          if (introspect && introspect.setSeen) introspect.setSeen(desc);
          if (toastOn) _toast('success', 'Looked at the page');
        } catch (e) {
          if (toastOn) _toast('error', 'page.see failed: ' + (e && e.message || e));
        }
        return true;
    }
    return {run, invalidate() {_lastSee.sig = null;}};
  }
  return {create};
})();
