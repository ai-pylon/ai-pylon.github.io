/* Shell mounting: template validation and content region mounting. */

/* The versioned AppUI DOM contract is validated before shell rendering. */
window.AppUIShellTemplateMounter = {
  mount() {
    return this.map(AppUITemplate.mount().regions);
  },
  reset() {
    document.querySelectorAll('[data-appui-owned="true"]').forEach(el => el.remove());
    for (const id of ['app-menubar', 'app-left', 'app-content-top', 'app-content-body',
        'app-content-bottom', 'app-right', 'app-statusbar']) {
        const region = document.getElementById(id);
        if (!region) continue;
        region.replaceChildren();
        region.hidden = false;
        region.classList.remove('ai-app-hidden');
        region.style.removeProperty('width');
    }
    document.body.classList.remove('ai-app-body', 'ai-app-compact', 'ai-app-compact-left-open', 'ai-app-compact-right-open');
  },
  map(regions) {
    return {
      menuBar: regions['app-menubar'], main: regions['app-main'], left: regions['app-left'],
      content: regions['app-content'], contentTop: regions['app-content-top'],
      contentBody: regions['app-content-body'], contentBottom: regions['app-content-bottom'],
      right: regions['app-right'], status: regions['app-statusbar'],
    };
  },
};

/* Content-region mounting is independent of the surrounding shell lifecycle. */
window.AppUIShellContentMounter = {
  mount({config, region, runCommand}) {
    if (!config) return null;
    const contentConfig = Object.assign({}, config, {
      onCommand: config.onCommand || ((command, params, context) => runCommand(command, params, context)),
    });
    return region.mount(contentConfig);
  },
};

/* Region construction and initial visibility; the shell retains lifecycle ownership. */
window.AppUIShellRegionMounter = {
  create({elements, layout, persist}) {
    const {main, menuBar, left, content, right, status, contentTop, contentBody, contentBottom} = elements;
    return {
      menubar: AppUIMenubarRegion.create(menuBar),
      left: AppUISidebarRegion.create({element: left, main, position: 'left', layout, persist}),
      content: AppUIContentRegion.create({element: content, top: contentTop, body: contentBody, bottom: contentBottom}),
      right: AppUISidebarRegion.create({element: right, main, position: 'right', layout, persist}),
      statusbar: AppUIStatusbarRegion.create(status),
    };
  },
  mount({regions, elements, config, buildResponsiveRail}) {
    const menuSlots = regions.menubar.mount({visible: config.menubar !== false});
    elements.menu = menuSlots.menu; elements.menuRight = menuSlots.right;
    regions.left.mount(config.sidebar !== false ? config.leftSidebar : null);
    regions.right.mount(config.sidebar !== false ? config.rightSidebar : null);
    buildResponsiveRail(elements.main);
    const statusSlots = regions.statusbar.mount({visible: config.statusbar !== false && !!config.statusBar});
    elements.statusMain = statusSlots.main; elements.statusRight = statusSlots.right;
  },
};
