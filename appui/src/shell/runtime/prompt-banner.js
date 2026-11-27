/* Global workflow prompts with restartable, owned reads, responses and presentation. */
(function () {
  'use strict';
  const API_BASE = '/api/workflows';
  const POLL_INTERVAL = 5000;
  let active = null;
  const idOf = (prompt) => String(prompt?.run_id ?? prompt?.id ?? '');
  const current = (context) => active === context && context.owner.current();

  async function render(context) {
    if (!current(context)) return;
    if (context.view) {
      context.view.render(context.prompts, context.states);
      return;
    }
    if (!context.prompts.length) return;
    if (!context.viewPromise) {
      context.viewPromise = AppUI.load('toolbar', 'collections')
        .then(() => {
          if (!current(context) || !context.prompts.length) return;
          const view = window._AppUIWorkflowPromptView.create({
            parent: context.owner,
            idOf,
            onRespond: (prompt, action, value, row) => respond(context, prompt, action, value, row),
            onDispose: () => {
              if (current(context)) context.owner.destroy();
            }
          });
          context.view = view;
          context.owner.add(view);
          view.render(context.prompts, context.states);
        })
        .catch((error) => {
          if (current(context)) console.warn('Workflow prompt controls unavailable:', error);
        })
        .finally(() => {
          context.viewPromise = null;
        });
    }
    return context.viewPromise;
  }
  function replacePrompts(context, prompts) {
    context.prompts = prompts;
    const present = new Set(prompts.map(idOf));
    for (const id of context.states.keys()) {
      if (!present.has(id)) {
        context.states.delete(id);
        context.responses.destroy(id);
      }
    }
  }
  async function poll(context) {
    if (!current(context)) return;
    const owner = context.reads.begin('pending');
    try {
      const response = await fetch(API_BASE + '/prompt/pending', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
        signal: owner.signal
      });
      if (!response.ok) return;
      const data = await response.json();
      if (!owner.current()) return;
      const prompts = Array.isArray(data.prompts) ? data.prompts : [];
      if (JSON.stringify(prompts.map(idOf)) !== JSON.stringify(context.prompts.map(idOf))) {
        replacePrompts(context, prompts);
        await render(context);
      } else if (!context.view && prompts.length) {
        // Retry optional controls after a transient asset-loading failure.
        await render(context);
      }
    } catch (error) {
      if (owner.current() && context.prompts.length) {
        replacePrompts(context, []);
        await render(context);
      }
    }
  }
  async function respond(context, prompt, action, value, row) {
    if (!current(context) || !row.current()) return;
    const id = idOf(prompt);
    if (context.states.has(id) || !context.prompts.some((item) => idOf(item) === id)) return;
    const owner = context.responses.begin(id, {
      isCurrent: () => current(context) && context.prompts.some((item) => idOf(item) === id)
    });
    context.reads.destroy('pending');
    context.states.set(id, { status: 'pending', action, value });
    render(context);
    try {
      // A submitted response may resume a workflow: complete it independently of UI reads.
      const response = await fetch(API_BASE + '/prompt/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action, value: value || '' })
      });
      const data = await response.json();
      if (!owner.current()) return;
      if (!response.ok || !data.ok) throw new Error(data._error || 'Response not accepted');
      context.states.set(id, { status: 'responded', action, value });
      await render(context);
      if (!(await AppUILifecycle.wait(owner, 1000)) || !owner.current()) return;
      replacePrompts(
        context,
        context.prompts.filter((item) => idOf(item) !== id)
      );
      context.states.delete(id);
      context.responses.destroy(id);
      await render(context);
    } catch (error) {
      if (owner.current()) {
        context.states.delete(id);
        context.responses.destroy(id);
        await render(context);
      }
    }
  }
  function connect(context) {
    if (
      !current(context) ||
      context.bus ||
      window.APPUI_BASE ||
      typeof window.AppUIEventBus !== 'function'
    )
      return;
    const bus = new window.AppUIEventBus(['workflows']);
    context.bus = bus;
    context.owner.add(() => {
      bus.close();
      if (context.bus === bus) context.bus = null;
    });
    bus.on('workflows', 'prompt', (prompt) => {
      if (
        !current(context) ||
        !prompt ||
        context.prompts.some((item) => idOf(item) === idOf(prompt))
      )
        return;
      context.prompts = [...context.prompts, prompt];
      render(context);
    });
  }
  async function connectLater(context) {
    if (await AppUILifecycle.wait(context.owner, 100)) connect(context);
  }
  function ensure() {
    if (active?.owner.current()) return active;
    const owner = AppUILifecycle.createViewScope();
    const context = {
      owner,
      prompts: [],
      states: new Map(),
      view: null,
      viewPromise: null,
      bus: null,
      poller: null,
      reads: AppUILifecycle.createKeyedScopes({ parent: owner }),
      responses: AppUILifecycle.createKeyedScopes({ parent: owner })
    };
    active = context;
    owner.add(context.reads);
    owner.add(context.responses);
    owner.add(() => {
      context.states.clear();
      if (active === context) active = null;
    });
    if (typeof window.AppUIEventBus === 'function') connect(context);
    else if (document.readyState === 'loading')
      owner.listen(document, 'DOMContentLoaded', () => connectLater(context), { once: true });
    else connectLater(context);
    return context;
  }
  function start() {
    const context = ensure();
    if (context.poller) return;
    const poller = AppUIPollRefresh.create(() => poll(context), POLL_INTERVAL, {
      refreshOnVisible: true
    });
    context.poller = poller;
    context.owner.add(poller);
    poller.start();
    poller.refresh();
  }
  function stop() {
    const context = active;
    active = null;
    context?.owner.destroy();
  }
  window.AppUIWorkflowPromptBanner = { start, stop, destroy: stop, poll: () => poll(ensure()) };
  ensure();
})();
