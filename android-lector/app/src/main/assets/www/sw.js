/**
 * SIGA-Comunitario • Service Worker PWA (Offline-First Real)
 */

const CACHE_NAME = 'siga-pwa-v17';
const STATIC_ASSETS = [
  './',
  './index.html',
  './login.html',
  './socios.html',
  './lecturas.html',
  './caja.html',
  './fondos.html',
  './reportes.html',
  './admin.html',
  './styles.css',
  './login.css',
  './fondos.css',
  './reportes.css',
  './admin.css',
  './auth.js',
  './shared-layout.js',
  './sweetalert.js',
  './socios.js',
  './lecturas.js',
  './caja.js',
  './fondos.js',
  './reportes.js',
  './admin.js',
  './manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Pre-cacheados activos estáticos');
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn('[SW] Algunos activos no pudieron ser cacheados:', err);
      });
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[SW] Eliminando caché antigua:', key);
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Ignorar peticiones que no sean GET
  if (event.request.method !== 'GET') return;

  // Peticiones de la API REST: Network-first con fallback
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request).catch(() => {
        return new Response(
          JSON.stringify({ error: 'Modo fuera de línea. La operación local se guardará en IndexedDB.' }),
          { headers: { 'Content-Type': 'application/json' }, status: 503 }
        );
      })
    );
    return;
  }

  // Activos estáticos (HTML, CSS, JS, imágenes): Stale-While-Revalidate
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const fetchPromise = fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseClone);
            });
          }
          return networkResponse;
        })
        .catch(() => cachedResponse);

      return cachedResponse || fetchPromise;
    })
  );
});
