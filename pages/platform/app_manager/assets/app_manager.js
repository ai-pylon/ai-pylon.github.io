(function () {
  'use strict';

  const API_BASE = '/v1/apps/platform/app_manager/';
  let state = { packs: [], apps: [] };

  function notify(msg, isErr) {
    const el = document.getElementById('am-notice');
    el.textContent = msg;
    el.className = 'am-notice' + (isErr ? ' err' : '');
    el.style.display = 'block';
  }

  async function callOp(op, body) {
    const res = await AppUIApi.post(API_BASE + op, body || {});
    if (res && res._error) throw new Error(res._error);
    if (res && res.ok === false) throw new Error(res.error || 'Operation failed');
    return res;
  }

  function renderPacks() {
    const tbody = document.getElementById('packs-body');
    const sel = document.getElementById('new-pack');
    tbody.innerHTML = '';
    sel.innerHTML = '';

    for (const p of state.packs) {
      if (p.enabled) {
        const opt = document.createElement('option');
        opt.value = p.name;
        opt.textContent = p.name;
        sel.appendChild(opt);
      }
      const tr = document.createElement('tr');
      tr.innerHTML = '<td></td><td><code></code></td><td></td><td></td><td class="am-actions"></td>';
      tr.children[0].textContent = p.name;
      tr.children[1].firstChild.textContent = p.root || '(disabled)';
      tr.children[2].textContent = String(p.app_count || 0);
      const badge = document.createElement('span');
      badge.className = 'am-badge' + (p.enabled ? ' ok' : '');
      badge.textContent = p.enabled ? 'enabled' : 'disabled';
      tr.children[3].appendChild(badge);

      const toggleBtn = document.createElement('button');
      toggleBtn.type = 'button';
      toggleBtn.className = 'am-btn sec sm';
      toggleBtn.textContent = p.enabled ? 'Disable' : 'Enable';
      toggleBtn.addEventListener('click', async () => {
        try {
          await callOp('pack_toggle', { name: p.name, enabled: !p.enabled, confirm: true });
          notify((!p.enabled ? 'Enabled ' : 'Disabled ') + p.name + '. Click Reassemble & Reload to apply.');
          load();
        } catch (err) { notify(err.message, true); }
      });
      tr.children[4].appendChild(toggleBtn);

      if (p.is_extra && p.root) {
        const rmBtn = document.createElement('button');
        rmBtn.type = 'button';
        rmBtn.className = 'am-btn sec sm';
        rmBtn.textContent = 'Remove';
        rmBtn.addEventListener('click', async () => {
          try {
            await callOp('pack_remove', { path: p.root, confirm: true });
            notify('Removed pack path ' + p.root);
            load();
          } catch (err) { notify(err.message, true); }
        });
        tr.children[4].appendChild(rmBtn);
      }
      tbody.appendChild(tr);
    }

    if (!state.packs.length) {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td colspan="5" class="am-muted">No external pylon-apps-* packs discovered yet.</td>';
      tbody.appendChild(tr);
    }
  }

  function renderApps() {
    const q = (document.getElementById('app-filter').value || '').trim().toLowerCase();
    const tbody = document.getElementById('apps-body');
    const filtered = state.apps.filter(a =>
      !q || (a.id + ' ' + a.title + ' ' + a.pack + ' ' + a.category).toLowerCase().includes(q)
    );
    document.getElementById('apps-count').textContent = String(filtered.length);
    tbody.innerHTML = '';
    for (const a of filtered) {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td><code></code></td><td></td><td></td><td></td><td></td>';
      tr.children[0].firstChild.textContent = a.id;
      tr.children[1].textContent = a.title;
      const pb = document.createElement('span');
      pb.className = 'am-badge' + (a.pack !== 'core' ? ' pack' : '');
      pb.textContent = a.pack;
      tr.children[2].appendChild(pb);
      tr.children[3].textContent = a.hosting;
      tr.children[4].textContent = a.has_page ? 'yes' : 'api-only';
      tbody.appendChild(tr);
    }
  }

  async function load() {
    try {
      const res = await callOp('status', {});
      state = res;
      document.getElementById('am-sub').textContent =
        'Workspace: ' + (res.workspace_root || '') + ' · ' + res.total_apps + ' apps (' + res.pack_apps + ' from packs)';
      renderPacks();
      renderApps();
    } catch (err) {
      notify('Failed to load App Manager status: ' + err.message, true);
    }
  }

  window.AppUIReady.then(() => {
    document.getElementById('btn-refresh').addEventListener('click', load);
    document.getElementById('btn-reassemble').addEventListener('click', async () => {
      try {
        notify('Reassembling runtime and rediscovering apps...');
        const r = await callOp('reassemble', { confirm: true });
        notify('Reassembled successfully! Loaded ' + r.apps + ' apps.');
        load();
      } catch (err) { notify(err.message, true); }
    });
    document.getElementById('pack-add-form').addEventListener('submit', async e => {
      e.preventDefault();
      const input = document.getElementById('pack-path');
      try {
        const r = await callOp('pack_add', { path: input.value, create: true, confirm: true });
        input.value = '';
        notify('Added pack ' + r.pack + ' (' + r.path + '). Click Reassemble & Reload to load its apps.');
        load();
      } catch (err) { notify(err.message, true); }
    });
    document.getElementById('app-create-form').addEventListener('submit', async e => {
      e.preventDefault();
      try {
        const r = await callOp('app_create', {
          pack: document.getElementById('new-pack').value,
          group: document.getElementById('new-group').value,
          name: document.getElementById('new-name').value,
          title: document.getElementById('new-title').value,
          description: document.getElementById('new-desc').value,
          confirm: true,
        });
        document.getElementById('new-name').value = '';
        document.getElementById('new-title').value = '';
        document.getElementById('new-desc').value = '';
        notify('Created ' + r.app_id + ' in ' + r.pack + '! Click Reassemble & Reload to activate it.');
        load();
      } catch (err) { notify(err.message, true); }
    });
    document.getElementById('app-filter').addEventListener('input', renderApps);
    load();
  });
})();
