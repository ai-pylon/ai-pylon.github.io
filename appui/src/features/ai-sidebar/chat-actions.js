/* Shared assistant command, tool execution and page explanation bridge. */
window._AISidebarChatActions = (() => {
  function create({isCurrent, getChat, enabledTools, enabledGroups, enabledWorkflows, applyRecommendations, onSwitch}) {
    let attached = false;
    const onToolCall = async (toolName, args) => {
      if (!isCurrent()) return;
      if (typeof AppUIUsageTracker !== 'undefined') {
        AppUIUsageTracker.recordToolUse(toolName);
        if (toolName === 'workflows.run' && args && args.name) AppUIUsageTracker.recordWorkflowSuggestion(args.name);
      }
      const pageName = (window.location.pathname.match(/\/pages\/([^/]+)/) || [])[1] || '';
      if (toolName !== 'workflows.recommend' && toolName !== 'workflows.recommend.accept') {
        fetch('/api/workflows/recommend/accept', {
          method: 'POST', headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({names: [toolName], page: pageName}),
        }).catch(function(){});
      }
      if (toolName === 'workflows.recommend' && args) {
        applyRecommendations(args);
        return;
      }
      // Execute the tool and return result to LLM
      try {
        const toolPath = toolName.replace(/\./g, '/');
        const resp = await fetch('/api/' + toolPath, {
          method: 'POST', headers: {'Content-Type': 'application/json'},
          body: JSON.stringify(args || {}),
        });
        const result = await resp.json();
        return result.result || result;
      } catch (e) {
        return { _error: e.message || String(e) };
      }
    };
    const onDone = () => { if (!isCurrent()) return; if (typeof AppUIUsageTracker !== 'undefined') AppUIUsageTracker.commit(); };
    function attach() {
      if (attached || !isCurrent()) return;
      attached = true;
      // Wrap chat.send to intercept slash commands (/create, /fix, /update, /tools)
      const chat = getChat(), _originalSend = chat.send.bind(chat);
      chat.send = async function(msg, internal) {
        if (!isCurrent()) return;
        if (internal) return _originalSend(msg, internal);
        const cmdResult = await window._AISidebarCommands.handleCommand(msg);
        if (!isCurrent()) return;
        if (cmdResult) {
          const contextPrefix = cmdResult.contextPrefix;
          const rewrittenMsg = contextPrefix + '\n\n[User Request]\n' + cmdResult.message;
          return _originalSend(rewrittenMsg);
        }
        // Track usage signal (what page, what prompt)
        if (typeof AppUIUsageTracker !== 'undefined') {
          AppUIUsageTracker.recordPrompt(msg, enabledTools(), enabledGroups(), enabledWorkflows());
        }
        // Send prompt as-is — no tool context injected upfront.
        // The LLM has workflows.recommend as a callable tool and will use it
        // to discover what tools/workflows are available for this task.
        return _originalSend(msg);
      };
    }
    function explainPage() {
      if (!isCurrent()) return;
      const chat = getChat();
      const parts = [];
      parts.push('Page: ' + document.title);
      const headings = [...document.querySelectorAll('h1,h2,h3')].slice(0, 10).map(h => h.textContent.trim()).filter(Boolean);
      if (headings.length) parts.push('Headings: ' + headings.join(', '));
      const activeNav = [...document.querySelectorAll('.active,[aria-selected="true"],[aria-current],.selected,.current')].map(el => el.textContent.trim()).filter(t => t && t.length < 100).slice(0, 5);
      if (activeNav.length) parts.push('Active/selected: ' + activeNav.join(', '));
      const mainEl = document.querySelector('main,[role="main"],.main-content,#content,.content') || document.body;
      const mainText = (mainEl.innerText || mainEl.textContent || '').trim().slice(0, 1500);
      if (mainText) parts.push('Content:\n' + mainText);
      const pageSummary = parts.join('\n');
      chat.send('Explain what I\'m looking at on this page:\n\n' + pageSummary);
      onSwitch('chat');
    }
    return {onToolCall, onDone, attach, explainPage};
  }
  return {create};
})();
