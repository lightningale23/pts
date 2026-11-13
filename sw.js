// Service worker: pts keeps working with no internet once it has been opened online. This is how
// the iPhone/iPad home-screen app (Share → Add to Home Screen) works offline; it does the same for
// any browser. Strategy:
//  - The site's own files (page, css, js, data, icons, visual-bonus pictures): network first, so an
//    online visit always gets the latest site and questions; the copy is kept in the cache and used
//    when there's no connection (or no answer within a few seconds).
//  - Fonts and KaTeX from their CDNs: cache first (their URLs are versioned).
//  - Everything else (rooms, presence, reports, GitHub) isn't touched and simply fails offline.
// Installing caches everything needed to practice offline (~27 MB with the pictures). The cache
// name only changes if its layout does; files in it are refreshed as they're fetched online.
// When a module is added to js/, add it to SHELL (tests/sw.test.js checks).
const CACHE = 'pts-offline-v1';

const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/style.css',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
  'js/app.js', 'js/bookmarks.js', 'js/changelog.js', 'js/checker.js', 'js/config.js', 'js/csv.js',
  'js/engine.js', 'js/game-view.js', 'js/mathval.js', 'js/net.js', 'js/presence.js', 'js/questions.js',
  'js/report.js', 'js/rounds.js', 'js/settings.js', 'js/sound.js', 'js/speech.js', 'js/stats.js',
  'js/text.js', 'js/util.js',
];
// Big files: fetched at install only if not cached yet (online visits keep them fresh).
const DATA = [
  'data/questions.csv', 'data/visual-bonuses.csv', 'data/osb-questions.csv',
  'data/sample-questions.csv', 'data/pronunciations.csv', 'data/changelog.json',
];
// Stylesheets from CDNs; the fonts they use are cached with them.
const CDN_CSS = [
  'https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:ital,wght@0,400;0,700;1,400&family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700;12..96,800&display=swap',
  'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css',
];
const CDN = ['https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js'];
const CDN_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com', 'cdn.jsdelivr.net'];
// Same-origin paths kept for offline use (dev.html, review/ etc. aren't).
const OWN = /^(|index\.html|manifest\.webmanifest|css\/.*|js\/.*|icons\/.*|data\/.*)$/;

const scope = () => new URL(self.registration.scope);
const abs = p => new URL(p, scope()).href;
const ownPath = url => (url.startsWith(scope().href) ? url.slice(scope().href.length).split(/[?#]/)[0] : null);

async function put(cache, key, res, old) {
  if (!res || !res.ok || res.type === 'opaque') return;
  const tag = res.headers.get('etag');
  if (old && tag && old.headers.get('etag') === tag) return; // unchanged; skip rewriting 13 MB
  await cache.put(key, res);
}

async function fetchInto(cache, url, { ifMissing = false } = {}) {
  const old = await cache.match(url);
  if (ifMissing && old) return old;
  const res = await fetch(url, { cache: 'no-cache', mode: url.startsWith(self.location.origin) ? 'same-origin' : 'cors' });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  await put(cache, url, res.clone(), old);
  return res;
}

// Pictures of visual bonuses named in the visual bonus file that aren't cached yet.
async function cacheVisuals(cache, csv) {
  const paths = [...new Set(csv.match(/data\/visuals\/[\w-]+\.\w+/g) || [])];
  for (let i = 0; i < paths.length; i += 8) {
    await Promise.allSettled(paths.slice(i, i + 8).map(p => fetchInto(cache, abs(p), { ifMissing: true })));
  }
}

// A stylesheet and the font files it points to.
async function cacheCss(cache, url) {
  const res = await fetchInto(cache, url, { ifMissing: true });
  const css = await res.clone().text();
  const fonts = [...css.matchAll(/url\(\s*['"]?([^'")]+\.woff2)['"]?\s*\)/g)].map(m => new URL(m[1], url).href);
  await Promise.allSettled(fonts.map(f => fetchInto(cache, f, { ifMissing: true })));
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Needed to practice offline: if one fails, installing is tried again on the next visit.
    await Promise.all(SHELL.map(p => fetchInto(cache, abs(p))));
    await Promise.all(DATA.map(p => fetchInto(cache, abs(p), { ifMissing: true })));
    // Nice to have: fonts, math, pictures.
    await Promise.allSettled([
      ...CDN.map(u => fetchInto(cache, u, { ifMissing: true })),
      ...CDN_CSS.map(u => cacheCss(cache, u)),
      cache.match(abs('data/visual-bonuses.csv')).then(r => r && r.text()).then(t => t && cacheVisuals(cache, t)),
    ]);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('pts-offline-') && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

const timeout = (p, ms) => new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('timeout')), ms);
  p.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
});

async function networkFirst(event, key) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(key, { ignoreSearch: true });
  if (cached && self.navigator && self.navigator.onLine === false) return cached;
  try {
    // With a saved copy, don't wait long for a bad connection (headers only; the body streams).
    const res = await timeout(fetch(event.request), cached ? 6000 : 120000);
    if (res.ok && event.request.method === 'GET') {
      const copy = res.clone();
      event.waitUntil((async () => {
        await put(cache, key, copy.clone(), cached);
        if (key.endsWith('data/visual-bonuses.csv')) await cacheVisuals(cache, await copy.text());
      })());
    }
    return res;
  } catch (err) {
    if (cached) return cached;
    if (event.request.mode === 'navigate') {
      const page = await cache.match(abs('index.html'));
      if (page) return page;
    }
    throw err;
  }
}

async function cacheFirst(event) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(event.request.url);
  if (cached) return cached;
  const res = await fetch(event.request);
  if (res.ok && res.type !== 'opaque') event.waitUntil(cache.put(event.request.url, res.clone()));
  return res;
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const path = ownPath(req.url);
  if (path != null) {
    if (req.mode === 'navigate' && (path === '' || path === 'index.html')) {
      event.respondWith(networkFirst(event, abs('index.html')));
    } else if (OWN.test(path) && path !== '') {
      event.respondWith(networkFirst(event, abs(path)));
    }
  } else if (CDN_HOSTS.includes(url.hostname) && (url.hostname !== 'cdn.jsdelivr.net' || url.pathname.startsWith('/npm/katex@'))) {
    event.respondWith(cacheFirst(event));
  }
});
