# e04s07 Task 5 Review: Prove exactly-once cleanup across terminal sequences

## Verdict

Overall: **PASS**. Spec compliance: **PASS**. Code quality: **PASS**. No must-fix findings. One should-fix item, report wording only; no production code or test change required.

## Scope and diff reviewed

- Base: `88b19d0` (`chore(e04s07): complete task 4 review loop`) through HEAD `89c5a35`.
- Task 5 commits:
  - `246b5b7` `test(e04s07): repeated cleanup sequences admit every request` (`server.test.js`)
  - `9752f25` `test(e04s07): every terminal path in sequence releases each slot` (`server.test.js`)
  - `08fad7c` `test(e04s07): a second reconciliation records no additional outcome` (`server.test.js`)
  - `a086565` `test(e04s07): counters do not double-count across repeated paths` (`server.test.js`)
  - `89c5a35` `chore(e04s07): mark task 5 passing and add task 5 report` (`e04s07-tasks.yaml`, report)
- Changed files since base: `server.test.js`, `specs/epics/e04-rate-limiting/e04s07-tasks.yaml`, `specs/epics/e04-rate-limiting/briefs/e04s07-t05.md`, `specs/epics/e04-rate-limiting/briefs/e04s07-t05-report.md`. No production file changed.

## Required test names and behavioral strength

All four required names are present exactly in `describe("e04s07 non-streaming usage reconciliation")`:

1. `server.test.js:5427` `repeated cleanup sequences admit every request`
2. `server.test.js:5459` `every terminal path in sequence releases each slot`
3. `server.test.js:5524` `a second reconciliation records no additional outcome`
4. `server.test.js:5535` `counters do not double-count across repeated paths`

Observed behavior:
- Test 1: four terminal paths (usage JSON 200, 204, upstream 429, fallback JSON 200) run sequentially under `PROXY_MAX_CONCURRENT_REQUESTS=1`; each completes with expected status/body; `receivedRequests.length` reaches 4. Strong.
- Test 2: four terminal paths (JSON, 204, HEAD, client disconnect) plus a post-disconnect probe under a one-slot ceiling; HEAD preserves declared `content-length` with empty body; disconnect reads first chunk then cancels; `assertUpstreamAborted(teardowns, 2000, 3)` confirms upstream teardown; fifth request succeeds and `receivedRequests.length` reaches 5. Strong.
- Test 3: `createBudget({ rpm: 60, tpm: 60 }, { safetyMarginPct: 0 }, null)`; `reserve(...)` then `reconcile(10)` returns `true`, `reconcile(20)` returns `false`; `reconciledCount === 1`, `fallbackCount === 0`. Strong.
- Test 4: same budget; `reconcile(null)` twice returns `false` both times and keeps `fallbackCount === 1`, `reconciledCount === 0`; later `reconcile(10)` returns `false` and changes neither counter. Strong.

## Stub changes reviewed

- `t05seq1` and `t05seq2` are deterministic, request-number-driven branches in `startStubUpstream`; no cross-test state beyond the existing per-instance `requestCount`.
- `assertUpstreamAborted` gained an optional `index` parameter defaulting to `0`, preserving existing callers.
- Cleanup follows the existing `t.after` LIFO registration; no new cleanup gaps observed.

## Findings

### Must-fix

None.

### Should-fix

1. `specs/epics/e04-rate-limiting/briefs/e04s07-t05-report.md:88` — "Proof that no production file changed" says `git diff --name-only 88b19d0..HEAD` lists only `server.test.js` and the task 5 brief. The actual range also includes the report and the task 5 status row. Correct the wording to list all changed files or state that no production file changed. Evidence: `git diff --name-only 88b19d0..HEAD` → `server.test.js`, `specs/.../briefs/e04s07-t05.md`, `specs/.../briefs/e04s07-t05-report.md`, `specs/.../e04s07-tasks.yaml`.

### Consider

1. `server.test.js:5508` — Test 2 waits 50 ms before the post-disconnect probe. This is consistent with other disconnect tests and sufficient here, but a slightly longer settle would make the negative assertion more robust. No production behavior change.
2. `server.test.js:5434` — Test 1 asserts sequential completion and request counts, but does not separately assert queued/rejected admission. The one-slot ceiling plus passing sequence provides that proof; no change required.

## Verification performed

- Task 5 verify command, verbatim: `rc=0`, `n=4`; 4 tests, 1 suite, 0 fail.
- Focused tests individually at HEAD: each of the four tests passes (1 pass, 0 fail).
- Focused tests individually at their own commits (`246b5b7`, `9752f25`, `08fad7c`, `a086565`): each passes (1 pass, 0 fail).
- `npm test`: 203 tests, 21 suites, 203 pass, 0 fail.
- `npm run check`: lint, typecheck, and format:check all clean.
- `git diff --check`: clean.
- Production files unchanged in `88b19d0..HEAD`.
- Test count: base 199, after 203 (`grep -c`).

## Cannot verify from this review

- No SIGTERM flake was observed in this review run; the full suite passed 203/203. If a later rerun flakes, record it separately rather than changing test assertions.
- Living-doc test counts remain at older values; task 6 owns that sync and it is correctly out of task 5 scope.

## Report inaccuracies

1. `e04s07-t05-report.md:88` — changed-file list omits the report and task status row. Correct as described in Should-fix 1.

## Conclusion

Task 5 meets its scope: four exact tests pin exactly-once cleanup and reconciliation behavior, stub changes are minimal and deterministic, four separate test-only commits are present, no production files changed, quality gate clean. PASS.
TL;DR: Task 5 PASS — 4 exact tests verified, no production changes, 0 must-fix and 1 should-fix report wording.