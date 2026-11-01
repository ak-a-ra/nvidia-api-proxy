# e04s08 final whole-branch review

Branch: `feat/e04s08-stats`
Base: `main` @ `6ac2c66`
Verdict: **PASS** (with one non-blocking documented concern)

## Review scope

Full e04s08 implementation: `/stats` route, admission/budget/server counters, tests, docs count 237, status files, verifications evidence.
Diff surface: `git diff main...HEAD -- server.js admission.js budget.js server.test.js config.js` plus docs/status diffs.

## Findings

### 1. Zero runtime dependencies — PASS

`package.json` `"dependencies"` absent; only `devDependencies` (`@types/node`, `eslint`, `prettier`, `typescript`). `"type": "module"` confirmed. `npm test` stays `node --test`.

### 2. ESM only — PASS

`import` throughout; no `require`.

### 3. No new env var / no `CONFIG_ENV_VARS` change — PASS

`config.js` unchanged. `CONFIG_ENV_VARS` at `server.test.js:274` untouched. `/stats` reads only existing config fields and counters. Task 7 sweep confirmed no `CONFIG_ENV_VARS` delta.

### 4. `/stats` auth-before-unconfigured — PASS

Branch order in `server.js`: `/health`, then `/stats` (`!authorized(req)` → 401 before `config.unconfigured` → 503), then `/v1/*` checks, then `admission.acquire`/`budget.reserve`/`fetch`. Missing/invalid token → `401 { error: "Unauthorized" }`, zero upstream contact. Valid token while unconfigured → `503 { error: "Proxy is not configured" }`. Non-GET → `404 { error: "Not found" }`.

### 5. Bypasses admission/budgets/upstream — PASS

`/stats` placed before `admission.acquire` and `budget.reserve`; never calls `fetch`. Saturation test: `/stats` returns 200 with 21 keys while concurrency ceiling + queue full; `receivedRequests.length` unchanged.

### 6. Exact allowlist — PASS (one prose concern)

Code builds exactly 21 keys:

`rateLimitEnabled`, `effectiveGlobalRpm`, `effectiveGlobalTpm`, `safetyMarginPct`, `maxConcurrentRequests`, `maxQueueSize`, `queueTimeoutSeconds`, `active`, `queued`, `admitted`, `waits`, `queueFullRejections`, `queueTimeoutRejections`, `oversizedBodyRejections`, `costOverLimitRejections`, `queuedClientDisconnects`, `activeClientDisconnects`, `completed`, `usageReconciled`, `usageEstimateFallbacks`, `trackedModels`

Spec §3/§17 enumerate 21; spec prose reconciled to 21 in task 7.

**Concern (non-blocking):** `server.test.js:794` assertion message still says `"exactly the 24-key allowlist"` while the `expected` array and `deepEqual` comparison pin 21 keys. Test passes (comparison is on sorted key arrays; message string is cosmetic only). Recommend renaming message to "21-key allowlist" in a follow-up docs/test cleanup.

### 7. Disabled shape — PASS

`rateLimitEnabled: false`, `effectiveGlobalRpm: null`, `effectiveGlobalTpm: null`, `safetyMarginPct: 5`, `maxConcurrentRequests: null`, `maxQueueSize: 32`, `queueTimeoutSeconds: 30`, all counters `0`.

### 8. Privacy exclusions — PASS

Body contains no path/query/body/prompt/completion/API key/proxy token/authorization/upstream/host/origin/model/models. `trackedModels` asserted as count only. Log line field set unchanged (`ts`/`method`/`path`/`status`/`ms`); `/stats` path is the client's own request target (disclosed behavior, no new leak).

### 9. Self-exclusion — PASS

Two `/stats` 200 calls produce identical counters including `completed`. `/stats` increments no counter, calls no admission/budget/fetch.

### 10. Counters monotonic / exactly-once — PASS

- `admission.js`: `admitted`, `waits`, `queueFullRejections`, `queueTimeoutRejections`, `queuedClientDisconnects` incremented once per matching terminal ticket outcome in `settleTicket`/`acquire`. Read-only getters; disabled path returns zero getters; assignment throws.
- `budget.js`: `costOverLimitRejections` incremented once per `reserve()` rejection (global and model windows); `trackedModels` null-prototype map keyed by `cost.model` strings (`"__proto__"` ordinary key → count 2 with `__proto__`+`m`); `usageReconciled`/`usageEstimateFallbacks` alias existing `reconciledCount`/`fallbackCount`. Disabled path zero.
- `server.js`: `completed`, `oversizedBodyRejections`, `activeClientDisconnects` incremented once per terminal event. `activeClientDisconnects` catch gate fixed from `error.name === "AbortError" && error.message === "client disconnected"` to `error.message === "client disconnected"` (task 5 RED caught the miswire; GREEN one-line fix).

### 11. 24→21 prose — PASS in spec; concern in test message

Story spec prose reconciled to "21-key" (§6, §8, invariant #4, Gherkin). Test message `server.test.js:794` still says "24-key allowlist" (see #6 concern).

### 12. Living docs test count 237 — PASS

All living-doc sites state 237: `README.md` badge + tip, `AGENTS.md`, `CONVENTIONS.md`, `specs/README.md`, `tech-stack.md`, `TEST_PLAN_LATEST.md` (×3), `VISION_LATEST.yaml`, `state.yaml`, `e04s01` story spec, `e04s07` story spec, `e04s08` story spec §21. Count sweep CLEAN N=237. Exclusions honored (`plans/`, `docs/research/config-invariant-guard-tests.md`, `LOG.md`, `specs/epics/*/briefs/`, `specs/epics/*/*-tasks.yaml`, `specs/verifications/`).

### 13. `npm run check` rc 0 — PASS

lint + typecheck + format:check all green.

### 14. `npm test` — 237 pass, 0 fail — PASS

Ran full suite: `tests 237`, `pass 237`, `fail 0`, `cancelled 0`, `skipped 0`, `todo 0`, `duration_ms 219830.944031`. All 10 new `/stats` black-box tests pass, all 10 counter-delta tests pass, all admission/budget direct-import shape tests pass, no regressions on existing routes.

### 15. Security — PASS

No secrets, model IDs, paths, or queries in `/stats` body or logs. Auth reuses SHA-256 digest + `timingSafeEqual` (no raw-byte comparison). `trackedModels` reports count only.

### 16. TDD gate — PASS with recorded waiver

- Task 1: RED `ca3ad67` (test-only) → GREEN `dd40cdd`. PASS.
- Task 2: combined commit `1dac39e` (no separate RED test-only commit). **Waived** per user decision 2026-11-01; recorded in `specs/epics/e04-rate-limiting/briefs/e04s08-t02-review.md`. Behavior/tests/suite/check all green; only RED test-only commit evidence missing.
- Task 4: RED `eb68dd7` → GREEN `eff0a27` (+ style `cb2d869`). PASS.
- Task 5: RED `6881fd1` → GREEN `c7d1395` (one-line `server.js` catch-gate fix). PASS.

### 17. Stray root dot-diff files — PASS (untracked, not committed)

`.g_test_diff.txt`, `.green.diff`, `.green_server.diff`, `.green_test.diff`, `.red.diff` remain untracked; not staged/committed. Pre-existing e04s08 briefs/reports also untracked and out of scope.

## Status files

- `epic.yaml`: e04s08 `status: passing`, `bcps: 7`, spec/tasks filenames present.
- `specs/execution-status.yaml`: `e04s08: passing`; `e04s09` blocked by e04s08.
- `e04s08-tasks.yaml`: story `status: passing`; all 7 tasks `status: passing`.
- `specs/verifications/e04s08-verify.yaml`: evidence (check rc 0, TAP 237/237/0, task-7 gate N=237, reviewer verdicts).
- `specs/state.yaml`: branch `feat/e04s08-stats`, commit `8aebdcc`, handoff note records e04s08 landed, 237 tests, 21-key allowlist.

## Verdict

**PASS.** All code, tests, suite (237/0), `npm run check` (rc 0), auth ordering, bypass, allowlist, disabled shape, privacy, self-exclusion, monotonic counters, docs count, zero-deps, ESM, and status files verified. One non-blocking concern: `server.test.js:794` message says "24-key allowlist" instead of "21-key allowlist" — cosmetic, does not affect correctness; fix in follow-up cleanup. Task 2 TDD RED commit waived and recorded in `e04s08-t02-review.md`. No code or docs committed by this review.

TL;DR: e04s08 final review PASS — `/stats` route, all counters, tests (237/0), `npm run check` rc 0, docs count 237, zero deps, ESM, auth-before-unconfigured, bypass, 21-key allowlist, privacy, self-exclusion all verified; only non-blocking concern is test message "24-key" at server.test.js:794, task 2 RED waiver recorded.
