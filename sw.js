const CACHE_NAME = 'asistenciaspro-cache-v3'; // Nueva versión para forzar la actualización
const CDN_CACHE_NAME = 'cdn-cache-v1';

// Recursos locales a precachear (incluyendo el index y el script en la ruta corregida).
const ASSETS_TO_PRECACHE = [
  './', // Ruta raíz
  './index.html',
  './assets/js/app.js', // Asumiendo que el código JS está aquí (si lo separas del index.html)
  './manifest.json',
  // Puedes agregar aquí las rutas a tus iconos:
  './assets/icons/icon-192x192.png' 
];

// Evento de Instalación: Pre-cache de archivos locales
self.addEventListener('install', (e) => {
  console.log('[SW] Instalando y precacheando recursos locales...');
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        // Ejecutamos addAll con los archivos locales.
        return cache.addAll(ASSETS_TO_PRECACHE);
      })
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
      return Promise.all(keyList.map((key) => {
        if (key !== CACHE_NAME && key !== CDN_CACHE_NAME) {
          console.log('[SW] Eliminando caché antigua:', key);
          return caches.delete(key);
        }
      }));
    })
  );
  return self.clients.claim(); // Asegura que el SW tome control inmediatamente
});

// Evento de Fetch: Estrategia de "Cache Falling Back to Network" para locales y "Cache Only/Cache First" para CDNs
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // 1. Estrategia para CDNs (Tailwind, Lucide, Chart.js, Tesseract.js)
  // Usaremos Cache First para CDNs: si está en caché, lo usa; si no, lo descarga y lo guarda.
  if (url.origin === 'https://cdn.jsdelivr.net' || 
      url.origin === 'https://unpkg.com' ||
      url.origin === 'https://cdn.tailwindcss.com' ||
      url.origin === 'https://api.github.com' // Excluimos Gist Sync de la caché
      ) {
    
    // Dejamos que Gist Sync pase a la red directamente sin caché de Service Worker
    if (url.origin === 'https://api.github.com') {
        return; // No cacheamos la API de GitHub
    }

    e.respondWith(
      caches.open(CDN_CACHE_NAME).then((cache) => {
        return cache.match(e.request).then((response) => {
          // Si está en caché, lo devuelve
          if (response) {
            return response;
          }

          // Si no está, va a la red y lo guarda en caché
          return fetch(e.request).then((networkResponse) => {
            if (networkResponse.status === 200) {
              cache.put(e.request, networkResponse.clone());
            }
            return networkResponse;
          }).catch(() => {
            // Manejo de fallas de CDN, especialmente en modo offline
            return new Response('Error: CDN resource not found in cache and network failed.', {status: 503});
          });
        });
      })
    );
    return;
  }
  
  // 2. Estrategia para el resto de recursos (locales, incluyendo index.html)
  // Usamos Network Falling Back to Cache (para revalidación): intenta la red, si falla, usa el caché.
  e.respondWith(
    caches.match(e.request).then((cachedResponse) => {
      // Intenta usar la red para asegurar que siempre tienes la última versión (si estás online)
      return fetch(e.request).then((networkResponse) => {
        // Si tiene éxito, actualiza el caché y devuelve la respuesta de la red
        if (networkResponse.status === 200) {
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(e.request, networkResponse.clone());
          });
        }
        return networkResponse;
      }).catch(() => {
        // Si la red falla, devuelve el caché. Esto funciona excelente en modo offline.
        return cachedResponse;
      });
    })
  );
});
