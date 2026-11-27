/**
 * AppUI Auto-Init — reads data attributes from <body> and creates an AppUI app.
 *
 * Only activates when data-auto-init="true" is set on <body>.
 * Pages with custom init logic (their own app.js calling AppUI.createApp) should
 * NOT include this script.
 *
 * Supported data attributes:
 *   data-auto-init="true"        — required to activate
 *   data-page-id="my_page"       — page identifier
 *   data-page-title="My Page"    — window title
 *   data-page-css="style.css"    — page-specific stylesheet
 *   data-menubar="true"          — show menu bar (default: true)
 *   data-left-sidebar="true"     — show left sidebar
 *   data-left-width="250"        — left sidebar width px
 *   data-right-sidebar="true"    — show right sidebar (default: true)
 *   data-right-width="350"       — right sidebar width px
 *   data-statusbar="true"        — show status bar (default: true)
 *   data-file-explorer="true"    — file explorer in left sidebar
 *   data-file-roots='[...]'      — JSON array of root configs
 *   data-file-watch='[...]'      — JSON array of watch paths
 *   data-content-top="true"      — show content-top region
 *   data-content-bottom="true"   — show content-bottom region
 */

(function() {
  const body = document.body;
  const publicApp = window.AppUI;
  if (!publicApp?.createApp) throw new Error('AppUI auto-init requires the public AppUI entry point.');
  let appInstance = null;
  const setStatus = (...args) => appInstance?.setStatus?.(...args);
  const attr = (name, fallback) => body.getAttribute('data-' + name) ?? fallback;
  const bool = (name, fallback) => attr(name, fallback) === 'true';
  const json = (name) => { try { return JSON.parse(attr(name, 'null')); } catch(e) { return null; } };

  // Inject page CSS if specified
  const pageCss = attr('page-css', '');
  if (pageCss) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = pageCss;
    document.head.appendChild(link);
  }

  // Set title
  const title = attr('page-title', '');
  if (title) document.title = title;

  // Only auto-init if explicitly enabled
  if (!bool('auto-init', 'false')) return;

  const pageId = attr('page-id', 'app');
  const fileExplorer = bool('file-explorer', 'false');
  const fileRoots = json('file-roots') || [];
  const fileWatch = json('file-watch') || fileRoots.map(r => r.path);

  const config = {
    id: pageId,
    title: title || pageId,
    menubar: bool('menubar', 'true') !== false,
    statusBar: bool('statusbar', 'true') ? {} : false,
  };

  // Left sidebar with optional file explorer or sections
  if (bool('left-sidebar', 'false')) {
    const sidebarType = attr('left-sidebar-type', 'file-explorer');
    config.leftSidebar = {
      width: parseInt(attr('left-width', '250'), 10),
      render(el) {
        if (sidebarType === 'sections') {
          // SidebarSections mode: page provides sections via custom event
          const comp = window.AppUISidebarSections;
          if (comp) {
            const instance = comp.create({ container: el, hashRouting: true });
            window._sidebarSections = instance;
            document.dispatchEvent(new CustomEvent('sidebar-sections:ready', { detail: instance }));
          } else {
            el.innerHTML = '<div style="padding:12px;color:var(--text-muted)">SidebarSections not loaded</div>';
          }
        } else if (fileExplorer && fileRoots.length) {
          const fileExplorerFeature = publicApp.features.FileExplorer;
          if (!fileExplorerFeature?.create) {
            el.textContent = 'Loading file explorer…';
            return;
          }
          window._fileExplorer = fileExplorerFeature.create({
            container: el,
            roots: fileRoots,
            watchPaths: fileWatch,
            storageKey: pageId + '-tree',
            onNotice: setStatus,
            onSelect(file) {
              setStatus('Selected: ' + file.name);
              document.dispatchEvent(new CustomEvent('file-explorer:select', { detail: file }));
            },
            onConvert(file, format) {
              setStatus(`Converting ${file.name} → ${format}…`);
              fetch('/api/sysdoc_converter/convert', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ input: file.path, format }),
              }).then(r => r.json()).then(result => {
                if (result._error) setStatus('❌ ' + result._error);
                else setStatus(`✅ ${file.name} → ${format}`);
              });
            },
            formatOptions: fileExplorerFeature.DEFAULT_FORMATS,
          });
        } else {
          el.innerHTML = '<div style="padding:12px;color:var(--text-muted)">No content</div>';
        }
      },
    };
  }

  // Right sidebar (AI chat)
  if (bool('right-sidebar', 'true')) {
    config.rightSidebar = {
      type: 'ai-sidebar',
      width: parseInt(attr('right-width', '350'), 10),
    };
  }

  // Content with top/body/bottom regions
  const hasTop = bool('content-top', 'false');
  const hasBottom = bool('content-bottom', 'false');
  config.content = {
    render(el) {
      el.classList.add('content-layout');
      let html = '';
      if (hasTop) html += '<div class="content-top" id="content-top"></div>';
      html += '<div class="content-body" id="content-body"></div>';
      if (hasBottom) html += '<div class="content-bottom" id="content-bottom"></div>';
      el.innerHTML = html;
    },
  };

  appInstance = publicApp.createApp(config);

  // Optional features never delay the shell. Mount the explorer after the
  // browser has had an opportunity to paint the application.
  if (fileExplorer && fileRoots.length) {
    const loadExplorer = () => publicApp.load('fileExplorer')
      .then(() => appInstance.regions.controller('left')?.mount(config.leftSidebar, config.leftSidebar.render))
      .catch(error => console.error(error));
    if ('requestIdleCallback' in window) window.requestIdleCallback(loadExplorer, {timeout: 1500});
    else window.setTimeout(loadExplorer, 0);
  }
})();
