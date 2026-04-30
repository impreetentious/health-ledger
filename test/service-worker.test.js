import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const serviceWorkerSource = await readFile(
  new URL("../service-worker.js", import.meta.url),
  "utf8",
);

// Read the shipped cache key instead of hard-coding it, so this stays a test of
// the cleanup rule rather than of the current release number.
const shellCacheSuffix = serviceWorkerSource.match(/SHELL_CACHE_PREFIX\}(v[\d.]+)`/)?.[1];

test("service worker keys its shell cache to a release version", () => {
  assert.match(shellCacheSuffix ?? "", /^v\d+\.\d+\.\d+$/);
});

test("service worker activation deletes only stale Health Ledger caches", async () => {
  const listeners = new Map();
  const deletedCaches = [];
  const cacheNames = [
    "health-ledger-shell-v5",
    "health-ledger-shell-v6",
    `health-ledger-shell-${shellCacheSuffix}`,
    "another-app-v1",
  ];

  const context = {
    URL,
    fetch: async () => {
      throw new Error("fetch is not expected during activation");
    },
    caches: {
      keys: async () => cacheNames,
      delete: async (key) => {
        deletedCaches.push(key);
        return true;
      },
      open: async () => {
        throw new Error("cache.open is not expected during activation");
      },
    },
    self: {
      registration: { scope: "https://example.test/health-ledger/" },
      location: { origin: "https://example.test" },
      clients: { claim: async () => {} },
      skipWaiting: async () => {},
      addEventListener: (type, listener) => listeners.set(type, listener),
    },
  };

  vm.runInNewContext(serviceWorkerSource, context);

  let activation;
  listeners.get("activate")({ waitUntil: (promise) => (activation = promise) });
  await activation;

  assert.deepEqual(deletedCaches, ["health-ledger-shell-v5", "health-ledger-shell-v6"]);
});
