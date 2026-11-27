// Compatibility entry point for pages that still include /appui/lib/logger.js.
(function () {
  let ready;
  function load() {
    if (window.AppUILogger) return Promise.resolve(window.AppUILogger);
    if (!ready) ready = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = '/appui/src/foundation/logging.js';
      script.onload = () => resolve(window.AppUILogger);
      script.onerror = reject;
      document.head.appendChild(script);
    });
    return ready;
  }
  window.logger = Object.fromEntries(['debug', 'info', 'warn', 'error'].map(level =>
    [level, (message, fields) => load().then(log => log[level](message, fields)).catch(() => false)]));
})();
