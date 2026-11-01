# e04s08 tracer bullet report

Branch: `feat/e04s08-stats`
Status: complete (tracer slice 1 of 1)

## Commits

```
c421fc0 feat(stats): return 401 for unauthenticated GET /stats
496dc8b test(stats): GET /stats returns 401 without a token
```

RED commit `496dc8b` (test-only, `git add server.test.js`).
GREEN commit `c421fc0` (feat, `git add server.js`).
Uncommitted spec files (`specs/...`) left unstaged per branch constraint.

## RED

Test added: `GET /stats returns 401 without a token` in `server.test.js`, placed after the bare-`/v1` 404 test and before `multi-value set-cookie preserved (not merged)`, using the existing `withProxy`/`proxiedFetch` harness and stub upstream, asserting status `401`, body `{ "error": "Unauthorized" }`, and `receivedRequests.length === 0`.

RED failure line (quoted):

```
✖ GET /stats returns 401 without a token (658.918489ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
  
  404 !== 401
```

Failed at `server.test.js:679:12` because `/stats` fell through to the `/v1` 404 path.

## GREEN

Minimal `server.js` change: a `/stats` branch inserted after `/health` and before the `/v1` checks:

```js
if (incoming.pathname === "/stats" && !authorized(req)) {
  return sendJson(req, res, 401, { error: "Unauthorized" });
}
```

Behavior: `authorized(req)` false → `401 { "error": "Unauthorized" }`, no upstream contact. No 200 path, no counters, no admission/budget bypass logic beyond placement, no doc edits.

GREEN pass output:

```
✔ GET /stats returns 401 without a token (628.771615ms)
✔ proxy (638.903385ms)
ℹ tests 1
ℹ suites 1
ℹ pass 1
ℹ fail 0
```

`/stats` 401 path never contacts upstream — asserted via zero upstream request records in the test itself.

## npm test summary (full suite)

```
ℹ tests 204
ℹ suites 21
ℹ pass 204
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

Suite green: 204 tests, 204 pass, 0 fail. No regressions introduced by the `/stats` branch; existing routes unchanged.

## Concerns

- Tracer placed `/stats` before `/v1` checks but after `/health`, exactly as the story requires. `/stats` is not under `/v1`, so `authorized()` is called explicitly in this branch (matches story precondition).
- Auth-before-unconfigured ordering preserved: missing/invalid token returns 401 before any unconfigured check.
- No new env var, no `CONFIG_ENV_VARS` change, zero runtime deps, ESM only.
- `/stats` 401 path returns before any `fetch` or admission call — verified by the zero-upstream-requests assertion.
- The report itself is a new file under `specs/epics/e04-rate-limiting/briefs/`; it is not part of the `git add server.js server.test.js` constraint and is intentionally uncommitted here per branch note.

## Next

Continue the e04s08 story: task 1 admission counters, task 2 budget counters, task 3 server counters, task 4 full `/stats` route (200 path + allowlist), task 5 counter-delta tests, task 6 regression pin, task 7 doc/test-count sync.
