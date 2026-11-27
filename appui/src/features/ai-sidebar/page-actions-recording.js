/* Recording and CDP-free replay, delegated through the caller's guarded action path. */
window._AppUIPageActionRecording = (() => {
  function create({opts, onAction, introspect, toastOn, _toast}) {
    var _recording = !!opts.record, _trace = [], _lastSavedId = null;
    function post(path, args) {
      return window.AppUIApi.requestResponse(path, args, {
        method: 'POST', timeout: null, decode: function (response) { return response.json(); }
      }).then(function (result) { return result.data; }).catch(function () { return null; });
    }

    function record(kind, selector, value) {
      if (!_recording) return;
      var action = {kind:kind, selector:selector};
      if (value != null) action.value = value;
      _trace.push(action);
    }
    async function saveCase(payload) {
        payload = payload || {};
        var rid = String(payload.id || '').trim();
        if (!rid) { if (toastOn) _toast('error', 'page.record_case: an id is required'); return true; }
        var actions = _trace.slice();
        if (!actions.length) {
          var m = '(nothing was recorded — turn on recording and perform some '
                + 'fill/click/select actions first, then record_case.)';
          if (introspect && introspect.setSeen) introspect.setSeen(m);
          if (toastOn) _toast('info', 'page.record_case: empty trace');
          return true;
        }
        try {
          var base = (opts.appBase || '/v1/apps/ai/llm_server');
          // from_actions lives on platform/page_automation; derive its base from
          // the host root (appBase is the llm app). Use an absolute op path.
          var paBase = (opts.pageAutomationBase || '/v1/apps/platform/page_automation');
          var r = await post(paBase + '/from_actions', {
            id: rid, title: payload.title || '', actions: actions,
            url: payload.url || (location && location.pathname) || '',
            match_text: payload.match_text, confirm: true
          });
          var okmsg = r && r.ok
            ? ('Saved the recorded flow as automation case "' + (r.id || rid) + '" ('
               + actions.length + ' step(s)). It can be replayed on this page without CDP.')
            : ('(could not save the case: ' + ((r && r._error) || (r && r.error) || 'no response') + ')');
          if (introspect && introspect.setSeen) introspect.setSeen(okmsg);
          if (toastOn) _toast(r && r.ok ? 'success' : 'error', okmsg);
        } catch (e) {
          if (toastOn) _toast('error', 'page.record_case failed: ' + (e && e.message || e));
        }
        return true;
    }
    // Replay a page_automation CASE in THIS page — NO CDP. Executes each screen's
    // do[] via the same scoped+guarded onAction path, so replay is as safe as a
    // live action. Resolves {ok, performed, skipped}. This is how a recorded case
    // runs again without the daemon/managed-Edge: same-origin, in the user's tab.
    async function replayCase(theCase) {
      var c = theCase && (theCase.case || theCase);
      var screens = (c && c.screens) || [];
      var performed = 0, skipped = 0;
      // #27 — settle time between steps. A fixed 120ms per step made a long
      // replay mostly sleeps. Make it adaptive: only CLICK/navigate (which may
      // fire async handlers / re-render) needs a real settle; a plain fill/
      // select/check just yields a microtask. A case may override via
      // c.replaySettleMs (and 0 disables all but the microtask).
      var clickSettle = (c && typeof c.replaySettleMs === 'number') ? c.replaySettleMs : 120;
      var microtask = function () { return Promise.resolve(); };
      var settle = function (ms) { return ms > 0 ? new Promise(function (r) { setTimeout(r, ms); }) : microtask(); };
      for (var si = 0; si < screens.length; si++) {
        var dolist = (screens[si] && screens[si].do) || [];
        for (var di = 0; di < dolist.length; di++) {
          var a = dolist[di]; if (!a || !a.type) { skipped++; continue; }
          var t = a.type, verb = null, pl = {}, heavy = false;
          if (t === 'fill') { verb = 'page.fill'; pl = { selector: a.selector, value: a.value }; }
          else if (t === 'select') { verb = 'page.select'; pl = { selector: a.selector, value: a.value }; }
          else if (t === 'check') { verb = 'page.check'; pl = { selector: a.selector }; }
          else if (t === 'click' || t === 'click_primary' || t === 'click_tile') { verb = 'page.click'; pl = { selector: a.selector }; heavy = true; }
          else if (t === 'semantic' && a.action) {
            // #12 — a recorded SEMANTIC step (e.g. page.apply). Re-dispatch the
            // SEMANTIC verb through the host's onSemantic handler so the app's
            // own confirm gate runs — NOT a raw click on the submit control.
            if (typeof opts.onSemantic === 'function') {
              try { await opts.onSemantic(a.action, { selector: a.selector, value: a.value }); performed++; }
              catch (_e) { skipped++; }
              await settle(clickSettle);
            } else { skipped++; }
            continue;
          }
          else if (t === 'wait') { await new Promise(function (r) { setTimeout(r, (a.seconds || 1) * 1000); }); performed++; continue; }
          else if (t === 'navigate' && a.url) { try { if (location) location.href = a.url; } catch (_e) {} performed++; continue; }
          else { skipped++; continue; }   // secret/extract/capture — not client-replayable
          if (verb) {
            try { await onAction(verb, pl); performed++; } catch (_e) { skipped++; }
            // #27 — only a click/navigate gets the real settle; others yield a
            // microtask so a 20-step form isn't seconds of pure sleeps.
            await settle(heavy ? clickSettle : 0);
          }
        }
      }
      if (toastOn) _toast('success', 'Replayed ' + performed + ' step(s) (no CDP)');
      return { ok: true, performed: performed, skipped: skipped };
    }

    // Fetch a case by id from page_automation and replay it here. Convenience for
    // a UI "run this saved automation" button.
    async function replayCaseById(caseId, paBase) {
      try {
        var base = paBase || opts.pageAutomationBase || '/v1/apps/platform/page_automation';
        var g = await post(base + '/get', {id: caseId});
        var c = g && (g.case || (g.ok && g));
        if (!c || !c.screens) return { ok: false, error: 'case not found: ' + caseId };
        return await replayCase(c);
      } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
    }

    // Save the current recording as a case (the UI "Save automation" button).
    async function recordAndSave(id, meta) {
      meta = meta || {};
      _lastSavedId = id;   // remembered so a Replay button can default to it (#9)
      return onAction('page.record_case', { id: id, title: meta.title,
        url: meta.url, match_text: meta.match_text });
    }

    return {
      record, saveCase, replayCase, replayCaseById, recordAndSave,
      startRecording() {_recording = true; _trace = [];},
      stopRecording() {_recording = false;},
      isRecording() {return _recording;},
      getRecording() {return _trace.slice();},
      clearRecording() {_trace = [];},
      get _lastSavedId() {return _lastSavedId;}
    };
  }
  return {create};
})();
