/*
  pwa.js — Progressive-web-app registration
  ---------------------------------------------------------------------------
  Keeps registration outside app.js's auth and view wiring. The service worker
  is deliberately best-effort: an unsupported, insecure, or failed registration
  must never prevent a person from using the tracker online.
*/

export function registerServiceWorker() {
  if (!globalThis.isSecureContext || !("serviceWorker" in navigator)) return;

  window.addEventListener(
    "load",
    () => {
      navigator.serviceWorker.register("./service-worker.js", { scope: "./" }).catch(() => {
        // Offline installation is an enhancement. Avoid a noisy console error
        // when a static host deliberately disables service workers.
      });
    },
    { once: true },
  );
}
