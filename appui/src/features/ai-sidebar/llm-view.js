/* Private connection-field DOM shared by the AI sidebar service and catalog. */
window._AISidebarLLMView = (() => {
  function layout(container) {
    container.innerHTML = `<div class="ui-ai-llm-layout"><section class="ui-ai-llm-section ui-ai-llm-connection"><h3>LLM connection</h3><p>Select the local service used for chat requests.</p></section><section class="ui-ai-llm-section"><h3>Generation</h3><label>Provider<select data-ai-backend><option value="">Loading providers…</option></select></label><label>Model<select data-ai-model><option value="">Auto</option></select></label></section><section class="ui-ai-llm-section ui-ai-tool-catalog"><h3>Tools catalog</h3><p>Tools are available only while this catalog is connected.</p><output data-ai-tool-catalog-status aria-live="polite">Not connected</output></section><section class="ui-ai-llm-section ui-ai-llm-health"><h3>LLM status</h3><div class="ui-ai-llm-check"><output data-ai-llm-status aria-live="polite">Checking…</output></div></section></div>`;
  }
  function connection({options, labelText, selectLabel, endpointLabel, placeholder, value, className}) {
    const label = document.createElement('label');
    if (className) label.className = className;
    label.append(document.createTextNode(labelText));
    const select = document.createElement('select');
    select.setAttribute('aria-label', selectLabel);
    options.forEach(option => {
      const item = document.createElement('option');
      item.value = option.value; item.textContent = option.label;
      select.appendChild(item);
    });
    select.value = value;
    label.appendChild(select);
    const serverLabel = document.createElement('label');
    serverLabel.append(document.createTextNode('Server / port'));
    const endpoint = document.createElement('input');
    endpoint.type = 'text'; endpoint.setAttribute('aria-label', endpointLabel);
    endpoint.placeholder = placeholder;
    serverLabel.appendChild(endpoint);
    const connect = document.createElement('button');
    connect.type = 'button'; connect.textContent = 'Connect';
    const row = document.createElement('div');
    row.className = 'ui-ai-catalog-connect'; row.append(serverLabel, connect);
    return {label, select, endpoint, connect, row};
  }
  function catalogStatus({container,context}) {
    const status = container.querySelector('[data-ai-tool-catalog-status]');
    return {
      pending() { if(status){status.textContent='Connecting…';status.dataset.state='pending';} },
      connected(count) { if (status) { status.textContent = `Connected · ${count} tools`; status.dataset.state = 'ok'; } },
      disabled() {
        const toolsTextarea = context.querySelector('[data-ai-tools]');
        if (toolsTextarea) toolsTextarea.value = 'No tools available. Connect a tools catalog in the LLM tab.';
        if (status) { status.textContent = 'Disabled · no tools available'; status.dataset.state = 'idle'; }
      },
      unavailable(error) {
        const toolsTextarea = context.querySelector('[data-ai-tools]');
        if (toolsTextarea) toolsTextarea.value = 'No tools available. The tools catalog is unavailable.';
        if (status) { status.textContent = `Unavailable · ${error.message || error}`; status.dataset.state = 'error'; }
      },
      tools(getTools,getGroups) {
        const textarea=context.querySelector('[data-ai-tools]');
        if(textarea)textarea.value=window._AISidebarPrompts.toolSummary(getTools(),getGroups());
      },
    };
  }
  return {layout, connection,catalogStatus};
})();
