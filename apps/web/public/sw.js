/**
 * The service worker exists for one reason: Chrome refuses to offer "Install
 * app" for a site that does not register one with a `fetch` handler. The
 * manifest alone gets you Safari's "Add to Home Screen" and nothing on Android.
 *
 * It caches almost nothing, and that is deliberate. Every screen in this
 * application is server-rendered against a session cookie and scoped to one
 * tenant; a Cache Storage entry is shared by every profile on the device and
 * survives sign-out, so caching a rendered page or an /api response would hand
 * the next person at the same phone another tenant's data. The only things put
 * in the cache are the static offline page and the icon — no markup, no JSON,
 * nothing that was rendered for a particular viewer.
 *
 * So: navigations go to the network, and fall back to /offline.html when the
 * network is gone. Everything else is left to the browser untouched.
 */
const CACHE = 'shell-v1';
const OFFLINE_URL = '/offline.html';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll([OFFLINE_URL, '/icon-192.png']))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  // Not a page load: no handler, no cache, straight to the network. Returning
  // without calling respondWith is what leaves the request to the browser.
  if (event.request.mode !== 'navigate') return;

  event.respondWith(
    fetch(event.request).catch(
      async () =>
        (await caches.match(OFFLINE_URL)) ??
        new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } }),
    ),
  );
});
