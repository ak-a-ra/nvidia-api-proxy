# e04s07 release flake fix report

Status: fixed and verified.

Root cause: in `server.test.js`, test "shutdown rejects late arrivals and keeps health responsive" created two fetch promises (`late`, `health`) but awaited `late` to completion before attaching any handler to `health`. If `health` rejected while `late` was still pending, Node reported it as an unhandled promise rejection (`TypeError: fetch failed`, cause `read ECONNRESET`), failing the test even though both outcomes were otherwise allowed. The race was in test harness promise handling, not proxy shutdown behavior.

Fix: await both requests with `Promise.allSettled([late, health])` immediately after creation, so both promises are handled from the start. Assertions and allowed outcomes unchanged; no production code changed.

Files changed:
- `server.test.js` (test only)

Verification (Node 24, `LD_LIBRARY_PATH=`):
- Focused flaky test: 15/15 pass.
- `e04s03 abort-aware and shutdown-safe admission` suite: 8 consecutive runs, all pass (15 tests each).
- Full suite: 203/203 pass, 0 fail.
- `npm run check`: lint, typecheck, format all pass.

Risks:
- Fix is test-harness only; proxy SIGTERM behavior unchanged.
- `settle(50)` post-SIGTERM window retained; if future environments need more time, revisit separately.
- No co-author footer; commit pending.
