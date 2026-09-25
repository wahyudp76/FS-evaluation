// PG2 Irrigation Dashboard - Service Worker (PWA)
// v1.8.0 — strategi cache dipisah: app shell (network-first) vs aset statis/vendor (cache-first)
const VERSION = 'v1.8.0';
const CACHE_NAME = 'pg2-irrigation-' + VERSION;
const RUNTIME_CACHE = 'pg2-runtime-' + VERSION;

const SHELL = ['./', './index.html', './app.js', './manifest.json'];

const STATIC_ASSETS = [
  './assets/favicon.ico',
  './assets/favicon.svg',
  './assets/favicon-16.png',
  './assets/favicon-32.png',
  './assets/logo-white-192.png',
  './assets/logo-white-512.png',
  './assets/apple-touch-icon.png',
  './assets/icon-72.png',
  './assets/icon-96.png',
  './assets/icon-128.png',
  './assets/icon-144.png',
  './assets/icon-152.png',
  './assets/icon-192.png',
  './assets/icon-384.png',
  './assets/icon-512.png',
  './assets/icon-maskable-192.png',
  './assets/icon-maskable-512.png'
];

// Install — precache, tapi jangan gagal total kalau satu file hilang
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(
        SHELL.concat(STATIC_ASSETS).map((url) =>
          cache.add(url).catch((err) => console.warn('[sw] gagal precache', url, err))
        )
      )
    )
  );
  self.skipWaiting();
});

// Activate — hapus cache versi lama
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.map((n) => (n === CACHE_NAME || n === RUNTIME_CACHE ? null : caches.delete(n))))
    )
  );
  self.clients.claim();
});

// Simpan respons ke cache (hanya GET + status ok)
function putInCache(cacheName, request, response) {
  if (!response || response.status !== 200 || request.method !== 'GET') return response;
  const clone = response.clone();
  caches.open(cacheName).then((cache) => cache.put(request, clone)).catch(() => {});
  return response;
}

// Cache-first + revalidate di belakang (aset statis/ikon/CDN: cepat & tetap segar)
function staleWhileRevalidate(event, cacheName) {
  return caches.match(event.request).then((cached) => {
    const network = fetch(event.request)
      .then((res) => putInCache(cacheName, event.request, res))
      .catch(() => null);
    if (cached) {
      event.waitUntil(network);
      return cached;
    }
    return network.then((res) => res || (event.request.mode === 'navigate' ? caches.match('./index.html') : Response.error()));
  });
}

// Network-first: app shell selalu versi terbaru, fallback ke cache saat offline
function networkFirst(event, cacheName) {
  return fetch(event.request)
    .then((res) => putInCache(cacheName, event.request, res))
    .catch(() =>
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        if (event.request.mode === 'navigate') return caches.match('./index.html');
        return Response.error();
      })
    );
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch (e) {
    return;
  }

  // Spreadsheet / API Google — selalu jaringan, jangan pernah di-cache di sini
  // (data sudah ditangani sendiri oleh app.js lewat Cache Storage 'pg2-data-v1')
  if (url.hostname.endsWith('docs.google.com') || url.hostname.endsWith('google.com') || url.hostname.endsWith('googleusercontent.com')) {
    return;
  }

  // Halaman & skrip inti: network-first (update langsung terpakai, offline tetap jalan)
  if (request.mode === 'navigate' || (url.origin === self.location.origin && /\/(index\.html|app\.js)$/.test(url.pathname))) {
    event.respondWith(networkFirst(event, CACHE_NAME));
    return;
  }

  // Aset statis milik sendiri: cache-first + revalidate
  if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(event, CACHE_NAME));
    return;
  }

  // Font & library CDN (versi sudah dipin): cache-first + revalidate
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com' || url.hostname === 'cdn.jsdelivr.net' || url.hostname === 'unpkg.com') {
    event.respondWith(staleWhileRevalidate(event, RUNTIME_CACHE));
    return;
  }
  // sisanya: biarkan browser menangani
});
