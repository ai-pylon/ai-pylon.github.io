/* Private prompt-channel editor markup for AI sidebar settings. */
window._AISidebarContextSettingsView = {
  mount({container,config,options,system,selectedTools,escapeHtml}) {
    const ctxHtml = document.createElement('div');
    ctxHtml.innerHTML = `<label><input type="checkbox" data-prompt="system"${options.system ? ' checked' : ''}> Send system prompt</label><textarea data-ai-system rows="5">${escapeHtml(system())}</textarea><label><input type="checkbox" data-prompt="tools"${options.tools ? ' checked' : ''}> Send tool prompt</label><textarea data-ai-tools rows="5" readonly>${escapeHtml(selectedTools)}</textarea>`;
    container.appendChild(ctxHtml);
    let environmentText = null;
    if (config.context) {
      const environmentLabel = document.createElement('label');
      const environmentToggle = document.createElement('input');
      environmentToggle.type = 'checkbox'; environmentToggle.dataset.prompt = 'environment'; environmentToggle.checked = options.environment;
      environmentLabel.append(environmentToggle, document.createTextNode(' Send environment prompt'));
      environmentText = document.createElement('textarea');
      environmentText.dataset.aiEnvironment = 'true'; environmentText.rows = 7; environmentText.readOnly = true;
      container.appendChild(environmentLabel);
      container.appendChild(environmentText);
    }
    const userLabel = document.createElement('label');
    const userToggle = document.createElement('input');
    userToggle.type = 'checkbox'; userToggle.dataset.prompt = 'user'; userToggle.checked = options.user;
    userLabel.append(userToggle, document.createTextNode(' Send user prompt'));
    container.appendChild(userLabel);
    const fpLabel = document.createElement('label');
    fpLabel.textContent = 'Final prompt preview';
    const finalPrompt = document.createElement('textarea');
    finalPrompt.dataset.aiFinalPrompt = 'true'; finalPrompt.rows = 12; finalPrompt.readOnly = true;
    fpLabel.appendChild(finalPrompt);
    container.appendChild(fpLabel);
    const applyHost=document.createElement('div');container.appendChild(applyHost);
    return {environmentText,finalPrompt,applyHost};
  },
};
