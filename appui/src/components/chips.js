/* AppUIChips: rows of toggleable filter chips (one group per facet).
 *
 *   const chips = AppUIChips.create({
 *     container: el,
 *     groups: [
 *       {id: 'severity', label: 'Severity', multi: true,          // several may be on
 *        options: [{value: 'critical', label: 'critical', count: 12}, {value: 'major'}]},
 *       {id: 'range', label: 'Range', multi: false,               // one (or none) on
 *        options: [{value: '24h', label: '≤ 24 h of the newest crash'}]},
 *     ],
 *     value: {severity: ['critical']},                            // initial selection
 *     onChange: (value, group) => {},                             // {groupId: [values]}
 *   });
 *   chips.value();  chips.set({severity: []});  chips.setCounts('severity', {major: 3});
 *   chips.clear();  chips.destroy();
 *
 * Each chip is a <button aria-pressed>; a group is role=group with its label.
 * Keyboard: Tab between chips, Enter / Space toggles. A chip with count 0 is
 * shown dimmed but stays usable (a filter may still be wanted).
 */
const AppUIChips = (() => {
  let styled = false;
  function style() {
    if (styled) return; styled = true;
    const s = document.createElement('style');
    s.textContent = [
      '.auchips{display:flex;flex-wrap:wrap;gap:4px 14px;align-items:center;font:12px var(--font-ui,system-ui,sans-serif)}',
      '.auchips-g{display:flex;flex-wrap:wrap;gap:4px;align-items:center}',
      '.auchips-l{opacity:.7;margin-right:2px}',
      '.auchip{border:1px solid var(--border,#8884);background:transparent;color:inherit;border-radius:12px;padding:2px 9px;cursor:pointer;font:inherit;line-height:16px}',
      '.auchip:hover{background:rgba(127,127,127,.12)}',
      '.auchip:focus-visible{outline:2px solid var(--accent,#4c8bf5);outline-offset:1px}',
      '.auchip[aria-pressed="true"]{background:var(--accent,#4c8bf5);border-color:var(--accent,#4c8bf5);color:#fff}',
      '.auchip.zero{opacity:.55}',
      '.auchip small{opacity:.75;margin-left:4px}'
    ].join('\n');
    document.head.appendChild(s);
  }

  function create(opts = {}) {
    const container = typeof opts.container === 'string' ? document.querySelector(opts.container) : opts.container;
    if (!container) throw new Error('AppUIChips: container required');
    style();
    const groups = (opts.groups || []).map(g => Object.assign({multi: true, options: []}, g));
    const sel = {};
    groups.forEach(g => { sel[g.id] = new Set(((opts.value || {})[g.id] || []).map(String)); });
    const root = document.createElement('div');
    root.className = 'auchips';
    const buttons = {};                     // groupId -> {value: button}

    function snapshot() {
      const out = {};
      groups.forEach(g => { out[g.id] = Array.from(sel[g.id]); });
      return out;
    }
    function paint(g) {
      Object.entries(buttons[g.id] || {}).forEach(([v, b]) => b.setAttribute('aria-pressed', sel[g.id].has(v) ? 'true' : 'false'));
    }
    function label(opt) {
      return (opt.label != null ? String(opt.label) : String(opt.value));
    }
    function chipText(b, opt) {
      b.textContent = label(opt);
      if (opt.count != null) {
        const c = document.createElement('small');
        c.textContent = String(opt.count);
        b.appendChild(c);
      }
      b.classList.toggle('zero', opt.count === 0);
    }
    function build() {
      root.replaceChildren();
      groups.forEach(g => {
        const box = document.createElement('div');
        box.className = 'auchips-g';
        box.setAttribute('role', 'group');
        if (g.label) {
          const l = document.createElement('span');
          l.className = 'auchips-l';
          l.textContent = g.label;
          l.id = 'auchips-' + Math.random().toString(36).slice(2);
          box.setAttribute('aria-labelledby', l.id);
          box.appendChild(l);
        }
        buttons[g.id] = {};
        g.options.forEach(opt => {
          const v = String(opt.value);
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'auchip';
          if (opt.title) b.title = opt.title;
          chipText(b, opt);
          b.addEventListener('click', () => {
            const s = sel[g.id];
            if (s.has(v)) s.delete(v);
            else { if (!g.multi) s.clear(); s.add(v); }
            paint(g);
            if (opts.onChange) opts.onChange(snapshot(), g.id);
          });
          buttons[g.id][v] = b;
          box.appendChild(b);
        });
        root.appendChild(box);
        paint(g);
      });
    }
    build();
    container.appendChild(root);
    return {
      element: root,
      value: snapshot,
      set(value, silent) {
        groups.forEach(g => { if (value && value[g.id]) { sel[g.id] = new Set(value[g.id].map(String)); paint(g); } });
        if (!silent && opts.onChange) opts.onChange(snapshot(), null);
      },
      clear(silent) {
        groups.forEach(g => { sel[g.id].clear(); paint(g); });
        if (!silent && opts.onChange) opts.onChange(snapshot(), null);
      },
      setCounts(groupId, counts) {
        const g = groups.find(x => x.id === groupId);
        if (!g) return;
        g.options.forEach(opt => {
          const v = String(opt.value);
          opt.count = counts && counts[v] != null ? counts[v] : 0;
          if (buttons[groupId][v]) chipText(buttons[groupId][v], opt);
        });
      },
      destroy() { root.remove(); },
    };
  }
  return {create};
})();
window.AppUIChips = AppUIChips;
