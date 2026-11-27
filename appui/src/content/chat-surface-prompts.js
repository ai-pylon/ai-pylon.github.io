/** Internal ChatSurface prompts dialog; core supplies instance dependencies. */
window._AppUIChatSurfacePrompts = (() => {
  function create({ Dialog, esc, setStatus, composerInput }) {
    // ---- ★ Prompts ----------------------------------------------------------
    function openPrompts() {
      const Store = window.AppUIChatPromptStore;
      if (!Dialog || !Store) { setStatus('Prompts unavailable'); return; }
      let filterTag = '';   // '' = all tags
      let filterGroup = '';  // '' = all groups
      const body = document.createElement('div');
      body.style.cssText = 'display:flex;flex-direction:column;gap:8px;min-width:460px';

      // filter bar: group dropdown + tag chips
      const filterBar = document.createElement('div');
      filterBar.style.cssText = 'display:flex;flex-direction:column;gap:6px';
      const listEl = document.createElement('div');
      listEl.style.cssText = 'display:flex;flex-direction:column;gap:6px;max-height:48vh;overflow:auto';
      const saveRow = document.createElement('div');
      saveRow.style.cssText = 'display:flex;gap:6px;justify-content:flex-end;border-top:1px solid var(--border);padding-top:8px';
      const saveBtn = document.createElement('button');
      saveBtn.type = 'button'; saveBtn.className = 'tt-ctl'; saveBtn.textContent = '+ Save current input…';
      saveRow.append(saveBtn);
      body.append(filterBar, listEl, saveRow);

      function renderFilters() {
        filterBar.replaceChildren();
        const groups = Store.groups(), tags = Store.tags();
        // group select
        const gWrap = document.createElement('div');
        gWrap.style.cssText = 'display:flex;align-items:center;gap:6px';
        const gl = document.createElement('span'); gl.textContent = 'Group:'; gl.style.cssText = 'font-size:11px;color:var(--text-muted)';
        const gsel = document.createElement('select');
        gsel.style.cssText = 'background:var(--bg);color:var(--text-primary);border:1px solid var(--border);border-radius:var(--radius-sm);padding:3px 6px;font-size:11px';
        gsel.innerHTML = '<option value="">All groups</option>'
          + '<option value="\u0000">(Ungrouped)</option>'
          + groups.map(g => '<option value="' + esc(g) + '"' + (g === filterGroup ? ' selected' : '') + '>' + esc(g) + '</option>').join('');
        if (filterGroup === '\u0000') gsel.value = '\u0000';
        gsel.addEventListener('change', () => { filterGroup = gsel.value; renderList(); });
        gWrap.append(gl, gsel);
        filterBar.append(gWrap);
        // tag chips
        if (tags.length) {
          const tWrap = document.createElement('div');
          tWrap.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;align-items:center';
          const tl = document.createElement('span'); tl.textContent = 'Tags:'; tl.style.cssText = 'font-size:11px;color:var(--text-muted)';
          tWrap.append(tl);
          const mkChip = (label, val) => {
            const c = document.createElement('button'); c.type = 'button'; c.className = 'tt-ctl';
            c.textContent = label;
            if (filterTag === val) { c.style.borderColor = 'var(--accent)'; c.style.color = 'var(--accent)'; }
            c.addEventListener('click', () => { filterTag = (filterTag === val ? '' : val); renderList(); });
            return c;
          };
          tWrap.append(mkChip('all', ''));
          tags.forEach(t => tWrap.append(mkChip('#' + t, t)));
          filterBar.append(tWrap);
        }
      }

      function insert(p) {
        const input = composerInput();
        if (input) { input.value = p.prompt || ''; input.focus(); try { input.dispatchEvent(new Event('input', {bubbles: true})); } catch (_e) {} }
        setStatus('Inserted “' + p.name + '”');
      }

      function promptRow(p) {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:5px 6px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg)';
        const meta = document.createElement('div'); meta.style.cssText = 'flex:1;min-width:0';
        const tagHtml = (p.tags || []).map(t => '<span style="font-size:9px;background:var(--bg-active);border:1px solid var(--border);border-radius:8px;padding:0 5px;margin-left:3px;color:var(--text-muted)">#' + esc(t) + '</span>').join('');
        meta.innerHTML = '<div style="font-size:12px;font-weight:600;color:var(--text-primary)">' + esc(p.name) + tagHtml + '</div>'
          + '<div style="font-size:11px;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(String(p.prompt || '').slice(0, 120)) + '</div>';
        const insBtn = document.createElement('button'); insBtn.type = 'button'; insBtn.className = 'tt-ctl'; insBtn.textContent = 'Insert';
        insBtn.addEventListener('click', () => insert(p));
        const editBtn = document.createElement('button'); editBtn.type = 'button'; editBtn.className = 'tt-ctl'; editBtn.textContent = 'Edit';
        editBtn.addEventListener('click', () => editPrompt(p));
        const delBtn = document.createElement('button'); delBtn.type = 'button'; delBtn.className = 'tt-ctl'; delBtn.textContent = 'Delete';
        delBtn.addEventListener('click', () => { Store.delete(p.id); renderList(); });
        row.append(meta, insBtn, editBtn, delBtn);
        return row;
      }

      function renderList() {
        renderFilters();
        listEl.replaceChildren();
        let items = Store.list();
        if (filterTag) items = items.filter(p => (p.tags || []).includes(filterTag));
        if (filterGroup === '\u0000') items = items.filter(p => !(p.group || ''));
        else if (filterGroup) items = items.filter(p => (p.group || '') === filterGroup);
        if (!items.length) {
          const empty = document.createElement('div');
          empty.style.cssText = 'color:var(--text-muted);font-size:12px;padding:6px';
          empty.textContent = Store.list().length ? 'No prompts match this filter.' : 'No saved prompts yet. Type something and “+ Save current input…”.';
          listEl.append(empty); return;
        }
        // group the (filtered) items by group, '' last as "Ungrouped"
        const byGroup = new Map();
        items.forEach(p => { const g = p.group || ''; if (!byGroup.has(g)) byGroup.set(g, []); byGroup.get(g).push(p); });
        const names = [...byGroup.keys()].sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)));
        names.forEach(g => {
          const det = document.createElement('details'); det.open = true;
          det.style.cssText = 'border:0';
          const sum = document.createElement('summary');
          sum.style.cssText = 'cursor:pointer;font-size:11px;font-weight:600;color:var(--text-muted);padding:4px 2px;list-style:none';
          sum.textContent = (g || 'Ungrouped') + ' (' + byGroup.get(g).length + ')';
          det.append(sum);
          const inner = document.createElement('div'); inner.style.cssText = 'display:flex;flex-direction:column;gap:4px;padding-left:4px';
          byGroup.get(g).forEach(p => inner.append(promptRow(p)));
          det.append(inner); listEl.append(det);
        });
      }

      // edit/save form dialog (name, group, tags, prompt text)
      function editForm(title, init, onSave) {
        const d = document.createElement('div');
        d.style.cssText = 'display:flex;flex-direction:column;gap:8px;min-width:420px';
        const groups = Store.groups();
        const dl = '<datalist id="cs-prompt-groups">' + groups.map(g => '<option value="' + esc(g) + '">').join('') + '</datalist>';
        d.innerHTML = dl
          + '<label style="font-size:11px;color:var(--text-muted)">Name<input id="pf-name" value="' + esc(init.name || '') + '" style="width:100%;box-sizing:border-box;background:var(--bg);color:var(--text-primary);border:1px solid var(--border);border-radius:var(--radius-sm);padding:5px 7px;font-size:12px;margin-top:2px"></label>'
          + '<label style="font-size:11px;color:var(--text-muted)">Group<input id="pf-group" list="cs-prompt-groups" value="' + esc(init.group || '') + '" placeholder="(optional — e.g. Ops, Writing)" style="width:100%;box-sizing:border-box;background:var(--bg);color:var(--text-primary);border:1px solid var(--border);border-radius:var(--radius-sm);padding:5px 7px;font-size:12px;margin-top:2px"></label>'
          + '<label style="font-size:11px;color:var(--text-muted)">Tags (comma-separated)<input id="pf-tags" value="' + esc((init.tags || []).join(', ')) + '" placeholder="e.g. terse, review" style="width:100%;box-sizing:border-box;background:var(--bg);color:var(--text-primary);border:1px solid var(--border);border-radius:var(--radius-sm);padding:5px 7px;font-size:12px;margin-top:2px"></label>'
          + '<label style="font-size:11px;color:var(--text-muted)">Prompt<textarea id="pf-text" rows="5" style="width:100%;box-sizing:border-box;background:var(--bg);color:var(--text-primary);border:1px solid var(--border);border-radius:var(--radius-sm);padding:6px 8px;font-size:12px;resize:vertical;margin-top:2px">' + esc(init.prompt || '') + '</textarea></label>';
        Dialog.show({title, body: d, width: '520px', buttons: [{text: 'Cancel'}, {text: 'Save', primary: true, action: () => {
          const name = (d.querySelector('#pf-name').value || '').trim();
          const group = (d.querySelector('#pf-group').value || '').trim();
          const tags = (d.querySelector('#pf-tags').value || '').split(',').map(t => t.trim()).filter(Boolean);
          const text = d.querySelector('#pf-text').value || '';
          if (!text.trim()) { setStatus('Prompt text is empty'); return; }
          onSave({name: name || 'Untitled', group, tags, prompt: text});
          renderList();
        }}]});
      }
      function editPrompt(p) { editForm('Edit prompt', p, patch => Store.update(p.id, patch)); }

      renderList();
      saveBtn.addEventListener('click', () => {
        const input = composerInput();
        const text = input ? String(input.value || '').trim() : '';
        editForm('Save prompt', {prompt: text}, v => Store.add(v.name, v.prompt, {group: v.group, tags: v.tags}));
      });
      Dialog.show({title: '★ Prompt library', body, width: '560px', buttons: [{text: 'Close'}]});
    }
    return { openPrompts };
  }
  return { create };
})();
