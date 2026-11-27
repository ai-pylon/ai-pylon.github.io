  var current = (qsUser() || stored() || legacyStored() || 'alice').trim() || 'alice';
  // If we resolved from a query/legacy source, persist to the canonical key now
  // so every app converges on one value, and seed the legacy keys too.
  try {
    if (current) {
      window.localStorage.setItem(STORE_KEY, current);
      for (var _li = 0; _li < LEGACY_KEYS.length; _li++) {
        try { window.localStorage.setItem(LEGACY_KEYS[_li], current); } catch (e) { /* ignore */ }
      }
    }
  } catch (e) { /* ignore */ }

  function _normalizeSetUser(value) { return value; }

