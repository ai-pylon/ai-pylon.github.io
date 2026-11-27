/* Page Automation — live MIRROR of the managed browser's sign-in tab (NEXT #11).
 *
 * While a device-login / page automation run drives the managed Edge (often
 * headless), this attaches a system/cdp screencast session to that tab
 * (signin_open {attach_tab_id}) and shows it in a dialog through the shared
 * AppUIScreencastViewer, so the user can WATCH the drive and step in (click /
 * type) at an MFA or consent screen. Attaching never closes the tab: stopping
 * an attached session leaves the automation's tab alive.
 */
window.PageAutomationMirror = (() => {
  const LOGIN_RE = /devicelogin|login\.microsoftonline|login\.microsoft\.com|login\.live\.com|microsoft\.com\/devicelogin/i;

  function op(name, args) {
    return AppUIApi.operation('system/cdp', name, args || {});
  }

  function pickTab(tabs) {
    const pages = (tabs || []).filter(t => (t.type || 'page') === 'page');
    return pages.find(t => LOGIN_RE.test(t.url || '')) || pages[0] || null;
  }

  async function open(opts) {
    const o = opts || {};
    const Dialog = window.AppUIDialog;
    if (!Dialog || !Dialog.show) throw new Error('needs the AppUI dialog service');
    await AppUIAssets.load('screencastViewer');
    const t = await op('tabs');
    const tab = o.tabId ? {id: o.tabId} : pickTab((t && t.tabs) || []);
    if (!tab) {
      if (window.AppUI && AppUI.toast) AppUI.toast('No managed browser tab to mirror (is a run driving one?)', 'bad');
      return null;
    }
    const s = await op('signin_open', {attach_tab_id: tab.id});
    const session = s && s.session;
    if (!session) {
      if (window.AppUI && AppUI.toast) AppUI.toast('Mirror failed: ' + ((s && (s.error || s._error)) || '?'), 'bad');
      return null;
    }
    const hostId = 'pa-mirror-' + Date.now();
    Dialog.show({
      title: 'Live browser — ' + (tab.title || tab.url || tab.id),
      body: '<div id="' + hostId + '"></div><div class="pa-meta">Click or type in the frame to act in the '
        + 'real tab (e.g. approve an MFA prompt). Closing this view leaves the tab running.</div>',
      width: '960px',
      buttons: [{text: 'Close'}],
    });
    const host = document.getElementById(hostId);
    if (!host) return null;
    return window.AppUIScreencastViewer.create({
      container: host,
      intervalMs: o.intervalMs || 800,
      shot: (etag) => op('signin_shot', {session, etag: etag || ''}),
      // an ATTACHED session's stop ends only our capture loop — the tab stays
      onStop: () => { op('signin_stop', {session}).catch(() => {}); },
      input: (ev) => op('signin_input', {session, kind: ev.kind,
        payload: ev.kind === 'click' ? {x: ev.x, y: ev.y} : (ev.kind === 'type' ? {text: ev.text} : {key: ev.key})}),
    });
  }

  return {open, pickTab};
})();
