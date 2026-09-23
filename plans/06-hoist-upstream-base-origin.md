# Plan 06: Hoist the upstream base origin (per-request URL re-parse)

Category: Performance · Priority: low · Effort: trivial (2 lines in server.js) · Introduced-by: n/a (original)

## Problem

`upstreamUrl()` parses `config.baseURL` on **every proxied request** (`server.js:117-120`):

```js
function upstreamUrl(incoming) {
  const base = new URL(config.baseURL);
  return `${base.origin}${incoming.pathname}${incoming.search}`;
}
```

`config.baseURL` is fixed once at module load by `validateConfig()` and never changes, so the parse
result is a constant being recomputed per request — one wasted `URL` object allocation plus WHATWG
parse per request, for a value available at startup.

## Evidence

- `server.js:117-120` — `new URL(config.baseURL)` sits inside the per-request path.
- `server.js:12-37` — `validateConfig(process.env)` runs once at import; `config.baseURL` is the raw
  env string, unmodified afterwards.
- Microbenchmark on the dev machine (Node v24.18.0, 200k reps, `process.hrtime.bigint`):

  | op | µs/op |
  | --- | --- |
  | `new URL(BASE).origin` (current) | 1.493 |
  | hoisted `BASE_ORIGIN` + concat | 0.042 |

  ≈ 1.45 µs and one allocation saved per request. Context for scale: the whole measurable JS request
  path (`new URL(req.url)` 2.311 + SHA-256 digest auth 6.880 + header copy 3.181) is ≈ 14 µs against
  an upstream round trip of 300–3000 ms. This is hygiene, not a latency win.

## Goal

The base origin is computed once at startup. Upstream URLs produced are byte-identical to today's.

## Implementation

**`server.js`** — add a module-level constant right after `TOKEN_DIGEST` (`server.js:44-46`):

```js
// config.baseURL never changes after startup, so its origin is resolved once
// here instead of re-parsing the same string on every request.
const BASE_ORIGIN = new URL(config.baseURL).origin;
```

Then reduce `upstreamUrl` (`server.js:117-120`) to:

```js
function upstreamUrl(incoming) {
  return `${BASE_ORIGIN}${incoming.pathname}${incoming.search}`;
}
```

- Keep the existing four-line comment above `upstreamUrl` (`server.js:110-116`) byte-identical — it
  documents the path-mapping rule and stays true.
- Do **not** restructure anything else. No new imports, no new functions, no touched headers.
- Conventions: ESM, double quotes, comment above the code, surgical patch only.

## Tests

None. The change is behavior-preserving: `new URL(base).origin` for a fixed base is the same string
the hoisted constant holds, so every existing path-mapping assertion still holds.

- **Do not modify `server.test.js`** — the suite must stay at 33 passing.
- **No test-count sync** (README badge, README tip, AGENTS.md bullet all stay as-is).

## Verification

1. `npm test` → 33 passing, 0 failing.
2. `git diff --stat` → `server.js` only (+3/−2 lines).
3. Spot check that both shapes of base URL agree, e.g.
   `node -e 'for (const b of ["https://integrate.api.nvidia.com/v1","https://integrate.api.nvidia.com","http://127.0.0.1:8123/v1"]) console.log(b, "->", new URL(b).origin)'`
   → `https://integrate.api.nvidia.com`, `https://integrate.api.nvidia.com`, `http://127.0.0.1:8123`.

## Existing tests you must not break

- All 33 current tests (`npm test`).
- In particular the `path mapping` tests, which assert the upstream receives the incoming
  `/v1/*` path + query verbatim on the base origin.

## Deferred findings (measured, not implemented — do not implement without a reason to)

Recorded so a future pass does not re-derive them:

- **`for..in` instead of `Object.entries` for the request-header copy** (`server.js:150-153`):
  measured 3.181 → 0.322 µs/op (9-header request), the larger of the two wins. Deferred because
  **Plan 04** (`plans/04-request-header-array-flattening.md`) rewrites that exact loop and explicitly
  says "do not restructure the loop". Doing both would collide. Apply after 04 lands, folding the
  `Array.isArray(value) ? value.join(", ") : value` guard into the `for..in` body.
- **One-shot `crypto.hash()` for the auth digest** (`server.js:104-107`): would avoid the `Hash`
  object churn in the 6.880 µs auth step, but `crypto.hash` needs Node ≥ 20.12 while `package.json`
  `engines` promises ≥ 18.14, so it either raises the engine floor or adds a second code path in
  security-sensitive code. Not worth it.
- **Caching auth digests / rate limiting / circuit breaker / cluster workers**: out of scope —
  caching auth material is a security regression, and the rest are features or excluded by
  `specs/product/SCOPE_LATEST.yaml`, not performance defects.

## Escape hatches

- If `npm test` fails after the change → STOP and report; the change is not behavior-preserving in
  your environment and must be re-derived.
- If `config.baseURL` turns out to be mutated anywhere (search `config.baseURL =`) → STOP; the
  hoist assumption is invalid.

## Run log

- 2026-09-23 — plan written by orchestrator from a second-pass audit of `server.js`; implementer
  subagent dispatched (Task 06).
