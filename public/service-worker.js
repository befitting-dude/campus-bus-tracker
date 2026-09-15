// service-worker.js — the minimum needed for Chrome to treat this as an installable PWA.
// We're NOT doing offline caching here (a live bus tracker is useless offline anyway —
// it has nothing meaningful to show without a live connection). This file exists purely
// to satisfy the technical requirement that unlocks the "Install app" prompt.

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  self.clients.claim();
});

// Pass every request straight through to the network — no caching logic.
self.addEventListener("fetch", (event) => {
  event.respondWith(fetch(event.request));
});