/* Content accordion markup and lifetime; Disclosure owns expansion behavior. */
window._AppUIContentAccordion = (() => {
  function create(area, spec) {
    const owner = AppUILifecycle.createScope(), sections = Object.create(null);
    for (const section of spec.sections || []) {
      if (owner.destroyed) break;
      const wrapper = document.createElement('div');
      wrapper.className = 'appui-accordion-section';
      wrapper.dataset.paneId = section.id || '';
      const header = document.createElement('button');
      header.type = 'button';
      header.className = 'appui-accordion-header';
      header.innerHTML = '<span class="appui-accordion-arrow">' + (section.open !== false ? '\u25be' : '\u25b8') + '</span> ' + (section.label || section.id || '');
      const panel = document.createElement('div');
      panel.className = 'appui-accordion-panel';
      wrapper.append(header, panel); area.appendChild(wrapper);
      owner.add(() => wrapper.remove());
      sections[section.id] = {wrapper, header, panel};
      let rendered = false;
      function render() {
        if (owner.destroyed || rendered) return;
        rendered = true;
        owner.add(section.render?.(panel));
      }
      const disclosure = AppUIDisclosure.bind({trigger: header, panel, expanded: section.open !== false,
        onToggle(open) {
          header.querySelector('.appui-accordion-arrow').textContent = open ? '\u25be' : '\u25b8';
          if (open) render();
        },
      });
      owner.add(disclosure);
      if (section.open !== false) render();
    }
    function update(id, value) {
      if (owner.destroyed || !sections[id]) return;
      sections[id].wrapper.hidden = value(sections[id].wrapper.hidden);
    }
    return {
      destroy: () => owner.destroy(),
      showPane: id => update(id, () => false),
      hidePane: id => update(id, () => true),
      togglePane: id => update(id, hidden => !hidden),
      isPaneVisible: id => !owner.destroyed && !!sections[id] && !sections[id].wrapper.hidden,
      getPaneIds: () => Object.keys(sections),
    };
  }
  return {create};
})();
