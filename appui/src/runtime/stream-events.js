/* Incremental SSE framing; transport and payload handling belong to callers. */
const AppUIStreamEvents = (() => {
  function create(onEvent) {
    let line = '', event = '', data = [], skipLf = false, first = true, finished = false;

    function dispatch() {
      const frame = data.length ? {event: event || 'message', data: data.join('\n')} : null;
      event = '';
      data = [];
      if (frame) onEvent(frame);
    }

    function consumeLine() {
      const value = line;
      line = '';
      if (!value) { dispatch(); return; }
      if (value.startsWith(':')) return;
      const colon = value.indexOf(':');
      const field = colon < 0 ? value : value.slice(0, colon);
      let content = colon < 0 ? '' : value.slice(colon + 1);
      if (content.startsWith(' ')) content = content.slice(1);
      if (field === 'data') data.push(content);
      else if (field === 'event') event = content;
    }

    function push(text) {
      if (finished) throw new Error('Stream parser is finished');
      for (const char of String(text)) {
        if (first) { first = false; if (char === '\uFEFF') continue; }
        if (skipLf) { skipLf = false; if (char === '\n') continue; }
        if (char === '\r') { skipLf = true; consumeLine(); }
        else if (char === '\n') consumeLine();
        else line += char;
      }
    }

    function finish() {
      if (finished) return;
      finished = true;
      if (line) consumeLine();
      dispatch();
    }

    return {push, finish};
  }
  return {create};
})();
window.AppUIStreamEvents = AppUIStreamEvents;
