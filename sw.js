const VERSION = new Date().toISOString(); // cache busts automatically
const CORE = [
  './',
  './index.html',
  './quiz.html',
  './assets/css/quiz.css',
  './assets/js/quiz.js',
  './manifest.webmanifest',
  './data/manifest.json'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION).then(c => c.addAll(CORE)).then(()=>self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k=>k!==VERSION).map(k=>caches.delete(k)))))
  self.clients.claim();
});

// Cache-first for same-origin GETs; fills cache on demand (works for quiz JSON)
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    caches.match(req).then(res => res || fetch(req).then(net => {
      const copy = net.clone();
      caches.open(VERSION).then(c => c.put(req, copy)).catch(()=>{});
      return net;
    }).catch(()=>caches.match('./index.html')))
  );
});
