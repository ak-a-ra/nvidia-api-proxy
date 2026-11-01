# e04s08 task 1 report — admission counters

## Git log
```
dd40cdd feat(stats): expose monotonic admission counters
ca3ad67 test(stats): admission counter getters
```

## RED
Direct-import tests in `server.test.js` (`describe("e04s08 admission counters")`) failed because the getters were absent:
```
✖ enabled path: queued client disconnect increments queuedClientDisconnects once
AssertionError: undefined !== 1
```
Commit `test(stats): admission counter getters` — test-only, `git add admission.js server.test.js`.

## GREEN
Implemented counters in `admission.js` on both paths:
- Disabled path: zero-valued read-only getters via `Object.defineProperties`.
- Enabled path: monotonic counters incremented once per terminal outcome (`admitted` on every admission including waiter release, `waits` on queue entry, `queueFullRejections`, `queueTimeoutRejections`, `queuedClientDisconnects` on CANCELLED while queued). Read-only getters; settle-once preserved; no reset; no admission-decision behavior change.

Commit `feat(stats): expose monotonic admission counters`.

## Task 1 verify command (exact)
```
node --input-type=module -e "..." 2>&1 | grep -q 'admission counters shape ok'
```
Exit code 0 — printed `admission counters shape ok`.

## npm test summary
- `# tests 211`
- `# pass 211`
- `# fail 0`

## Concerns
None. Suite fully green; counters are additive read-only getters and do not affect admission decisions.
