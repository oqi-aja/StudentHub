// sw.js - StudentHub Service Worker for Offline PWA
// ponytail: Cache-First for local static assets, skip live Supabase calls.

const CACHE_NAME = 'studenthub-v1';
const STATIC_ASSETS = [
  './',
  './index.html',
  './style.css',
  './script.js',
  './manifest.json',
  './data/contoh.json',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './pages/home.html',
  './pages/login.html',
  './pages/daftar-tugas.html',
  './pages/detail-tugas.html',
  './pages/jadwal.html',
  './pages/catatan.html',
  './pages/profil.html',
  './pages/kelola-akun.html',
  './pages/tugas.html',
  './js/auth.js',
  './js/dashboard.js',
  './js/daftar-tugas.js',
  './js/detail-tugas.js',
  './js/jadwal.js',
  './js/catatan.js',
  './js/profil.js',
  './js/kelola-akun.js',
  './js/file-manager.js',
  './js/api.js',
  './js/config.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((k) => (k !== CACHE_NAME ? caches.delete(k) : null))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // Bypass external API calls (mis. Supabase REST/Storage)
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((response) => {
          if (!response || response.status !== 200 || response.type !== 'basic') {
            return response;
          }
          const toCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, toCache));
          return response;
        })
        .catch(() => {
          if (req.mode === 'navigate') {
            return caches.match('./index.html');
          }
        });
    })
  );
});
