/**
 * AppUIAIPipeline  --  unified AI pipeline framework.
 *
 * Combines: routing (cheap LLM) -> context assembly (parallel fetch) -> execution -> feedback loop
 *
 * Pages just register commands + context sources, the pipeline handles everything.
 *
 * Usage:
 *   const pipeline = AppUIAIPipeline.create({
 *     chat: myChatInstance,
 *     promptTemplate: 'doc_studio',  // loads from config/prompts/<name>.txt
 *     models: ['qwen3-coder-next', 'minimax-m2.1', 'claude-haiku-4.5'],  // auto-escalate
 *   });
 *
 *   // Register commands
 *   pipeline.command('select', {desc: 'Navigate to chapter', exec: (arg) => selectChapter(arg)});
 *   pipeline.command('fill', {desc: 'AI generate content', exec: (arg, ctx) => aiFill(arg, ctx), needsContext: true});
 *   pipeline.command('save', {desc: 'Save session', exec: () => saveSession()});
 *   pipeline.command('clear', {desc: 'Clear content', exec: () => clear(), destructive: true});
 *
 *   // Register context sources
 *   pipeline.source('chapter_content', {cost:'free', desc:'...', index:()=>[...], fetch:(ids)=>Promise});
 *   pipeline.source('files', {cost:'medium', desc:'...', fetch:(paths)=>Promise});
 *
 *   // Process user input
 *   pipeline.run("select chapter 3.2 and fill it based on other chapters");
 *
 *   // Observability
 *   pipeline.onStep((step) => console.log(step));  // {type, data, ms}
 */
const AppUIAIPipeline = (function() {

  const DEFAULT_MODELS = ['qwen3-coder-next', 'minimax-m2.1', 'claude-haiku-4.5'];
  const LLM_URL = '/api/llm/kiro/chat';

  function create(opts) {
    opts = Object.assign({
      chat: null,
      models: DEFAULT_MODELS,
      backend: 'kiro',
      llmUrl: LLM_URL,
      promptTemplate: null,  // config name or inline string
      state: () => ({}),
      maxFeedbackLoops: 3,
    }, opts);

    const _commands = Object.create(null); // {name: {desc, exec, needsContext, destructive}}
    const _sources = Object.create(null);  // {name: {cost, desc, index, fetch}}
    const _observers = [];     // callbacks for observability
    const _cache = Object.create(null);    // {key: {data, ts}}
    const CACHE_TTL = 30000;
    const {load:_loadPromptTemplate,build:_buildSystemPrompt}=window._AppUIAIPipelinePrompts.create({
      opts,commands:_commands,sources:_sources,
    });

    // --- Command Registry ---
    function command(name, def) {
      _commands[name] = Object.assign({desc: '', exec: null, needsContext: false, destructive: false}, def);
    }

    // --- Source Registry ---
    function source(name, def) {
      _sources[name] = Object.assign({cost: 'free', desc: '', index: null, fetch: null}, def);
    }

    // --- Observability ---
    function onStep(cb) { _observers.push(cb); }
    function _emit(step) { _observers.forEach(cb => { try { cb(step); } catch {} }); }

    // --- Call LLM with auto-escalation ---
    async function _callLLM(prompt, system) {
      for (const model of opts.models) {
        const t0 = Date.now();
        try {
          const resp = await fetch(opts.llmUrl, {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({prompt, system, backend: opts.backend, model}),
          });
          const data = await resp.json();
          const parsed = AppUITextUtils.parseJsonObject(data.response || data.content || '');
          const ms = Date.now() - t0;

          // Try to parse JSON
          if (parsed) {
            _emit({type: 'route', model, ms, plan: parsed});
            return parsed;
          }
          // Parse failed  --  escalate to next model
          _emit({type: 'escalate', from: model, reason: 'no valid JSON', ms});
        } catch (e) {
          _emit({type: 'escalate', from: model, reason: e.message, ms: Date.now() - t0});
        }
      }
      return null;  // all models failed
    }

    // --- Fetch context (parallel, cached) ---
    async function _fetchContext(contextPlan) {
      const t0 = Date.now();
      let result = '';
      const promises = [];

      for (const [name, items] of Object.entries(contextPlan)) {
        if (!items || (Array.isArray(items) && !items.length)) continue;
        const src = _sources[name];
        if (!src || !src.fetch) continue;

        const fetchItems = items === true ? [] : (Array.isArray(items) ? items.slice(0, 7) : [items]);

        // Check cache
        const cacheKey = name + ':' + JSON.stringify(fetchItems);
        if (_cache[cacheKey] && Date.now() - _cache[cacheKey].ts < CACHE_TTL) {
          result += _cache[cacheKey].data;
          continue;
        }

        promises.push(
          Promise.resolve(src.fetch(fetchItems)).then(data => {
            let text = '';
            if (typeof data === 'string') text = data ? `\n[${name}]\n${data}\n` : '';
            else if (typeof data === 'object') {
              const entries = Object.entries(data).filter(([k, v]) => v);
              if (entries.length) {
                text = `\n[${name}]\n` + entries.map(([k, v]) => `${k}: ${typeof v === 'string' ? v.substring(0, 1000) : JSON.stringify(v).substring(0, 500)}`).join('\n') + '\n';
              }
            }
            if (text) { _cache[cacheKey] = {data: text, ts: Date.now()}; result += text; }
          }).catch(() => {})
        );
      }

      await Promise.all(promises);
      _emit({type: 'context', ms: Date.now() - t0, sources: Object.keys(contextPlan).filter(k => contextPlan[k] && (!Array.isArray(contextPlan[k]) || contextPlan[k].length))});
      return result;
    }

    // --- Execute commands ---
    async function _execute(commands, context) {
      for (const cmd of commands) {
        const c = cmd.cmd || cmd.command || '';
        const arg = cmd.arg || cmd.argument || '';
        const def = _commands[c];

        if (!def) {
          // Unknown command  --  send to chat
          if (opts.chat) opts.chat.send(arg || c);
          _emit({type: 'exec', cmd: c, status: 'unknown'});
          continue;
        }

        const t0 = Date.now();
        try {
          if (def.needsContext) {
            await def.exec(arg, context);
          } else {
            await def.exec(arg);
          }
          _emit({type: 'exec', cmd: c, arg, status: 'ok', ms: Date.now() - t0});
        } catch (e) {
          _emit({type: 'exec', cmd: c, arg, status: 'error', error: e.message, ms: Date.now() - t0});
        }
        await new Promise(r => setTimeout(r, 150));
      }
    }

    // --- Main entry: process user input ---
    async function run(msg) {
      const t0 = Date.now();
      _emit({type: 'start', msg});

      // Load prompt template if needed
      await _loadPromptTemplate();

      // Build system prompt
      const state = typeof opts.state === 'function' ? opts.state() : opts.state;
      const system = _buildSystemPrompt(state);

      // Route (with auto-escalation)
      const plan = await _callLLM(msg, system);
      if (!plan) {
        // All models failed  --  send to chat directly
        if (opts.chat) opts.chat.send(msg);
        _emit({type: 'fallback', reason: 'all models failed', ms: Date.now() - t0});
        return;
      }

      // Safety confirmation
      if (plan.confirm) {
        if (!await window.AppUIDialog.confirmAsync('This action may modify/delete content. Proceed?', {signal:opts.signal})) {
          _emit({type: 'cancelled', ms: Date.now() - t0});
          return;
        }
      }

      // Fetch context (parallel)
      let context = '';
      if (plan.context) {
        context = await _fetchContext(plan.context);
      }

      // Execute commands
      await _execute(plan.commands || [], context);

      _emit({type: 'done', ms: Date.now() - t0, commands: (plan.commands || []).length});
    }

    // --- Public API ---
    return {
      run,
      command,
      source,
      onStep,
      getCommands: () => ({..._commands}),
      getSources: () => ({..._sources}),
      clearCache: () => { Object.keys(_cache).forEach(k => delete _cache[k]); },
    };
  }

  return { create };
})();
window.AppUIAIPipeline = AppUIAIPipeline;
