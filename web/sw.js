// Offline cache for the whole STEEL site (home menu, Fuel app, dashboard).
// Pages (HTML) come from the network first, so phones always get the newest version; the cached copy is used
// when the network is slow (over 3 s) or offline. Other files open at once from the phone's cache, and the
// latest copy is fetched in the background for next time ("stale-while-revalidate"). Data (the Apps Script API) is never cached here: it is a POST
// to another site, and each app keeps its own data cache. Bump VERSION only to drop every cached file.
const VERSION = 'steel-v1';
const FONTS = 'steel-fonts-v1';
const SHELL = [
  './', 'home.css', 'home.js', 'lang.js', 'request.js', 'config.js', 'manifest.webmanifest',
  'icons/isi-logo.png', 'icons/isi-white.png', 'icons/banner-pattern.png', 'icons/favicon.png', 'icons/app-192.png', 'icons/flag-kh.svg', 'icons/flag-gb.svg',
  'icons/meeting.svg', 'icons/fuel.svg', 'icons/transport.svg', 'icons/overtime.svg', 'icons/location.svg', 'icons/dashboard.svg', 'icons/home.svg',
  'fuel/', 'fuel/app.js', 'fuel/styles.css',
  'minutes/', 'minutes/mm.js', 'minutes/mm.css', 'minutes/config.js',
  'overtime/', 'overtime/ot.js', 'overtime/ot.css', 'overtime/config.js', 'vendor/jsQR.min.js',
  'delivery/', 'delivery/delivery.js', 'delivery/delivery.css', 'delivery/config.js', 'vendor/qrcode.min.js',
  'dashboard/', 'dashboard/assets/dashboard.js', 'dashboard/assets/dashboard.css',
  'dashboard/vendor/react.production.min.js', 'dashboard/vendor/react-dom.production.min.js',
  'dashboard/vendor/prop-types.min.js', 'dashboard/vendor/Recharts.js',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION)
    // One by one, so a single missing file never stops the rest from being cached.
    .then(c => Promise.all(SHELL.map(u => fetch(u, { cache: 'no-cache' }).then(r => keep(r) && c.put(u, r)).catch(() => {}))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== FONTS).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Only plain, complete answers are worth keeping (no errors, redirects or partial videos).
const keep = r => r && r.ok && r.status === 200 && !r.redirected && (r.type === 'basic' || r.type === 'cors');

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    if (url.searchParams.has('nosw')) return;
    e.respondWith(req.mode === 'navigate' ? page(e) : fresh(e, VERSION, false));
  } else if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(fresh(e, FONTS, false));
  }
  // Everything else (Google sign-in, the API, Telegram) goes straight to the network.
});

/** Network first for pages (Kim, 17 Oct 2026: phones kept running last week's app), cache after 3 s or offline. */
async function page(e) {
  const req = e.request, path = new URL(req.url).pathname;
  const cache = await caches.open(VERSION);
  const net = fetch(req).then(r => { if (keep(r)) cache.put(path, r.clone()); return r; });
  e.waitUntil(net.catch(() => {}));
  const slow = new Promise(res => setTimeout(res, 3000)).then(() => cache.match(path));
  const hit = await Promise.race([net.catch(() => null), slow]);
  if (hit) return hit;
  return net.catch(async () => (await cache.match(path)) || (await cache.match('./')) || Response.error());
}

/** Answer from the cache when we have it and refresh it in the background; otherwise wait for the network. */
async function fresh(e, name, page) {
  const req = e.request;
  const cache = await caches.open(name);
  // "?plate=3C-4266" links from the truck QR stickers open the same cached page.
  const hit = await cache.match(req, { ignoreSearch: page });
  const net = fetch(req).then(r => {
    // The font stylesheet comes back "opaque" (no status to check), so it is kept as long as it arrived.
    if (keep(r) || (name === FONTS && r.type === 'opaque')) cache.put(page ? new URL(req.url).pathname : req, r.clone());
    return r;
  });
  if (hit) {
    e.waitUntil(net.catch(() => {}));   // let the background refresh finish
    return hit;
  }
  return net.catch(async () => (page && (await cache.match('./'))) || Response.error());
}
