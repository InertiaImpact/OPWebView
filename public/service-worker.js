const CACHE_NAME = "opwebview-shell-v9";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css?v=3",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./src/app.js?v=5",
  "./src/demo.js?v=2",
  "./src/core/state.js?v=2",
  "./src/core/telemetry-adapter.js?v=2",
  "./src/core/device-discovery.js",
  "./src/core/webrtc-transport.js?v=3",
  "./src/core/connection-manager.js",
  "./src/render/projection.js",
  "./src/render/overlay-renderer.js",
  "./src/widgets/widget-manager.js?v=2",
  "./src/widgets/widget-catalog.js",
  "./src/widgets/layout-presets.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || event.request.method !== "GET") return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) caches.open(CACHE_NAME).then((cache) => cache.put(event.request, response.clone()));
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => cached || caches.match("./index.html")))
  );
});
