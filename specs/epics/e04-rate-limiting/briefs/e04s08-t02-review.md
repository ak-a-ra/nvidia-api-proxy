# e04s08 task 2 review — budget counters

## Verdict: CONCERNS

Behavior is correct, but the TDD RED/GREEN gate is violated: no separate RED test-only commit exists for task 2.

## Evidence

### Two-commit RED/GREEN gate — FAIL

`git log --oneline -5` on branch `feat/e04s08-stats`:

```
1dac39e feat(stats): expose monotonic budget counters
dd40cdd feat(stats): expose monotonic admission counters
ca3ad67 test(stats): admission counter getters
```

Task 1 followed the gate correctly: `ca3ad67` (test-only, `server.test.js` only, 161 insertions, 0 deletions = RED) then `dd40cdd` (feat, `admission.js`+`server.test.js` = GREEN).

Task 2 did NOT. `1dac39e` is a single mixed commit:
- `budget.js`: 38 insertions / 2 deletions (implementation)
- `server.test.js`: 93 insertions / 8 deletions (new tests PLUS pre-existing admission-counter cleanup)

There is no `test(stats): budget counter getters` RED commit. The `e04s08-t02-report.md` RED/GREEN narrative describes tests failing before implementation, but `git log` shows they landed in the same commit as the implementation, so RED was never independently observed/committed.

Missing evidence (exact): a `test(stats): budget counter getters` commit touching only `server.test.js` whose `node --test` run fails because the `costOverLimitRejections`/`trackedModels`/`usageReconciled`/`usageEstimateFallbacks` getters are absent on `budget.js`, preceding `1dac39e`.

### Behavior (budget.js) — PASS

Verified by running the task-2 `verify:` command exactly (from `e04s08-tasks.yaml` task 2): `VERIFY OK` (exit 0).

- `estimateCost` untouched/pure — diff touches only the disabled block and `reserve()`/`getter` section.
- Disabled gate (`createBudget(null, ...)`): read-only getters `costOverLimitRejections`, `trackedModels`, `usageReconciled`, `usageEstimateFallbacks` all return `0`; assignment throws (strict mode `defineProperties` without setter).
- Enabled gate: keeps `reconciledCount`/`fallbackCount`; aliases `usageReconciled`/`usageEstimateFallbacks` return same values.
- `costOverLimitRejections`: incremented exactly once per `reserve()` rejection (global window and model window), never on admitted reservation.
- `trackedModels`: null-prototype map (`Object.create(null)`), keyed by `cost.model` only when `typeof cost.model === "string"`, `"__proto__"` counts as an ordinary key (test asserts 2 for `__proto__`+`m`), reports size only, never stored in responses.
- No reservation/admission behavior change; no new env var; zero runtime deps; ESM; `server.js`/`config.js` untouched.
- Only `budget.js` and `server.test.js` changed (`git show --numstat 1dac39e` confirms).

### Tests (server.test.js) — PASS

New `describe("e04s08 budget counters")` block: 6 direct-import behavioral tests, no `t.skip`, no `todo`, no weakened assertions:
1. disabled path exposes zero-valued read-only getters
2. admitted reserve does not increment `costOverLimitRejections`
3. rejected reserve increments `costOverLimitRejections` once
4. same model twice -> `trackedModels` 1
5. `__proto__` model tracked as ordinary key -> 2
6. aliases match existing getters (after `reconcile(10)`)

Pre-existing admission-counter tests in the same commit had `t → _t` and unused-var cleanup (behavior-neutral lint fix, noted in report). No assertions weakened.

### Suite + quality gate — PASS

- `npm test`: tests 217, pass 217, fail 0, skipped 0. The 6 new budget-counter tests pass; no regressions.
- `npm run check` (lint + typecheck + format:check): exit 0, green.

### Story spec alignment (sections 3/6/8/11/17) — PASS

- §3/§6/§8: `budget.js` exposes `usageReconciled`/`usageEstimateFallbacks` aliases, `costOverLimitRejections`, `trackedModels`; `estimateCost` stays pure; null-prototype `__proto__` handling.
- §11 invariant 8: `trackedModels` is a single integer, never per-model data.
- §17 / §16 risk: `"__proto__"` counted as ordinary key — covered by test.

## Findings

| # | Finding | Severity |
|---|---------|----------|
| 1 | No separate RED test-only commit for task 2; tests + implementation landed together in `1dac39e`. TDD RED/GREEN gate cannot be verified from history. | FAIL (gate) |
| 2 | Behavior, tests, suite (217/0), and `npm run check` all green. | — |

## Required before merge (TDD gate)

Reorder into two commits:
1. `test(stats): budget counter getters` — `server.test.js` only, new `describe("e04s08 budget counters")` block, failing against current `budget.js` (getters absent). Commit test-only.
2. `feat(stats): expose monotonic budget counters` — `budget.js` implementation, GREEN.

Do not edit `e04s08-tasks.yaml`. Test-count sync (203 → 217) is task 7's responsibility; left uncommitted here.

## TL;DR

CONCERNS: budget-counter behavior/tests/suite/check all PASS (217/0, `npm run check` green), but task 2's TDD gate FAILs because no separate RED test-only commit exists — tests and implementation landed together in `1dac39e`; missing evidence is a `test(stats): budget counter getters` test-only commit failing before `1dac39e`.

## Waiver

User decision 2026-11-01: leave combined commit `1dac39e` as-is and record this waiver. Behavior, tests, suite (217/217/0), and `npm run check` are green; only the RED test-only commit evidence is missing. Do not rewrite local history.
