'use strict';
/* Private AppUIPanelApp controller; load through the feedback bundle. */
window._AppUIPanelGallery = {create: function ({listSidebars, listChatProfiles, _embedIntoRight}) {
  async function openGallery(opts) {
    opts = opts || {};
    // Resolve a dialog primitive that works on BOTH the full shell
    // (AppUI.components.Dialog) and shim pages (window.AppUIDialog). Normalize
    // to a .show({title, body, width, buttons}) call returning a handle.
    const Dialog = (window.AppUI && window.AppUI.components && window.AppUI.components.Dialog)
      || (window.AppUIDialog && (window.AppUIDialog.show ? window.AppUIDialog : null));
    if (!Dialog || typeof Dialog.show !== 'function') {
      (window.AppUIToast && window.AppUIToast.error) ? window.AppUIToast.error('Gallery needs AppUI dialogs')
        : (window.alert && window.alert('Gallery needs AppUI dialogs'));
      return;
    }
    const esc = window.AppUITextUtils ? window.AppUITextUtils.esc : (s => String(s == null ? '' : s));
    const body = document.createElement('div');
    body.style.cssText = 'min-width:520px;display:flex;flex-direction:column;gap:8px';
    body.innerHTML = '<div style="color:var(--text-muted);font-size:12px;padding:6px">Loading sidebars…</div>';
    const dlg = Dialog.show({title: 'Sidebar Gallery', body, width: '620px', buttons: [{text: 'Close'}]});
    const closeDlg = () => {
      try {
        if (dlg && typeof dlg.close === 'function') return dlg.close();
        if (window.AppUIDialog && window.AppUIDialog.close) return window.AppUIDialog.close(dlg);
        const x = document.querySelector('.appui-dialog-close'); if (x) x.click();
      } catch (_e) { /* best-effort */ }
    };

    let specs = [];
    try { specs = await listSidebars(opts.baseUrl || ''); } catch (_e) { specs = []; }
    // #11 — also fetch the manifest-declared CHAT PROFILES as embeddable items,
    // in parallel, so the gallery is a cross-page assistant menu (unless the
    // host opts out via opts.includeProfiles === false).
    let profileSpecs = [];
    if (opts.includeProfiles !== false) {
      try { profileSpecs = await listChatProfiles(opts.baseUrl || ''); } catch (_e) { profileSpecs = []; }
    }
    // A host may offer EXTRA, page-local sidebars (e.g. the workspace's own AI
    // chat / Memo / Feedback) that carry their own embed() — merge them in so a
    // CLOSED built-in tab can be re-added. extraSpecs win over a server spec of
    // the same app_id+type (they have the working renderer).
    const extra = Array.isArray(opts.extraSpecs) ? opts.extraSpecs : [];
    const extraKey = new Set(extra.map(s => (s.app_id || '') + '::' + s.type));
    const extraLabels = new Set(extra.map(s => String(s.label || '').trim().toLowerCase()));
    // Drop server specs that an extraSpec supersedes (same app+type OR same
    // LABEL — the host's extraSpec has the working renderer, so a same-named
    // server entry is a confusing duplicate), and drop `local` server specs that
    // aren't ours (we have no renderer for another app's local one).
    const ownApp = opts.hostApp || null;
    const seen = new Set();
    specs = specs.filter(s => {
      if (extraKey.has((s.app_id || '') + '::' + s.type)) return false;
      if (extraLabels.has(String(s.label || '').trim().toLowerCase())) return false;
      if (s.local && s.app_id !== ownApp) return false;   // not embeddable here
      const k = (s.app_id || '') + '::' + s.type;         // guard any server dupes
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    specs = extra.concat(specs);
    // #11 — append the chat-profile cards after the sidebar providers. A profile
    // whose own app ALSO declares a `sidebar` block is still shown separately —
    // the sidebar block is the generic chat; the profile is the preconfigured
    // assistant (system prompt + scope) — so a user can pick either.
    specs = specs.concat(profileSpecs);
    body.replaceChildren();
    const intro = document.createElement('div');
    intro.style.cssText = 'font-size:11px;color:var(--text-muted)';
    intro.textContent = profileSpecs.length
      ? 'Sidebars and AI assistants you can embed here (from each app\u2019s manifest "sidebar" block and declared chat_profile).'
      : 'Apps that can be embedded as a sidebar here (declared via each app\u2019s manifest "sidebar" block).';
    body.append(intro);
    if (!specs.length) {
      const e = document.createElement('div');
      e.style.cssText = 'color:var(--text-muted);font-size:12px;padding:6px';
      e.textContent = 'No sidebar-capable apps found.';
      body.append(e); return;
    }
    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:8px';
    specs.forEach(spec => {
      const card = document.createElement('div');
      card.style.cssText = 'display:flex;flex-direction:column;gap:4px;padding:10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg)';
      const nh = (spec.needs_host && typeof spec.needs_host === 'object') ? spec.needs_host : null;
      const nhNames = nh ? Object.keys(nh) : [];
      card.innerHTML =
        '<div style="font-size:13px;font-weight:600;color:var(--text-primary)">'
        + (spec.icon ? (esc(spec.icon) + ' ') : '') + esc(spec.label) + '</div>'
        + '<div style="font-size:11px;color:var(--text-muted);flex:1;min-height:28px">' + esc(spec.description || '') + '</div>'
        + (nhNames.length
            ? '<div style="font-size:10px;color:var(--accent)">wants: ' + esc(nhNames.join(', ')) + '</div>'
            : '')
        + '<div style="font-size:10px;color:var(--text-dim,#6b7280)">' + esc(spec.app_id) + ' \u00b7 type:' + esc(spec.type) + '</div>';
      // #13 — when the provider declares needs_host, let the user supply the
      // special-handling bits inline AT EMBED TIME: a system-prompt field (if
      // it accepts `system`) and a "use this page's context" toggle (if it
      // accepts `context` and the host offers one via opts.pageContext).
      let sysInput = null, useCtx = null;
      if (nh && (nh.system || nh.context)) {
        const form = document.createElement('div');
        form.style.cssText = 'display:flex;flex-direction:column;gap:4px;margin-top:2px';
        if (nh.system) {
          sysInput = document.createElement('textarea');
          sysInput.rows = 2; sysInput.placeholder = 'Optional system prompt for this panel\u2026';
          sysInput.style.cssText = 'width:100%;box-sizing:border-box;font-size:11px;padding:4px 6px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg-elevated);color:var(--text-primary);resize:vertical';
          form.append(sysInput);
        }
        if (nh.context && typeof opts.pageContext === 'function') {
          const lbl = document.createElement('label');
          lbl.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:11px;color:var(--text-muted);cursor:pointer';
          useCtx = document.createElement('input'); useCtx.type = 'checkbox'; useCtx.checked = true;
          lbl.append(useCtx, document.createTextNode('Use this page\u2019s context'));
          form.append(lbl);
        }
        card.append(form);
      }
      const open = document.createElement('button');
      open.type = 'button'; open.className = 'ai-btn ai-btn-primary'; open.textContent = 'Open in sidebar';
      open.style.cssText = 'margin-top:4px;font-size:12px';
      open.addEventListener('click', async () => {
        open.disabled = true; open.textContent = 'opening\u2026';
        // Assemble the host config from the inline needs_host form.
        const cfg = {};
        if (sysInput && sysInput.value.trim()) cfg.system = sysInput.value.trim();
        if (useCtx && useCtx.checked && typeof opts.pageContext === 'function') cfg.context = opts.pageContext;
        let ok = false;
        // Prefer a host-provided ADD hook (adds a tab alongside existing ones,
        // never replacing the current sidebar). Else fall back to a dock embed.
        if (typeof opts.addSidebar === 'function') {
          try { ok = (await opts.addSidebar(spec, cfg)) !== false; } catch (_e) { ok = false; }
        } else {
          ok = await _embedIntoRight(opts, spec, cfg);
        }
        closeDlg();
        if (!ok) window.AppUIToast && window.AppUIToast.error && window.AppUIToast.error('Could not open ' + spec.label);
      });
      card.append(open);
      grid.append(card);
    });
    body.append(grid);
  }

  return {openGallery};
}};
