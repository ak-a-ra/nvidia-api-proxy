# e04s07 Task 4 Review: Prove conservative terminal paths

## Verdict

Overall: **PASS**. Spec compliance: **PASS**. Code quality: **PASS**. No must-fix findings. Two should-fix items, both report/test-strength only; no production code or implementation change required.

## Scope and diff reviewed

- Base for review package: `901eec0` (`chore(e04s07): add task 4 brief`) through `HEAD`.
- Task 4 commits:
  - `8c07178` `test(e04s07): upstream 429 passes through exactly once` (`server.test.js`, +17)
  - `dcf836b` `test(e04s07): upstream 429 retains the estimate` (`server.test.js`, +16)
  - `476cb4e` `test(e04s07): pre-header failure remains a generic 502` (`server.test.js`, +19)
  - `97355de` `test(e04s07): mid-stream non-streaming failure destroys only the response` (`server.test.js`, +34; includes stub support)
  - `ac17817` `test(e04s07): client disconnect commits the estimate without a 502` (`server.test.js`, +21)
  - `397f101` `chore(e04s07): mark task 4 passing and add task 4 report` (`e04s07-tasks.yaml`, report)
- Changed files since `901eec0`: `server.test.js`, `specs/epics/e04-rate-limiting/e04s07-tasks.yaml`, `specs/epics/e04-rate-limiting/briefs/e04s07-t04-report.md`. No production file changed.

## Required test names and behavioral strength

All five required names are present exactly in `describe("e04s07 non-streaming usage reconciliation")`:

1. `server.test.js:5240` `upstream 429 passes through exactly once`
2. `server.test.js:5257` `upstream 429 retains the estimate`
3. `server.test.js:5273` `pre-header failure remains a generic 502`
4. `server.test.js:5292` `mid-stream non-streaming failure destroys only the response`
5. `server.test.js:5319` `client disconnect commits the estimate without a 502`

Observed behavior:
- Test 1: upstream 429 status, exact JSON body, original `Retry-After: 7`, `receivedRequests.length === 1`, then 50 ms delay and recheck `=== 1` for delayed replay. Strong.
- Test 2: first upstream 429 completes; second request under `RATE_ON` (`PROXY_RPM=60`, `PROXY_TPM=1500`) is rejected 429; `receivedRequests.length === 1`. Proves the estimate remains committed. Strong.
- Test 3: pre-header socket destruction yields status 502 and exact `{ "error": "Bad gateway" }`; checks no base URL, hostname, port, or `/nvidia/i`; `/health` returns 200 `{ status: "ok" }`. Strong.
- Test 4: mid-body socket destruction after headers; asserts status 200 and terminated/partial body; `/health` 200; later normal request returns exact body. Strong; stub is one-shot.
- Test 5: client reads first chunk, cancels, `assertUpstreamAborted` confirms upstream response closed without finishing; 50 ms settle; following request rejected 429. Upstream cancellation and estimate retention proven.

## Stub changes reviewed

- `server.test.js:20` `requestCount` is declared inside `startStubUpstream`, so it is per-stub-instance and resets across tests. No cross-test leakage observed.
- `server.test.js:29` increments at request entry, before body parsing, so aborted/pre-header requests still count.
- `server.test.js:148-152` `midabortOnce` fails only `requestCount === 1`, writes `{"partial":true`, then `setImmediate(() => req.socket.destroy())`. Later requests use the normal status/body/headers path, satisfying deterministic process-health proof.
- Resource cleanup follows existing `t.after` LIFO registration: stub closes after proxy child kill. No new cleanup gaps observed.

## Findings

### Must-fix

None.

### Should-fix

1. `specs/epics/e04-rate-limiting/briefs/e04s07-t04-report.md:11` — report base commit is `c29e492`, but the first task-4 test commit's parent is `901eec0` (`chore(e04s07): add task 4 brief`). Prior task reports in this repo use the brief commit as base (for example `e04s07-t03-report.md` base `f2f5464`, which is the task-3 brief commit). Correct the base commit and restate the "changed files since base" sentence accordingly. Evidence: `git show -s --format='%H %P' 8c07178` → parent `901eec0`; `git show -s --format='%H %s' 901eec0`.
2. `server.test.js:5319-5336` — the client-disconnect test does not explicitly assert that no 502 body is delivered to the disconnected client, although brief requirement 4 asks for that assertion. The current proof relies on `reader.cancel()` and the absence of a response body read. Strengthen by capturing the read result/error and asserting no `502`/`Bad gateway` payload is observed before cancellation. Evidence: test body at `server.test.js:5328-5336`.

### Consider

1. `server.test.js:5292-5316` — the mid-stream assertion `readError || received.length < body.length` is appropriate, but it does not explicitly distinguish a destroyed stream from a successfully truncated-but-complete short body. The status 200 plus later successful request make the practical proof sufficient. Optional: assert `readError` is a stream/abort error when present.
2. `server.test.js:5240-5255` — the delayed-replay check waits only 50 ms. This is consistent with other tests and sufficient for the proxy's synchronous pass-through behavior, but a slightly longer settle would make the negative assertion more robust without changing production behavior.

## Verification performed

- Focused five tests:
  `node --test --test-reporter=tap --test-name-pattern 'passes through exactly once|upstream 429 retains the estimate|generic 502|mid-stream non-streaming failure|commits the estimate' server.test.js`
  Result: `tests 5`, `suites 1`, `pass 5`, `fail 0`.
- `npm run check`: lint, typecheck, and format:check all clean.
- `git diff --check`: clean (no whitespace errors).
- Test counts: `grep -c '^[[:space:]]*test(' server.test.js` = 199; base `901eec0` had 194.
- Commit hashes in report verified valid and subjects match.
- Production files (`server.js`, `observer.js`, `budget.js`, `admission.js`, `config.js`, `package.json`) are unchanged in the task-4 range.

## Cannot verify from this review

- Full `npm test` was not rerun per task instructions; report records 199/199 green and the focused run plus count check are consistent with that.
- Whether each of the five test-only commits individually passed at its own commit was not replayed here; the report's per-commit evidence was accepted as recorded.
- The exact SIGTERM flake disclosure mentioned in the review request was not found in the task-4 report; the report only states focused and final verification results. If a SIGTERM flake is expected in this task's evidence, it is not documented in `e04s07-t04-report.md`.

## Report inaccuracies

1. Base commit should be `901eec0`, not `c29e492` (`report.md:11`, `report.md:77`).
2. "Changed files since base commit `c29e492`" should be reworded once the base is corrected; with base `901eec0`, the task-4 brief is not a changed file in the task range.
3. The SIGTERM flake referenced in the review request is not recorded in the report; if applicable, add it to concerns/facts.

## Conclusion

Task 4 meets its scope: five exact tests pin conservative terminal-path behavior, stub changes are minimal and deterministic, no production files changed, quality gate clean. PASS.
---

## Scoped re-review: fix round 1/5

### Finding resolution

1. **Client-disconnect no-502 assertion — ADDRESSED**
   - `server.test.js:5327`: `assert.notEqual(res.status, 502, "disconnected client never receives a proxy 502")`.
   - `server.test.js:5330-5331`: first chunk decoded and asserted not to contain `Bad gateway`.
   - `server.test.js:5337-5346`: post-cancel read decoded and asserted not to contain `Bad gateway`; read terminates via error or `done`.
   - Upstream-abort proof remains at `server.test.js:5347` (`assertUpstreamAborted(teardowns)`).
   - Estimate-retention proof remains at `server.test.js:5350` (`second.status === 429`).

2. **Report base commit / changed-files wording — ADDRESSED**
   - `e04s07-t04-report.md:11`: base commit now `901eec0`.
   - `e04s07-t04-report.md:77`: changed files now `server.test.js`, task 4 status row, and report; no stale task-4-brief wording.

3. **SIGTERM flake disclosure — ADDRESSED**
   - `e04s07-t04-report.md:57`: final verification includes SIGTERM flake disclosure.
   - `e04s07-t04-report.md:90`: concerns section includes SIGTERM flake disclosure.
   - `e04s07-t04-report.md:96-106`: Fix round 1 records focused, verify, full-suite, check, and diff-check evidence.

### New-breakage check (fix diff only)

- `a989417` changes only test assertions; no production files changed.
- `assert.notEqual(res.status, 502)` is valid because the abortable path responds 200 before holding.
- Post-cancel read termination assertion accepts either an error or `done`, matching stream cancellation behavior.
- Focused run: `client disconnect commits the estimate without a 502` — 1 test, 1 suite, 0 fail.
- `npm run check` — clean.
- `git diff --check` — clean.

### Evidence caveat

Report final verification and Fix round 1 state 199/199 green, while the latest full-suite result is 198/199 due a known environmental SIGTERM flake. This does not reopen the three findings above; if the report must reflect the latest run, adjust the final count to 198/199 or note the flaky rerun explicitly. This is a documentation-consistency note, not a code or test breakage.

### Scoped verdict

PASS. Addressed: 3. Open: 0.
