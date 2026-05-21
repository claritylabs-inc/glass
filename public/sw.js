const CACHE_NAME = "glass-static-v1";
const STATIC_PATH_PREFIXES = ["/_next/static/"];
const PUBLIC_ASSET_EXTENSIONS = [
  ".avif",
  ".css",
  ".gif",
  ".ico",
  ".jpg",
  ".jpeg",
  ".js",
  ".png",
  ".svg",
  ".webp",
  ".woff",
  ".woff2",
];

function isStaticAsset(request) {
  if (request.method !== "GET") return false;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return false;
  if (STATIC_PATH_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) {
    return true;
  }
  if (url.pathname.includes("/api/")) return false;
  if (url.pathname.startsWith("/mcp") || url.pathname.startsWith("/oauth")) {
    return false;
  }

  return PUBLIC_ASSET_EXTENSIONS.some((extension) =>
    url.pathname.endsWith(extension),
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (!isStaticAsset(event.request)) return;

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(event.request);
      if (cached) return cached;

      const response = await fetch(event.request);
      if (response.ok) {
        await cache.put(event.request, response.clone());
      }
      return response;
    }),
  );
});
