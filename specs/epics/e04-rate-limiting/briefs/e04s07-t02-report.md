# e04s07 Task 2 Report: Integrate non-streaming observation and reconciliation

- status: passing
- branch: e04s07-reconcile-non-streaming-usage
- worktree: /data/data/com.termux/files/home/workspace/e04s07-reconcile-non-streaming-usage
- base commit: 7d3528c (task 2 brief commit; original task text cites c4d4135)

## Commits

New history from base `7d3528c`:

1. `81c3c3b` test(e04s07): characterize non-streaming JSON byte identity
   - files: server.test.js (+23)
2. `fb8e778` test(e04s07): characterize missing non-streaming usage fallback
   - files: server.test.js (+13)
3. `6da318d` test(e04s07): characterize malformed non-streaming usage fallback
   - files: server.test.js (+13)
4. `d85b1dc` test(e04s07): characterize non-streaming observation overflow
   - files: server.test.js (+15)
5. `06c2756` test(e04s07): RED valid non-streaming usage replaces estimate
   - files: server.test.js (+13)
6. `0a449ee` feat(server): reconcile lower actual non-streaming usage
   - files: server.js (+39/-3)
7. `93b369c` test(e04s07): RED higher actual non-streaming usage raises current usage
   - files: server.test.js (+14)
8. `955a8e9` feat(server): raise current usage on higher non-streaming actual
   - files: server.js (+1/-5)
9. docs commit: task 2 report, task 2 ledger status, restored review file (this commit)
   - files: specs/epics/e04-rate-limiting/briefs/e04s07-t02-report.md,
     specs/epics/e04-rate-limiting/e04s07-tasks.yaml,
     specs/epics/e04-rate-limiting/briefs/e04s07-t02-review.md

Original aggregate history (rewritten away) was:
- `05b541d` test(e04s07): add non-streaming usage reconciliation tests
- `b1de3af` feat(server): integrate non-streaming usage observation and reconciliation
- `662f359` docs(e04s07): add task 2 report and mark task 2 passing
- `b3815da` docs(e04s07): add task 2 review

## Tests

Suite count before: 183 tests in 21 suites.
Suite count after: 189 tests in 21 suites.

Six required tests:
1. non-streaming JSON bytes are identical to upstream
2. valid non-streaming usage replaces the estimate
3. missing non-streaming usage retains the estimate
4. malformed non-streaming usage retains the estimate
5. higher actual non-streaming usage raises current usage
6. non-streaming observation overflow detaches without affecting pass-through

## Verification

Task 2 verify command (verbatim) exited 0 with 7 matching test lines (6 required plus the suite line):

```
rc=0 count=7
```

`grep -q 'pipeline(src, res, onComplete)' server.js` exited 0 (match).

`npm run check`: clean (lint, typecheck, format).
`git diff --check`: clean.

## Focused RED/GREEN evidence

Characterization tests (pass immediately on the pre-integration tree; not RED failures):
- `non-streaming JSON bytes are identical to upstream`: `node --test --test-name-pattern 'non-streaming JSON bytes are identical to upstream' server.test.js` → 1 pass, 0 fail.
- `missing non-streaming usage retains the estimate`: same pattern → 1 pass, 0 fail.
- `malformed non-streaming usage retains the estimate`: same pattern → 1 pass, 0 fail.
- `non-streaming observation overflow detaches without affecting pass-through`: same pattern → 1 pass, 0 fail.

Reason these pass before integration: byte forwarding, estimate retention, and overflow detach are already provided by the unchanged pipeline plus the task 1 observer; they pin existing behavior and are recorded as characterization tests per the approved mixed-history ruling.

Valid usage cycle:
- RED: `node --test --test-name-pattern 'valid non-streaming usage replaces the estimate' server.test.js` → `429 !== 200` (`ERR_ASSERTION`), because the estimate was retained without reconciliation.
- GREEN: `0a449ee` added observer creation, data-event observation, and reconciliation gated to actual totals at or below the estimate; test passed (1 pass, 0 fail).

Higher actual usage cycle:
- RED: `node --test --test-name-pattern 'higher actual non-streaming usage raises current usage' server.test.js` → `200 !== 429` (`ERR_ASSERTION`), because the first incremental implementation did not reconcile an actual above the estimate.
- GREEN: `955a8e9` removed the upper-bound guard so any finite usable actual reconciles; test passed (1 pass, 0 fail).

## Deviations and mixed-history rationale

This report does not claim zero deviations. The original implementation was committed as one aggregate RED commit and one aggregate GREEN commit, violating the brief's strict vertical-cycle policy. Per explicit human ruling for this fix round, history was rewritten from `7d3528c` into an honest mixed history:
- Four behaviors that legitimately pass on the pre-integration tree are recorded as separate characterization test-only commits that pass immediately, with that reason stated above.
- `valid non-streaming usage replaces the estimate` and `higher actual non-streaming usage raises current usage` each have an honest test-only RED commit followed by an implementation GREEN commit.
- The first GREEN commit (`0a449ee`) is a genuinely incremental implementation: it reconciles a non-streaming actual only when it is finite, usable, and no greater than the estimate, so the lower-actual valid case passes while the higher-actual case stays red. The second GREEN commit (`955a8e9`) generalizes reconciliation to any finite usable actual. No assertions were weakened, no production code was sabotaged, and no fake logs or failures were introduced.

The higher-actual test uses `PROXY_TPM: "2500"` rather than `1500` so the pre-integration estimate (1025 tokens) allows a second estimated request (2050 <= 2500) to be admitted, while the reconciled 6000-token actual rejects it. This keeps the test able to distinguish retention from raising; the brief does not fix a TPM value for the higher-actual case.

## Server integration points

- Eligibility: `isJson = budget.enabled && Boolean(budgetReservation) && !isSse && Boolean(upstream.body)`, computed beside `isSse`; content-type is not consulted.
- Observer creation: one `createJsonObserver` when `isJson`, callback stores the observed total in the existing `observedUsage` variable.
- Data listener: `src.on("data", ...)` registers `jsonObserver.observe(chunk)` with try/catch and `detach()` on failure, beside the existing `src.on("data", armIdle)` idle watchdog listener.
- Forwarding chain unchanged: `pipeline(src, res, onComplete)` remains the non-SSE path; no Transform or other stream stage is inserted.
- Completion path: `onComplete` ends `jsonObserver` (and `sseObserver`) and, only when `!error && budgetReservation && (sseObserver || jsonObserver)`, reconciles. The SSE branch reconciles unconditionally on success; the non-streaming branch reconciles a finite usable actual, with the final implementation reconciling any such actual.
- Overflow: observer detaches at the 1,048,576-byte bound and delivers `null`; reconciliation retains the estimate.

## Concerns and facts for later tasks

- The first incremental GREEN intentionally did not reconcile an actual above the estimate; the final GREEN fixes this. No residual condition remains in the final tree.
- `jsonObserver.end()` is called unconditionally in `onComplete` (including error completions), matching the existing SSE handling; reconciliation is still gated on `!error`, so abnormal completions record no outcome.
- Task 3 must handle the `!upstream.body` branch and no-body terminals; those paths are untouched here.
- Task 4 abnormal-terminal behavior relies on the same `!error` gate and observer detach semantics established here.
- The original review file `e04s07-t02-review.md` is preserved from review commit `b3815da`; its must-fix finding about TDD commit policy is addressed by this rewrite.
- Full suite runtime is about 4.5 minutes.