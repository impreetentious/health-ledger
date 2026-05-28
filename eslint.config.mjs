import js from "@eslint/js";
import globals from "globals";

// Flat config. Generated and build output are ignored here rather than in .eslintignore,
// which flat config no longer reads.
export default [
  {
    ignores: ["node_modules/**", "fonts/**"],
  },
  js.configs.recommended,
  {
    files: ["js/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.browser,
      },
    },
  },
  {
    files: ["service-worker.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.serviceworker,
      },
    },
  },
  {
    files: ["test/**/*.js", "scripts/**/*.mjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.node,
      },
    },
  },
];
