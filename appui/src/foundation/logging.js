/* Shared structured logging. Deliberately does not intercept console or form data. */
(function () {
  'use strict';
  if (window.AppUILogger) return;
  let windowStart = Date.now(), sent = 0, routine = 0;
  const consoles = new Map();
  const source = location.pathname.replace(/^\/apps\//, '').split('/').filter(Boolean).slice(0, 2).join('/') || 'page';
  function send(level, name, message, fields) {
    if (Date.now() - windowStart >= 60000) {windowStart = Date.now(); sent = 0; routine = 0;}
    if (['debug', 'info'].includes(level) && ++routine > 20) return Promise.resolve(false);
    if (++sent > 60) return Promise.resolve(false);
    return fetch('/v1/log', {method: 'POST', credentials: 'same-origin', keepalive: true,
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({level, source: name, message: String(message ?? '').slice(0, 16000), fields: fields || {}})
    }).then(response => response.ok).catch(() => false);
  }
  function create(name = source) {
    return Object.fromEntries(['debug', 'info', 'warn', 'error', 'critical'].map(level =>
      [level, (message, fields) => send(level, name, message, fields)]));
  }
  // Opt-in console-compatible adapter: preserve local arguments, send bounded metadata.
  function consoleFor(name = source) {
    if (consoles.has(name)) return consoles.get(name);
    function summarize(value) {
      if (value instanceof Error) return value.name + ': ' + value.message;
      if (typeof value === 'string') return value.slice(0, 1000);
      if (value == null || ['number', 'boolean', 'bigint'].includes(typeof value)) return String(value);
      if (Array.isArray(value)) return '[Array(' + value.length + ')]';
      return '[object]';
    }
    const adapter = Object.fromEntries(['log', 'debug', 'info', 'warn', 'error'].map(method => [method, (...args) => {
      window.console?.[method]?.(...args);
      try {
        const error = args.find(value => value instanceof Error);
        return send(method === 'log' ? 'debug' : method, name, args.map(summarize).join(' '),
          error ? {stack: String(error.stack || '').slice(0, 12000)} : {});
      } catch (_) {return Promise.resolve(false);}
    }]));
    consoles.set(name, adapter);
    return adapter;
  }
  const api = Object.assign(create(), {create, console: consoleFor});
  window.AppUILogger = api;
  window.addEventListener('error', event => {
    if (event.message) api.error(event.message, {kind: 'uncaught', line: event.lineno,
      stack: event.error?.stack ? String(event.error.stack).slice(0, 12000) : ''});
  });
  window.addEventListener('unhandledrejection', event => {
    api.error(event.reason?.message || String(event.reason), {kind: 'unhandledrejection',
      stack: event.reason?.stack ? String(event.reason.stack).slice(0, 12000) : ''});
  });
})();
