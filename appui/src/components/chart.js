/* AppUIChart: a chart surface for app pages, drawn with Plotly.
 *
 * The page hands over a small declarative chart (Vega-Lite style: a mark and an
 * encoding of data columns) plus the data as COLUMNS; the component turns that
 * into Plotly traces, follows the AppUI theme and keeps the plot sized to its
 * container. Plotly (basic build: line / scatter / bar / pie) is vendored at
 * /appui/lib/plotly/ and loaded on first use, so pages need no script tag and
 * no network access.
 *
 * Usage:
 *   const chart = AppUIChart.create({container: el});
 *   chart.render({
 *     chart: {title: 'Throughput', mark: 'line',            // line | point | bar | area | arc
 *             encoding: {x: {field: 't', type: 'temporal', title: 'Time'},
 *                        y: {field: 'mbps', type: 'quantitative', title: 'Mbit/s'},
 *                        color: {field: 'cell', title: 'Cell'}}},   // one series per value
 *     columns: {t: [...], mbps: [...], cell: [...]},
 *   });
 *   chart.clear();   chart.resize();   chart.destroy();
 *
 * `chart.layer: [{mark, encoding}, …]` draws several marks over the same columns.
 * For arc, encoding.theta is the value and encoding.color the label.
 * mark 'rect' = heatmap: x / y categories, encoding.color the cell value (scale.scheme: viridis,
 * blues, …). Needs a heatmap build: set AppUIChart.heatmapLib to its URL (loaded on first use);
 * without it the heatmap is shown as a table.
 * `chart.highlights: [{from, to, label?, color?}]` shades x ranges (time values as the data has them).
 * create({container, onZoom}) — onZoom({from, to} | null) when the USER zooms / resets the x axis;
 * chart.setXRange({from, to} | null) sets it from outside (does not call onZoom): link several charts.
 * AppUIChart.plotly() resolves with the Plotly object for anything beyond this.
 * Keep the data small: aggregate on the server and send points, not rows.
 */
const AppUIChart = (() => {
  const LIB = '/appui/lib/plotly/plotly-basic-3.3.1.min.js';
  const MAX_SERIES = 60;
  let loading = null;
  function plotly() {
    if (window.Plotly) return Promise.resolve(window.Plotly);
    if (!loading) {
      loading = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = LIB; s.async = true;
        s.onload = () => window.Plotly ? resolve(window.Plotly) : reject(new Error('Plotly did not load'));
        s.onerror = () => { loading = null; reject(new Error('could not load ' + LIB)); };
        document.head.appendChild(s);
      });
    }
    return loading;
  }
  function markOf(layer, fallback) {
    const m = layer.mark != null ? layer.mark : fallback;
    return typeof m === 'string' ? m : (m && m.type) || 'line';
  }
  // Heatmaps (mark 'rect') need a Plotly build with the heatmap trace; the vendored basic build
  // has none. AppUIChart.heatmapLib is the URL of a heatmap-capable build (plotly-cartesian):
  // a page that draws heatmaps sets it (it is loaded on first use and replaces window.Plotly with
  // the larger build). Without it - or when it cannot be loaded - a heatmap is shown as a table.
  const hasHeatmap = P => { try { return !!(P.PlotSchema && P.PlotSchema.get().traces.heatmap); } catch (e) { return false; } };
  let heatLoading = null;
  function heatmapPlotly() {
    return plotly().then(P => {
      if (hasHeatmap(P)) return P;
      const url = AppUIChart.heatmapLib;
      if (!url) throw new Error('this Plotly build has no heatmap');
      if (!heatLoading) {
        heatLoading = new Promise((resolve, reject) => {
          const s = document.createElement('script');
          s.src = url; s.async = true;
          s.onload = () => window.Plotly && hasHeatmap(window.Plotly) ? resolve(window.Plotly) : reject(new Error('heatmap build did not load'));
          s.onerror = () => { heatLoading = null; reject(new Error('could not load ' + url)); };
          document.head.appendChild(s);
        });
      }
      return heatLoading;
    });
  }
  const isHeat = chart => (chart.layer && chart.layer.length ? chart.layer : [chart])
    .some(l => ['rect', 'heatmap'].includes(markOf(l, chart.mark)));
  // heatmap as a table (no heatmap build available): rows = y, columns = x, cell = color value
  function heatTable(host, chart, cols) {
    const enc = chart.encoding || {}, fx = enc.x && enc.x.field, fy = enc.y && enc.y.field, fc = enc.color && enc.color.field;
    const xs = [...new Set(cols[fx] || [])], ys = [...new Set(cols[fy] || [])], cell = new Map();
    (cols[fx] || []).forEach((x, i) => cell.set(ys.indexOf(cols[fy][i]) + '|' + xs.indexOf(x), (cols[fc] || [])[i]));
    const t = document.createElement('table');
    t.style.cssText = 'border-collapse:collapse;font-size:11px;margin:4px';
    const head = t.createTHead().insertRow();
    head.appendChild(Object.assign(document.createElement('th'), {textContent: (fy || '') + ' \\ ' + (fx || '')}));
    xs.slice(0, 200).forEach(x => head.appendChild(Object.assign(document.createElement('th'), {textContent: String(x)})));
    ys.slice(0, 500).forEach((y, r) => {
      const tr = t.insertRow();
      tr.appendChild(Object.assign(document.createElement('th'), {textContent: String(y)}));
      xs.slice(0, 200).forEach((_, c) => {
        const v = cell.get(r + '|' + c);
        tr.appendChild(Object.assign(document.createElement('td'), {textContent: v == null ? '' : String(v), style: 'padding:1px 5px;border:1px solid rgba(127,127,127,.3);text-align:right'}));
      });
    });
    const box = document.createElement('div');
    box.style.cssText = 'width:100%;height:100%;overflow:auto';
    if (chart.title) box.appendChild(Object.assign(document.createElement('div'), {textContent: chart.title, style: 'font-weight:600;padding:4px 8px'}));
    box.appendChild(t);
    host.replaceChildren(box);
  }
  function build(chart, cols, ink) {
    const layers = chart.layer && chart.layer.length ? chart.layer : [chart];
    const traces = [];
    const layout = {margin: {l: 64, r: 20, t: chart.title ? 40 : 16, b: 52}, title: {text: chart.title || ''},
      paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)', font: {color: ink, size: 11},
      showlegend: true, hovermode: 'closest'};
    const grid = 'rgba(127,127,127,.22)';
    layers.forEach(layer => {
      const mark = markOf(layer, chart.mark), enc = layer.encoding || chart.encoding || {};
      const fx = enc.x && enc.x.field, fy = enc.y && enc.y.field, fc = enc.color && enc.color.field;
      const value = (e, v) => e && e.type === 'temporal' && typeof v === 'number' ? new Date(v) : v;
      if (mark === 'arc') {
        const ft = enc.theta && enc.theta.field;
        traces.push({type: 'pie', labels: cols[fc] || cols[fx] || [], values: cols[ft] || cols[fy] || []});
        return;
      }
      if (mark === 'rect' || mark === 'heatmap') {
        // a heatmap: x and y are categories (in order of first appearance), color the cell value
        const hx = cols[fx] || [], hy = cols[fy] || [], hz = cols[fc] || [];
        const xi = new Map(), yi = new Map();
        for (let i = 0; i < hx.length; i++) {
          if (!xi.has(hx[i])) xi.set(hx[i], xi.size);
          if (!yi.has(hy[i])) yi.set(hy[i], yi.size);
        }
        const z = Array.from(yi.keys(), () => new Array(xi.size).fill(null));
        for (let i = 0; i < hx.length; i++) z[yi.get(hy[i])][xi.get(hx[i])] = hz[i] == null ? null : hz[i];
        const scheme = enc.color && enc.color.scale && enc.color.scale.scheme;
        const SCALES = {viridis: 'Viridis', blues: 'Blues', reds: 'Reds', greens: 'Greens', inferno: 'Inferno', plasma: 'Plasma',
          magma: 'Magma', turbo: 'Turbo', greys: 'Greys', oranges: 'YlOrRd', purples: 'Purples'};
        traces.push({type: 'heatmap', x: Array.from(xi.keys()), y: Array.from(yi.keys()), z,
          colorscale: SCALES[String(scheme || '').toLowerCase()] || 'Viridis',
          colorbar: {title: {text: (enc.color && (enc.color.title || fc)) || ''}}, hoverongaps: false});
        layout.xaxis = {title: {text: (enc.x && (enc.x.title || fx)) || ''}, type: 'category', gridcolor: grid};
        layout.yaxis = {title: {text: (enc.y && (enc.y.title || fy)) || ''}, type: 'category', gridcolor: grid};
        layout.showlegend = false;
        return;
      }
      const xs = cols[fx] || [], ys = cols[fy] || [], n = Math.min(xs.length, ys.length);
      const groups = new Map();
      for (let i = 0; i < n; i++) {
        const g = fc && cols[fc] ? String(cols[fc][i]) : '';
        let t = groups.get(g);
        if (!t) groups.set(g, t = {x: [], y: []});
        t.x.push(value(enc.x, xs[i])); t.y.push(value(enc.y, ys[i]));
      }
      let k = 0;
      for (const [g, d] of groups) {
        if (k++ >= MAX_SERIES) break;
        const t = {x: d.x, y: d.y, name: g || (enc.y && enc.y.title) || fy || ''};
        if (mark === 'bar') t.type = 'bar';
        else {
          t.type = 'scatter';
          t.mode = mark === 'point' || mark === 'circle' ? 'markers' : 'lines';
          if (mark === 'area') t.fill = 'tozeroy';
        }
        traces.push(t);
      }
      if (groups.size > MAX_SERIES) layout.title.text = (layout.title.text + '  (first ' + MAX_SERIES + ' of ' + groups.size + ' series)').trim();
      layout.xaxis = {title: {text: (enc.x && (enc.x.title || fx)) || ''}, gridcolor: grid, zerolinecolor: grid};
      layout.yaxis = {title: {text: (enc.y && (enc.y.title || fy)) || ''}, gridcolor: grid, zerolinecolor: grid};
      if (fc && enc.color.title) layout.legend = {title: {text: enc.color.title}};
      if (groups.size <= 1 && layers.length === 1) layout.showlegend = false;
    });
    const hl = Array.isArray(chart.highlights) ? chart.highlights : [];
    if (hl.length) {
      // shaded time ranges (e.g. the part of a timeline the global filters exclude)
      const e0 = (layers[0].encoding || chart.encoding || {}).x || {};
      const tv = v => e0.type === 'temporal' && typeof v === 'number' ? new Date(v) : v;
      layout.shapes = hl.map(h => ({type: 'rect', xref: 'x', yref: 'paper', x0: tv(h.from), x1: tv(h.to), y0: 0, y1: 1,
        fillcolor: h.color || 'rgba(150,150,150,.28)', line: {width: 0}, layer: 'below'}));
      const lbl = hl.filter(h => h.label);
      if (lbl.length) layout.annotations = lbl.map(h => ({xref: 'x', yref: 'paper', x: tv(h.from), y: 1, text: h.label,
        showarrow: false, xanchor: 'left', yanchor: 'top', font: {size: 10}}));
    }
    return {traces, layout};
  }

  function create(opts = {}) {
    const container = typeof opts.container === 'string' ? document.querySelector(opts.container) : opts.container;
    if (!container) throw new Error('AppUIChart: container required');
    const host = document.createElement('div');
    host.className = 'appui-chart';
    host.style.cssText = 'width:100%;height:100%;min-height:0;overflow:hidden;position:relative';
    container.replaceChildren(host);
    let destroyed = false, drawn = false, token = 0, frame = 0, w = -1, h = -1, asTable = false, listening = false, quiet = false;
    const size = () => ({width: Math.max(50, host.clientWidth), height: Math.max(50, host.clientHeight)});
    function resize() {
      if (destroyed || !drawn || !window.Plotly) return;
      const s = size(), drawnAs = host._fullLayout;      // what Plotly actually drew, when known
      const cw = drawnAs ? drawnAs.width : w, ch = drawnAs ? drawnAs.height : h;
      if (s.width === cw && s.height === ch) return;
      w = s.width; h = s.height;
      window.Plotly.relayout(host, s);
    }
    // next frame, and only on a real size change (never resize inside the observer callback)
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => {
      cancelAnimationFrame(frame); frame = requestAnimationFrame(resize);
    }) : null;
    if (ro) ro.observe(host);
    function render(input = {}) {
      const mine = ++token;
      const def = input.chart || {};
      const heat = isHeat(def);
      return (heat ? heatmapPlotly().catch(() => null) : plotly()).then(Plotly => {
        if (destroyed || mine !== token) return;
        if (!Plotly) {                         // a heatmap with no heatmap build: a table
          if (drawn && window.Plotly) window.Plotly.purge(host);
          drawn = false; asTable = true;
          return heatTable(host, def, input.columns || {});
        }
        if (asTable) { host.replaceChildren(); asTable = false; }
        const ink = getComputedStyle(host).color || '#444';
        const p = build(def, input.columns || {}, ink);
        const s = size(); w = s.width; h = s.height;
        Object.assign(p.layout, s, input.layout || {});
        drawn = true;
        // the container may have changed size while Plotly was drawing (a sibling
        // chart was added): compare again once the draw has finished
        return Promise.resolve(Plotly.react(host, p.traces, p.layout, {responsive: false, displaylogo: false}))
          .then(() => {
            if (!listening && typeof host.on === 'function') { listening = true; host.on('plotly_relayout', relayout); }
            if (!destroyed && mine === token) resize();
          });
      });
    }
    // a zoom the USER made on the x axis (not one set with setXRange) -> opts.onZoom({from, to} | null)
    function relayout(ev) {
      if (quiet || !opts.onZoom || !ev) return;
      if (ev['xaxis.autorange'] || ev['xaxis.range'] === null) return opts.onZoom(null);
      const a = ev['xaxis.range[0]'], b = ev['xaxis.range[1]'];
      if (a != null && b != null) return opts.onZoom({from: a, to: b});
      if (Array.isArray(ev['xaxis.range'])) opts.onZoom({from: ev['xaxis.range'][0], to: ev['xaxis.range'][1]});
    }
    function setXRange(range) {
      if (destroyed || !drawn || !window.Plotly || asTable) return Promise.resolve();
      quiet = true;
      const done = () => { quiet = false; };
      const r = range ? window.Plotly.relayout(host, {'xaxis.range': [range.from, range.to]})
                      : window.Plotly.relayout(host, {'xaxis.autorange': true});
      return Promise.resolve(r).then(done, done);
    }
    return {
      element: host, render, resize, setXRange,
      clear() { token++; if (drawn && window.Plotly) window.Plotly.purge(host); drawn = false; },
      destroy() {
        destroyed = true; token++; cancelAnimationFrame(frame);
        if (ro) ro.disconnect();
        if (drawn && window.Plotly) window.Plotly.purge(host);
        host.remove();
      },
    };
  }
  return {create, plotly, build, heatmapLib: null};
})();
window.AppUIChart = AppUIChart;
