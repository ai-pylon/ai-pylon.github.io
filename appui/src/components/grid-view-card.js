/* Native text cards for GridView renderers; GridView owns interaction lifetime. */
window._AppUIGridViewCard = {
  create({ label = '', lines = [], selected = false, className = '' } = {}) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'appui-grid-text-card' + (className ? ' ' + className : '');
    card.setAttribute('aria-label', String(label ?? ''));
    card.style.cssText =
      'display:flex;flex-direction:column;align-items:stretch;text-align:left;min-width:0;padding:5px 6px;color:var(--text-primary);background:var(--bg-primary);border:1px solid var(--border);border-radius:3px;cursor:pointer;font-size:10px';
    if (selected) {
      card.classList.add('selected');
      card.setAttribute('aria-current', 'true');
      card.style.borderLeft = '2px solid var(--accent)';
    }
    function append(text, muted) {
      const line = document.createElement('span');
      line.textContent = String(text ?? '');
      line.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
      if (muted) line.style.color = 'var(--text-muted)';
      card.appendChild(line);
    }
    append(label, false);
    for (const value of lines) {
      const line = value !== null && typeof value === 'object' ? value : { text: value };
      append(line.text, line.muted);
    }
    return card;
  }
};
