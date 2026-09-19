# Research: config-invariant guard tests

Researched 2026-09-19 against server.js, server.test.js (repo @ 429ae05), and nodejs.org docs. Finding: of four suspected config-invariant gaps, one was already covered; the rest are pinned by 1 edit + 2 new tests (28 → 30).

## Gaps assessed

| Gap | Status | Resolution |
| --- | --- | --- |
| 401-vs-503 ordering (auth before `unconfigured`) | untested | new test |
| 503 body content (`/health` + proxied) | untested (status only) | edit + new test |
| `/health` 200 body `{status:"ok"}` | **already covered** (`server.test.js:248`) | none |
| whitespace-only credentials = missing | untested | covered incidentally: new tests pass `" "` as the API key, pinning the `.trim()` path on the key side |

## Helper facts (verified, server.test.js)

- `startProxyServer` (l. 85-120): env = `{...process.env, ...extraEnv}`, args applied with `!= null` sentinel — `null` = leave unset (inherits ambient shell env). Spawns `node --input-type=module -e`, port returned over IPC.
- `withProxy` (l. 122-142): stub + proxy child, `t.after` LIFO (child killed before stub closed). `proxyEnv` flows verbatim into child env, so `" "` reaches the child untouched.
- `proxiedFetch` (l. 144-146): thin `fetch` wrapper → standard `Response`.
- Control flow (server.js l. 131-141): `/v1/*` guard → 401 (`authorized`) → 503 (`unconfigured`) → proxy. Return happens before the upstream `fetch` (l. 167), so `receivedRequests.length === 0` is assertable (pattern matches existing tests at l. 282, 436).

## Assertion style (official docs)

`import assert from "node:assert/strict"` (server.test.js:3) — per https://nodejs.org/api/assert.html#assert_module_assert_strict, `deepEqual` is an alias of `deepStrictEqual` in strict mode. `await res.json()` already parses (used at l. 248, 324, 351, 365); no `JSON.parse` needed.

## Ambient-env caveat

`null` args make the child inherit developer-shell `NVIDIA_API_KEY`/`PROXY_AUTH_TOKEN`. New tests avoid this by passing explicit whitespace values (`key: " "`) — which is simultaneously the whitespace-pinning. The edited existing test keeps `token: null` (pre-existing exposure, not worsened).

## Count sync (3 places, mandatory)

- README.md:9 — badge `tests-28%20passing` → `tests-30%20passing`
- README.md:70 — "(28 tests" → "(30 tests"
- AGENTS.md:89 — "(28 tests" → "(30 tests"

No CI exists; `node --test` locally is the only gate.
