#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url);
const errors = [];

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

const domFreeModules = ["js/auth.js", "js/db.js"];
const domPattern = /\b(?:document|window|HTMLElement|querySelector|getElementById|innerHTML)\b/;

for (const file of domFreeModules) {
  const source = stripComments(readFileSync(new URL(file, root), "utf8"));
  if (domPattern.test(source)) {
    errors.push(`${file} must stay DOM-free; move DOM work to app/ui modules.`);
  }
}

const utils = stripComments(readFileSync(new URL("js/utils.js", root), "utf8"));
for (const match of utils.matchAll(/^\s*import\s+.*?from\s+['"](.+?)['"]/gm)) {
  if (match[1] !== "./config.js") {
    errors.push(
      `js/utils.js must stay side-effect-free; ${match[1]} is not an approved constants import.`,
    );
  }
}

for (const file of ["js/auth.js", "js/db.js"]) {
  const source = readFileSync(new URL(file, root), "utf8");
  const forbiddenImports = source.matchAll(/^\s*import\s+.*?from\s+['"](.+?)['"]/gm);
  for (const match of forbiddenImports) {
    const specifier = match[1];
    const normalized = join("js", specifier).replaceAll("\\", "/");
    if (/dom|ui|app|dashboard|forms|charts|pwa/.test(normalized)) {
      errors.push(`${file} must not import DOM-touching module ${specifier}.`);
    }
  }
}

if (errors.length) {
  console.error("module-boundaries FAILED:");
  for (const error of errors) console.error(` - ${error}`);
  process.exit(1);
}

console.log("module-boundaries OK");
