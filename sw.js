/* Protech Resto · service worker
   - Archivos de la app: primero la red (así siempre llega la versión nueva) y, si no hay internet, la copia guardada.
   - Librerías externas (CDN): se guardan y se refrescan en segundo plano.
   - La base de datos (Supabase) nunca pasa por aquí. */
const V = 'resto-v6';
const BASE = ['./', 'index.html', 'app.js', 'app.css', 'soporte.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'];
const CDN = ['cdn.jsdelivr.net', 'cdnjs.cloudflare.com'];
self.addEventListener('install', e => { e.waitUntil(caches.open(V).then(c => c.addAll(BASE).catch(() => {})).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const r = e.request; if (r.method !== 'GET') return;
  const u = new URL(r.url);
  if (u.origin === location.origin) {
    if (u.pathname.endsWith('/pedir.html')) return;
    e.respondWith(fetch(r).then(res => { if (res.ok) { const cp = res.clone(); caches.open(V).then(c => c.put(r, cp)); } return res; }).catch(() => caches.match(r, { ignoreSearch: true }).then(m => m || caches.match('index.html'))));
  } else if (CDN.includes(u.hostname)) {
    e.respondWith(caches.open(V).then(c => c.match(r).then(m => { const red = fetch(r).then(res => { if (res.ok) c.put(r, res.clone()); return res; }).catch(() => m); return m || red; })));
  }
});

/* Avisos push: llegan aunque la app esté cerrada (anulaciones, descuentos). Al tocarlos se abre Resto. */
self.addEventListener('push', e => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch (x) { d = { cuerpo: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.titulo || 'Protech Resto', { body: d.cuerpo || '', tag: d.tag || 'resto', icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', vibrate: [200, 100, 200], requireInteraction: true, data: { url: d.url || './' } }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(l => { const c = l.find(w => 'focus' in w); return c ? c.focus() : self.clients.openWindow((e.notification.data && e.notification.data.url) || './'); }));
});
