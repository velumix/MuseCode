// Offline launch caches only the phone shell. Messages, API responses, and QR
// pairing data never enter Cache Storage. Commands are never queued offline.
const CACHE = "velum-phone-v5";
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then(async (cache) => {
    await cache.addAll(["/", "/manifest.webmanifest", "/velum-192.png", "/velum-512.png"]);
    const html = await (await cache.match("/")).text();
    const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"?]+)"/g)].map((match) => match[1]);
    await cache.addAll(assets);
    await self.skipWaiting();
  }));
});
self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then(async (keys) => {
    await Promise.all(keys.filter((key) => /^(muse|velum)-phone-/.test(key) && key !== CACHE).map((key) => caches.delete(key)));
    await self.clients.claim();
  }));
});
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  const shell = event.request.mode === "navigate";
  if (!shell && !url.pathname.startsWith("/assets/") && !["/manifest.webmanifest", "/velum-192.png", "/velum-512.png", "/velum-icon.png"].includes(url.pathname)) return;
  event.respondWith(fetch(event.request).then(async (response) => {
    if (response.ok && !shell) { const cache = await caches.open(CACHE); await cache.put(event.request, response.clone()); }
    return response;
  }).catch(async () => (await (await caches.open(CACHE)).match(shell ? "/" : event.request)) || new Response("Reconnect to your desktop to open Velum Code.", { status: 503 })));
});
