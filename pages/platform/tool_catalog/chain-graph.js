// SVG pipeline rendering of the chain: one node per step, grey arrows for the run order and orange
// ROUTE wires from a step to every later step that takes one of its outputs - labelled with the
// receiving parameter(s) ("→ group"). Steps with routing errors are outlined red.
import { wires } from './chain-bindings.js?v=3';

export function createChainGraph({ state: st, find: q, renderInspector: drawInspector, svgEl, svgText, issuesOf }) {
  const NODE_W = 250, NODE_H = 54, GAP_Y = 46, PAD = 24;
  function drawGraph() {
    const canvas = q('c-canvas');
    if (!st.steps.length) {
      canvas.innerHTML = '<div class="tc-empty">Drag a tool here from the <b>Tools</b> list (or click it) to add the first step.<br>' +
        'Then route an earlier step\'s output into a parameter with its <b>⤵</b> button.</div>';
      return;
    }
    const n = st.steps.length, cx = PAD + 20, yOf = (i) => PAD + i * (NODE_H + GAP_Y);
    const width = NODE_W + PAD * 2 + 230, height = PAD * 2 + n * NODE_H + (n - 1) * GAP_Y;
    const svg = svgEl('svg', { class: 'tc-svg', width, height, viewBox: '0 0 ' + width + ' ' + height });
    const defs = svgEl('defs', {});
    defs.innerHTML = '<marker id="c-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="var(--border)"/></marker>' +
      '<marker id="c-arrow-w" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="var(--color-warning)"/></marker>';
    svg.appendChild(defs);
    const layer = svgEl('g', {});
    for (let i = 1; i < n; i++) layer.appendChild(seqEdge(cx, yOf(i - 1), yOf(i)));
    // route wires grouped by (source -> target), labelled with the receiving params
    const lanes = {};
    for (let i = 0; i < n; i++) {
      const byFrom = {};
      for (const w of wires(st.steps[i].params)) {
        if (w.step < 0 || w.step >= i) continue;                 // invalid routes are reported, not drawn
        (byFrom[w.step] = byFrom[w.step] || []).push(w.param);
      }
      for (const from of Object.keys(byFrom)) {
        const lane = (lanes[from] = (lanes[from] || 0) + 1);
        layer.appendChild(routeEdge(cx, yOf(+from), yOf(i), lane, [...new Set(byFrom[from])]));
      }
    }
    svg.appendChild(layer);
    function seqEdge(x, y1, y2) {
      const sx = x + NODE_W / 2;
      return svgEl('path', { d: 'M' + sx + ',' + (y1 + NODE_H) + ' L' + sx + ',' + y2, class: 'tc-edge', fill: 'none', 'marker-end': 'url(#c-arrow)' });
    }
    function routeEdge(x, y1, y2, lane, params) {
      const sx = x + NODE_W, sy = y1 + NODE_H / 2, ex = x + NODE_W, ey = y2 + NODE_H / 2;
      const bow = 28 + lane * 26 + Math.min(60, Math.abs((y2 - y1) / (NODE_H + GAP_Y)) * 10);
      const g = svgEl('g', { class: 'tc-route' });
      g.appendChild(svgEl('path', { d: 'M' + sx + ',' + sy + ' C' + (sx + bow) + ',' + sy + ' ' + (ex + bow) + ',' + ey + ' ' + (ex + 6) + ',' + ey,
        class: 'tc-edge wire', fill: 'none', 'marker-end': 'url(#c-arrow-w)' }));
      const t = svgText(ex + bow * 0.75 + 4, (sy + ey) / 2 + 4, '→ ' + params.join(', '), 'tc-wire-label', 200);
      const title = svgEl('title', {}); title.textContent = 'output routed into: ' + params.join(', ');
      g.appendChild(title); g.appendChild(t);
      return g;
    }
    const nodeEls = [];
    for (let i = 0; i < n; i++) {
      const step = st.steps[i], y = yOf(i);
      const bad = issuesOf ? issuesOf(i).some((x) => x.level === 'error') : false;
      const g = svgEl('g', { class: 'tc-node' + (i === st.selected ? ' sel' : '') + (bad ? ' bad' : '') +
        (step._running ? ' running' : step._done ? (step._ok ? ' ok' : ' err') : ''), transform: 'translate(' + cx + ',' + y + ')' });
      g.dataset.i = i;
      g.appendChild(svgEl('rect', { width: NODE_W, height: NODE_H, rx: 8 }));
      g.appendChild(svgEl('circle', { cx: 16, cy: NODE_H / 2, r: 11, class: 'tc-num' }));
      g.appendChild(svgText(16, NODE_H / 2 + 4, String(i + 1), 'tc-numt'));
      const glyph = step._running ? '⏳' : step._done ? (step._ok ? '✓' : '✗') : '';
      const write = step.tool && step.tool.safety === 'confirm' ? '  ✏ write' : '';
      g.appendChild(svgText(36, 21, step.tool.id || step.tool.name || '', 'tc-ntitle', NODE_W - 50));
      g.appendChild(svgText(36, 39, (step.tool.app_id || '') + write + (glyph ? '   ' + glyph : '') + (step._time !== undefined ? '   ' + step._time + 'ms' : ''), 'tc-nsub', NODE_W - 50));
      svg.appendChild(g); nodeEls.push(g);
    }
    canvas.innerHTML = ''; canvas.appendChild(svg);
    const activate = (i) => { st.selected = i; drawGraph(); drawInspector(); };
    if (window.AppUI && AppUI.components && AppUI.components.GraphNode) AppUI.components.GraphNode.bind({ elements: nodeEls, getData: (e) => parseInt(e.dataset.i, 10), label: 'Pipeline step', onActivate: (_e, i) => activate(i) });
    else nodeEls.forEach((e) => e.addEventListener('click', () => activate(parseInt(e.dataset.i, 10))));
  }
  return { render: drawGraph };
}
