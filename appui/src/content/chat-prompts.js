/* Prompt construction shared by Chat sends and full-context previews. */
window._AppUIChatPrompts=(function(){
  // --- Tool Merge ---
  function _mergeDefaultTools(pageTools) {
    return pageTools;
  }

  // --- Enabled Tools ---
  function _getEnabledTools(tools) {
    if (typeof tools === 'function') return tools;
    const savedKey = 'ai-chat-tools:' + window.location.pathname;
    const enabled = AppUIStorage.getJSON(savedKey, {}) || {};
    if (!Object.keys(enabled).length) return tools;
    return tools.filter(t => enabled[t.name] !== false);
  }

  // --- Build System Prompt ---
  async function _buildSystem(opts) {
    const promptOptions = Object.assign({system: true, tools: true, environment: true, ui: true, user: true}, opts.promptOptions || {});
    let system = promptOptions.system ? (opts.system || '') : '';

    if (promptOptions.system) {
      const memoryCtx = AppUIChatUI.buildMemoryContext();
      if (memoryCtx) system += memoryCtx;

      const customCtx = AppUIStorage.get('ai-sidebar-custom-context:' + window.location.pathname);
      if (customCtx && customCtx.trim()) system += '\n\n[Custom Instructions]\n' + customCtx.trim();

      const shared = AppUIStorage.get('ai-shared-context');
      if (shared && shared.trim()) system += '\n\n[Shared Context]\n' + shared.trim();
    }

    if (promptOptions.system && opts.clipboard) {
      try {
        const cbR = await fetch('/api/clipboard.recent');
        const cbD = await cbR.json();
        if (cbD && cbD.items && cbD.items.length) {
          const recent = cbD.items.slice(0, 3).map(i => i.text || '').filter(Boolean).join('\n---\n');
          if (recent) system += '\n\n[Recent Clipboard]\n' + recent.substring(0, 1500);
        }
      } catch {
        try {
          const cbR2 = await fetch('/api/clipboard/search?q=&limit=3');
          const cbD2 = await cbR2.json();
          if (cbD2 && cbD2.items && cbD2.items.length) {
            const recent = cbD2.items.slice(0, 3).map(i => i.text || '').filter(Boolean).join('\n---\n');
            if (recent) system += '\n\n[Recent Clipboard]\n' + recent.substring(0, 1500);
          }
        } catch {}
      }
    }

    return system;
  }

  async function _resolveEnvironmentPrompt(opts, question) {
    if (!opts.context) return '';
    try {
      // the turn's question goes to a context(question) hook (it may tailor the snapshot to it)
      const context = typeof opts.context === 'function' ? await opts.context(question || '') : opts.context;
      return context ? (typeof context === 'string' ? context : JSON.stringify(context, null, 2)) : '';
    } catch {
      return '';
    }
  }

  async function _buildEnvironmentPrompt(opts, question) {
    const promptOptions = Object.assign({environment: true}, opts.promptOptions || {});
    return promptOptions.environment ? _resolveEnvironmentPrompt(opts, question) : '';
  }

  async function _buildToolPrompt(opts) {
    const promptOptions = Object.assign({tools: true}, opts.promptOptions || {});
    if (!promptOptions.tools) return '';
    const sections = [];
    if (Array.isArray(opts.toolGroups) && opts.toolGroups.length) {
      sections.push('[Available Tool Groups]\nThese are discovery catalogs, not enabled child tools. Fetch a group with `/tool tool_catalog.fetch {"prefix":"<group_name>"}`. Fetch one child schema with `/tool tool_catalog.fetch {"name":"<child_tool_name>"}`. Then request or enable only the specific child tool needed for the next step.\n'
        + opts.toolGroups.map(group => `- ${group.name}: ${group.description || ''}`).join('\n'));
    }
    if (opts.tools) {
      let toolList = _getEnabledTools(opts.tools);
      if (typeof toolList === 'function') toolList = await toolList();
      if (Array.isArray(toolList) && toolList.length) {
        sections.push('[Available Tools]\nYou can call tools by responding with: /tool <tool_name> {"param":"value"}\n'
          + 'For multi-step workflows: /tool orchestrator.run {"steps":[{"tool":"name","params":{...}},...]}\n'
          + toolList.map(tool => {
            let line = `- ${tool.name}: ${tool.description || ''}`;
            if (tool.parameters && typeof tool.parameters === 'object') {
              const params = Object.entries(tool.parameters);
              if (params.length) {
                const paramStr = params.map(([k, v]) => {
                  const req = v.required ? '' : '?';
                  const desc = v.desc || v.description || '';
                  return `${k}${req}${desc ? ': ' + desc : ''}`;
                }).join(', ');
                line += ` (${paramStr})`;
              }
            }
            return line;
          }).join('\n'));
      }
    }
    return sections.join('\n\n');
  }

  function buildCatalogContinuation(result) {
    const catalogError = result?._error;
    if (catalogError) {
      const suggestedPrefix = result?.suggested_prefix;
      const instruction = suggestedPrefix
        ? 'The requested child tool does not exist. Fetch the real namespace catalog now with /tool tool_catalog.fetch {"prefix":"' + suggestedPrefix + '"}. Do not invent child tool names.'
        : 'The catalog request failed. Explain the error to the user; do not invent another tool name.';
      return 'Tool catalog result: ' + JSON.stringify(result) + '\n' + instruction;
    } else {
      return `Tool catalog result: ${JSON.stringify(result)}\nChoose the one exact child tool required for the original request. Call it now with /tool <tool_name> {params}; do not fetch the catalog again.`;
    }
  }

  function buildRequest(opts,{msg,system,toolPrompt,environmentPrompt,sessionId,internal,promptOptions}) {
    const reqBody = {prompt: (promptOptions.user || internal) ? msg : '', system, backend: opts.backend, model: opts.model || ''};
    if (promptOptions.ui && opts.uiPrompt) reqBody.ui_prompt = opts.uiPrompt;
    if (toolPrompt) reqBody.tool_prompt = toolPrompt;
    if (environmentPrompt) reqBody.environment_prompt = environmentPrompt;
    if (sessionId) reqBody.session_id = sessionId;
    if (promptOptions.tools && opts.tools) {
      const toolList = typeof opts.tools === 'function' ? opts.tools() : opts.tools;
      if (toolList && toolList.length) reqBody.tools = toolList;
    }

    return reqBody;
  }

  async function resolveParts(opts, {current = () => true, transformSystem = value => value, question = ''} = {}) {
    if (!current()) return null;
    let system = await _buildSystem(opts);
    if (!current()) return null;
    system = transformSystem(system);
    if (!current()) return null;
    const toolPrompt = await _buildToolPrompt(opts);
    if (!current()) return null;
    const environmentPrompt = await _buildEnvironmentPrompt(opts, question);
    return current() ? {system, toolPrompt, environmentPrompt} : null;
  }

  async function preview(opts, getMetadata) {
    const {system, toolPrompt, environmentPrompt} = await resolveParts(opts);
    const sections = [];
    const parts = system.split(/\n\n(?=\[)/);
    for (const part of parts) {
      const headerMatch = part.match(/^\[(.+?)\]/);
      if (headerMatch) {
        sections.push({label: headerMatch[1], content: part.slice(headerMatch[0].length).trim()});
      } else if (part.trim()) {
        sections.push({label: 'System', content: part.trim()});
      }
    }
    return {
      raw: system,
      uiPrompt: opts.promptOptions?.ui !== false ? (opts.uiPrompt || '') : '',
      toolPrompt,
      environmentPrompt,
      sections,
      metadata: getMetadata()
    };
  }

  return {resolveParts,preview,buildRequest,buildCatalogContinuation,mergeDefaultTools:_mergeDefaultTools,buildSystem:_buildSystem,
    buildEnvironmentPrompt:_buildEnvironmentPrompt,buildToolPrompt:_buildToolPrompt};
})();
