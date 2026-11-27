// ---- chain parameter ROUTING: {{stepN.path}} references between steps -------------------------------------
// A step parameter is either a LITERAL ("architecture", 5, {...}) or routes an earlier step's OUTPUT:
//   * a WHOLE-VALUE reference  "{{step1.groups}}"        -> the typed value (list / object / number), not text
//   * an EMBEDDED reference    "Summarize:\n{{step1.result}}" -> the value is substituted into the text
// N is 1-based. Paths are dotted; list items by index ("groups.0.group"); "length" of a list or string;
// "result" (or "_full") is the whole output. Pure functions - unit-tested in tests/chain_bindings.test.js.
export const REF_RE = /\{\{\s*step(\d+)\.([^}]+?)\s*\}\}/g;
const WHOLE_RE = /^\s*\{\{\s*step(\d+)\.([^}]+?)\s*\}\}\s*$/;
// a route whose source step was REMOVED (remapRefs writes {{step?.path}}): always an error, never sent as text
export const BROKEN_RE = /\{\{\s*step\?\.([^}]+?)\s*\}\}/g;

export function parseRefs(value) {
  const out = [];
  if (typeof value !== 'string' || value.indexOf('{{') < 0) return out;
  let m; const re = new RegExp(REF_RE.source, 'g');
  while ((m = re.exec(value))) out.push({ step: parseInt(m[1], 10) - 1, path: m[2].trim(), raw: m[0] });
  return out;
}
export function wholeRef(value) {
  const m = typeof value === 'string' ? WHOLE_RE.exec(value) : null;
  return m ? { step: parseInt(m[1], 10) - 1, path: m[2].trim() } : null;
}
export function refText(stepIndex, path) { return '{{step' + (stepIndex + 1) + '.' + (path || 'result') + '}}'; }

// look a dotted path up in a step's output -> {found, value}
export function lookup(result, path) {
  if (path === 'result' || path === '_full' || path === '') return { found: result !== undefined, value: result };
  let val = result;
  for (const p of String(path).split('.')) {
    if (p === 'length' && (Array.isArray(val) || typeof val === 'string')) { val = val.length; continue; }
    if (val == null || typeof val !== 'object') return { found: false, value: undefined };
    if (Array.isArray(val)) {
      if (!/^-?\d+$/.test(p)) return { found: false, value: undefined };
      const i = parseInt(p, 10);
      val = val[i < 0 ? val.length + i : i];
    } else val = Object.prototype.hasOwnProperty.call(val, p) ? val[p] : undefined;
    if (val === undefined) return { found: false, value: undefined };
  }
  return { found: true, value: val };
}

// the tool schema's description string -> a coarse type ("number", "boolean", "json", "string")
export function hintType(desc) {
  const d = String(desc || '').trim().toLowerCase();
  if (/^(number|int|integer|float)\b/.test(d)) return 'number';
  if (/^(bool|boolean)\b/.test(d)) return 'boolean';
  if (/^(string\[\]|(object|array|list|dict|json)\b)/.test(d)) return 'json';
  return 'string';
}
export function coerce(value, hint) {
  if (typeof value !== 'string') return value;
  const t = value.trim();
  if (hint === 'number' && t !== '' && !isNaN(Number(t))) return Number(t);
  if (hint === 'boolean' && /^(true|false)$/i.test(t)) return t.toLowerCase() === 'true';
  if ((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))) { try { return JSON.parse(t); } catch (_e) { /* keep text */ } }
  if (hint !== 'string' && /^(true|false)$/.test(t)) return t === 'true';
  return value;
}

// one parameter value -> {value, missing:[ref texts that did not resolve]}
export function resolveValue(raw, results, hint) {
  if (typeof raw !== 'string') return { value: raw, missing: [] };
  const broken = raw.match(new RegExp(BROKEN_RE.source, 'g'));
  if (broken) return { value: raw, missing: broken };
  const whole = wholeRef(raw);
  if (whole) {
    const r = whole.step >= 0 && whole.step < results.length ? lookup(results[whole.step], whole.path) : { found: false };
    return r.found ? { value: r.value, missing: [] } : { value: raw, missing: [raw.trim()] };
  }
  if (raw.indexOf('{{') < 0) return { value: coerce(raw, hint), missing: [] };
  const missing = [];
  const text = raw.replace(new RegExp(REF_RE.source, 'g'), (match, n, path) => {
    const idx = parseInt(n, 10) - 1;
    const r = idx >= 0 && idx < results.length ? lookup(results[idx], path.trim()) : { found: false };
    if (!r.found) { missing.push(match); return match; }
    return typeof r.value === 'string' ? r.value : JSON.stringify(r.value);
  });
  return { value: missing.length ? text : coerce(text, hint === 'string' ? 'string' : hint), missing };
}

// a step's call args -> {args, missing:[{param, ref}]}; empty literals are left out (the tool's default applies)
export function buildArgs(params, results, schema) {
  const args = {}, missing = [];
  for (const [key, raw] of Object.entries(params || {})) {
    if (raw === '' || raw == null) continue;
    const r = resolveValue(raw, results, hintType((schema || {})[key]));
    r.missing.forEach((ref) => missing.push({ param: key, ref }));
    args[key] = r.value;
  }
  return { args, missing };
}
// back-compat (older callers / saved code): just the args
export function stepArgs(params, results, schema) { return buildArgs(params, results, schema).args; }
// back-compat: the 0-based steps a step's params reference
export function wiredSources(params) {
  const refs = new Set();
  for (const raw of Object.values(params || {})) for (const r of parseRefs(raw)) refs.add(r.step);
  return refs;
}
// [{param, step, path}] - every routed input of a step (for the graph's labelled wires and the inspector)
export function wires(params) {
  const out = [];
  for (const [param, raw] of Object.entries(params || {})) for (const r of parseRefs(raw)) out.push({ param, step: r.step, path: r.path });
  return out;
}

// the routable output fields of a step's last result: [{path, type, preview}] (depth- and count-capped)
export function outputFields(result, { maxDepth = 3, max = 80 } = {}) {
  const out = [];
  const kind = (v) => (v === null ? 'null' : Array.isArray(v) ? 'list' : typeof v === 'object' ? 'object' : typeof v);
  const preview = (v) => {
    const s = JSON.stringify(v);                       // strings are quoted, so "ai" (text) vs 42 (number) is visible
    return s === undefined ? '' : (s.length > 60 ? s.slice(0, 57) + '…' : s);
  };
  out.push({ path: 'result', type: kind(result), preview: preview(result) });
  (function walk(v, base, depth) {
    if (out.length >= max || depth > maxDepth || v == null || typeof v !== 'object') return;
    if (Array.isArray(v)) {
      out.push({ path: base + '.length', type: 'number', preview: String(v.length) });
      if (v.length) {
        out.push({ path: base + '.0', type: kind(v[0]), preview: preview(v[0]) });
        walk(v[0], base + '.0', depth + 1);
      }
      return;
    }
    for (const k of Object.keys(v)) {
      if (out.length >= max) return;
      const p = base ? base + '.' + k : k;
      out.push({ path: p, type: kind(v[k]), preview: preview(v[k]) });
      walk(v[k], p, depth + 1);
    }
  })(result, '', 1);
  // a top-level list's items are addressed from the root ("0.name"), so drop the leading dot
  return out.map((f) => (f.path.startsWith('.') ? Object.assign({}, f, { path: f.path.slice(1) }) : f));
}

// static checks over a chain: [{step, param, level: 'error'|'warning', message}]
export function validateChain(steps) {
  const issues = [];
  (steps || []).forEach((s, i) => {
    for (const [param, raw] of Object.entries(s.params || {})) {
      if (typeof raw === 'string' && new RegExp(BROKEN_RE.source).test(raw)) {
        issues.push({ step: i, param, level: 'error', message: 'is routed from a step that was removed - pick a new source' });
      }
    }
    for (const w of wires(s.params)) {
      if (w.step < 0 || w.step >= steps.length) {
        issues.push({ step: i, param: w.param, level: 'error', message: 'refers to step ' + (w.step + 1) + ', which does not exist' });
      } else if (w.step >= i) {
        issues.push({ step: i, param: w.param, level: 'error', message: 'refers to step ' + (w.step + 1) + ', which runs ' + (w.step === i ? 'as this step' : 'later') + ' - only earlier steps can be routed in' });
      } else if (steps[w.step]._result !== undefined && !lookup(steps[w.step]._result, w.path).found) {
        issues.push({ step: i, param: w.param, level: 'warning', message: '"' + w.path + '" is not in step ' + (w.step + 1) + "'s last output" });
      }
    }
  });
  return issues;
}

// keep references pointing at the same steps after a step moves (from -> to) or is removed (to = null)
export function remapRefs(steps, from, to) {
  const map = (idx) => {
    if (to === null) return idx === from ? -1 : idx > from ? idx - 1 : idx;
    if (idx === from) return to;
    if (from < to && idx > from && idx <= to) return idx - 1;
    if (from > to && idx >= to && idx < from) return idx + 1;
    return idx;
  };
  for (const s of steps) {
    for (const k of Object.keys(s.params || {})) {
      const v = s.params[k];
      if (typeof v !== 'string' || v.indexOf('{{') < 0) continue;
      s.params[k] = v.replace(new RegExp(REF_RE.source, 'g'), (m, n, path) => {
        const ni = map(parseInt(n, 10) - 1);
        return ni < 0 ? '{{step?.' + path.trim() + '}}' : '{{step' + (ni + 1) + '.' + path.trim() + '}}';
      });
    }
  }
}

// legacy helper kept for callers that only need text substitution
export function resolveVars(text, results) {
  if (typeof text !== 'string' || text.indexOf('{{') < 0) return text;
  return text.replace(new RegExp(REF_RE.source, 'g'), (match, n, field) => {
    const idx = parseInt(n, 10) - 1;
    if (idx < 0 || idx >= results.length || results[idx] == null) return match;
    const r = lookup(results[idx], field.trim());
    if (!r.found) return match;
    return typeof r.value === 'string' ? r.value : JSON.stringify(r.value);
  });
}
