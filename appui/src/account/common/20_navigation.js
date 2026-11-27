  // Owner segment base: /{owner}/{slug}/...  → '/{owner}'. Lets us build sibling
  // app URLs. Falls back to '' (same-level) if the path is shallow.
  function ownerBase() {
    var parts = window.location.pathname.split('/').filter(Boolean);
    // parts[0] is the owner (e.g. 'ejasung'); parts[1] is this app's slug.
    return parts.length >= 1 ? '/' + parts[0] : '';
  }
  function thisSlug() {
    var parts = window.location.pathname.split('/').filter(Boolean);
    return parts.length >= 2 ? parts[1] : '';
  }

  // Which environment are we in? LOCAL ai-pylon serves pages at /pages/...;
  // AppForge serves each app at /{owner}/{slug}/. Detect from the path.
  function isLocal() {
    return window.location.pathname.split('/').filter(Boolean)[0] === 'pages';
  }
  // Build the correct href to a fleet app, carrying the current account id.
  function appHref(a) {
    var q = '?user=' + encodeURIComponent(current);
    if (isLocal()) {
      // /pages/<local>/  (e.g. /pages/documents/plantuml_python/)
      return '/pages/' + a.local + '/' + q;
    }
    // AppForge: /{owner}/<slug>/
    return ownerBase() + '/' + a.slug + '/' + q;
  }
  // Is this fleet entry the current app? Compare against the local path tail or
  // the AppForge slug depending on environment.
  function appIsHere(a) {
    if (isLocal()) {
      return window.location.pathname.indexOf('/pages/' + a.local + '/') === 0
          || window.location.pathname.indexOf('/pages/' + a.local) === 0;
    }
    return a.slug === thisSlug();
  }

