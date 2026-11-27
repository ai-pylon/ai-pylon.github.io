/* AI Sidebar slash command handling (/create, /fix, /update, /tools, /workflow). */
window._AISidebarCommands = (function() {
  'use strict';

  /**
   * Returns {handled: true, contextPrefix, message} if command detected, else null.
   */
  async function handleCommand(msg) {
    const trimmed = msg.trim();
    if (!trimmed.startsWith('/')) return null;

    const match = trimmed.match(/^\/(\w+)\s*(.*)/s);
    if (!match) return null;
    const [, cmd, arg] = match;

    if (cmd === 'create') {
      // /create <description> — inject page boilerplate context
      let templateContent = '';
      try {
        const resp = await fetch('/api/acp/file/read', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({path: 'pylon/appui/app.htm'}),
        });
        if (resp.ok) {
          const data = await resp.json();
          templateContent = data.content || data.text || '';
        }
      } catch {}
      const context = [
        '[Command: /create]',
        'The user wants to create a new AppUI page.',
        templateContent ? `[AppUI Template (app.htm)]\n${templateContent}` : '',
        'Generate a complete page implementation based on the description below.',
        'Include: index.html (from template), app.js, style.css, and manifest.json.',
        'Follow the page conventions from the project rules.',
      ].filter(Boolean).join('\n\n');
      return {handled: true, contextPrefix: context, message: arg || 'Create a new page'};
    }

    if (cmd === 'fix') {
      // /fix — gather console errors and page state
      const errors = [];
      if (window.__capturedErrors?.length) {
        errors.push(...window.__capturedErrors.slice(-10).map(e => typeof e === 'string' ? e : e.message || String(e)));
      }
      const pageInfo = [
        'Page: ' + document.title,
        'URL: ' + window.location.pathname,
      ];
      const errorEls = document.querySelectorAll('.error,[data-error],[role="alert"]');
      errorEls.forEach(el => {
        const text = (el.textContent || '').trim();
        if (text && text.length < 500) errors.push(text);
      });
      const context = [
        '[Command: /fix]',
        'The user wants to fix errors on the current page.',
        pageInfo.join('\n'),
        errors.length ? '[Console/UI Errors]\n' + errors.join('\n') : '[No captured errors found — ask the user to describe the issue]',
        'Diagnose the problem and provide a fix. Reference specific files and line numbers when possible.',
      ].filter(Boolean).join('\n\n');
      return {handled: true, contextPrefix: context, message: arg || 'Fix the errors on this page'};
    }

    if (cmd === 'update') {
      // /update — check page against latest conventions
      const currentPage = window.location.pathname.replace(/^\/pages\//, '').replace(/\/$/, '');
      let pageHtml = '';
      if (currentPage) {
        try {
          const resp = await fetch('/api/acp/file/read', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({path: `pages/${currentPage}/index.html`}),
          });
          if (resp.ok) {
            const data = await resp.json();
            pageHtml = (data.content || data.text || '').slice(0, 3000);
          }
        } catch {}
      }
      const context = [
        '[Command: /update]',
        'The user wants to check if this page follows the latest AppUI conventions.',
        `Current page: ${currentPage || 'unknown'}`,
        pageHtml ? `[Current index.html (first 3000 chars)]\n${pageHtml}` : '',
        'Compare against the AppUI Page Guide and project rules.',
        'List what needs to be updated and provide the specific changes.',
      ].filter(Boolean).join('\n\n');
      return {handled: true, contextPrefix: context, message: arg || 'Check this page against latest conventions and suggest migrations'};
    }

    if (cmd === 'tools') {
      // /tools <query> — search tool catalog
      const query = arg.trim();
      let searchResults = '';
      if (query) {
        try {
          const resp = await fetch('/api/tool_catalog/fetch', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({prefix: query}),
          });
          if (resp.ok) {
            const data = await resp.json();
            searchResults = JSON.stringify(data, null, 2);
          }
        } catch {}
      }
      if (!searchResults) {
        try {
          const resp = await fetch('/tools');
          if (resp.ok) {
            const data = await resp.json();
            const tools = (data.tools || []).filter(t => t.name.includes(query) || (t.description || '').toLowerCase().includes(query.toLowerCase()));
            if (tools.length) searchResults = tools.slice(0, 20).map(t => `- ${t.name}: ${t.description || ''}`).join('\n');
          }
        } catch {}
      }
      const context = [
        '[Command: /tools]',
        `The user is searching for tools matching: "${query}"`,
        searchResults ? `[Search Results]\n${searchResults}` : '[No results found]',
        'Explain which tools are relevant and how to use them. Show example API calls.',
      ].filter(Boolean).join('\n\n');
      return {handled: true, contextPrefix: context, message: query ? `Find tools for: ${query}` : 'Show available tool namespaces'};
    }

    if (cmd === 'workflow' || cmd === 'wf') {
      // /workflow <name> [params] — run or suggest a workflow
      const query = arg.trim();
      let workflowList = '';
      try {
        const resp = await fetch('/api/workflows/list', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{}'});
        if (resp.ok) {
          const data = await resp.json();
          const workflows = data.workflows || [];
          if (query) {
            const matches = workflows.filter(w => w.name.includes(query) || (w.description || '').toLowerCase().includes(query.toLowerCase()));
            workflowList = matches.slice(0, 15).map(w => `- ${w.name}: ${w.description || ''} (${(w.steps || []).length} steps)`).join('\n');
          } else {
            workflowList = workflows.slice(0, 30).map(w => `- ${w.name}: ${w.description || ''}`).join('\n');
          }
        }
      } catch {}
      const context = [
        '[Command: /workflow]',
        query ? `The user wants to find or run a workflow matching: "${query}"` : 'The user wants to see available workflows.',
        workflowList ? `[Available Workflows]\n${workflowList}` : '[No workflows found]',
        'Explain relevant workflows and how to run them. Use: POST /api/workflows/run {name: "workflow-name", data: {...}}',
        'If the user seems to want a new workflow, suggest creating one.',
      ].filter(Boolean).join('\n\n');
      return {handled: true, contextPrefix: context, message: query ? `Find or run workflow: ${query}` : 'Show available workflows'};
    }

    return null; // Not a recognized command
  }

  return { handleCommand };
})();
