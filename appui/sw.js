// AppUI service worker. Public entry point: /appui/sw.js
const CACHE_PREFIX = 'appui-runtime-';
const CACHE_NAME = CACHE_PREFIX + 'v12';
const PRECACHE = [
  '/appui/loader.js',
  '/appui/app.htm',
  '/appui/assets/styles/theme.css',
  '/appui/assets/styles/ui-components.css',
  '/appui/src/components/styles.css',
  '/appui/src/components/common-elements.css',
  '/appui/src/shell/styles.css',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => Promise.all(
    PRECACHE.map(url => fetch(url, {cache: 'no-cache'})
      .then(response => response.ok ? cache.put(url, response) : null)
      .catch(() => null))
  )).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map(key => caches.delete(key))
  )).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) return;
  const pathname = requestUrl.pathname;
  const isAppUIAsset = pathname.startsWith('/appui/');
  if (!isAppUIAsset) return;
  const cachePromise = caches.open(CACHE_NAME);
  const versioned = requestUrl.searchParams.has('v');
  const networkPromise = fetch(event.request).then(response => ({
    response,
    cacheCopy: response.ok ? response.clone() : null,
  }));
  // A versioned (?v=) asset is immutable: once it is in the offline cache, re-putting it on every load is pure
  // Cache Storage churn (ROUND3 #33). Unversioned ones keep being refreshed.
  event.waitUntil(Promise.all([cachePromise, networkPromise]).then(async ([cache, result]) => {
    if (!result.cacheCopy) return null;
    if (versioned && await cache.match(event.request)) return null;
    return cache.put(event.request, result.cacheCopy);
  }).catch(() => null));
  event.respondWith(networkPromise.then(result => result.response).catch(async () => {
    const cached = await (await cachePromise).match(event.request);
    if (cached) return cached;
    // Neither network nor cache could satisfy this /appui/ asset. Return a real
    // (error) Response instead of rethrowing — a thrown rejection surfaces as an
    // "Uncaught (in promise) TypeError: Failed to fetch" and a FetchEvent network
    // error, which is noisier than the underlying failure (usually a transient
    // offline/restart). The caller sees a 504 it can handle.
    return new Response('appui asset unavailable (offline?)', {
      status: 504, statusText: 'Gateway Timeout',
      headers: {'Content-Type': 'text/plain'},
    });
  }));
});
