
    // SURFACE PREVIEW SWITCH (dev): ?surface=sidebar previews the SIDEBAR
    // surface in this full tab; default is the page surface. A sidebar normally
    // has NO HTML of its own (it's a panel the shell mounts into a host page's
    // <aside>) — this is only a convenience for testing the sidebar renderer
    // standalone, NOT a second shell.
    try {
      var _s = new URLSearchParams(location.search).get('surface');
      window.__FEEDBACK_SURFACE = (_s === 'sidebar') ? 'sidebar' : 'page';
    } catch (e) { window.__FEEDBACK_SURFACE = 'page'; }

    window.AppUIReady = AppUIAssets.load('foundation', 'shell', 'feedback');
    window.AppUIReady
      .then(function(){ return AppUIAssets.loadCss(); })
      // load the surface renderers (shared first), then the thin wiring.
      .then(function(){ return AppUIAssets.loadModule('render-shared.js?v=1'); })
      .then(function(){ return AppUIAssets.loadModule('render-page.js?v=1'); })
      .then(function(){ return AppUIAssets.loadModule('render-sidebar.js?v=1'); })
      .then(function(){ return AppUIAssets.loadModule('app.js?v=3b'); })
      .catch(function(err){
        var el = document.getElementById('app-content-body') || document.body;
        el.innerHTML = '<pre style="color:#d92d3a;padding:16px;white-space:pre-wrap">Feedback failed to load: '
          + (err && err.message || err) + '</pre>';
      });
  