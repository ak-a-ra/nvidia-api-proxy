# e04s08 task 5 report — exact counter deltas per event class

Branch: `feat/e04s08-stats`
Task: `e04s08-tasks.yaml` id 5
Brief: `specs/epics/e04-rate-limiting/briefs/e04s08-t05.md`

## git log -2 --oneline

```
c7d1395 feat(e04s08): wire activeClientDisconnects counter on real client-disconnect path
6881fd1 test(e04s08): add black-box counter delta tests (RED)
```

## RED failure lines (against pre-GREEN server.js)

`activeClientDisconnects` counter never incremented: the catch block gated on `error.name === "AbortError" && error.message === "client disconnected"`, but `ac.abort(new Error("client disconnected"))` makes undici reject with `name: Error, message: "client disconnected"`, so `error.name === "AbortError"` was false and `activeClientDisconnects` stayed 0.

Decisive line from RED output (test name pattern `counter delta|exact delta|deltas per event`):

```
not ok 7 - counter delta: activeClientDisconnects +1 when an admitted client disconnects
  activeClientDisconnects must advance exactly once
  0 !== 1
```

RED verify gate:
- `# tests 10 / # pass 9 / # fail 1`
- RC=0 (subtest suite failed but gate count was 9 ≥ 8 once test names matched the pattern; the genuine miswire surfaced)

## GREEN fix

Minimal counter-placement fix in `server.js` only: the catch block now matches `error.message === "client disconnected"` (dropping the incorrect `error.name === "AbortError"` check), so `activeClientDisconnects++` fires on a real admitted-client disconnect. One line changed, one file touched (`server.js`), committed as `c7d1395` (feat). `server.js` otherwise untouched — no response behavior changes, no new env var, zero deps, ESM preserved.

## Verify output (GREEN, after `npm run format` fold into RED commit)

```
node --test --test-reporter=tap --test-name-pattern 'counter delta|exact delta|deltas per event' server.test.js
```

```
# tests 10
# suites 1
# pass 10
# fail 0
```
- Matching test count: 11 `ok` lines (gate requires `>= 8`), RC=0.
- All 10 event classes pass:
  - completed +1 on proxied completion, active returns to prior
  - oversizedBodyRejections +1 on over-cap body, upstream not contacted
  - costOverLimitRejections +1 on over-TPM, upstream not contacted
  - queueFullRejections +1 when the queue is full
  - queueTimeoutRejections +1 when a queued ticket times out
  - queuedClientDisconnects +1 when a queued client disconnects
  - activeClientDisconnects +1 when an admitted client disconnects
  - usageReconciled +1 on valid usage
  - usageEstimateFallbacks +1 on unusable usage
  - trackedModels increases at most 1 for a new model

Each test uses a fresh `withProxy` child so deltas are isolated and exact.

## npm test

```
ℹ tests 237
ℹ suites 24
ℹ pass 237
ℹ fail 0
```
- 227 baseline + 10 new counter-delta tests, exit 0.
- Test count is now 237; living-doc count sync (227 → 237) is task 7, intentionally not done here.

## npm run check

rc 0 — lint clean (`no-return-await` on `readStats` removed), typecheck clean, format:check clean (Prettier applied to `server.test.js` only).

## Concerns

- `git log -2 --oneline` shows `c7d1395` then `6881fd1` then `f1ac952`: RED test-only commit `6881fd1` (test-only, 1 file) and GREEN feat `c7d1395` (server.js only, 1 file). `specs/*` files were already modified in the working tree before this task (epic.yaml, state.yaml) and were left uncommitted per constraints — `git add -A` was never used, specs stay uncommitted.
- RED test names were renamed to include `counter delta:` so they match the verify gate pattern; no test logic weakened.
- `completed` remains incremented also on the post-admission destroyed-response branch (line ~377); that pre-existing behavior is not part of this task's scope (task 5 only asserts completed advances exactly once on a real proxied completion, which holds).
- No doc count sync, no tasks.yaml edit, no new env var, no `/stats` response-shape changes, no self-exclusion violation (/stats moves no counter).

TL;DR: GREEN — 10 counter-delta tests pass (gate >= 8), `activeClientDisconnects` miswire fixed with a one-line server.js change, full suite 237 pass / 0 fail, `npm run check` rc 0, RED test-only commit `6881fd1` and GREEN feat commit `c7d1395` split cleanly on `feat/e04s08-stats`, specs left uncommitted.
