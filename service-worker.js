/*
  Health Ledger offline shell
  ---------------------------------------------------------------------------
  The shell is cache-first after a successful online installation. Requests to
  Firebase and EmailJS remain network operations; no authenticated data or API
  response is stored in Cache Storage. The app's separate offline-preview
  workspace remains the only persisted personal data in this static build.
*/

const SHELL_CACHE = "health-ledger-shell-v4";
const SHELL_ASSETS = [
  "./",
  "./index.html",
  "./favicon.svg",
  "./manifest.webmanifest",
  "./css/style.css",
  "./fonts/InterVariable.woff2",
  "./js/runtime-config.js",
  "./js/app.js",
  "./js/auth.js",
  "./js/charts.js",
  "./js/config.js",
  "./js/dashboard.js",
  "./js/db.js",
  "./js/dom.js",
  "./js/firebase.js",
  "./js/forms.js",
  "./js/history.js",
  "./js/pwa.js",
  "./js/state.js",
  "./js/ui.js",
  "./js/utils.js",
];

const STATIC_RUNTIME_ORIGINS = new Set(["https://www.gstatic.com", "https://cdn.jsdelivr.net"]);

// Do not use a broad same-origin rule here: a host can add endpoints later,
// and health records or backup responses must never enter Cache Storage.
const SHELL_PATHS = new Set(
  SHELL_ASSETS.map((asset) => new URL(asset, self.registration.scope).pathname),
);

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== SHELL_CACHE).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  const isSameOrigin = url.origin === self.location.origin;
  const isShellAsset = isSameOrigin && !url.search && SHELL_PATHS.has(url.pathname);
  const isKnownStaticRuntime = STATIC_RUNTIME_ORIGINS.has(url.origin);

  if (request.mode === "navigate" && isSameOrigin) {
    event.respondWith(isShellAsset ? cacheFirst(request) : navigateWithShellFallback(request));
    return;
  }

  if (!isShellAsset && !isKnownStaticRuntime) return;

  event.respondWith(cacheFirst(request));
});

async function cacheFirst(request) {
  const cachedResponse = await caches.match(request);
  if (cachedResponse) return cachedResponse;

  try {
    const response = await fetch(request);
    if (response.ok || response.type === "opaque") {
      const cache = await caches.open(SHELL_CACHE);
      await cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    if (request.mode === "navigate") {
      const fallback = await caches.match("./index.html");
      if (fallback) return fallback;
    }
    throw error;
  }
}

async function navigateWithShellFallback(request) {
  try {
    return await fetch(request);
  } catch {
    const fallback = await caches.match("./index.html");
    if (fallback) return fallback;
    throw new Error("The Health Ledger shell is not cached yet.");
  }
}
