/* File Shot service worker: makes the game installable and playable offline.
   Game files are served network-first (so updates arrive straight away)
   and fall back to the cached copy when there's no connection. */
const CACHE = "fileshot-v5";
const GAME_FILES = [
  "",
  "index.html",
  "game.css",
  "game.js",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/maskable-512.png",
  "icons/apple-touch-icon.png",
  "icons/favicon-32.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(GAME_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("fileshot-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isGameRequest(url) {
  if (url.origin === self.location.origin) {
    const path = url.pathname.slice(new URL(self.registration.scope).pathname.length);
    return GAME_FILES.includes(path);
  }
  // the Inter font used by the game
  return url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com";
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (!isGameRequest(url)) return; // leave the rest of the site alone

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && (res.ok || res.type === "opaque")) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }))
  );
});
