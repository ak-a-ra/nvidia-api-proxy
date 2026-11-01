# e04s08 task 1 review — admission counters

**Verdict: PASS**

Commits reviewed:
- `ca3ad67 test(stats): admission counter getters` (test-only, `server.test.js`)
- `dd40cdd feat(stats): expose monotonic admission counters` (`admission.js` + `server.test.js`)

## Scope
Only `admission.js` and `server.test.js` changed. `git show --stat` confirms no other files touched in either commit. Zero runtime deps (Node built-ins only), ESM `import`, no new env var, no entry added to `CONFIG_ENV_VARS`.

## Findings — all satisfied

**Counters exist on both paths.** Disabled path (`maxConcurrentRequests === null`) exposes zero-valued read-only getters for `active`, `queued`, `admitted`, `waits`, `queueFullRejections`, `queueTimeoutRejections`, `queuedClientDisconnects`. Enabled path exposes same getters backed by incrementing counts. Verified by direct import and task-1 verify command.

**Monotonic, read-only, no reset.** Getters defined via `Object.defineProperties` with `get` only (no setter); assignment throws in strict mode. Counters only increment, never decrement or reset.

**Exactly-once increments per terminal outcome.**
- `admitted++` on immediate admission and on waiter release-admission in `createReleaseHandle`.
- `waits++` once per ticket pushed onto the queue.
- `queueFullRejections++` on `QUEUE_FULL` rejection.
- `queueTimeoutRejections++` on `QUEUE_TIMEOUT`.
- `queuedClientDisconnects++` on `CANCELLED` while queued (both pre-abort and abort-listener arms).

**Settle-once preserved.** `settleTicket` guards with `ticket.settled` (first caller wins, later calls are no-ops). Counter increments are placed at terminal sites outside the guard so each terminal outcome increments exactly once.

**No admission behavior change.** Counter increments are additive side effects; no admission decision, queue logic, release logic, or timing is altered.

**Tests.** Direct-import + behavioral tests in `describe("e04s08 admission counters")` (7 tests): disabled zero getters, read-only assignment throws, immediate admission increments `admitted` once, `waits` increments once per queue entry, queue-full rejection, queue-timeout rejection, queued client disconnect, counters settle once. No `.skip`/todo, no weakened assertions, no skips. The feat commit's `+5-5` tweak to the `waits` test swaps the timeout-after-queue assertion for an admission-from-queue assertion (`admitted`/`active`); the timeout path remains covered by the dedicated queue-timeout test, and the `waits` assertion is retained — not a weakening.

**Task 1 verify command.** `node --input-type=module -e "..."` (direct import shape check) exits 0, prints `admission counters shape ok`.

**`npm test`.** `# tests 211`, `# pass 211`, `# fail 0`, `# skipped 0`. Suite fully green.

## Concerns
None.

## Next step
Task 1 is complete and reviewed. Do not commit; do not touch specs status files.

TL;DR: PASS — counters exist on disabled/enabled paths, monotonic read-only no-reset, exactly-once terminal increments, settle-once preserved, no admission behavior change, only admission.js/server.test.js changed, zero deps/ESM/no new env var, task-1 verify passes, npm test 211 pass 0 fail.
