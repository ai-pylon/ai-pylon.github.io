/**
 * AppUI Debug Accessibility Layer
 * 
 * Automatically tags all interactive elements with data-aid (automation ID)
 * attributes so that LLMs and CDP can find and interact with them reliably.
 *
 * Load this AFTER AppUI. It will:
 * 1. Tag all buttons, inputs, textareas, links with data-aid="<descriptive-id>"
 * 2. Expose window.AppUIDebug with helper methods for element discovery
 * 3. Provide a describe() function that returns a JSON map of all interactive elements
 * 4. Auto-update when DOM changes (MutationObserver)
 *
 * Usage by LLM/CDP:
 *   // Find element
 *   document.querySelector('[data-aid="chat-send"]')
 *   // Or via helper
 *   window.AppUIDebug.find('chat-send')
 *   // List all interactive elements
 *   window.AppUIDebug.describe()
 *   // Interact
 *   window.AppUIDebug.click('chat-send')
 *   window.AppUIDebug.type('chat-input', 'hello')
 *   window.AppUIDebug.value('chat-input')  // read current value
 */
(function() {
  const {tagAll,describe,find,click,type,value,submit,listInteractive}=window._AppUIDebugDOM.create();

  // Auto-tag on DOM changes
  var _debounceTimer = null;
  var observer = new MutationObserver(function() {
    if (_debounceTimer) clearTimeout(_debounceTimer);
    _debounceTimer = setTimeout(tagAll, 500);
  });

  // Start observing after page load
  if (document.readyState === 'complete') {
    tagAll();
    observer.observe(document.body, {childList: true, subtree: true});
  } else {
    window.addEventListener('load', function() {
      tagAll();
      observer.observe(document.body, {childList: true, subtree: true});
    });
  }

  // Expose API
  window.AppUIDebug = {
    tagAll: tagAll,
    describe: describe,
    find: find,
    click: click,
    type: type,
    value: value,
    submit: submit,
    list: listInteractive,
    // Convenience: find all chat-related elements
    chat: function() { return listInteractive('chat'); },
    // Send a chat message (bypasses internal state issues with synthetic events)
    sendChat: function(prompt, opts) {
      opts = opts || {};
      var backend = opts.backend || localStorage.getItem('ai-chat-backend') || 'ericai';
      var model = opts.model || localStorage.getItem('ai-chat-model') || '';
      var system = opts.system || 'You are a helpful AI assistant.';
      var tools = opts.tools || [];
      var timeout = opts.timeout || 15000;
      var body = {prompt: prompt, backend: backend, model: model, system: system};
      if (tools.length) body.tools = tools;
      return new Promise(function(resolve) {
        var resolved = false;
        var events = [];
        var fullText = '';
        
        // Timeout fallback
        var timer = setTimeout(function() {
          if (!resolved) { resolved = true; resolve({events: events, text: fullText, timeout: true}); }
        }, timeout);
        
        fetch((window.AI_LLM_URL || '/llm') + '/' + backend + '/chat/stream', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify(body)
        }).then(function(resp) {
          var reader = resp.body.getReader();
          var decoder = new TextDecoder();
          var buffer = '';
          function read() {
            reader.read().then(function(result) {
              if (result.done || resolved) { 
                if (!resolved) { resolved = true; clearTimeout(timer); resolve({events: events, text: fullText}); }
                return; 
              }
              buffer += decoder.decode(result.value, {stream: true});
              var lines = buffer.split('\n');
              buffer = lines.pop();
              var done = false;
              lines.forEach(function(line) {
                if (line.startsWith('event: done')) done = true;
                else if (line.startsWith('event: ')) events.push({type: 'event', name: line.substring(7)});
                else if (line.startsWith('data: ')) {
                  var d = line.substring(6);
                  try {
                    var parsed = JSON.parse(d);
                    if (typeof parsed === 'string') { fullText += parsed; events.push({type:'token', value: parsed}); }
                    else events.push({type: 'data', value: parsed});
                  } catch(e) { events.push({type: 'raw', value: d}); }
                }
              });
              if (done) { 
                if (!resolved) { resolved = true; clearTimeout(timer); try{reader.cancel();}catch(e){} resolve({events: events, text: fullText}); }
                return; 
              }
              read();
            }).catch(function(e) { 
              if (!resolved) { resolved = true; clearTimeout(timer); resolve({events: events, text: fullText, error: e.message}); }
            });
          }
          read();
        }).catch(function(e) { 
          if (!resolved) { resolved = true; clearTimeout(timer); resolve({error: e.message}); }
        });
      });
    },
    // Quick status
    status: function() {
      return {
        tagged: document.querySelectorAll('[data-aid]').length,
        visible: describe().length,
        page: document.body.dataset.pageId || 'unknown',
      };
    }
  };

  console.log('[AppUIDebug] Accessibility layer loaded. Use window.AppUIDebug.describe() or AppUIDebug.list()');
})();
