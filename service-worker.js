/*
  Health Ledger offline shell
  ---------------------------------------------------------------------------
  The shell is cache-first after a successful online installation. Requests to
  Firebase and EmailJS remain network operations; no authenticated data or API
  response is stored in Cache Storage. Personal data can persist separately in
  offline preview localStorage or the explicitly enabled Firestore browser cache.
*/

const SHELL_CACHE_PREFIX = "health-ledger-shell-";
// Keyed to the released app version and enforced by
// scripts/check-version-coherence.mjs. Every release must change this file:
// shell assets are served cache-first with no revalidation, and the browser
// only reinstalls the worker (and so refreshes the cache) when these bytes
// change. A hand-maintained counter leaves installed clients on the build
// they first cached whenever a release touches index.html, css/, or js/
// without editing this file.
const SHELL_CACHE = `${SHELL_CACHE_PREFIX}v2.9.3`;
const SHELL_ASSETS = [
  "./",
  "./index.html",
  "./favicon.svg",
  "./manifest.webmanifest",
  "./css/style.css",
  "./fonts/InterVariable.woff2",
  "./js/runtime-config.js",
  "./js/bootstrap.js",
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
const OPTIONAL_SHELL_ASSETS = ["./js/runtime-config.local.js"];

const STATIC_RUNTIME_PREFIXES = [
  "https://www.gstatic.com/firebasejs/12.19.0/",
  "https://cdn.jsdelivr.net/npm/chart.js@4.5.1/",
  "https://cdn.jsdelivr.net/npm/@emailjs/browser@4.4.1/",
];

// Do not use a broad same-origin rule here: a host can add endpoints later,
// and health records or backup responses must never enter Cache Storage.
const SHELL_PATHS = new Set(
  [...SHELL_ASSETS, ...OPTIONAL_SHELL_ASSETS].map(
    (asset) => new URL(asset, self.registration.scope).pathname,
  ),
);
const CONFIG_PATHS = new Set(
  ["./js/runtime-config.js", ...OPTIONAL_SHELL_ASSETS].map(
    (asset) => new URL(asset, self.registration.scope).pathname,
  ),
);

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      await cache.addAll(SHELL_ASSETS);
      await Promise.all(
        OPTIONAL_SHELL_ASSETS.map(async (asset) => {
          try {
            const response = await fetch(asset, { cache: "no-store" });
            if (response.ok) await cache.put(asset, response);
          } catch {
            // The local override is optional; the tracked runtime config is enough to boot.
          }
        }),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith(SHELL_CACHE_PREFIX) && key !== SHELL_CACHE)
            .map((key) => caches.delete(key)),
        ),
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
  const isConfigAsset = isSameOrigin && !url.search && CONFIG_PATHS.has(url.pathname);
  const isKnownStaticRuntime = STATIC_RUNTIME_PREFIXES.some((prefix) =>
    url.href.startsWith(prefix),
  );

  // Deploy-time config can change independently of the application shell.
  // Refresh it online, but retain the last successful copy for an offline boot.
  if (isConfigAsset) {
    event.respondWith(networkFirstWithCacheFallback(request));
    return;
  }

  if (request.mode === "navigate" && isSameOrigin) {
    event.respondWith(isShellAsset ? cacheFirst(request) : navigateWithShellFallback(request));
    return;
  }

  if (!isShellAsset && !isKnownStaticRuntime) return;

  event.respondWith(cacheFirst(request));
});

async function cacheFirst(request) {
  const cache = await caches.open(SHELL_CACHE);
  const cachedResponse = await cache.match(request);
  if (cachedResponse) return cachedResponse;

  try {
    const response = await fetch(request);
    if (response.ok || response.type === "opaque") {
      await cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    if (request.mode === "navigate") {
      const fallback = await cache.match("./index.html");
      if (fallback) return fallback;
    }
    throw error;
  }
}

async function networkFirstWithCacheFallback(request) {
  const cache = await caches.open(SHELL_CACHE);

  try {
    const response = await fetch(request);
    if (response.ok) {
      await cache.put(request, response.clone());
    } else if (response.status === 404) {
      await cache.delete(request);
    }
    return response;
  } catch (error) {
    const cachedResponse = await cache.match(request);
    if (cachedResponse) return cachedResponse;
    throw error;
  }
}

async function navigateWithShellFallback(request) {
  try {
    return await fetch(request);
  } catch {
    const cache = await caches.open(SHELL_CACHE);
    const fallback = await cache.match("./index.html");
    if (fallback) return fallback;
    throw new Error("The Health Ledger shell is not cached yet.");
  }
}
