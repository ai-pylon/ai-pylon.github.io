/* Private model option rendering and selection policy for AI service discovery. */
window._AISidebarLLMModels = {
  fill({select,data,backend,requested}) {
    const models = data.models || data[backend] || data.data || [];
    const isChatModel = model => !/(?:\bembed(?:ding)?\b|\brerank(?:er)?\b|\bocr\b|\bwhisper\b|\bsafeguard\b)/i.test(model.id || model.name || '');
    models.forEach(model => {
      const option = document.createElement('option');
      option.value = model.id || model.name;
      const unavailable = String(model.status || '').toUpperCase() === 'UNHEALTHY';
      option.textContent = `${model.name || model.id}${unavailable ? ' (unavailable)' : ''}`;
      // A healthy EricAI deployment can be scaled to zero and wake on
      // demand.  Its `running` flag is therefore not an availability
      // signal and must not replace the user's selected model.
      option.disabled = unavailable;
      select.appendChild(option);
    });
    const requestedOption = [...select.options].find(option => option.value === requested && !option.disabled && isChatModel({id: option.value}));
    const availableOption = models.find(model => !String(model.status || '').toUpperCase().includes('UNHEALTHY') && isChatModel(model));
    const availableOptionElement = availableOption && [...select.options].find(option => option.value === (availableOption.id || availableOption.name));
    const selected = requestedOption || availableOptionElement;
    if (!selected) throw new Error(data._error || 'No available models');
    selected.selected = true;
    return selected.value;
  }
};
