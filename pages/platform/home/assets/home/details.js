import { S, capName, esc, toolCount } from "./state.js";

// ----------------------------------------------------------- details -----
// Capabilities / dependencies / example prompts (the tools themselves are
// browsed through VIS).
function showDetails(a){
  var body = document.createElement('div'); body.className = 'dd';
  var needs = (a.needs_capabilities||[]).map(capName).filter(Boolean);
  var opts = (a.optional_capabilities||[]).map(capName).filter(Boolean);
  var capHtml = needs.length ? needs.map(function(n){
    return '<span class="tag ' + (S.caps.has(n) ? 'ok' : 'bad') + '">' + esc(n) + (S.caps.has(n) ? ' ✓' : ' ✗') + '</span>';
  }).join(' ') : '<span class="tag">none — runs anywhere</span>';
  if (opts.length) capHtml += ' <span style="color:var(--text-muted);font-size:11px">optional:</span> ' +
    opts.map(function(n){ return '<span class="tag">' + esc(n) + '</span>'; }).join(' ');
  var deps = (a.needs_apps||[]).map(function(d){ return '<span class="tag ' + (d.present ? 'ok' : 'bad') + '">' + esc(d.id) + '</span>'; }).join(' ');
  var prompts = (a.example_prompts||[]).map(function(p){ return '<li>' + esc(p) + '</li>'; }).join('');
  var ops = a.ops || [], writes = ops.filter(function(o){ return o.safety === 'confirm'; }).length;
  body.innerHTML =
    '<div>' + esc(a.description || 'No description.') + '</div>' +
    '<div><div class="lbl">Capabilities</div>' + capHtml + '</div>' +
    (deps ? '<div><div class="lbl">Uses apps</div>' + deps + '</div>' : '') +
    (prompts ? '<div><div class="lbl">Try asking the AI</div><ul>' + prompts + '</ul></div>' : '') +
    '<div><div class="lbl">Operations</div>' + ops.length + ' total · ' + toolCount(a) + ' exposed to the LLM · ' + writes + ' write' + (writes === 1 ? '' : 's') + '</div>';
  window.AppUIDialog && AppUIDialog.show({ title: (a.title || a.app_id) + ' — ' + a.app_id, body: body, width: '640px', buttons: [{ text: 'Close' }] });
}

export { showDetails };
