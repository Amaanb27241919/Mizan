// Minimal, crash-focused ESLint (flat) config.
//
// Lives at config/eslint.mjs (not the default eslint.config.mjs) and is referenced
// explicitly via `npm run lint` (eslint --config config/eslint.mjs .). Reason: a
// global config-protection guard blocks writing the default filename; using a
// referenced path keeps this change self-contained to the repo.
//
// Purpose: catch the class of runtime bug Vite/esbuild do NOT flag — chiefly
// `no-undef` (a referenced identifier with no declaration/import), which crashed
// the Zakat & Sadaqah page after a refactor removed a local that JSX still read.
// This is intentionally NOT a style linter: only rules that catch real runtime
// faults are on, so the build gate stays signal, not noise.
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";

// Rules that catch genuine runtime crashes / logic faults (all errors).
const CRASH_RULES = {
  "no-undef": "error",
  "no-const-assign": "error",
  "no-class-assign": "error",
  "no-func-assign": "error",
  "no-import-assign": "error",
  "no-setter-return": "error",
  "getter-return": "error",
  "no-dupe-keys": "error",
  "no-dupe-args": "error",
  "no-dupe-class-members": "error",
  "no-dupe-else-if": "error",
  "no-obj-calls": "error",
  "no-unreachable": "error",
  "no-unsafe-negation": "error",
  "no-self-assign": "error",
  "no-cond-assign": ["error", "except-parens"],
  "use-isnan": "error",
  "valid-typeof": "error",
  // Not a crash, but the smell of a half-finished refactor. Warn only so it never
  // blocks the build; the crash rules above are what fail it.
  "no-unused-vars": ["warn", { args: "none", ignoreRestSiblings: true, varsIgnorePattern: "^_" }],
};

const JS_LANG = {
  ecmaVersion: "latest",
  sourceType: "module",
  parserOptions: { ecmaFeatures: { jsx: true } },
};

export default [
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "coverage/**",
      ".vercel/**",
      "public/**", // built assets + service worker (its own global scope)
    ],
  },
  {
    // The monolith carries `eslint-disable react-hooks/exhaustive-deps` comments;
    // registering the plugin makes those rule names known (no "rule not found").
    // exhaustive-deps is OFF (too noisy on an 11k-line file); reportUnused… is off
    // so the now-inert disable comments don't generate warnings either.
    linterOptions: { reportUnusedDisableDirectives: "off" },
  },
  // Frontend — browser globals (window, document, localStorage, fetch, Intl, …).
  {
    files: ["src/**/*.{js,jsx}"],
    plugins: { "react-hooks": reactHooks },
    languageOptions: {
      ...JS_LANG,
      globals: { ...globals.browser, ...globals.es2021 },
    },
    rules: {
      ...CRASH_RULES,
      "react-hooks/rules-of-hooks": "error", // conditional/looped hooks crash React
      "react-hooks/exhaustive-deps": "off",
    },
  },
  // Backend — Node globals only (a `document` ref in lib/api/server IS a real bug).
  {
    files: [
      "lib/**/*.{js,mjs}",
      "api/**/*.{js,mjs}",
      "server.js",
      "config/**/*.{js,mjs}",
    ],
    languageOptions: {
      ...JS_LANG,
      globals: { ...globals.node, ...globals.es2021 },
    },
    rules: CRASH_RULES,
  },
  // Dev scripts — Node + browser: they run in Node but embed browser code inside
  // Playwright `page.evaluate()` callbacks (document/window are valid there).
  {
    files: ["scripts/**/*.{js,mjs}"],
    languageOptions: {
      ...JS_LANG,
      globals: { ...globals.node, ...globals.browser, ...globals.es2021 },
    },
    rules: CRASH_RULES,
  },
  // Tests — jsdom (browser) + Node; vitest primitives are imported explicitly.
  {
    files: ["src/test/**/*.{js,jsx}"],
    languageOptions: {
      ...JS_LANG,
      globals: { ...globals.browser, ...globals.node, ...globals.es2021 },
    },
    rules: CRASH_RULES,
  },
];
