/* AI Sidebar prompt library — builtin prompts, custom prompt persistence. */
window._AISidebarPrompts = (function() {
  'use strict';

  const BUILTIN_PROMPTS = [
    {id: 'code_reviewer', name: 'Code Reviewer', builtin: true, prompt: 'You are a code reviewer. Analyze code for bugs, security issues, and style problems. Provide actionable feedback with line references.'},
    {id: 'doc_writer', name: 'Doc Writer', builtin: true, prompt: 'You are a documentation writer. Generate clear docs from code including signatures, parameters, return values, and usage examples.'},
    {id: 'bug_hunter', name: 'Bug Hunter', builtin: true, prompt: 'You are a bug hunter. Find potential bugs and edge cases: null errors, off-by-one, race conditions, resource leaks, unhandled exceptions.'},
    {id: 'refactorer', name: 'Refactorer', builtin: true, prompt: 'You are a refactoring expert. Suggest cleaner patterns, reduce duplication, improve naming, and apply SOLID principles. Show before/after.'},
    {id: 'explainer', name: 'Explainer', builtin: true, prompt: 'You are a code explainer. Explain code step by step in plain English. Describe what each section does and how it connects to the rest.'},
  ];

  const STORAGE_KEY = 'ai_prompt_library_custom';

  function loadCustom(getSetting) {
    const raw = getSetting(STORAGE_KEY, '[]');
    try { return JSON.parse(typeof raw === 'string' ? raw : JSON.stringify(raw)); }
    catch { return []; }
  }

  function saveCustom(setSetting, prompts) {
    setSetting(STORAGE_KEY, JSON.stringify(prompts));
  }

  function getAll(getSetting) {
    return [...BUILTIN_PROMPTS, ...loadCustom(getSetting)];
  }

  function toolSummary(tools, groups) {
    return [...groups.map(group => `[group] ${group.name}: ${group.description}`),
      ...tools.map(tool => `${tool.name}: ${tool.description || ''}`)].join('\n') || 'No tool groups or tools selected.';
  }

  function createSettings({config,getPathname=()=>window.location.pathname}) {
    // A missing AppUIConfigStore must not turn every tool on. Keep a local
    // selection state for lightweight pages that do not load that plugin.
    const localSettings = new Map();
    const getSetting = (name, fallback) => window.AppUIConfigStore
      ? AppUIConfigStore.get(name, fallback)
      : (localSettings.has(name) ? localSettings.get(name) : fallback);
    const setSetting = (name, value) => {
      if (window.AppUIConfigStore) AppUIConfigStore.set(name, value);
      else localSettings.set(name, value);
    };
    const promptOptions = () => ({
      system: getSetting('ai_send_system', true) !== false,
      tools: getSetting('ai_send_tools', true) !== false,
      environment: getSetting('ai_send_environment', true) !== false,
      ui: false,
      user: getSetting('ai_send_user', true) !== false,
    });
    const _recommendInstructions = 'When you need to perform an action or the user asks you to do something, call workflows.recommend with their prompt to discover available tools and workflows. Use the page parameter to provide context about which page the user is on. After receiving recommendations, use the suggested tools directly.';
    const system = () => {
      const base = getSetting('ai_system_prompt', '') || config.system || 'You are a helpful AI assistant.';
      const pageName = (getPathname().match(/\/pages\/([^/]+)/) || [])[1] || '';
      const recommend = config.recommendInstructions !== undefined ? config.recommendInstructions : _recommendInstructions;
      return base + (recommend ? '\n\n' + recommend : '') + (pageName ? `\nCurrent page: ${pageName}` : '');
    };

    return {getSetting,setSetting,promptOptions,system,
      removeSetting:name=>window.AppUIConfigStore?AppUIConfigStore.remove(name):localSettings.delete(name)};
  }

  return { BUILTIN_PROMPTS, STORAGE_KEY, loadCustom, saveCustom, getAll, createSettings, toolSummary };
})();
