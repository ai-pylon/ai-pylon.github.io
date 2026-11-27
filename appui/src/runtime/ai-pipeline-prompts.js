/* Private template loading and prompt construction for AI Pipeline. */
window._AppUIAIPipelinePrompts = {
  create({opts,commands:_commands,sources:_sources}) {
    let _promptTemplate = null;
    // --- Load prompt template ---
    async function _loadPromptTemplate() {
      if (_promptTemplate) return _promptTemplate;
      if (!opts.promptTemplate) return null;

      // Try config system
      try {
        const r = await fetch('/configs');
        const data = await r.json();
        const entry = (data.configs || []).find(c => c.name === `prompts_${opts.promptTemplate}.txt` || c.name === `prompts/${opts.promptTemplate}.txt`);
        if (entry && entry.data) { _promptTemplate = typeof entry.data === 'string' ? entry.data : JSON.stringify(entry.data); return _promptTemplate; }
      } catch {}

      // Fallback: build from registered commands/sources
      return null;
    }

    // --- Build system prompt ---
    function _buildSystemPrompt(stateObj) {
      let prompt = _promptTemplate || '';
      if (!prompt) {
        // Auto-generate from registry
        prompt = `You are a command router + context planner.
Return commands to execute AND context to fetch.

Commands:\n`;
        for (const [name, def] of Object.entries(_commands)) {
          prompt += `- ${name}(arg?)  --  ${def.desc}${def.destructive ? ' [DESTRUCTIVE]' : ''}\n`;
        }
        prompt += `\nContext sources:\n`;
        for (const [name, def] of Object.entries(_sources)) {
          prompt += `- ${name} [${def.cost}]: ${def.desc}`;
          if (def.index) {
            const idx = typeof def.index === 'function' ? def.index() : def.index;
            if (typeof idx === 'string') prompt += `\n    ${idx.substring(0, 500)}`;
            else if (Array.isArray(idx)) prompt += `\n    Available: ${idx.slice(0, 20).join(', ')}`;
          }
          prompt += '\n';
        }
        prompt += `\nRules:
- help/onboarding -> cmd=chat, context needs menu
- content generation -> context needs relevant sources
- simple actions (save/export/select) -> no context
- destructive -> "confirm": true\n`;
      }

      // Inject current state
      prompt += `\nCurrent state: ${JSON.stringify(stateObj)}\n`;
      prompt += `\nRespond JSON: {"commands":[{"cmd":"..","arg":".."}], "context":{...}, "confirm":false}`;
      return prompt;
    }

    return {load:_loadPromptTemplate,build:_buildSystemPrompt};
  },
};
