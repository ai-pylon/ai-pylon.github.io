/* Assistant reply tool execution and captured result rendering. */
window._AppUIChatTools = (() => {
  /**
   * Detect and run tool calls from assistant reply text.
   * @param {string} reply - The assistant's reply text
   * @param {HTMLElement} el - Container element for tool output
   * @param {Array} tools - Available tools
   * @returns {Promise<object|null>} - Executed tool result or null
   */
  async function run(reply, el, tools) {
    const toolMatch = reply.match(/\/tool\s+([\w.]+)\s*(\{[\s\S]*\})?/);
    if (!toolMatch || !tools) return null;
    const toolName = toolMatch[1];
    let toolParams = {};
    if (toolMatch[2]) {
      try { toolParams = JSON.parse(toolMatch[2]); } catch {
        const raw = toolMatch[2];
        let depth = 0, end = 0;
        for (let i = 0; i < raw.length; i++) {
          if (raw[i] === '{') depth++;
          else if (raw[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
        }
        try { toolParams = JSON.parse(raw.substring(0, end)); } catch { toolParams = {}; }
      }
    }
    // Orchestrator: multi-step pipeline execution
    if (toolName === 'orchestrator.run' && toolParams.steps) {
      const toolEl = document.createElement('div');
      toolEl.style.cssText = 'font-size:11px;background:#1a1a2a;border:1px solid #2a2a4a;border-radius:4px;padding:6px 8px;margin-top:6px';
      toolEl.innerHTML = `\ud83d\udd17 Running pipeline (${toolParams.steps.length} steps)...`;
      el.appendChild(toolEl);
      try {
        const r = await fetch('/api/orchestrator/run_steps', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(toolParams)});
        const result = await r.json();
        const results = result.results || [];
        let html = `<b>\ud83d\udd17 Pipeline (${results.length} steps)</b>`;
        results.forEach((res, i) => {
          const step = toolParams.steps[i];
          const ok = !res._error;
          html += `<div style="margin:3px 0;padding:3px;border-left:2px solid ${ok ? '#4caf50' : '#f44336'}">${ok ? '\u2705' : '\u274c'} ${AppUITextUtils.esc(step.tool)}: <span style="font-size:10px">${AppUITextUtils.esc(JSON.stringify(res).substring(0, 200))}</span></div>`;
        });
        toolEl.innerHTML = html;
      } catch (e) { toolEl.textContent = `\ud83d\udd17 Pipeline error: ${e.message}`; }
      return null;
    }
    // Single tool
    const toolEl = document.createElement('div');
    toolEl.style.cssText = 'font-size:11px;background:#1a2a1a;border:1px solid #2a4a2a;border-radius:4px;padding:6px 8px;margin-top:6px';
    toolEl.textContent = `\u2699\ufe0f Running ${toolName}...`;
    el.appendChild(toolEl);
    try {
      const r = await fetch(`/api/${toolName}`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(toolParams)});
      const result = await r.json();
      const executed = {toolName, result};
      toolEl.innerHTML = `<b>\u2699\ufe0f ${AppUITextUtils.esc(toolName)}</b><pre style="margin:4px 0;font-size:10px;max-height:150px;overflow:auto">${AppUITextUtils.esc(JSON.stringify(result, null, 2).substring(0, 1000))}</pre>`;
      return executed;
    } catch (e) { toolEl.textContent = `\u2699\ufe0f ${toolName}: Error - ${e.message}`; }
    return null;
  }

  return {run};
})();
