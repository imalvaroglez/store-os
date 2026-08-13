// Minimal offline service worker: cache-first for app shell.
// ponytail: no versioning strategy beyond CACHE name bump; app shell is small and
// local-first, so stale UI is acceptable. Upgrade path: Workbox when caching grows.
const CACHE = "store-os-v1";
const SHELL = ["/", "/index.html", "/manifest.webmanifest", "/icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  // Network-first for navigation so updates land; cache fallback offline.
  // On a successful online navigation we ALSO persist the fresh /index.html
  // into the SHELL cache — a second rotation path independent of a new SW
  // installing (defends against "the new SW never arrived"). Belt: addAll in
  // install. Suspenders: this cache.put on every online nav.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put("/index.html", copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match("/index.html"))
    );
    return;
  }
  event.respondWith(
    caches.match(req).then(
      (cached) =>
        cached ||
        fetch(req).catch(() => new Response("", { status: 504, statusText: "Offline" }))
    )
  );
});
