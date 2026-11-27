import { renderSkeleton } from "./dashboard.js";
import { pollApps, pollEps, refreshAll } from "./data.js";
import { openPalette, toggleView } from "./search.js";
import { $, TREE, esc, page } from "./state.js";
import { renderTree } from "./tree.js";

// -------------------------------------------------------------- mount ----
window.AppUIReady.then(function(){
  page.app = AppUI.createApp({
    id: 'directory',
    title: 'pylon-server',
    menubar: { theme: true },
    menu: { View: [ { id: 'refresh', label: 'Refresh' }, { id: 'palette', label: 'Jump to… (Ctrl+K)' },
                    { id: 'view', label: 'Toggle grid / list' } ] },
    onAction: function(_menu, id){
      if (id === 'refresh') refreshAll(true);
      else if (id === 'palette') openPalette();
      else if (id === 'view') toggleView();
    },
    leftSidebar: { tabs: [ { id: 'apps', label: 'Apps', render: function(el){ TREE.host = el; renderTree(); } } ] },
    content: { render: function(el){ renderSkeleton(el); } },
    statusbar: {},
  });
  var owner = page.viewScope;
  // "/" focuses search; Ctrl+K opens the palette. The AppUI dispatcher skips
  // keys typed into inputs, so "/" inside a field still types normally.
  if (window.AppUIShortcuts) {
    var keys = AppUIShortcuts.create();
    owner.add(keys);
    keys.bind('/', function(){ var q = $('#hp-q'); if (q) { q.focus(); q.select(); } });
    keys.bind('ctrl+k', function(){ openPalette(); });
  }
  owner.listen(document, 'keydown', function(e){
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && e.target && e.target.id === 'hp-q') { e.preventDefault(); openPalette(); }
  });
  refreshAll(true);
  owner.add(window.AppUIPollRefresh.start(pollEps, 5000, {
    refreshOnVisible: true, stopWhen: function () { return owner.destroyed; }
  }));
  owner.add(window.AppUIPollRefresh.start(pollApps, 30000, {
    stopWhen: function () { return owner.destroyed; }
  }));
}).catch(function(e){
  document.getElementById('app-content-body').innerHTML =
    '<div style="padding:18px">AppUI failed to load: ' + esc(e) + '</div>';
});
