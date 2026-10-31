// SVGcinema — the editor's service worker (registered by app/pwa in a production build): the editor works
// offline once it has been opened, and the installed app (PWA, Microsoft Store) opens without the network.
// - install: caches the app shell, the files sw-precache.json lists (the build writes it: index.html, the
//   scripts and styles, icons; not the image encoders, the help clips or the downloads);
// - pages: network first (so an update shows at once), the cache when offline;
// - other files of the editor and the fonts: from the cache, refreshed in the background; files fetched
//   later (the image encoders, help clips' posters) are kept once used. Videos and downloads aren't kept.
// Each build has its own cache; the old ones are removed when the new worker takes over.
let CACHE = 'svgcinema';
const ready = fetch('sw-precache.json', { cache: 'no-store' })
  .then(r => r.json())
  .then(p => ((CACHE = 'svgcinema-' + p.build), p))
  .catch(() => ({ build: '', files: [] }));

self.addEventListener('install', e => {
  e.waitUntil(
    ready
      .then(p => caches.open(CACHE).then(c => c.addAll(['./'].concat(p.files)).catch(() => {})))
      .then(() => self.skipWaiting()),
  );
});
self.addEventListener('activate', e => {
  e.waitUntil(
    ready
      .then(() => caches.keys())
      .then(ks => Promise.all(ks.filter(k => k.startsWith('svgcinema') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const skip = u => /\.(mp4|webm|zip|deb|gz|exe|map)$/i.test(u.pathname) || /\/downloads\//.test(u.pathname);
const fonts = u => u.hostname === 'fonts.googleapis.com' || u.hostname === 'fonts.gstatic.com';

self.addEventListener('fetch', e => {
  const q = e.request;
  if (q.method !== 'GET') return;
  const u = new URL(q.url);
  if (q.mode === 'navigate') {
    // the page: fresh when online (keeping the copy), the cached one offline
    e.respondWith(
      fetch(q)
        .then(r => {
          const c = r.clone();
          ready.then(() => caches.open(CACHE)).then(ca => ca.put('./', c));
          return r;
        })
        .catch(() => caches.match('./', { ignoreSearch: true })),
    );
    return;
  }
  if (!((u.origin === location.origin && !skip(u)) || fonts(u))) return;
  e.respondWith(
    ready.then(() =>
      caches.open(CACHE).then(ca =>
        ca.match(q).then(hit => {
          const net = fetch(q)
            .then(r => {
              if (r && (r.ok || r.type === 'opaque')) ca.put(q, r.clone());
              return r;
            })
            .catch(() => hit);
          return hit || net;
        }),
      ),
    ),
  );
});
