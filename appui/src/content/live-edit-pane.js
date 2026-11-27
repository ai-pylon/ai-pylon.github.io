/* AppUILiveEditPane  --  reusable live document editor pane.
 *
 * Opens a file via editor.open, renders slides/pages, and supports
 * inline text editing via editor.set_pptx_run_text / editor.set_docx_run_text.
 *
 * Usage:
 *   const pane = AppUILiveEditPane.create({
 *     container: el,
 *     path: '/path/to/file.pptx',
 *     slide: 0,          // initial slide (0-based)
 *     readOnly: false,
 *     onReady: (session) => {},
 *     callTool: async (name, params) => { ... },  // tool caller
 *   });
 *   pane.setSlide(2);
 *   pane.refresh();
 *   pane.destroy();
 */
const AppUILiveEditPane = (() => {

  function create(opts = {}) {
    const container = typeof opts.container === 'string'
      ? document.querySelector(opts.container)
      : opts.container;
    if (!container) throw new Error('AppUILiveEditPane: container required');

    const callTool = opts.callTool || _defaultCallTool;
    const readOnly = opts.readOnly || false;
    let sessionId = null;
    let format = null;
    let currentSlide = opts.slide || 0;
    let textRuns = [];  // parsed text runs for current slide
    let destroyed = false;
    let _cachedSlides = null;  // {styles, pages: [html strings]}

    // DOM
    container.innerHTML = '';
    const root = document.createElement('div');
    root.className = 'live-edit-pane';
    container.appendChild(root);

    const renderArea = document.createElement('div');
    renderArea.className = 'live-edit-render';
    root.appendChild(renderArea);

    const statusEl = document.createElement('div');
    statusEl.className = 'live-edit-status';
    statusEl.textContent = 'Opening...';
    root.appendChild(statusEl);

    // --- Open session ---
    async function open(path) {
      statusEl.textContent = 'Opening...';
      console.log('[LiveEditPane] opening:', path);
      const result = await callTool('editor.open', { path });
      console.log('[LiveEditPane] editor.open result:', result);
      if (destroyed) return;
      if (result.error || result._error) {
        statusEl.textContent = result.error || result._error;
        renderArea.innerHTML = `<div class="live-edit-error">${result.error || result._error}</div>`;
        return;
      }
      sessionId = result.session_id;
      format = result.format;
      statusEl.textContent = `${result.filename} (${result.format}, ${result.slides || '?'} slides)`;
      opts.onReady?.({ sessionId, format, filename: result.filename, slides: result.slides });
      await renderSlide();
    }

    // --- Render current slide ---
    async function renderSlide() {
      if (!sessionId) { console.log('[LiveEditPane] renderSlide: no session'); return; }
      console.log('[LiveEditPane] renderSlide: slide', currentSlide, 'format', format);
      renderArea.innerHTML = '<div class="live-edit-loading">Rendering...</div>';

      if (format === 'pptx') {
        // Render via converter for full visual fidelity (cached)
        if (!_cachedSlides) {
          renderArea.innerHTML = '<div class="live-edit-loading">Rendering slides...</div>';
          statusEl.textContent = 'Converting...';
          console.log('[LiveEditPane] calling converter...');
          const convertResult = await callTool('sysdoc_converter.convert', {
            input: opts.path, format: 'html', embed_images: true, show_hidden: true
          });
          console.log('[LiveEditPane] converter result:', convertResult?.ok, convertResult?._error, convertResult?.file);
          if (destroyed) return;
          if (convertResult._error || !convertResult.file) {
            renderArea.innerHTML = `<div class="live-edit-error">${convertResult._error || 'Conversion failed'}</div>`;
            statusEl.textContent = 'Error';
            return;
          }
          statusEl.textContent = 'Loading HTML...';
          console.log('[LiveEditPane] reading file:', convertResult.file);
          const fileData = await callTool('file.read', { path: convertResult.file });
          console.log('[LiveEditPane] file.read result: length=', fileData?.content?.length, 'error=', fileData?._error);
          if (destroyed) return;
          const html = fileData.content || '';
          if (!html) { renderArea.innerHTML = '<div class="live-edit-error">Empty output</div>'; return; }

          // Parse all slides once and cache
          console.log('[LiveEditPane] parsing HTML...', html.length, 'bytes');
          const parser = new DOMParser();
          const doc = parser.parseFromString(html, 'text/html');
          const styles = Array.from(doc.querySelectorAll('style')).map(s => s.outerHTML).join('\n');
          let pages = Array.from(doc.querySelectorAll('[data-page]'));
          if (!pages.length) pages = Array.from(doc.querySelectorAll('.slide, .page, section'));
          console.log('[LiveEditPane] parsed:', pages.length, 'pages, styles:', styles.length, 'bytes');
          _cachedSlides = { styles, pages: pages.map(p => p.outerHTML) };
          opts.onSlidesReady?.({styles: _cachedSlides.styles, pages: [..._cachedSlides.pages]});
          statusEl.textContent = `${_cachedSlides.pages.length} slides loaded`;
        }

        console.log('[LiveEditPane] showing slide', currentSlide, 'of', _cachedSlides.pages.length);
        const slideHtml = _cachedSlides.pages[currentSlide];
        if (!slideHtml) {
          renderArea.innerHTML = `<div class="live-edit-error">Slide ${currentSlide + 1} not found (${_cachedSlides.pages.length} total)</div>`;
          return;
        }

        renderArea.innerHTML = `<div class="live-edit-slide-wrapper">${_cachedSlides.styles}<div class="live-edit-slide-html">${slideHtml}</div></div>`;

        // Make text spans editable and attach inline-edit handlers
        if (!readOnly) {
          _attachInlineEditHandlers(renderArea);
        }
        statusEl.textContent = `Slide ${currentSlide + 1}`;
      } else if (format === 'docx') {
        // For DOCX, get rendered HTML via converter
        const result = await callTool('sysdoc_converter.convert', {
          input: opts.path, format: 'html', embed_images: true
        });
        if (destroyed) return;
        if (result.file) {
          const fileData = await callTool('file.read', { path: result.file });
          renderArea.innerHTML = fileData.content || 'No content';
        }
        if (!readOnly) _loadDocxRuns();
      }
    }

    // --- Render PPTX slide from pptx_text data ---
    function _renderPptxSlide(slide) {
      const pageW = slide.width || 1280;
      const pageH = slide.height || 720;
      const aspect = pageH / pageW;

      const page = document.createElement('div');
      page.className = 'live-edit-slide';
      page.style.cssText = `width:100%;padding-bottom:${aspect * 100}%;position:relative;background:${slide.background || 'white'};overflow:hidden;`;

      const inner = document.createElement('div');
      inner.className = 'live-edit-slide-inner';
      inner.style.cssText = `position:absolute;top:0;left:0;width:${pageW}px;height:${pageH}px;transform-origin:top left;`;
      page.appendChild(inner);

      for (const shape of (slide.shapes || [])) {
        const el = _renderTextShape(shape);
        if (el) inner.appendChild(el);
      }

      renderArea.innerHTML = '';
      renderArea.appendChild(page);

      // Scale inner to fit
      const doScale = () => {
        const containerW = page.clientWidth;
        if (containerW && pageW) {
          inner.style.transform = `scale(${containerW / pageW})`;
        }
      };
      requestAnimationFrame(doScale);
    }

    function _renderTextShape(shape) {
      if (!shape || !shape.paragraphs || !shape.paragraphs.length) return null;
      const el = document.createElement('div');
      el.className = 'live-edit-shape';
      el.dataset.shapeId = shape.shape || shape.name || '';

      // Apply pre-built CSS style object directly
      if (shape.style) {
        for (const [k, v] of Object.entries(shape.style)) {
          if (v != null) el.style.setProperty(k, String(v));
        }
      }

      for (let pi = 0; pi < shape.paragraphs.length; pi++) {
        const para = shape.paragraphs[pi];
        const pEl = document.createElement('div');
        pEl.dataset.para = pi;
        if (para.style) {
          for (const [k, v] of Object.entries(para.style)) {
            if (v != null) pEl.style.setProperty(k, String(v));
          }
        }
        for (let ri = 0; ri < (para.runs || []).length; ri++) {
          const run = para.runs[ri];
          const span = document.createElement('span');
          span.dataset.run = ri;
          span.dataset.shape = shape.shape || '';
          span.dataset.slide = currentSlide;
          span.textContent = run.text || '';
          if (run.style) {
            for (const [k, v] of Object.entries(run.style)) {
              if (v != null) span.style.setProperty(k, String(v));
            }
          }
          if (!readOnly) {
            span.contentEditable = 'true';
            span.addEventListener('blur', (e) => _onRunEdit(e, shape.shape || '', pi, ri));
            span.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } });
          }
          pEl.appendChild(span);
        }
        el.appendChild(pEl);
      }
      return el;
    }

    // --- Text editing ---
    async function _onRunEdit(e, shapeId, paraIdx, runIdx) {
      const newText = e.target.textContent;
      statusEl.textContent = 'Saving...';
      const result = await callTool('editor.set_pptx_run_text', {
        session_id: sessionId,
        slide: currentSlide,
        shape: shapeId,
        paragraph: paraIdx,
        run: runIdx,
        text: newText,
      });
      if (result.error || result._error) {
        statusEl.textContent = 'Error: ' + (result.error || result._error);
      } else {
        statusEl.textContent = 'Saved';
        setTimeout(() => { if (statusEl.textContent === 'Saved') statusEl.textContent = ''; }, 1500);
      }
    }

    // --- Converter HTML inline editing (partial re-render) ---

    /**
     * Attach contentEditable and edit handlers to all text spans in
     * converter-rendered HTML (shapes with data-shape, paras with data-para,
     * runs with data-run attributes).
     */
    function _attachInlineEditHandlers(area) {
      area.querySelectorAll('[data-shape]').forEach(shapeEl => {
        shapeEl.querySelectorAll('span[data-run]').forEach(span => {
          if (span.children.length === 0) {
            span.contentEditable = 'true';
            span.style.cursor = 'text';
            span.addEventListener('blur', _onConverterSpanBlur);
            span.addEventListener('keydown', _onConverterSpanKeydown);
          }
        });
        // Also make plain text spans (without data-run) editable for visual editing,
        // but they won't trigger a save (no run identifier)
        shapeEl.querySelectorAll('span:not([data-run])').forEach(span => {
          if (span.children.length === 0 && span.textContent.trim()) {
            span.contentEditable = 'true';
            span.style.cursor = 'text';
          }
        });
      });
    }

    function _onConverterSpanKeydown(e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.target.blur();
      }
    }

    async function _onConverterSpanBlur(e) {
      const span = e.target;
      const runIdx = span.dataset.run != null ? parseInt(span.dataset.run, 10) : null;
      if (runIdx == null) return;  // no run index — can't save

      // Walk up to find data-para and data-shape
      const paraEl = span.closest('[data-para]');
      const shapeEl = span.closest('[data-shape]');
      if (!paraEl || !shapeEl) return;

      const paraIdx = parseInt(paraEl.dataset.para, 10);
      const shapeName = shapeEl.dataset.shape;
      const newText = span.textContent;

      if (isNaN(paraIdx) || !shapeName) return;

      // Save the edit
      statusEl.textContent = 'Saving...';
      const saveResult = await callTool('editor.set_pptx_run_text', {
        session_id: sessionId,
        slide: currentSlide,
        shape: shapeName,
        paragraph: paraIdx,
        run: runIdx,
        text: newText,
      });

      if (saveResult.error || saveResult._error) {
        statusEl.textContent = 'Error: ' + (saveResult.error || saveResult._error);
        return;
      }

      // Partial re-render: get updated slide HTML and replace just the shape
      await renderShape(shapeName);
    }

    /**
     * Re-render a single shape by name after an edit.
     * Calls editor.preview for the current slide, extracts the matching
     * shape element from the returned HTML, and replaces it in the DOM.
     * Falls back to full slide re-render on error.
     *
     * @param {string} shapeId - The data-shape attribute value (shape name)
     * @param {string} [newText] - Optional: not used directly (edit already saved)
     */
    async function renderShape(shapeId) {
      if (!sessionId || format !== 'pptx') return;

      // Show subtle loading state on the shape being re-rendered
      const currentShapeEl = renderArea.querySelector(`[data-shape="${CSS.escape(shapeId)}"]`);
      if (currentShapeEl) {
        currentShapeEl.style.opacity = '0.6';
        currentShapeEl.style.transition = 'opacity 0.15s';
      }

      try {
        // Get freshly rendered slide HTML from the editor (uses cached Node tree)
        const preview = await callTool('editor.preview', {
          session_id: sessionId,
          slide: currentSlide,
        });

        if (destroyed) return;

        if (preview.error || preview._error || !preview.html) {
          // Fall back to full slide re-render
          console.warn('[LiveEditPane] renderShape: preview failed, falling back to full re-render');
          _cachedSlides = null;
          await renderSlide();
          return;
        }

        // Parse the new slide HTML and find the matching shape
        const parser = new DOMParser();
        const doc = parser.parseFromString(preview.html, 'text/html');
        const newShapeEl = doc.querySelector(`[data-shape="${CSS.escape(shapeId)}"]`);

        if (!newShapeEl || !currentShapeEl) {
          // Shape not found in new HTML — fall back to full slide replacement
          console.warn('[LiveEditPane] renderShape: shape not found in preview, replacing full slide');
          _replaceFullSlideFromPreview(preview.html);
          return;
        }

        // Replace just the shape element
        const replacement = document.importNode(newShapeEl, true);
        currentShapeEl.replaceWith(replacement);

        // Re-attach edit handlers on the new shape element
        if (!readOnly) {
          replacement.querySelectorAll('span[data-run]').forEach(span => {
            if (span.children.length === 0) {
              span.contentEditable = 'true';
              span.style.cursor = 'text';
              span.addEventListener('blur', _onConverterSpanBlur);
              span.addEventListener('keydown', _onConverterSpanKeydown);
            }
          });
          replacement.querySelectorAll('span:not([data-run])').forEach(span => {
            if (span.children.length === 0 && span.textContent.trim()) {
              span.contentEditable = 'true';
              span.style.cursor = 'text';
            }
          });
        }

        // Update the cached slide HTML so navigation doesn't revert the edit
        if (_cachedSlides && _cachedSlides.pages[currentSlide] != null) {
          const slideWrapper = renderArea.querySelector('.live-edit-slide-html');
          if (slideWrapper) {
            _cachedSlides.pages[currentSlide] = slideWrapper.innerHTML;
          }
        }

        statusEl.textContent = 'Saved';
        setTimeout(() => { if (statusEl.textContent === 'Saved') statusEl.textContent = ''; }, 1500);
      } catch (err) {
        console.error('[LiveEditPane] renderShape error:', err);
        // Fall back to full slide re-render
        if (currentShapeEl) {
          currentShapeEl.style.opacity = '';
          currentShapeEl.style.transition = '';
        }
        _cachedSlides = null;
        await renderSlide();
      }
    }

    /**
     * Replace the full slide HTML content from a preview response,
     * preserving the wrapper structure and re-attaching edit handlers.
     */
    function _replaceFullSlideFromPreview(html) {
      const slideHtmlEl = renderArea.querySelector('.live-edit-slide-html');
      if (slideHtmlEl) {
        slideHtmlEl.innerHTML = html;
      } else {
        // No wrapper found — rebuild entirely
        const styles = _cachedSlides ? _cachedSlides.styles : '';
        renderArea.innerHTML = `<div class="live-edit-slide-wrapper">${styles}<div class="live-edit-slide-html">${html}</div></div>`;
      }

      // Update cache
      if (_cachedSlides) {
        const slideHtmlContent = renderArea.querySelector('.live-edit-slide-html');
        if (slideHtmlContent) {
          _cachedSlides.pages[currentSlide] = slideHtmlContent.innerHTML;
        }
      }

      // Re-attach edit handlers
      if (!readOnly) {
        _attachInlineEditHandlers(renderArea);
      }

      statusEl.textContent = 'Saved';
      setTimeout(() => { if (statusEl.textContent === 'Saved') statusEl.textContent = ''; }, 1500);
    }

    async function _loadTextRuns() {
      const result = await callTool('editor.pptx_text', { session_id: sessionId });
      if (result && !result.error) textRuns = result.slides || result.runs || [];
    }

    async function _loadDocxRuns() {
      const result = await callTool('editor.docx_text', { session_id: sessionId });
      if (result && !result.error) textRuns = result.paragraphs || [];
    }

    // --- Public API ---
    function setSlide(idx) {
      currentSlide = idx;
      renderSlide();
    }

    function refresh() {
      renderSlide();
    }

    async function save(outputPath) {
      if (!sessionId) return { error: 'No session' };
      return callTool('editor.save', { session_id: sessionId, path: outputPath || '' });
    }

    function destroy() {
      destroyed = true;
      if (sessionId) {
        callTool('editor.close', { session_id: sessionId }).catch(() => {});
      }
      root.remove();
    }

    // Auto-open if path provided
    if (opts.path) open(opts.path);

    return {
      element: root,
      get sessionId() { return sessionId; },
      get format() { return format; },
      get currentSlide() { return currentSlide; },
      get _path() { return opts.path; },
      setSlide,
      refresh,
      renderShape,
      save,
      open,
      destroy,
    };
  }

  async function _defaultCallTool(name, params) {
    const resp = await fetch('/api/' + name, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params || {}),
    });
    return resp.json();
  }

  return { create };
})();
window.AppUILiveEditPane = AppUILiveEditPane;
