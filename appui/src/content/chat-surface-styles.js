/* ChatSurface styles — injected once. The transcript/composer come from the
 * shared AppUIChat engine (ai-chat-*); this styles only the surface chrome
 * (button bar, attach chip bar) + the Tools-dialog scope tree (tt-*). */
window._AppUIChatSurfaceStyles = (function() {
  'use strict';
  const CSS = `
.cs-wrap{display:flex;flex-direction:column;height:100%;min-height:0}
.cs-header{display:flex;flex-direction:column;border-bottom:1px solid var(--border);background:var(--bg-elevated)}
.cs-header .cs-bar{border-bottom:0}
.cs-wsind{display:block;font-size:11px;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:6px 12px 0;opacity:.85}
.cs-wsind:empty{display:none}
.cs-bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:8px 12px;border-bottom:1px solid var(--border);background:var(--bg-elevated)}
.cs-bar .cs-backend{background:var(--bg);color:var(--text-primary);border:1px solid var(--border);border-radius:var(--radius-sm);padding:4px 8px;font-size:12px}
.cs-bar .cs-sp{flex:1}
.cs-bar .cs-btn{background:var(--bg);color:var(--text-primary);border:1px solid var(--border);border-radius:var(--radius-sm);padding:5px 10px;font-size:12px;cursor:pointer;white-space:nowrap}
.cs-bar .cs-btn:hover{border-color:var(--accent)}
.cs-bar .cs-btn-icon{padding:5px 7px;font-size:14px;line-height:1;flex:0 0 auto}
.cs-bar .cs-sid{font:11px ui-monospace,Consolas,monospace;color:var(--text-muted);padding:4px 7px;flex:0 0 auto}
.cs-bar .cs-sid[hidden]{display:none}
/* Compact (sidebar) bar: single scrollable row so NO buttons are clipped in a
   narrow sidebar (wrapping hid the leading ⚙️/🧩/★ when height was constrained).
   The spacer is removed in compact so New stays inline at the end. */
.cs-compact .cs-bar{gap:4px;padding:6px 8px;flex-wrap:nowrap;overflow-x:auto;overflow-y:hidden;scrollbar-width:thin}
.cs-compact .cs-bar::-webkit-scrollbar{height:6px}
.cs-compact .cs-bar .cs-sp{display:none}
.cs-attach-bar{display:none;flex-wrap:wrap;gap:6px;padding:6px 12px;border-bottom:1px solid var(--border);background:var(--bg-elevated)}
.cs-ctx-bar{display:none;flex-wrap:wrap;gap:6px;padding:4px 12px;border-bottom:1px solid var(--border);background:var(--bg-elevated)}
.cs-ctx-chip{display:inline-flex;align-items:center;gap:4px;max-width:100%;background:var(--bg-active);border:1px solid var(--border);border-radius:12px;padding:1px 4px 1px 8px;font-size:11px}
.cs-ctx-chip .cs-ctx-lbl{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:260px}
.cs-ctx-live{padding-right:8px;border-style:dashed}
.cs-ctx-x{border:0;background:transparent;color:var(--text-muted);cursor:pointer;font-size:12px;padding:0 3px;line-height:1}
.cs-ctx-x:hover{color:var(--text-primary)}
.cs-view{flex:1;min-height:0;display:flex;flex-direction:column}
.cs-view.cs-dragover{outline:2px dashed var(--accent);outline-offset:-6px;background:var(--bg-hover)}
/* tool-scope tree (shared with the page's prior .tt-* styles) */
.tt-group{border:0;margin:0}
.tt-group>summary{display:flex;align-items:center;gap:7px;padding:4px 6px;cursor:pointer;border-radius:var(--radius-sm);list-style:none;font-size:12px;font-weight:600}
.tt-group>summary::-webkit-details-marker{display:none}
.tt-group>summary:hover{background:var(--bg-active)}
.tt-twist{display:inline-block;width:10px;color:var(--text-muted);transition:transform .12s}
.tt-group[open]>summary .tt-twist{transform:rotate(90deg)}
.tt-count{color:var(--text-muted);font-weight:400}
.tt-tool{display:flex;align-items:flex-start;gap:7px;padding:3px 6px 3px 28px;border-radius:var(--radius-sm);cursor:pointer}
.tt-tool:hover{background:var(--bg-active)}
.tt-tool input,.tt-group>summary input{margin:2px 0 0;flex:0 0 auto;cursor:pointer}
.tt-name{flex:0 0 auto;min-width:150px;font-size:12px;color:var(--text-primary);font-family:ui-monospace,Consolas,monospace}
.tt-desc{flex:1;min-width:0;font-size:11px;color:var(--text-muted);line-height:1.4}
.tt-ctl{background:var(--bg);color:var(--text-primary);border:1px solid var(--border);border-radius:var(--radius-sm);padding:2px 8px;font-size:11px;cursor:pointer}
.tt-ctl:hover{border-color:var(--accent)}
.cs-kiro{font-size:13px;line-height:1.45;max-height:68vh;overflow:auto}
.cs-kiro h4{margin:12px 0 4px;font-size:12px;text-transform:uppercase;color:var(--text-muted)}
.cs-kiro-note{font-size:12px;color:var(--text-muted);margin:3px 0}
.cs-kiro-agent{width:100%;padding:4px 6px;background:var(--bg);color:var(--text-primary);border:1px solid var(--border);border-radius:var(--radius-sm)}
.cs-kiro-list{display:flex;flex-direction:column;gap:4px}
.cs-kiro-row{display:flex;align-items:center;gap:8px;padding:3px 0;border-bottom:1px solid var(--border)}
.cs-kiro-name{font-weight:600;font-family:ui-monospace,Consolas,monospace}
.cs-kiro-meta{font-size:11px;color:var(--text-muted);margin-left:auto;text-align:right}
.cs-kiro-signin{font-size:11px;padding:1px 8px;flex:none}
.cs-wire-tabs{display:flex;flex-wrap:wrap;gap:4px;padding-bottom:6px;margin-bottom:6px;border-bottom:1px solid var(--border)}
.cs-wire-tab{font-size:12px;padding:2px 9px}
.cs-wire-tab[aria-selected="true"]{background:var(--accent-bg,rgba(79,195,247,.16));border-color:var(--accent);font-weight:600}
.cs-wire-pane{min-height:120px}
.cs-wire-safety{font-size:9.5px;flex:none;padding:0 5px;border-radius:8px;border:1px solid var(--border);color:var(--text-muted)}
.cs-wire-safety.cs-wire-write{border-color:var(--warning,#d9a400);color:var(--warning,#d9a400)}
.cs-wire-json{width:100%;box-sizing:border-box;font-size:11px;margin-top:4px}
.cs-wire{font-size:11px;white-space:nowrap;flex:none;display:inline-flex;align-items:center;gap:2px;cursor:pointer}
.cs-wire-search{display:flex;gap:6px;align-items:center;margin:6px 0}
.cs-wire-search input{flex:1;min-width:120px;padding:3px 6px;background:var(--bg);color:var(--text-primary);border:1px solid var(--border);border-radius:var(--radius-sm)}
.cs-wire-search select{padding:3px 4px;background:var(--bg);color:var(--text-primary);border:1px solid var(--border);border-radius:var(--radius-sm)}
.cs-kiro-skill summary{cursor:pointer;padding:2px 0}
.cs-kiro-pre{white-space:pre-wrap;font-size:11px;background:var(--bg-secondary,rgba(120,130,150,.08));padding:6px 8px;max-height:260px;overflow:auto}
.cs-bar .cs-btn-on{border-color:var(--accent);color:var(--accent)}
/* Virtualize off-screen chat messages so 50+ turn transcripts scroll at 60fps */
.cs-view .ai-msg,.cs-view .ai-chat-msg{content-visibility:auto;contain-intrinsic-size:auto 80px}
`;
  function inject() {
    if (document.getElementById('appui-chat-surface-style')) return;
    const style = document.createElement('style');
    style.id = 'appui-chat-surface-style';
    style.textContent = CSS;
    document.head.append(style);
  }
  return {inject, CSS};
})();
