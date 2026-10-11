const CACHE = "bookscan-v1";
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) =>
      c.addAll([
        "./",
        "./index.html",
        "./manifest.webmanifest",
        "./icon.svg",
        "./icon-192.png",
        "./icon-512.png",
        /* BUILD_ASSETS */
      ]),
    ),
  );
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith("bookscan-") && k !== CACHE)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin)
    return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      if (event.request.mode === "navigate") {
        try {
          const r = await fetch(event.request);
          if (r.ok) {
            await cache.put(event.request, r.clone());
            await cache.put(
              new URL("index.html", self.registration.scope).href,
              r.clone(),
            );
          }
          return r;
        } catch {
          return (await cache.match("./index.html")) || Response.error();
        }
      }
      const saved = await cache.match(event.request);
      if (saved) return saved;
      const r = await fetch(event.request);
      if (r.ok) await cache.put(event.request, r.clone());
      return r;
    })(),
  );
});
self.addEventListener("message", (event) => {
  if (event.data?.type === "CACHE_ASSETS")
    event.waitUntil(
      (async () => {
        try {
          const c = await caches.open(CACHE);
          for (const path of event.data.paths) await c.add(path);
          event.ports[0]?.postMessage({ ok: true });
        } catch (error) {
          event.ports[0]?.postMessage({ ok: false, error: String(error) });
        }
      })(),
    );
});
