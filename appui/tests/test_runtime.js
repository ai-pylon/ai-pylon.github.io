/* Run with node --test framework/appui/tests/test_runtime.js. No dependencies. */
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const source = file => fs.readFileSync(path.join(root, file), 'utf8');
function context(extra = {}) {
  const sandbox = {console, URL, URLSearchParams, AbortController, setTimeout, clearTimeout,
    performance, location: {href: 'https://example.test/', origin: 'https://example.test', search: ''}, ...extra};
  sandbox.window = sandbox;
  return vm.createContext(sandbox);
}

function worker({entries = new Map(), online = false} = {}) {
  const handlers = {}, deleted = [], tasks = [];
  const cache = {
    match: async request => entries.get(request.url),
    put: async (request, response) => entries.set(request.url, response),
  };
  const sandbox = context({Response, self: {location: {origin: 'https://example.test'},
    addEventListener: (type, callback) => {handlers[type] = callback;},
    clients: {claim: async () => {}}, skipWaiting: async () => {}},
    caches: {keys: async () => ['unrelated-cache', 'appui-other', 'appui-runtime-v11', 'appui-runtime-v12'],
      delete: async key => deleted.push(key), open: async () => cache},
    fetch: async () => {if (!online) throw new Error('offline'); return new Response('fresh');}});
  vm.runInContext(source('sw.js'), sandbox);
  return {handlers, deleted, tasks, request(url) {
    let response;
    handlers.fetch({request: {url, method: 'GET'}, waitUntil: task => tasks.push(task), respondWith: task => {response = task;}});
    return response;
  }};
}
test('worker activation preserves caches owned by other applications', async () => {
  const w = worker();
  await new Promise((resolve, reject) => w.handlers.activate({waitUntil: p => p.then(resolve, reject)}));
  assert.deepEqual(w.deleted, ['appui-runtime-v11']);
});
test('offline worker requires an exact asset URL, including version and variant', async () => {
  const url = 'https://example.test/appui/bundle/foundation.js?v=old&minify=1';
  const w = worker({entries: new Map([[url, new Response('old')]])});
  assert.equal(await (await w.request(url)).text(), 'old');
  assert.equal((await w.request(url.replace('v=old', 'v=new'))).status, 504);
  assert.equal((await w.request(url.replace('&minify=1', ''))).status, 504);
  assert.equal(w.request('https://other.test/appui/loader.js'), undefined);
  await Promise.all(w.tasks);
});

function api(fetch) {
  const sandbox = context({fetch});
  vm.runInContext(source('src/foundation/api.js'), sandbox);
  return sandbox.AppUIApi;
}
const reply = data => ({ok: true, status: 200, json: async () => data});
test('ambiguous job submission never invokes the operation directly', async () => {
  const calls = [];
  const client = api(async (url, opts) => {calls.push([url, JSON.parse(opts.body)]); throw new Error('connection lost');});
  const result = await client.runJob('example/app', 'change', {}, {idempotencyKey: 'retry-me'});
  assert.equal(result.ok, false);
  assert.equal(result.idempotency_key, 'retry-me');
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1].idempotency_key, 'retry-me');
});
test('explicitly missing work runner permits the compatibility fallback', async () => {
  const calls = [];
  const client = api(async url => {
    calls.push(url);
    return reply(url.endsWith('/submit') ? {ok: false, error: "app 'platform/work_runner' has no op 'submit'"} : {ok: true, value: 42});
  });
  assert.equal((await client.runJob('example/app', 'change')).value, 42);
  assert.equal(calls.length, 2);
});
test('timed-out submissions expose their key without executing or cancelling an unknown job', async () => {
  let calls = 0;
  const client = api(async (url, opts) => {
    calls++;
    return new Promise((resolve, reject) => opts.signal.addEventListener('abort', () =>
      reject(new DOMException('aborted', 'AbortError')), {once: true}));
  });
  const result = await client.runJob('example/app', 'change', {}, {timeout: 0.02, idempotencyKey: 'uncertain-submit'});
  assert.equal(result.code, 'timeout');
  assert.equal(result.idempotency_key, 'uncertain-submit');
  assert.equal(calls, 1);
});
test('job wait is bounded and cancellation aborts an in-flight request', async () => {
  let cancelled = 0, aborted = 0;
  const client = api(async (url, opts) => {
    if (url.endsWith('/submit')) return reply({ok: true, job: {id: 'j1'}});
    if (url.endsWith('/cancel')) {cancelled++; return reply({ok: true});}
    return new Promise((resolve, reject) => opts.signal.addEventListener('abort', () => {
      aborted++; reject(new DOMException('aborted', 'AbortError'));
    }, {once: true}));
  });
  const result = await client.runJob('example/app', 'change', {}, {timeout: 0.03});
  assert.equal(result.code, 'timeout');
  assert.equal(aborted, 1);
  assert.equal(cancelled, 1);
});
test('abort during polling sleep is prompt and removes the wait', async () => {
  const controller = new AbortController();
  const client = api(async url => reply(url.endsWith('/submit') ? {ok: true, job: {id: 'j2'}} : {ok: false, error: 'temporary failure'}));
  const pending = client.runJob('example/app', 'change', {}, {signal: controller.signal, pollMs: 10000});
  setTimeout(() => controller.abort(), 10);
  assert.equal((await pending).code, 'cancelled');
});
test('old runners without wait use get and return the completed result', async () => {
  const client = api(async url => reply(url.endsWith('/submit') ? {ok: true, job: {id: 'j3'}} :
    url.endsWith('/wait') ? {ok: false, error: "app 'platform/work_runner' has no op 'wait'"} :
      {ok: true, job: {status: 'done', op_result: {ok: true, answer: 42}}}));
  assert.equal((await client.runJob('example/app', 'change', {}, {pollMs: 0})).answer, 42);
});
test('pre-aborted jobs perform no submission', async () => {
  const controller = new AbortController(); controller.abort();
  const client = api(async () => {throw new Error('must not fetch');});
  assert.equal((await client.runJob('example/app', 'change', {}, {signal: controller.signal})).code, 'cancelled');
});
test('embed subscriptions can be disposed and reject unrelated messages', () => {
  const listeners = new Set();
  const sandbox = context({parent: {}, location: {search: '?embed=1', origin: 'https://example.test'},
    addEventListener: (type, callback) => listeners.add(callback),
    removeEventListener: (type, callback) => listeners.delete(callback)});
  vm.runInContext(source('src/index.js'), sandbox);
  let calls = 0;
  const unsubscribe = sandbox.AppUIEmbed.onCommand(() => calls++);
  const listener = [...listeners][0];
  listener({data: {type: 'appui:view-command'}, origin: 'https://attacker.test', source: sandbox.parent});
  listener({data: {type: 'appui:view-command'}, origin: 'https://example.test', source: sandbox.parent});
  assert.equal(calls, 1);
  unsubscribe(); unsubscribe();
  assert.equal(listeners.size, 0);
});
test('loader bounds diagnostic storage and exposes the effective asset version', async () => {
  const sandbox = context({navigator: {}, document: {baseURI: 'https://example.test/', currentScript: {src: 'https://example.test/appui/loader.js'},
    createElement: () => ({remove() {}}), head: {appendChild: element => queueMicrotask(() => element.onload?.())}}});
  // Observe the actual retained buffer, not just diagnostics()' sliced copy.
  const code = source('loader.js').replace('  var _loadEvents = [];', '  var _loadEvents = []; window.testEvents = _loadEvents;');
  vm.runInContext(code, sandbox);
  for (let i = 0; i < 250; i++) await sandbox.AppUIAssets.loadScript('/appui/test-' + i + '.js');
  assert.equal(sandbox.testEvents.length, 200);
  assert.equal(sandbox.AppUIAssets.diagnostics().events.length, 200);
  assert.ok(sandbox.AppUIAssets.diagnostics().assetVersion);
});

test('gateway-rewritten loader preserves prefixed AppUI asset and bundle paths', async () => {
  const {spawnSync} = require('node:child_process');
  const prefix = '/ejasung/pylon-server';
  const py = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
  const rewrite = spawnSync(py, ['-c',
    'import sys; from framework.aiweb.rewrite import rewrite_body; sys.stdout.write(rewrite_body(sys.stdin.read(), sys.argv[1]))', prefix],
    {cwd: path.resolve(root, '../..'), input: source('loader.js'), encoding: 'utf8'});
  assert.equal(rewrite.status, 0, rewrite.stderr);
  for (const base of [prefix + '/appui/', prefix + '/portable/appui/']) {
    const requests = [];
    const sandbox = context({APPUI_BASE: base, APPUI_ASSET_VERSION: 'test', navigator: {},
      document: {baseURI: 'https://example.test' + prefix + '/',
        createElement: () => ({remove() {}}), head: {appendChild(element) {
          requests.push(element.src); queueMicrotask(() => element.onload?.());
        }}}});
    vm.runInContext(rewrite.stdout, sandbox);
    assert.equal(sandbox.AppUIAssets.versioned(prefix + '/appui/src/foundation/storage.js'),
      base + 'src/foundation/storage.js?v=test');
    assert.equal(sandbox.AppUIAssets.versioned(prefix + '/appui/bundle/foundation.js'),
      base + 'bundle/foundation.js?v=test');
    await sandbox.AppUIAssets.loadScript(prefix + '/appui/src/foundation/storage.js');
    assert.deepEqual(requests, [base + 'src/foundation/storage.js?v=test']);
  }
});
