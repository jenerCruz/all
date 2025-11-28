// sw.js - cache strategy minimalista
const CACHE_NAME = 'asistencias-pro-static-v1';
const STATIC_FILES = [
  '/', // index
  // añade aquí rutas estáticas si quieres: '/assets/css/main.css', '/assets/js/evidence-module.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_FILES))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // No cacheamos uploads o imágenes grandes: si es petición de imagen a data: skip
  if (req.method !== 'GET') return;

  // For API/Gist requests prefer network-first
  if (url.hostname.includes('api.github.com') || url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(req).catch(() => caches.match(req))
    );
    return;
  }

  // Static assets: cache-first
  event.respondWith(
    caches.match(req).then(cached => cached || fetch(req).then(resp => {
      // Only cache same-origin static GET (avoid caching images from uploads)
      if (resp && resp.type === 'basic' && resp.status === 200 && req.destination !== 'image') {
        caches.open(CACHE_NAME).then(cache => cache.put(req, resp.clone()));
      }
      return resp;
    }).catch(() => {
      // fallback if needed
      return caches.match('/');
    }))
  );
});