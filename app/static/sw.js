const C = "rootwork-v9";
const SHELL = [
  "/", "/index.html", "/app.js", "/manifest.json",
  "/apple-touch-icon.png", "/icon-192.png", "/icon-512.png",
];

self.addEventListener("install", (e) =>
  e.waitUntil(caches.open(C).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()))
);
self.addEventListener("activate", (e) =>
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== C).map((k) => caches.delete(k))))
  )
);
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.pathname === "/propagate") return; // never cache API
  e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request)));
});
