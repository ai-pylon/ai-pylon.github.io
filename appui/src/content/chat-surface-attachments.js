/* ChatSurface attachments, conversion, drag/drop and paste lifecycle. */
window.AppUIChatSurfaceAttachments = (() => {
  function create({esc, q, setStatus, call, readBase64, getAttachments, setAttachments, composerInput}) {
    let destroyed = false;
    const scope = AppUILifecycle.createScope();
    const thumbs = new Map();                 // attachment id -> object URL of its image preview
    const dropThumb = id => { const u = thumbs.get(id); if (u) { try { URL.revokeObjectURL(u); } catch (_e) {} thumbs.delete(id); } };
    scope.add(() => { thumbs.forEach(u => { try { URL.revokeObjectURL(u); } catch (_e) {} }); thumbs.clear(); });
    function renderAttachChips() {
      if (destroyed) return;
      const bar = q('#cs-attach-bar'); if (!bar) return;
      bar.replaceChildren();
      if (!getAttachments().length) { bar.style.display = 'none'; return; }
      bar.style.display = 'flex';
      getAttachments().forEach(a => {
        const chip = document.createElement('span');
        chip.style.cssText = 'display:inline-flex;align-items:center;gap:6px;background:var(--bg-active);border:1px solid var(--border);border-radius:12px;padding:2px 8px;font-size:11px';
        const tu = thumbs.get(a.id);
        chip.innerHTML = (tu ? '<img alt="" src="' + esc(tu) + '" style="height:22px;width:auto;max-width:44px;object-fit:cover;border-radius:3px">' : '📎') + ' ' + esc(a.name) + ' <span style="color:var(--text-muted)">' + (a.truncated ? '~' : '') + a.chars + 'ch</span>';
        const x = document.createElement('button'); x.textContent = '×'; x.title = 'Remove';
        x.style.cssText = 'border:0;background:none;color:var(--text-muted);cursor:pointer;font-size:14px;line-height:1;padding:0';
        x.addEventListener('click', () => { dropThumb(a.id); setAttachments(getAttachments().filter(p => p.id !== a.id)); renderAttachChips(); });
        chip.appendChild(x); bar.appendChild(chip);
      });
    }
    async function doAttachFiles(fileList) {
      if (destroyed) return;
      const files = Array.from(fileList || []); if (!files.length) return;
      for (const f of files) {
        if (destroyed) return;
        setStatus('Attaching ' + f.name + '…');
        try {
          const b64 = await readBase64(f);
          if (destroyed) return;
          const r = await call('attach', {name: f.name, content_b64: b64}, 120000);
          if (destroyed) return;
          if (r && r.ok) {
            if (r.id && /^image\//.test(f.type || '')) { try { thumbs.set(r.id, URL.createObjectURL(f)); } catch (_e) {} }
            getAttachments().push({id: r.id, name: r.name, kind: r.kind, text: r.text, chars: r.chars, truncated: r.truncated});
            renderAttachChips();
            setStatus('Attached ' + r.name + (r.kind === 'image' ? ' (image described for the model)' : r.kind === 'converted' ? ' (converted)' : ''));
          } else { setStatus('Attach failed: ' + ((r && (r.error || r._error)) || 'error')); }
        } catch (e) { if (destroyed) return; setStatus('Attach failed: ' + (e.message || e)); }
      }
    }
    function openAttach() {
      if (destroyed) return;
      const inp = document.createElement('input'); inp.type = 'file'; inp.multiple = true;
      inp.addEventListener('change', () => doAttachFiles(inp.files)); inp.click();
    }
    // Attach a file the HOST already knows by its vfs:// (or local/ssh) ref —
    // the server reads the bytes itself (file/vfs), so the browser never
    // downloads them. Produces the SAME chip shape as doAttachFiles, so
    // renderAttachChips + buildReqBody handle it unchanged.
    async function doAttachVfs(url) {
      if (destroyed || !url) return;
      const short = String(url).split('/').pop() || url;
      setStatus('Attaching ' + short + '…');
      try {
        const r = await call('attach', {url: url}, 120000);
        if (destroyed) return;
        if (r && r.ok) {
          getAttachments().push({id: r.id, name: r.name, kind: r.kind, text: r.text, chars: r.chars, truncated: r.truncated});
          renderAttachChips();
          setStatus('Attached ' + r.name + (r.kind === 'converted' ? ' (converted)' : ''));
        } else { setStatus('Attach failed: ' + ((r && r.error) || 'error')); }
      } catch (e) { if (destroyed) return; setStatus('Attach failed: ' + (e.message || e)); }
    }

    function bind(dropZone) {
      if (destroyed) return;
      if (!dropZone.hasAttribute('tabindex')) { dropZone.tabIndex = -1; dropZone.style.outline = 'none'; }   // focusable, so a click in the transcript can receive Ctrl+V
        const showDrag = (on) => { try { dropZone.classList.toggle('cs-dragover', !!on); } catch (_e) {} };
        scope.listen(dropZone, 'dragover', (e) => {
          if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) {
            e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; showDrag(true);
          }
        });
        scope.listen(dropZone, 'dragleave', (e) => {
          // only clear when leaving the zone itself (not entering a child)
          if (e.target === dropZone) showDrag(false);
        });
        scope.listen(dropZone, 'drop', (e) => {
          const files = e.dataTransfer && e.dataTransfer.files;
          if (files && files.length) { e.preventDefault(); showDrag(false); doAttachFiles(files); }
          else showDrag(false);
        });
        // Paste an image (or any file) from the clipboard. A pasted image blob
        // carries no filename, so synthesize one from its mime subtype.
        const onPaste = (e) => {
          const items = e.clipboardData && e.clipboardData.items;
          if (!items) return;
          const files = [];
          for (const it of items) {
            if (it.kind === 'file') {
              const f = it.getAsFile();
              if (f) {
                if (!f.name || f.name === 'image.png' || f.name === 'blob') {
                  const ext = (f.type.split('/')[1] || 'png').replace('+xml', '');
                  const named = new File([f], 'pasted-' + Date.now() + '.' + ext, {type: f.type});
                  files.push(named);
                } else { files.push(f); }
              }
            }
          }
          if (files.length) { e.preventDefault(); doAttachFiles(files); }
        };
        scope.listen(dropZone, 'paste', onPaste);       // bubbles from the composer; also works with focus elsewhere in the view
    }
    return {renderAttachChips, doAttachFiles, doAttachVfs, openAttach, bind, destroy() {destroyed = true; scope.destroy();}};
  }
  return {create};
})();
