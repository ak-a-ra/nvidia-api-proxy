// ESLint flat config. Rules are chosen to catch bug classes in a Node
// proxy (resource leaks, unhandled async, wrong ref-equality, shadowed
// globals), not to enforce personal formatting taste — Prettier owns layout.
//
// Two blocks, not one: `server.js`/`config.js` are the files that ship, so
// they carry the full rule set, while the 2.4k-line black-box suite gets the
// same correctness rules minus the ones that fight a test harness. Nothing is
// excluded from linting.

const nodeGlobals = {
  process: "readonly",
  console: "readonly",
  Buffer: "readonly",
  URL: "readonly",
  URLSearchParams: "readonly",
  AbortController: "readonly",
  AbortSignal: "readonly",
  TextDecoder: "readonly",
  TextEncoder: "readonly",
  setTimeout: "readonly",
  clearTimeout: "readonly",
  setInterval: "readonly",
  clearInterval: "readonly",
  queueMicrotask: "readonly",
  structuredClone: "readonly",
  fetch: "readonly",
  Headers: "readonly",
  Request: "readonly",
  Response: "readonly",
  crypto: "readonly",
  performance: "readonly",
  global: "readonly",
  globalThis: "readonly",
};

export default [
  {
    ignores: ["node_modules/**", "coverage/**"],
  },
  {
    // Runtime source only. The proxy has exactly two shipped files; anything
    // that can ship without a build step must pass this block.
    files: ["server.js", "config.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: nodeGlobals,
    },
    rules: {
      // --- correctness ---
      eqeqeq: ["error", "always", { null: "ignore" }],
      "no-var": "error",
      "prefer-const": "error",
      "no-implicit-coercion": "error",

      // --- resource / lifecycle leaks, the classic proxy bug ---
      "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "no-empty": ["error", { allowEmptyCatch: false }],
      "require-atomic-updates": "off", // async counters: noisy, no real bug here

      // --- async correctness ---
      "no-async-promise-executor": "error",
      "no-return-await": "error",
      "require-await": "off", // an async handler with no await is legal Node shape

      // --- security ---
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",

      // --- hygiene ---
      "no-console": "off", // the proxy logs to stdout by design
      "no-duplicate-imports": "error",
      "no-unreachable": "error",
      "no-constant-condition": "error",
      "no-self-compare": "error",
      "no-func-assign": "error",
      "use-isnan": "error",
      "valid-typeof": "error",
      "no-sparse-arrays": "error",
    },
  },
  {
    // Test files: the same correctness rules, minus the stylistic ones that
    // fight a 2.4k-line black-box harness. Still fully linted, never skipped.
    files: ["server.test.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: nodeGlobals,
    },
    rules: {
      "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "no-empty": ["error", { allowEmptyCatch: false }],
      "no-var": "error",
      "prefer-const": "error",
      eqeqeq: ["error", "always", { null: "ignore" }],
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
      "no-async-promise-executor": "error",
      "no-return-await": "error",
      "no-duplicate-imports": "error",
      "no-unreachable": "error",
      "no-self-compare": "error",
      "use-isnan": "error",
      "valid-typeof": "error",
    },
  },
];
