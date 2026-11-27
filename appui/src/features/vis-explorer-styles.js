/* VIS Explorer styling, injected once per document. */
const _AppUIVisExplorerStyles = (() => {
  const CSS = `
  .vx{font-size:13px;color:var(--text-primary)}
  .vx *{box-sizing:border-box}
  .vx-top{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:10px}
  .vx-prov{display:inline-flex;align-items:center;gap:6px;padding:5px 11px;border-radius:999px;border:1px solid var(--border);
    background:var(--bg-elevated);color:var(--text-secondary);font-size:12px;cursor:pointer;user-select:none}
  .vx-prov:hover{color:var(--text-primary);border-color:var(--text-muted)}
  .vx-prov.on{background:var(--accent-muted);color:var(--accent);border-color:var(--accent)}
  .vx-crumbs{display:flex;flex-wrap:wrap;align-items:center;gap:4px;font-size:12px;color:var(--text-muted);margin:4px 0 12px}
  .vx-crumbs a{color:var(--text-secondary);text-decoration:none;padding:2px 6px;border-radius:6px}
  .vx-crumbs a:hover{background:var(--bg-hover);color:var(--accent)}
  .vx-crumbs .cur{color:var(--text-primary);font-weight:600;padding:2px 6px}
  .vx-head{display:flex;gap:12px;align-items:flex-start;margin-bottom:14px}
  .vx-head .vx-ic{width:44px;height:44px;font-size:22px;border-radius:12px}
  .vx-head .t{font-size:18px;font-weight:700}
  .vx-head .d{font-size:13px;color:var(--text-secondary);margin-top:3px;line-height:1.5;max-width:900px}
  .vx-head .acts{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}
  .vx-ic{flex:0 0 auto;width:34px;height:34px;border-radius:10px;display:grid;place-items:center;font-size:17px;
    background:color-mix(in srgb,var(--vx-hue,#94a3b8) 16%,transparent);border:1px solid color-mix(in srgb,var(--vx-hue,#94a3b8) 30%,transparent)}
  .vx-sec{margin:18px 0 0}
  .vx-sec>.sh{display:flex;align-items:center;gap:8px;margin:0 0 10px;font-size:13px;font-weight:600;cursor:pointer}
  .vx-sec>.sh .n{font-weight:400;font-size:12px;color:var(--text-muted)}
  .vx-sec>.sh .go{margin-left:auto;font-size:12px;font-weight:400;color:var(--accent);opacity:0;transition:opacity .12s}
  .vx-sec>.sh:hover .go{opacity:1}
  .vx-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px}
  .vx-card{position:relative;display:flex;flex-direction:column;gap:7px;padding:13px;min-height:120px;border:1px solid var(--border);
    border-radius:var(--radius-lg,12px);background:var(--bg-elevated);cursor:pointer;outline:none;
    transition:transform .15s,box-shadow .15s,border-color .15s}
  .vx-card:hover,.vx-card:focus-visible{transform:translateY(-2px);box-shadow:var(--shadow-md);
    border-color:color-mix(in srgb,var(--vx-hue,var(--accent)) 55%,var(--border))}
  .vx-card::before{content:"";position:absolute;inset:0 0 auto 0;height:3px;border-radius:12px 12px 0 0;background:var(--vx-hue,transparent);opacity:.85}
  .vx-card .top{display:flex;align-items:center;gap:10px}
  .vx-card .tt{min-width:0;flex:1}
  .vx-card .t{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .vx-card .p{font:11px var(--font-mono,ui-monospace,monospace);color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .vx-card .d{font-size:12px;line-height:1.45;color:var(--text-secondary);display:-webkit-box;-webkit-line-clamp:2;
    -webkit-box-orient:vertical;overflow:hidden}
  .vx-card .ft{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:auto}
  .vx-card .ft .grow{flex:1}
  .vx-tag{font-size:10.5px;padding:2px 7px;border-radius:999px;background:var(--bg-hover);color:var(--text-secondary);white-space:nowrap}
  .vx-badge{font-family:var(--font-mono,ui-monospace,monospace);max-width:100%;overflow:hidden;text-overflow:ellipsis}
  .vx-act{font-size:12px;font-weight:600;color:var(--accent);text-decoration:none;padding:3px 8px;border-radius:7px;
    border:1px solid transparent;background:none;cursor:pointer}
  .vx-act:hover{border-color:var(--accent)}
  .vx-act.btn{border-color:var(--border);color:var(--text-primary);font-weight:500;padding:7px 12px;border-radius:9px;background:var(--bg-primary)}
  .vx-act.btn:hover{border-color:var(--accent);color:var(--accent)}
  .vx-act.btn.primary{background:var(--accent);border-color:var(--accent);color:var(--text-inverse,#fff)}
  .vx.list .vx-grid{grid-template-columns:1fr;gap:6px}
  .vx.list .vx-card{flex-direction:row;align-items:center;min-height:0;padding:8px 12px;gap:12px}
  .vx.list .vx-card::before{inset:0 auto 0 0;width:3px;height:auto;border-radius:12px 0 0 12px}
  .vx.list .vx-card:hover{transform:none}
  .vx.list .vx-card .top{flex:0 0 300px}
  .vx.list .vx-card .d{-webkit-line-clamp:1}
  .vx-leaf{border:1px solid var(--border);border-radius:var(--radius-lg,12px);background:var(--bg-elevated);padding:16px;display:flex;flex-direction:column;gap:14px}
  .vx-leaf .lbl{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--text-muted);margin-bottom:6px}
  .vx-kv{display:grid;grid-template-columns:minmax(120px,max-content) 1fr;gap:4px 14px;font-size:12.5px}
  .vx-kv .k{font-family:var(--font-mono,ui-monospace,monospace);color:var(--text-primary)}
  .vx-kv .v{color:var(--text-secondary)}
  .vx-pre{white-space:pre-wrap;font:12px/1.5 var(--font-mono,ui-monospace,monospace);background:var(--bg-secondary);
    border:1px solid var(--border);border-radius:8px;padding:10px;max-height:340px;overflow:auto;margin:0}
  .vx-msg{text-align:center;padding:36px 10px;color:var(--text-muted)}
  .vx-content{margin:0 0 14px;border:1px solid var(--border);border-radius:var(--radius-lg,12px);background:var(--bg-elevated);padding:8px 12px}
  .vx-content>summary{cursor:pointer;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--text-muted);padding:4px 0}
  .vx-content .vx-pre{margin-top:8px;max-height:60vh}
  .vx-msg .big{font-size:30px;margin-bottom:6px}
  .vx-more{margin-top:10px;text-align:center}
  .vx-rel{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:8px;font-size:12px}
  .vx-rel .lbl{color:var(--text-muted);font-size:11px;text-transform:uppercase;letter-spacing:.05em}
  .vx-rel a{display:inline-flex;gap:5px;align-items:center;padding:3px 10px;border-radius:999px;text-decoration:none;
    border:1px solid var(--border);background:var(--bg-primary);color:var(--accent)}
  .vx-rel a:hover{border-color:var(--accent)}
  @media (max-width:640px){.vx.list .vx-card .top{flex-basis:160px}}
  @media (prefers-reduced-motion:reduce){.vx-card{transition:none}}`;

  function injectCss() {
    if (document.getElementById('appui-vis-explorer-css')) return;
    const st = document.createElement('style');
    st.id = 'appui-vis-explorer-css';
    st.textContent = CSS;
    document.head.appendChild(st);
  }
  return {inject: injectCss};
})();
