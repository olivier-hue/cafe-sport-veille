const CACHE = 'cdsb-v3';

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

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  if (url.pathname === '/share' && e.request.method === 'POST') {
    e.respondWith((async () => {
      const data = await e.request.formData();
      const shared = data.get('url') || data.get('text') || data.get('title') || '';
      const dest = '/?url=' + encodeURIComponent(shared.trim());
      return Response.redirect(dest, 303);
    })());
    return;
  }

  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});
