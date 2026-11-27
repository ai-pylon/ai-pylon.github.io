/* Shared AI-sidebar service discovery defaults, URL handling, and persistence. */
window.AppUIAISidebarConnections = (function() {
  const LLM_MODES = ['gateway', 'proxy', 'full', 'custom'];
  const CATALOG_MODES = ['direct', 'gateway', 'custom', 'off'];

  function normalizeBaseUrl(value) {
    let url = String(value || '').trim();
    if (url && !/^https?:\/\//i.test(url) && !url.startsWith('/')) url = 'http://' + url;
    return url.replace(/\/$/, '');
  }

  function normalizeCatalogUrl(value) {
    let url = normalizeBaseUrl(value);
    if (url && !/\/tools\/?(?:\?|#|$)/i.test(url)) url += '/tools';
    return url;
  }

  function configure(options) {
    const config = {...options};
    if (!Array.isArray(config.transportOptions) || !config.transportOptions.length) {
      const configuredUrl = config.llmUrl || window.AI_LLM_URL || '/llm';
      const savedMode = AppUIStorage.get('appui-ai-service');
      config.transportOptions = [
        {value: 'gateway', label: 'This server · /llm', url: '/llm', discovery: 'pylon'},
        {value: 'proxy', label: 'Kiro proxy · 8767', url: 'http://127.0.0.1:8767', discovery: 'openai'},
        {value: 'full', label: 'ai-pylon v1 · 8130', url: 'http://127.0.0.1:8130', discovery: 'pylon'},
        {value: 'custom', label: 'Custom server', url: '', discovery: 'auto'},
      ];
      config.transportValue = LLM_MODES.includes(savedMode) ? savedMode
        : configuredUrl.includes('8767') ? 'proxy' : configuredUrl.includes('8130') ? 'full' : 'gateway';
      config.transportUrl = AppUIStorage.get('appui-ai-service-url', configuredUrl);
    }
    if (!Array.isArray(config.toolCatalogOptions) || !config.toolCatalogOptions.length) {
      const savedCatalog = AppUIStorage.get('appui-tools-catalog');
      config.toolCatalogOptions = [
        {value: 'direct', label: 'tools_catalog · 9091', url: 'http://127.0.0.1:9091/tools'},
        {value: 'gateway', label: 'This server · /tools', url: '/tools'},
        {value: 'custom', label: 'Custom server', url: ''},
        {value: 'off', label: 'Disabled', url: ''},
      ];
      config.toolCatalogValue = CATALOG_MODES.includes(savedCatalog) ? savedCatalog : 'direct';
      config.toolCatalogUrl = AppUIStorage.get('appui-tools-catalog-url', 'http://127.0.0.1:9091/tools');
    }
    return config;
  }

  function saveService(mode, url) {
    AppUIStorage.set('appui-ai-service', mode);
    if (url) AppUIStorage.set('appui-ai-service-url', url);
  }

  function saveCatalog(mode, url) {
    AppUIStorage.set('appui-tools-catalog', mode);
    if (url) AppUIStorage.set('appui-tools-catalog-url', url);
  }

  function mountOptions({container, config = {}, system = '', appId = 'shared-ai'} = {}) {
    return {
      ...config,
      container,
      system: system || config.system || '',
      context: config.context || null,
      backend: config.backend || 'kiro',
      title: config.title || 'AI',
      tools: config.tools || [],
      suggestedToolPrefixes: config.suggestedToolPrefixes || [],
      toolGroups: config.toolGroups || [],
      suggestedToolGroups: config.suggestedToolGroups || [],
      configKey: config.configKey || ('pages/' + appId),
    };
  }

  return {configure, mountOptions, normalizeBaseUrl, normalizeCatalogUrl, saveService, saveCatalog};
})();
