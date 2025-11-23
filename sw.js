const CACHE_NAME = 'asistenciaspro-cache-v4';
const CDN_CACHE_NAME = 'cdn-cache-v1';

const ASSETS_TO_PRECACHE = [
  './',
  './index.html',
  './assets/js/app.js',
  './manifest.json',
  './assets/icons/icon-192x192.png',
  './assets/icons/icon-144x144.png'
];

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

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // CDN strategy
  if (
    url.origin === 'https://cdn.jsdelivr.net' ||
    url.origin === 'https://unpkg.com' ||
    url.origin === 'https://cdn.tailwindcss.com'
  ) {
    e.respondWith(handleCDNRequest(e.request));
    return;
  }

  // Local assets strategy
  e.respondWith(handleLocalRequest(e.request, e));
});

async function handleCDNRequest(request) {
  const cache = await caches.open(CDN_CACHE_NAME);
  const cachedResponse = await cache.match(request);
  if (cachedResponse) {
    return cachedResponse;
  }
  try {
    const networkResponse = await fetch(request);
    if (networkResponse && networkResponse.status === 200) {
      // Clonar antes de usarla para cachear
      const responseClone = networkResponse.clone();
      cache.put(request, responseClone);
    }
    return networkResponse;
  } catch (err) {
    return new Response(
      'Error: CDN resource not found in cache and network failed.',
      { status: 503 }
    );
  }
}

async function handleLocalRequest(request, event) {
  const cachedResponse = await caches.match(request);
  try {
    const networkResponse = await fetch(request);
    if (networkResponse && networkResponse.status === 200) {
      // Clonamos para cachear antes de dar la respuesta al cliente
      const responseToCache = networkResponse.clone();
      const cache = await caches.open(CACHE_NAME);
      // Use event.waitUntil para evitar que el Service Worker muera antes de cachear
      event.waitUntil(cache.put(request, responseToCache));
    }
    return networkResponse;
  } catch (err) {
    // Si falla la red, devolvemos lo cacheado si existe
    if (cachedResponse) {
      return cachedResponse;
    }
    // Aquí puedes decidir devolver un fallback si nada
    return new Response('Offline y recurso no encontrado.', { status: 504 });
  }
}
