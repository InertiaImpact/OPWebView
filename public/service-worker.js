const CACHE_NAME = "opwebview-shell-v20";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css?v=5",
  "./manifest.webmanifest",
  "./icons/web-wheel-192.png",
  "./icons/web-wheel-512.png",
  "./src/app.js?v=11",
  "./src/demo.js?v=3",
  "./src/core/state.js?v=3",
  "./src/core/telemetry-adapter.js?v=3",
  "./src/core/device-discovery.js?v=2",
  "./src/core/webrtc-transport.js?v=4",
  "./src/core/connection-manager.js?v=2",
  "./src/core/diagnostic-log.js?v=3",
  "./src/core/viewport-controller.js",
  "./src/render/projection.js",
  "./src/render/overlay-renderer.js",
  "./src/widgets/widget-manager.js?v=3",
  "./src/widgets/widget-catalog.js",
  "./src/widgets/layout-presets.js",
  "./src/widgets/widget-graphs.js",
  "./vendor/qrcode-generator.js?v=1"
];

self.addEventListener("install", (event) => {
  // Populate an entire release from the network, bypassing the HTTP cache.
  // A failed install leaves the previous worker and offline shell intact.
  event.waitUntil(caches.open(CACHE_NAME).then((cache) =>
    cache.addAll(APP_SHELL.map((url) => new Request(url, { cache: "reload" })))
  ));
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "ACTIVATE_UPDATE") event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      // Keep the preceding release available for existing tabs during handoff.
      // Only prune this app's caches; never clear site data or other caches.
      .then((keys) => Promise.all(keys.filter((key) => {
        const version = key.match(/^opwebview-shell-v(\d+)$/);
        return version && Number(version[1]) < Number(CACHE_NAME.split("-v")[1]) - 1;
      }).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || event.request.method !== "GET") return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    // All navigation URLs, including ?v= links, boot the same complete release.
    // Assets also come from that release, avoiding old/new module mixtures.
    const cached = event.request.mode === "navigate"
      ? await cache.match("./index.html")
      : await cache.match(event.request);
    if (cached) return cached;
    try {
      return await fetch(event.request, { cache: "no-store" });
    } catch {
      // Never return HTML in place of a missing JavaScript module or stylesheet.
      return new Response("Resource unavailable offline", { status: 503 });
    }
  })());
});
