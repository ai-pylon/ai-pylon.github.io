/* Chat queue, interruption and steering controls shared by AppUICore consumers. */
window._AppUICoreSteering = {
  /**
   * Queue a message to send after current LLM turn completes.
   * @param {string} message
   * @param {object} opts - {endpoint: '/chat/steer'}
   */
  queue(message, opts = {}) {
    const endpoint = opts.endpoint || `/api/llm/${opts.backend || 'kiro'}/chat/steer`;
    fetch(endpoint, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({message})
    }).catch(() => {});
  },

  /**
   * Interrupt current generation (abort controller) and re-send.
   * @param {AbortController} controller - the active abort controller
   * @param {function} sendFn - function to call with the message
   * @param {string} message
   * @returns {ReturnType<typeof setTimeout>} Handle callers can cancel with clearTimeout.
   */
  interrupt(controller, sendFn, message) {
    if (controller) try { controller.abort(); } catch(e) {}
    return setTimeout(() => sendFn(message), 200);
  },

  /**
   * Create queue/interrupt buttons for a chat input area.
   * @param {object} opts - {onQueue, onInterrupt, container}
   * @returns {HTMLElement} the button group
   */
  createButtons(opts = {}) {
    const el = document.createElement('span');
    el.className = 'ui-steer-btns';
    el.innerHTML = `<button class="ui-steer-queue" title="Queue (send after done)" style="padding:2px 6px;background:var(--bg-elevated);border:1px solid var(--color-warning);color:var(--color-warning);border-radius:3px;cursor:pointer;font-size:11px;margin-right:3px">⏭</button><button class="ui-steer-interrupt" title="Interrupt (abort + send now)" style="padding:2px 6px;background:var(--bg-elevated);border:1px solid var(--color-error);color:var(--color-error);border-radius:3px;cursor:pointer;font-size:11px">⏹</button>`;
    if (opts.onQueue) el.querySelector('.ui-steer-queue').onclick = opts.onQueue;
    if (opts.onInterrupt) el.querySelector('.ui-steer-interrupt').onclick = opts.onInterrupt;
    if (opts.container) opts.container.appendChild(el);
    return el;
  },

  /**
   * Remove steering buttons.
   * @param {HTMLElement} el - the button group from createButtons
   */
  removeButtons(el) {
    if (el) el.remove();
  }
};
