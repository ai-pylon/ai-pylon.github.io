/* Private recursive capability markup; selection policy stays in the controller. */
window._AISidebarToolHierarchyView = {
  create({owner,leaves,selected,isGroupEnabled,description,onGroupChange,onToolChange}) {
    const createBranch = (node, prefix, depth) => {
      const branchLeaves = leaves(node);
      const detail = document.createElement('details');
      detail.className = 'ui-ai-tool-group'; detail.style.marginLeft = depth ? '12px' : '0';
      const summary = document.createElement('summary');
      const toggle = document.createElement('input'); toggle.type = 'checkbox';
      toggle.checked = isGroupEnabled(prefix);
      toggle.title = 'Expose this capability group without enabling its child tools';
      owner.listen(toggle,'click', event => event.stopPropagation());
      owner.listen(toggle,'change', () => onGroupChange(prefix,toggle.checked));
      const title = document.createElement('span'); title.className = 'ui-ai-tool-group-title';
      title.textContent = ` ${node.name} (${branchLeaves.length}) — ${description(prefix, branchLeaves)}`;
      summary.append(toggle, title); detail.appendChild(summary);
      [...node.children.entries()].sort(([a], [b]) => a.localeCompare(b)).forEach(([name, child]) => detail.appendChild(createBranch(child, `${prefix}.${name}`, depth + 1)));
      node.tools.sort((a, b) => a.name.localeCompare(b.name)).forEach(tool => {
        const label = document.createElement('label'); label.style.marginLeft = '12px';
        const toggleTool = document.createElement('input'); toggleTool.type = 'checkbox'; toggleTool.checked = selected.has(tool.name);
        owner.listen(toggleTool,'change', () => onToolChange(tool.name,toggleTool.checked));
        const name = document.createElement('b'); name.textContent = tool.name;
        const detailText = document.createElement('small'); detailText.textContent = tool.description || '';
        label.append(toggleTool, document.createTextNode(' '), name, detailText); detail.appendChild(label);
      });
      // Suggested groups are selected for the AI, but the hierarchy stays
      // collapsed until the user explicitly opens a namespace. This avoids
      // expanding every branch merely because one descendant is suggested.
      return detail;
    };
    return createBranch;
  },
};
