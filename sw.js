const CACHE_NAME = 'asistenciaspro-cache-v4'; // Nueva versión para forzar la actualización
const CDN_CACHE_NAME = 'cdn-cache-v1';

// Recursos locales a precachear
const ASSETS_TO_PRECACHE = [
  './', // Ruta raíz
  './index.html',
  './assets/js/app.js',
  './manifest.json',
  './assets/icons/icon-192x192.png',
  './assets/icons/icon-144x144.png' // Agregado para evitar el 404 del manifest
];

// Evento de Instalación: Pre-cache de archivos locales
self.addEventListener('install', (e) => {
  console.log('[SW] Instalando y precacheando recursos locales...');
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS_TO_PRECACHE))
      .catch((error) => {
        console.error('[SW] Error al cachear ASSETS locales:', error);
      })
  );
});

// Evento de Activación: Limpia cachés antiguas
self.addEventListener('activate', (e) => {
  console.log('[SW] Activado. Limpiando cachés antiguas...');
  e.waitUntil(
    caches.keys().then((keyList) => {
      return Promise.all(
        keyList.map((key) => {
          if (key !== CACHE_NAME && key !== CDN_CACHE_NAME) {
            console.log('[SW] Eliminando caché antigua:', key);
            return caches.delete(key);
          }
        })
      );
    })
  );
  return self.clients.claim();
});

// Evento de Fetch
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // 1. Estrategia para CDNs
  if (
    url.origin === 'https://cdn.jsdelivr.net' ||
    url.origin === 'https://unpkg.com' ||
    url.origin === 'https://cdn.tailwindcss.com'
  ) {
    e.respondWith(
      caches.open(CDN_CACHE_NAME).then((cache) => {
        return cache.match(e.request).then((response) => {
          if (response) {
            return response;
          }
          return fetch(e.request).then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              cache.put(e.request, networkResponse.clone());
            }
            return networkResponse;
          }).catch(() => {
            return new Response(
              'Error: CDN resource not found in cache and network failed.',
              { status: 503 }
            );
          });
        });
      })
    );
    return;
  }

  // 2. Estrategia para recursos locales
  e.respondWith(
    caches.match(e.request).then((cachedResponse) => {
      return fetch(e.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone(); // Clonamos inmediatamente
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(e.request, responseToCache);
          });
        }
        return networkResponse;
      }).catch(() => {
        return cachedResponse;
      });
    })
  );
});
