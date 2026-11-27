import { $, S, ago, esc, secs } from "./state.js";

function renderEndpoints(){
  var box = $('#hp-eps'), meta = $('#hp-epmeta'); if (!box) return;
  if (meta) meta.textContent = S.epsError ? 'could not reach /v1/endpoints' : (S.eps.length + ' connected · ' + S.caps.size + ' capabilities');
  if (!S.eps.length) {
    box.innerHTML = '<div class="hp-empty" style="grid-column:1/-1"><div class="big">🔌</div>No endpoint daemons connected.<br>' +
      '<span style="font-size:12px">Start one with <code>py -3 daemons\\windows\\agent.py</code> to unlock COM / desktop / browser capabilities.</span></div>';
    return;
  }
  box.innerHTML = '';
  S.eps.forEach(function(e){
    var plat = /win/i.test(e.platform) ? '🪟' : /linux/i.test(e.platform) ? '🐧' : /darwin|mac/i.test(e.platform) ? '🍎' : '🖥️';
    var groups = {};
    (e.capabilities||[]).forEach(function(c){
      var nm = c.name || String(c), i = nm.indexOf('.'), pfx = i > 0 ? nm.slice(0, i) : nm;
      (groups[pfx] = groups[pfx] || []).push((i > 0 ? nm.slice(i + 1) : nm) + (c.variant ? ':' + c.variant : ''));
    });
    var warn = e.stale ? '<span class="tag bad">stale</span>' : (e.flapping ? '<span class="tag bad">flapping</span>' : '<span class="tag ok"><span class="live"></span>online</span>');
    var d = document.createElement('div'); d.className = 'ep';
    d.innerHTML = '<div class="h"><span class="ic" style="--hue:#0ea5e9">' + plat + '</span>' +
      '<div><div class="nm">' + esc(e.endpoint) + '</div><div class="sub">' + esc(e.platform) +
      ' · seen ' + secs(e.age_s) + ' ago' + (e.reconnects ? ' · ' + e.reconnects + ' reconnects' : '') + '</div></div>' +
      '<span class="grow"></span>' + warn + '</div>' +
      '<div class="caps">' + Object.keys(groups).sort().map(function(p){
        return '<div class="cg"><span class="lbl">' + esc(p) + '</span>' +
          groups[p].sort().map(function(n){ return '<span class="tag">' + esc(n) + '</span>'; }).join('') + '</div>';
      }).join('') + '</div>';
    box.appendChild(d);
  });
}

export { renderEndpoints };
