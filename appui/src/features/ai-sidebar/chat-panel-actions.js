/* ChatPanel actions helpers; loaded by the aiSidebar bundle. */
window._AppUIChatPanelActions = (() => {
  // Action `type`s we accept from a reply. Kept conservative so arbitrary JSON
  // the model shows (examples, data) isn't misread as an action to apply. A
  // host's onAction still decides what each type does; unknown-but-matching
  // types are passed through (the host ignores what it doesn't handle).
  const ACTION_TYPE = /^(chain|catalog|context|page|doc)\.[a-z][\w.-]*$/i;
  // + the EXACT action types a mounted chat profile DECLARES (manifest
  // chat_profile.actions, e.g. charts.plot / charts.show): an app's own domain
  // actions — registered by mount/mountProfile, page-wide (one parser).
  const _declared = new Set();
  function registerActionTypes(list) {
    (Array.isArray(list) ? list : []).forEach((t) => { if (typeof t === 'string' && /^[a-z][\w-]*\.[a-z][\w.-]*$/i.test(t)) _declared.add(t); });
  }
  function _isType(t) { return typeof t === 'string' && (ACTION_TYPE.test(t) || _declared.has(t)); }
  // Fenced blocks: ```action … ```  OR  ```json/```js/``` … ``` (any language
  // tag). The model doesn't reliably use the ```action tag, so we scan every
  // fenced block and keep only those whose JSON is a valid action.
  const ANY_FENCE = /```[a-zA-Z0-9]*\s*\n([\s\S]*?)```/g;

  function _asAction(raw) {
    const s = String(raw || '').trim();
    if (!s || (s[0] !== '{' && s[0] !== '[')) return null;
    let obj; try { obj = JSON.parse(s); } catch (_e) { return null; }
    return _normalizeAction(obj, s);
  }

  // Normalize the many shapes a model emits into a canonical action. Accepts:
  //  • {type:"chain.set"|"chain.append"|"catalog.focus"|…, …}        (preferred)
  //  • {type:"chain.*", steps:[…]} with steps as {tool,params} OR {app,op,args}
  //  • an UNTYPED chain: {steps:[…]} / {chain:[…]} / a bare [ …step… ] array —
  //    synthesized as chain.set (the common drift where the model omits `type`
  //    and/or uses `chain`/`app`/`op`/`args` instead of steps/tool/params).
  // Step normalization: tool ← tool | app+"."+op | op ; params ← params | args.
  function _normalizeAction(obj, raw) {
    if (!obj || typeof obj !== 'object') return null;
    const normSteps = (arr) => (Array.isArray(arr) ? arr : [])
      .map((s) => {
        if (!s || typeof s !== 'object') return null;
        let tool = s.tool || s.id;
        if (!tool && s.op) tool = s.app ? (String(s.app) + '.' + String(s.op)) : String(s.op);
        if (!tool) return null;
        return { tool: String(tool), params: (s.params && typeof s.params === 'object') ? s.params : (s.args && typeof s.args === 'object' ? s.args : {}) };
      })
      .filter(Boolean);

    // The model often keys the type as `action` or `kind` instead of `type`
    // (e.g. {"action":"page.inspect",...}). Accept those aliases, but ONLY when
    // the value is a real action type (matches ACTION_TYPE) — so arbitrary data
    // with an `action`/`kind` field isn't misread as an action to apply.
    let actionType = (typeof obj.type === 'string' && obj.type) ? obj.type : null;
    if (!actionType && !Array.isArray(obj)) {
      for (const k of ['action', 'kind']) {
        if (typeof obj[k] === 'string' && _isType(obj[k])) { actionType = obj[k]; break; }
      }
    }
    // Also accept the SINGLE-KEY-ENVELOPE shape where the action TYPE is the key
    // and its value is the payload: {"page.fill":{selector,value}} /
    // {"page.inspect":{path}}. Only when the object has exactly one key, that key
    // matches ACTION_TYPE, and its value is an object — so ordinary data isn't
    // misread. The inner payload becomes the action payload (with a canonical
    // type stamped on).
    if (!actionType && !Array.isArray(obj)) {
      const keys = Object.keys(obj);
      if (keys.length === 1 && _isType(keys[0]) && obj[keys[0]] && typeof obj[keys[0]] === 'object' && !Array.isArray(obj[keys[0]])) {
        const t = keys[0];
        return { type: t, payload: Object.assign({}, obj[t], { type: t }), raw };
      }
    }

    if (!Array.isArray(obj) && typeof actionType === 'string' && _isType(actionType)) {
      // typed action — if it's a chain.*, normalize its steps so {app,op,args} works
      if (/^chain\./i.test(actionType)) {
        const steps = normSteps(obj.steps || obj.chain);
        return { type: actionType, payload: Object.assign({}, obj, { type: actionType, steps }), raw };
      }
      // carry a canonical `type` into the payload so a host reading payload.type works
      return { type: actionType, payload: Object.assign({}, obj, { type: actionType }), raw };
    }
    // UNTYPED: a bare array of steps, or {steps|chain:[…]} → synthesize chain.set
    const arr = Array.isArray(obj) ? obj : (obj.steps || obj.chain);
    if (Array.isArray(arr) && arr.length) {
      const steps = normSteps(arr);
      if (steps.length) return { type: 'chain.set', payload: { type: 'chain.set', steps }, raw };
    }
    return null;
  }

  // Scan the prose for BARE top-level JSON objects (no fence) that are actions.
  // Brace-matching so a nested object (e.g. params:{…}) is captured whole; only
  // objects that parse AND carry an action `type` are kept. This recovers the
  // common case where the model emits the JSON without any code fence.
  function _bareActions(text) {
    const out = [];
    for (let i = 0; i < text.length; i++) {
      if (text[i] !== '{') continue;
      let depth = 0, inStr = false, esc = false, end = -1;
      for (let j = i; j < text.length; j++) {
        const c = text[j];
        if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
        if (c === '"') inStr = true;
        else if (c === '{') depth++;
        else if (c === '}') { depth--; if (depth === 0) { end = j; break; } }
      }
      if (end === -1) break;
      const slice = text.slice(i, end + 1);
      if (/"type"|"action"|"kind"|"steps"|"chain"|"(chain|catalog|context|page|doc)\.[a-z][\w.-]*"\s*:/.test(slice)) { const a = _asAction(slice); if (a) { a.span = [i, end + 1]; out.push(a); } }
      i = end;   // continue past this object
    }
    return out;
  }

  // Scan for the VERB-PREFIXED shape the model also emits: a bare action-type
  // word immediately followed by its JSON args — `page.fill {"selector":...}`
  // or `page.fill({...})` — optionally several in a row, optionally wrapped in a
  // <actions>…</actions> / <action>…</action> tag (the tag text is ignored; the
  // `verb {json}` tokens inside are matched). Returns [{type,payload,raw}]. This
  // is distinct from the JSON-object shapes (_asAction/_bareActions): here the
  // TYPE is a bare token OUTSIDE the JSON, and the JSON is just the payload.
  function _verbPrefixedActions(text) {
    const out = [];
    // match: <prefix>.<verb>  optional "(" / whitespace  { ...balanced... }  optional ")"
    const re = /\b((?:chain|catalog|context|page|doc)\.[a-z][\w.-]*)\s*\(?\s*(\{)/gi;
    let m;
    while ((m = re.exec(text)) !== null) {
      const type = m[1];
      // brace-match the JSON starting at the '{' (m.index of group 2)
      const start = m.index + m[0].length - 1;   // index of '{'
      let depth = 0, inStr = false, esc = false, end = -1;
      for (let j = start; j < text.length; j++) {
        const c = text[j];
        if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
        if (c === '"') inStr = true;
        else if (c === '{') depth++;
        else if (c === '}') { depth--; if (depth === 0) { end = j; break; } }
      }
      if (end === -1) break;
      const jsonStr = text.slice(start, end + 1);
      let payload; try { payload = JSON.parse(jsonStr); } catch (_e) { payload = null; }
      if (payload && typeof payload === 'object' && !Array.isArray(payload) && _isType(type)) {
        let tail = end + 1; if (text[tail] === ')') tail++;   // span covers verb({...})
        out.push({ type, payload: Object.assign({}, payload, { type }), raw: m[1] + ' ' + jsonStr, span: [m.index, tail] });
      }
      re.lastIndex = end + 1;   // continue after this JSON
    }
    return out;
  }

  // Scan the XML-TAG-ATTRIBUTE shape: `<action name="page.fill">{json}` or
  // `<action type='page.click'>{json}</action>` — the action TYPE is in a name=
  // / type= / action= attribute of an <action>/<tool_call>/<tool> tag, and the
  // JSON payload follows the '>'. Tolerates single/double quotes and a missing
  // closing tag. Distinct from _verbPrefixedActions (bare verb token) and the
  // JSON-object shapes.
  function _xmlTagActions(text) {
    const out = [];
    // <tag  ... name|type|action = "TYPE" ... >   then a following {json}
    const re = /<(?:action|tool_call|tool|invoke)\b[^>]*\b(?:name|type|action)\s*=\s*["']((?:chain|catalog|context|page|doc)\.[a-z][\w.-]*)["'][^>]*>/gi;
    let m;
    while ((m = re.exec(text)) !== null) {
      const type = m[1];
      // find the first '{' after the tag and brace-match it
      let s = text.indexOf('{', m.index + m[0].length);
      if (s === -1) continue;
      let depth = 0, inStr = false, esc = false, end = -1;
      for (let j = s; j < text.length; j++) {
        const c = text[j];
        if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
        if (c === '"') inStr = true;
        else if (c === '{') depth++;
        else if (c === '}') { depth--; if (depth === 0) { end = j; break; } }
      }
      if (end === -1) break;
      let payload; try { payload = JSON.parse(text.slice(s, end + 1)); } catch (_e) { payload = null; }
      if (payload && typeof payload === 'object' && !Array.isArray(payload) && _isType(type)) {
        let tail = end + 1;
        const close = text.slice(tail).match(/^\s*<\/(?:action|tool_call|tool|invoke)>/i);
        if (close) tail += close[0].length;
        out.push({ type, payload: Object.assign({}, payload, { type }), raw: m[0] + text.slice(s, end + 1), span: [m.index, tail] });
      }
      re.lastIndex = end + 1;
    }
    return out;
  }

  /**
   * Extract every structured ACTION from an assistant reply. Tolerant of how
   * the model renders it (the model does NOT reliably use a ```action fence):
   *   1. ```action … ```  blocks (preferred),
   *   2. any OTHER fenced block (```json / ``` / …) whose JSON is an action,
   *   3. a BARE top-level JSON object in the prose that is an action.
   * De-dupes identical (type+raw) hits so a block shown once isn't applied
   * twice. Only objects whose `type` matches ACTION_TYPE are accepted.
   */
  // #2 — track which NON-CANONICAL action shapes actually appear in the wild, so
  // drift is diagnosable (the canonical form is a fenced {"type":…} block; every
  // other recognized shape means the model drifted). One-time console.debug per
  // shape per page — no spam, no behavior change. Reset by a reload.
  const _seenShapes = new Set();
  function _noteShape(shape) {
    if (_seenShapes.has(shape)) return;
    _seenShapes.add(shape);
    try {
      console.debug('[AppUIChatPanel] page-action shape drift: the model emitted a "'
        + shape + '" action (canonical is a fenced {"type":…} block). The parser '
        + 'handled it; this is just telemetry for which shapes still appear.');
    } catch (_e) { /* console unavailable */ }
  }

  function parseActions(text) {
    if (!text || typeof text !== 'string' || text.indexOf('{') === -1) return [];
    const out = [];
    const seen = new Set();
    const add = (a) => { if (!a) return false; const k = a.type + '\u0000' + a.raw; if (seen.has(k)) return false; seen.add(k); out.push(a); return true; };
    // 1 + 2: every fenced block, action-tag or otherwise. Record the FENCE span
    // (#26) so stripActions can reuse it instead of re-scanning. The fenced
    // {"type":…} block is the CANONICAL shape — not tracked as drift.
    ANY_FENCE.lastIndex = 0;
    let m;
    while ((m = ANY_FENCE.exec(text)) !== null) {
      const a = _asAction(m[1]);
      if (a) { a.span = [m.index, m.index + m[0].length]; add(a); }
    }
    // 3: bare JSON objects in the prose (outside fences). Cheap guard: only scan
    // when there's a plausible action/chain token, to avoid brace-walking every
    // reply. Matches the typed form (type/action/kind) OR the untyped chain
    // drift (steps/chain arr).
    if (/"(type|action|kind)"\s*:\s*"(chain|catalog|context|page|doc)\.|"(steps|chain)"\s*:\s*\[|"(chain|catalog|context|page|doc)\.[a-z][\w.-]*"\s*:\s*\{/.test(text)) {
      for (const a of _bareActions(text)) { if (add(a)) _noteShape('bare-json'); }
    }
    // 4: the VERB-PREFIXED shape — `page.fill {json}` / `page.fill({json})` /
    // inside <actions>…</actions>. Cheap guard: a `<prefix>.<verb>` token near a
    // '{'. Handles the multi-action <actions> wrapper the model sometimes emits.
    if (/\b(chain|catalog|context|page|doc)\.[a-z][\w.-]*\s*\(?\s*\{/i.test(text)) {
      for (const a of _verbPrefixedActions(text)) { if (add(a)) _noteShape('verb-prefixed'); }
    }
    // 5: the XML-TAG-ATTRIBUTE shape — `<action name="page.fill">{json}`.
    if (/<(?:action|tool_call|tool|invoke)\b[^>]*\b(?:name|type|action)\s*=/i.test(text)) {
      for (const a of _xmlTagActions(text)) { if (add(a)) _noteShape('xml-tag'); }
    }
    return out;
  }

  // Remove recognized ACTION blocks from a reply's DISPLAY text, so the fenced
  // or bare JSON the model emits to drive the page doesn't leak into the chat as
  // visible content. Mirrors parseActions' recognition (fenced action/json whose
  // JSON is an action; bare top-level action JSON). Actions are still DISPATCHED
  // from the raw reply — this only cleans what the user SEES / what's stored.
  // Returns the trimmed remainder (may be '' when the reply was action-only).
  function stripActions(text) {
    if (!text || typeof text !== 'string' || text.indexOf('{') === -1) return text || '';
    // #26 — reuse parseActions' recognized SPANS instead of a second independent
    // brace-walk. parseActions already found every action and recorded its
    // [start,end] span (fence / bare JSON / verb-prefixed / XML tag); delete
    // those spans back-to-front so indices stay valid, then tidy up the
    // now-empty <actions>/<action> wrappers + blank lines. One scan for both.
    const acts = parseActions(text);
    const spans = acts.map((a) => a.span).filter(Boolean)
      .sort((x, y) => x[0] - y[0]);
    // merge/skip overlaps (a fence span can contain a bare-JSON span for the
    // same action; the de-dupe in parseActions already drops the duplicate, but
    // guard against partial overlaps defensively) then cut back-to-front.
    let out = text;
    const merged = [];
    for (const s of spans) {
      const last = merged[merged.length - 1];
      if (last && s[0] <= last[1]) { last[1] = Math.max(last[1], s[1]); }
      else merged.push([s[0], s[1]]);
    }
    for (let k = merged.length - 1; k >= 0; k--) out = out.slice(0, merged[k][0]) + out.slice(merged[k][1]);
    // drop now-empty <actions>…</actions> / <action>…</action> wrappers.
    out = out.replace(/<\/?(?:actions?|tool_call|tool|invoke)>/gi, '');
    // tidy leftover blank lines from removed blocks
    return out.replace(/\n{3,}/g, '\n\n').trim();
  }

  return { parseActions, stripActions, registerActionTypes };
})();
