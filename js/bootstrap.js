import "./runtime-config.js";

// The gitignored override is optional. Probe it with fetch first so a normal
// checkout does not emit a failed-script error when the file is absent.
const localConfigUrl = new URL("./runtime-config.local.js", import.meta.url);

try {
  const response = await fetch(localConfigUrl, { cache: "no-store" });
  if (response.ok) await import(localConfigUrl.href);
} catch {
  // A missing or unreachable override leaves the tracked safe defaults active.
}

await import("./app.js");
