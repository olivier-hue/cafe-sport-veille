const CACHE = 'cdsb-v2';

// Mise en cache des assets au premier chargement
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(['/', '/index.html', '/manifest.json']))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => clients.claim())
  );
});

// Interception du share_target (POST /share)
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  if (url.pathname === '/share' && e.request.method === 'POST') {
    e.respondWith((async () => {
      const data = await e.request.formData();
      // L'URL partagée peut arriver dans "url", "text" ou "title"
      const shared = data.get('url') || data.get('text') || data.get('title') || '';
      const dest = '/?url=' + encodeURIComponent(shared.trim());
      return Response.redirect(dest, 303);
    })());
    return;
  }

  // Pour tout le reste : réseau d'abord, cache en fallback
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});
