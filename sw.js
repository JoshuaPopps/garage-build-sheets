/* Garage Build Sheets — service worker.
 * Cache-first for the app shell so the garage works offline in the
 * shop. Version lives in the cache name; bump it on every release. */
var CACHE_NAME = 'garage-build-sheets-v8';
var ASSETS = [
  './',
  './index.html',
  './styles.css',
  './store.js',
  './app.js',
  './manifest.webmanifest',
    './icons/icon-192.png',
  './icons/icon-512.png'
];
self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) { return cache.addAll(ASSETS); })
      .then(function () { return self.skipWaiting(); })
  );
});
self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE_NAME; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});
self.addEventListener('fetch', function (event) {
  if (event.request.method !== 'GET') return;
  var url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return; /* Google Fonts etc. pass through */
  event.respondWith(
    caches.match(event.request).then(function (cached) {
      if (cached) return cached;
      return fetch(event.request).then(function (resp) {
        if (resp && resp.ok) {
          var copy = resp.clone();
          caches.open(CACHE_NAME).then(function (cache) { cache.put(event.request, copy); });
        }
        return resp;
      });
    })
  );
});
