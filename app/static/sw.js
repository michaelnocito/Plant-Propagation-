const C = "rootwork-v20";
const SHELL = [
  "/", "/index.html", "/app.js", "/manifest.json",
  "/apple-touch-icon.png", "/icon-192.png", "/icon-512.png",
];
const SHELL_PATHS = new Set(SHELL);

self.addEventListener("install", (e) =>
  e.waitUntil(caches.open(C).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()))
);
self.addEventListener("activate", (e) =>
  e.waitUntil(
    caches
      .keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== C).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  )
);

// NETWORK-FIRST for the app shell so updates show immediately when online;
// fall back to cache only when offline. API + photos always go straight to network.
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const u = new URL(e.request.url);
  const isShell = e.request.mode === "navigate" || SHELL_PATHS.has(u.pathname);
  if (!isShell) return; // /propagate, /plants/*, /photos/*, /export → network only
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(C).then((c) => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match("/")))
  );
});
