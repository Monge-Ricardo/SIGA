/**
 * SIGA-Comunitario • Service Worker PWA (Offline-First Real)
 */

const CACHE_NAME = 'siga-pwa-v64';
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
  './app.js',
  './auth.js',
  './socios.js',
  './lecturas.js',
  './caja.js',
  './fondos.js',
  './reportes.js',
  './admin.js',
  './shared-layout.js',
  './sync-engine.js',
  './sweetalert.js',
  './offline_seed.json',
  './manifest.json',
  './icon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      console.log('[SW] Pre-cacheando cascarón de la aplicación...');
      await Promise.allSettled(
        STATIC_ASSETS.map((asset) =>
          cache.add(asset).catch((err) => {
            console.warn(`[SW] Aviso: No se pudo pre-cachear ${asset}:`, err.message || err);
          })
        )
      );
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key.startsWith('siga-pwa-') && key !== CACHE_NAME) {
            console.log('[SW] Eliminando caché antigua:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  // Ignorar peticiones que no sean GET
  if (event.request.method !== 'GET') return;

  // Solo gestionar esquemas http: y https: (ignorar chrome-extension://, file://, etc.)
  if (!event.request.url.startsWith('http://') && !event.request.url.startsWith('https://')) {
    return;
  }

  const url = new URL(event.request.url);

  // Peticiones de la API REST: Network-first con fallback
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request).catch(() => {
        return new Response(
          JSON.stringify({ error: 'Modo fuera de línea. La operación se procesará localmente.' }),
          { headers: { 'Content-Type': 'application/json' }, status: 503 }
        );
      })
    );
    return;
  }

  // Activos de código y vistas (JS, HTML, CSS): Network-First con fallback resiliente
  const isCodeAsset = url.pathname.endsWith('.js') || url.pathname.endsWith('.html') || url.pathname.endsWith('.css') || url.pathname === '/' || url.pathname.endsWith('/');

  if (isCodeAsset) {
    event.respondWith(
      (async () => {
        // 1. Intentar red primero
        try {
          const networkResponse = await fetch(event.request);
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseClone).catch(() => {});
            }).catch(() => {});
          }
          return networkResponse;
        } catch {
          // Si falló la red, continuar a la búsqueda en caché y reintentos
        }

        // 2. Buscar en todos los cachés disponibles
        let cached = await caches.match(event.request, { ignoreSearch: true });
        if (cached) return cached;

        const filename = url.pathname.split('/').pop() || 'index.html';
        cached = await caches.match('./' + filename, { ignoreSearch: true }) ||
                 await caches.match('/' + filename, { ignoreSearch: true }) ||
                 await caches.match(filename, { ignoreSearch: true }) ||
                 await caches.match('.' + url.pathname, { ignoreSearch: true });
        if (cached) return cached;

        // 3. Reintentos breves de red por si el servidor local estaba reiniciando
        for (const delay of [250, 600, 1000]) {
          try {
            await new Promise((r) => setTimeout(r, delay));
            const retryRes = await fetch(event.request);
            if (retryRes && retryRes.status === 200) {
              const clone = retryRes.clone();
              caches.open(CACHE_NAME).then((c) => c.put(event.request, clone)).catch(() => {});
              return retryRes;
            }
          } catch {
            // Seguir reintentando
          }
        }

        // 4. Si es una navegación HTML y tanto red como caché fallaron, mostrar pantalla amigable de auto-reconexión (Status 200, no 503)
        if (event.request.mode === 'navigate' || url.pathname.endsWith('.html')) {
          const htmlFallback = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reconectando SIGA...</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f8fafc; color: #0f172a; text-align: center; padding: 1.5rem; }
    .card { background: white; padding: 2rem; border-radius: 16px; box-shadow: 0 10px 25px rgba(0,0,0,0.06); max-width: 420px; width: 100%; border: 1px solid #e2e8f0; }
    .spinner { width: 36px; height: 36px; border: 3px solid #e2e8f0; border-top-color: #0284c7; border-radius: 50%; animation: spin 0.8s linear infinite; margin: 0 auto 1.25rem; }
    @keyframes spin { to { transform: rotate(360deg); } }
    h2 { font-size: 1.2rem; margin: 0 0 0.5rem; color: #0369a1; }
    p { font-size: 0.88rem; color: #64748b; margin: 0 0 1.25rem; line-height: 1.4; }
    .btn { background: #0284c7; color: white; border: none; padding: 0.65rem 1.25rem; border-radius: 8px; font-weight: 600; cursor: pointer; }
  </style>
</head>
<body>
  <div class="card">
    <div class="spinner"></div>
    <h2>Reconectando con SIGA</h2>
    <p>El servidor se está restableciendo. La pantalla se actualizará automáticamente en unos instantes.</p>
    <button class="btn" onclick="location.reload()">Reintentar Ahora</button>
  </div>
  <script>setTimeout(() => location.reload(), 1500);</script>
</body>
</html>`;
          return new Response(htmlFallback, {
            status: 200,
            headers: { 'Content-Type': 'text/html; charset=utf-8' }
          });
        }

        // Para scripts o estilos, retornar respuesta vacía en vez de romper la ejecución con 503
        return new Response('', { status: 200, headers: { 'Content-Type': 'text/plain' } });
      })()
    );
    return;
  }

  // Demás activos estáticos (imágenes, fuentes, json): Cache-First con actualización de fondo
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const fetchPromise = fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseClone).catch(() => {});
            }).catch(() => {});
          }
          return networkResponse;
        })
        .catch(() => cachedResponse);

      return cachedResponse || fetchPromise;
    })
  );
});
