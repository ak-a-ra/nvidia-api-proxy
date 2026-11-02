# e04s08 task 4 review — GET /stats route + black-box tests

Verdict: **PASS**

Branch: `feat/e04s08-stats`, commits `eb68dd7` (RED tests), `eff0a27` (feat /stats), `cb2d869` (style).
Scope: only `server.js` and `server.test.js` changed; no new env var, zero runtime deps, ESM preserved.

## Authoritative key count: 21 (prose/count mismatch confirmed)

The spec's own §3 ("Exact top-level allowlist field set") and §17 ("exact allowlist field set") enumerations list exactly **21 keys**:

`rateLimitEnabled`, `effectiveGlobalRpm`, `effectiveGlobalTpm`, `safetyMarginPct`, `maxConcurrentRequests`, `maxQueueSize`, `queueTimeoutSeconds`, `active`, `queued`, `admitted`, `waits`, `queueFullRejections`, `queueTimeoutRejections`, `oversizedBodyRejections`, `costOverLimitRejections`, `queuedClientDisconnects`, `activeClientDisconnects`, `completed`, `usageReconciled`, `usageEstimateFallbacks`, `trackedModels`

The prose that says "24-key allowlist" / "exactly 24 top-level keys" appears at spec lines ~38, ~105, ~139, ~166, ~238 and in several test assert messages/descriptions. That prose is wrong; the code, the §3/§17 enumerations, and all tests consistently use **21**.

**Doc finding (confirmed):** prose/count mismatch — "24" appears in spec narrative while §3/§17 enumeration + implementation + tests all say 21. Out of scope for this task (touch only `server.js`/`server.test.js`), flagged here for task 7 / a docs PR to reconcile.

## Verified against brief

- RED commit `eb68dd7` truly failed: against pre-GREEN `server.js`, authorized `/stats` answered `404`. RED verify gate: `# tests 9 / pass 2 / fail 7`, decisive line `404 !== 503`, gate COUNT=2 below `>= 10`, RC=1.
- GREEN commit `eff0a27` wires `/stats` after `/health`, before `/v1/*` checks, before `admission.acquire`/`budget.reserve`/`fetch`.
- Auth ordering: `!authorized` → 401 before `config.unconfigured` → 503; both 401/503 contact zero upstream.
- non-GET on `/stats` → 404 `{ error: "Not found" }` (HEAD excluded from body assert per test).
- 200 returns exactly the 21-key allowlist via `sendJson` (exact content-length).
- Disabled shape: `rateLimitEnabled:false`, effective RPM/TPM `null`, `safetyMarginPct:5`, `maxConcurrentRequests:null`, `maxQueueSize:32`, `queueTimeoutSeconds:30`, all counters `0`.
- Saturation bypass: 200 while concurrency ceiling + queue full; admission/budgets/upstream never consulted.
- Upstream receives zero requests for `/stats` (401, 503, and 200 paths).
- Self-exclusion: two 200 `/stats` calls produce identical counters (including `completed`).
- Privacy exclusions: no path/query/body/prompt/completion/API key/proxy token/authorization/upstream/host/origin/model/models leaked; `trackedModels` asserted as a count only.
- Existing routes unchanged (no regression); suite green.

## Gates

| Gate | Result |
|---|---|
| RED verify (`>= 10` stats tests) | pass — COUNT=10 after GREEN; RED failed as expected |
| `npm test` | `# tests 227 / # pass 227 / # fail 0`, exit 0 |
| `npm run check` (lint + typecheck + format) | rc 0, clean |
| Files touched | `server.js`, `server.test.js` only |
| Deps / env | zero new deps, ESM only, no new env var |

## Concerns (non-blocking)

- Prose "24-key allowlist" vs actual 21-key allowlist — doc inconsistency confirmed; does not affect code correctness. Recommend reconciling spec prose and test messages to "21-key allowlist" in task 7 or a docs PR.
- `specs/epics/e04-rate-limiting/epic.yaml` and `specs/state.yaml` were modified before this task; left untouched per task constraints (no `tasks.yaml` edit, leave specs uncommitted). Test-count sync (203 → 227) deferred to task 7.

TL;DR: PASS — `/stats` branch correctly implemented, all gates green, 21-key allowlist confirmed authoritative; "24-key" prose is a doc mismatch flagged for reconciliation.
