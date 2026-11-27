  // Retired accounts: demo/placeholder ids that were removed from the platform.
  // A stale value cached in localStorage (or a legacy per-app key, or a bookmarked
  // ?user=) must NOT stick — collapse it to the standard 'guest' account.
  var RETIRED = { viewer: 1, alice: 1, anonymous: 1 };
  function _clean(v) {
    v = (v || '').trim();
    return (!v || RETIRED[v.toLowerCase()]) ? '' : v;
  }
  var current = (_clean(qsUser()) || _clean(stored()) || _clean(legacyStored()) || 'guest').trim() || 'guest';
  // If we resolved from a query/legacy source, persist to the canonical key now
  // so every app converges on one value, and seed the legacy keys too. Also
  // overwrites any retired value still sitting in storage/URL.
  try {
    if (current) {
      window.localStorage.setItem(STORE_KEY, current);
      for (var _li = 0; _li < LEGACY_KEYS.length; _li++) {
        try { window.localStorage.setItem(LEGACY_KEYS[_li], current); } catch (e) { /* ignore */ }
      }
      // Scrub a retired ?user= from the URL so a reload doesn't re-adopt it.
      try {
        var _q = qsUser();
        if (_q && RETIRED[_q.trim().toLowerCase()]) {
          var _u = new URL(window.location.href);
          _u.searchParams.set('user', current);
          window.history.replaceState(null, '', _u);
        }
      } catch (e) { /* ignore */ }
    }
  } catch (e) { /* ignore */ }

  function _normalizeSetUser(value) { return RETIRED[value.toLowerCase()] ? "guest" : value; }

