// Keeps the app's own screens available when the network is slow. Network first, so a new
// version is picked up as soon as it is published; the saved copy is only a fallback.
// Salesforce data is never stored here: only this site's own files are handled.
const CACHE = "mira-rm-shell-v29";
const SHELL = [
  "./",
  "index.html",
  "app.css",
  "config.js",
  "js/app.js",
  "js/auth.js",
  "js/api.js",
  "manifest.webmanifest"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) {
    return;
  }
  event.respondWith(
    // "no-cache" = always ask the server whether the file changed, so a newly published
    // version shows at once instead of after the browser's own ten-minute copy runs out
    fetch(event.request, { cache: "no-cache" })
      .then((response) => {
        if (response.ok && !url.search) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() =>
        caches
          .match(event.request, { ignoreSearch: true })
          .then((hit) => hit || caches.match("index.html"))
      )
  );
});
