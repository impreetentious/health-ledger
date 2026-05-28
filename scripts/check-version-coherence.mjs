#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Every release-version surface is listed here; adding a new one means adding it here too.
const read = (file) => readFileSync(path.join(root, file), "utf8");
const pkg = JSON.parse(read("package.json"));
const version = pkg.version;
const errors = [];
const EXPECTED = {
  nvmrc: "20.20.0",
  engines: ">=20.10",
  packageManager: "npm@10.8.2",
  workflow: ".github/workflows/ci.yml",
  ciNode: null,
};

if (!version) errors.push("package.json missing version");

if (existsSync(path.join(root, "package-lock.json"))) {
  const lock = JSON.parse(read("package-lock.json"));
  if (lock.name !== pkg.name) {
    errors.push(`package-lock.json name ${lock.name} != package.json ${pkg.name}`);
  }
  if (lock.packages?.[""]?.name !== pkg.name) {
    errors.push(`package-lock packages[""].name ${lock.packages?.[""]?.name} != ${pkg.name}`);
  }
  if (lock.version !== version) {
    errors.push(`package-lock.json version ${lock.version} != package.json ${version}`);
  }
  if (lock.packages?.[""]?.version !== version) {
    errors.push(`package-lock packages[""].version ${lock.packages?.[""]?.version} != ${version}`);
  }
} else {
  errors.push("missing package-lock.json");
}

const versionSurfaces = [
  {
    file: "README.md",
    pattern: /\*\*Version:\*\*\s*`?v?([0-9]+\.[0-9]+\.[0-9]+)[^`\n]*/,
    marker: "**Version:** vX.Y.Z",
  },
  {
    file: "index.html",
    pattern: /<span class="site-footer-center">Version v([0-9]+\.[0-9]+\.[0-9]+)<\/span>/,
    marker: "footer Version vX.Y.Z",
  },
  {
    // The offline shell is served cache-first, so the cache key must move with
    // every release or already-installed clients never see the new build.
    file: "service-worker.js",
    pattern: /SHELL_CACHE_PREFIX\}v([0-9]+\.[0-9]+\.[0-9]+)`/,
    marker: "SHELL_CACHE ${SHELL_CACHE_PREFIX}vX.Y.Z",
  },
];

for (const { file, pattern, marker } of versionSurfaces) {
  const found = read(file).match(pattern)?.[1];
  if (!found) errors.push(`${file} missing ${marker} marker`);
  else if (found !== version) errors.push(`${file} version ${found} != package.json ${version}`);
}

const nvm = read(".nvmrc").trim();
if (nvm !== EXPECTED.nvmrc) errors.push(`.nvmrc ${nvm} != ${EXPECTED.nvmrc}`);
if (pkg.engines?.node !== EXPECTED.engines) {
  errors.push(`package.json engines.node ${pkg.engines?.node} != ${EXPECTED.engines}`);
}
if (pkg.packageManager !== EXPECTED.packageManager) {
  errors.push(`package.json packageManager ${pkg.packageManager} != ${EXPECTED.packageManager}`);
}
if (pkg.license !== "Apache-2.0") errors.push(`package.json license ${pkg.license} != Apache-2.0`);
if (
  !existsSync(path.join(root, "LICENSE")) ||
  !read("LICENSE").trimStart().startsWith("Apache License\n")
) {
  errors.push("LICENSE is missing or is not the Apache license declared by package.json");
}
const workflow = read(EXPECTED.workflow);
const ciNodeFile = workflow.match(/^\s*node-version-file:\s*['"]?([^'"\s]+)['"]?\s*$/m)?.[1];
if (ciNodeFile) {
  if (ciNodeFile !== ".nvmrc")
    errors.push(`${EXPECTED.workflow} node-version-file ${ciNodeFile} != .nvmrc`);
} else {
  const ciNode = workflow.match(/^\s*node-version:\s*['"]?([^'"\s]+)['"]?\s*$/m)?.[1];
  if (ciNode !== EXPECTED.ciNode) {
    errors.push(`${EXPECTED.workflow} node-version ${ciNode ?? "missing"} != ${EXPECTED.ciNode}`);
  }
}

if (errors.length) {
  console.error("version-coherence FAILED:");
  for (const error of errors) console.error(` - ${error}`);
  process.exit(1);
}

console.log(`version-coherence OK — ${version}`);
