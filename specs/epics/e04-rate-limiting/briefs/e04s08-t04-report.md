# e04s08 task 4 report — GET /stats route + black-box tests

Branch: `feat/e04s08-stats`
Task: `e04s08-tasks.yaml` id 4
Commit range: last 2

## git log -2 --oneline

```
cb2d869 style(stats): prettier format server.test.js
eff0a27 feat(stats): wire GET /stats branch with exact 21-key allowlist
```
(RED test-only commit `eb68dd7 test(stats): add black-box GET /stats tests (RED)` precedes.)

## RED failure

Before the GREEN patch, authorized `/stats` answered `404`. RED verify gate:

```
out=$(node --test --test-reporter=tap --test-name-pattern 'GET /stats|stats' server.test.js 2>&1); rc=$?; test "$rc" -eq 0 || { printf '%s\n' "$out"; exit "$rc"; }; n=...; test "$n" -ge 10 ...
```

Decisive RED line (first failing subtest):

```
not ok 3 - GET /stats returns 503 while unconfigured with a valid token
    Expected values to be strictly equal:
    
    404 !== 503
```

RED result: `# tests 9` / `# pass 2` / `# fail 7` (gate COUNT=2, RC=1, below the `>= 10` threshold).

## GREEN

`/stats` branch wired after `/health`, before `/v1/*` checks, before `admission.acquire`/`budget.reserve`/`fetch`:
- `!authorized(req)` → `401 { "error": "Unauthorized" }`
- `config.unconfigured` → `503 { "error": "Proxy is not configured" }`
- `req.method !== "GET"` → `404 { "error": "Not found" }`
- else `200` JSON via `sendJson` with exactly the 21 top-level keys: `rateLimitEnabled`, `effectiveGlobalRpm`, `effectiveGlobalTpm`, `safetyMarginPct`, `maxConcurrentRequests`, `maxQueueSize`, `queueTimeoutSeconds`, `active`, `queued`, `admitted`, `waits`, `queueFullRejections`, `queueTimeoutRejections`, `oversizedBodyRejections`, `costOverLimitRejections`, `queuedClientDisconnects`, `activeClientDisconnects`, `completed`, `usageReconciled`, `usageEstimateFallbacks`, `trackedModels`.
- `/stats` increments no counter (self-exclusion), never contacts upstream, bypasses admission/budgets.

GREEN verify gate output (tail):

```
# tests 10
# suites 1
# pass 10
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

COUNT=10 (gate requires `>= 10`), RC=0.

## npm test

Full suite green:

```
ℹ tests 227
ℹ suites 23
ℹ pass 227
ℹ fail 0
```

`# tests 227` / `# pass 227` / `# fail 0`. Exit code 0.

## npm run check

`npm run check` (lint + typecheck + format:check) passed: RC=0. ESLint clean, `tsc` clean, Prettier check clean (`All matched files use Prettier code style!`).

## Concerns

- The story brief and spec text repeatedly say "24-key allowlist", but the actual allowlist has exactly 21 keys (the spec's own §3 list enumerates 21 entries). Tests pin 21, matching the code and §3 list; the "24" phrasing in §3 header/§17 is a doc inconsistency I did not correct (scoped to `server.js`/`server.test.js` only, per task constraints).
- `specs/epics/e04-rate-limiting/epic.yaml` and `specs/state.yaml` were already modified before this task (task-1/2/3 landing); I left them untouched per the "no tasks.yaml status edit / leave specs uncommitted" constraint.
- Test count moved from 203 → 227 across the e04s08 slice (tasks 1–4). Living-doc count sync belongs to task 7, which this task explicitly defers ("no doc count sync").
