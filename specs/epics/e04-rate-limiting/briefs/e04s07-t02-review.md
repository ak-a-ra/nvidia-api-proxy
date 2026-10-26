# e04s07 Task 2 Review: Integrate non-streaming observation and reconciliation

- overall: FAIL
- spec verdict: PASS
- code quality verdict: PASS
- reviewer: independent review
- branch: e04s07-reconcile-non-streaming-usage
- base commit: 7d3528c (review package base; report states c4d4135)

## Scope checked

Files changed vs base `7d3528c..HEAD`:

- `server.js`
- `server.test.js`
- `specs/epics/e04-rate-limiting/briefs/e04s07-t02-report.md`
- `specs/epics/e04-rate-limiting/e04s07-tasks.yaml`

No changes to `observer.js`, `budget.js`, `admission.js`, `config.js`, or other out-of-scope files.

## Findings

### Must-fix (1)

1. **TDD commit policy violated** — Brief requires vertical RED→GREEN cycles, one required behavior per cycle, with each behavior producing a separate `test(e04s07): ...` RED commit immediately followed by a `feat(server): ...` GREEN commit, and never combining a test with its implementation. The actual history contains only one test commit and one implementation commit:
   - `05b541d` `test(e04s07): add non-streaming usage reconciliation tests` (all six tests at once)
   - `b1de3af` `feat(server): integrate non-streaming usage observation and reconciliation`
   
   Evidence: `git log --oneline 7d3528c..HEAD`. The verification contract in the brief requires `git log --oneline` to show each RED commit immediately followed by its GREEN commit; it does not.

   Location: `server.test.js` (all six tests in one commit), `server.js` (implementation in one commit).

### Should-fix (1)

1. **Report accuracy / RED evidence** — The report states `Deviations: None from the brief`, but the commit history does not satisfy the brief's strict RED→GREEN policy. The "Focused RED evidence" section also provides only a representative stash run (`valid non-streaming usage replaces the estimate`) and asserts the other tests failed the same way without per-cycle focused commands and expected failures. Brief requires RED evidence for every cycle.

   Location: `specs/epics/e04-rate-limiting/briefs/e04s07-t02-report.md`, lines ~48–58 and ~62–66 (as committed in `662f359`).

### Consider (0)

None. The implementation's functional requirements are met; see verification below.

## Spec compliance assessment

1. **Eligibility** — PASS. `server.js:458` computes exactly `budget.enabled && Boolean(budgetReservation) && !isSse && Boolean(upstream.body)`. No `content-type` inspection. `isSse` (lines 455–457) is the only content-type-based predicate and is used only to exclude SSE.

2. **One observer per response; data event beside idle watchdog; no Transform in non-SSE chain; `pipeline(src, res, onComplete)` unchanged** — PASS.
   - One `createJsonObserver` created only when `isJson` (`server.js:467–471`); `sseObserver` and `jsonObserver` are mutually exclusive via `!isSse`.
   - `src.on("data", ...)` for the observer is registered beside the existing `src.on("data", armIdle)` idle watchdog listener (`server.js:477–488`).
   - Non-SSE branch remains `pipeline(src, res, onComplete)` (`server.js:552`); no Transform is inserted.
   - `grep -q 'pipeline(src, res, onComplete)' server.js` exits 0.

3. **Successful completion ends observer then reconciles; usable usage replaces estimate; null retains estimate/fallback; error records no outcome** — PASS.
   - `onComplete` ends `jsonObserver` (and `sseObserver`) before reconciling (`server.js:491–511`).
   - Reconciliation gated on `!error && budgetReservation && (sseObserver || jsonObserver)` (`server.js:510`), so abnormal/error completions record no outcome.
   - `budgetReservation.reconcile(observedUsage)` replaces the token cost when usage is finite/non-negative and records a fallback on `null` (verified in `budget.js` reconcile closure).

4. **SSE and disabled-mode behavior unchanged** — PASS. SSE path still uses `observerTransform` and `createSseObserver`; disabled mode (`budget.enabled === false`) makes `isJson` false and creates no observer.

5. **Six exact test names and behavioral strength** — PASS.
   - Exact names present and verified by `node --test --test-name-pattern 'non-streaming'`:
     - `non-streaming JSON bytes are identical to upstream`
     - `valid non-streaming usage replaces the estimate`
     - `missing non-streaming usage retains the estimate`
     - `malformed non-streaming usage retains the estimate`
     - `higher actual non-streaming usage raises current usage`
     - `non-streaming observation overflow detaches without affecting pass-through`
   - Byte identity asserts `Buffer` equality plus `content-length` (`server.test.js`).
   - Arithmetic verified against the estimator: request body `{ model: "m", messages: [{ role: "user", content: "hi" }] }` estimates 1025 tokens (input 1 + requested output 1024). With `PROXY_TPM: "1500"` and `PROXY_SAFETY_MARGIN_PCT: "0"`, two estimates (2050) exceed the window while 12 + 1025 (1037) fits, so test 2 proves replacement. Missing/malformed retain 1025, so 1025 + 1025 (2050) is rejected. Test 5 uses actual 6000, which raises current usage above the window. Test 6 uses a body of `JSON_OBSERVATION_BYTE_BOUND + 100` bytes and asserts full byte identity plus estimate retention.

6. **Strict RED→GREEN policy** — FAIL. See must-fix #1.

7. **Scope discipline** — PASS. Only `server.js`, `server.test.js`, task 2 status row, and report changed.

8. **Correctness edge cases** — PASS on the implemented path:
   - Event ordering: observer listener registered after `armIdle` on the same `src` data events.
   - Completion before final data: `pipeline` invokes `onComplete` after stream end; `jsonObserver.end()` is called there.
   - Observer callback failure: contained inside `createJsonObserver` (`observer.js`), and `observe` is wrapped at the call site with detach on throw (`server.js:477–488`).
   - Content-length/framing: non-SSE forwarding path untouched; byte identity and `content-length` asserted.
   - Idle watchdog: `src.on("data", armIdle)` remains in place.
   - Body chunk types: `observe` handles `Buffer` and other chunk values via `Buffer.from`.
   - Abnormal terminals: reconcile gated on `!error`; observer ended but no outcome recorded. (Task 4's terminal-path tests are out of scope here.)

## Verification evidence

- Task 2 verify command (verbatim): `rc=0`, `n=7` (6 required tests plus the suite line). Run by reviewer.
- `grep -q 'pipeline(src, res, onComplete)' server.js`: exit 0.
- `npm run check`: clean (lint, typecheck, format). Run by reviewer.
- `git diff --check`: clean.
- `npm test`: report records 189 tests, 189 pass, 0 fail, 21 suites. Not rerun by reviewer per instruction; focused verify above passed.
- Git history: `05b541d` then `b1de3af` then `662f359`.

## Cannot-verify items

- Full `npm test` (189/189) was not rerun by the reviewer; relied on the report and focused verification.
- Per-cycle RED failures cannot be reproduced from the current tree because all six tests were committed together.
- Abnormal-terminal behavior (task 4) is not implemented/tested in this task and was not exercised.
- Living-document test-count sync (task 6) was not checked.

## Report inaccuracies

- `Deviations: None from the brief` is inaccurate: the strict RED→GREEN commit policy was not followed.
- RED evidence is representative only, not per-cycle.
- Other report details verified accurate: commit hashes/subjects, changed files, test names, suite count before/after, verify command result, pipeline grep, check cleanliness, and integration-point descriptions.

---

## Scoped re-review: fix round 1/5

- scoped verdict: FAIL
- open count: 2 (1 must-fix, 1 should-fix)
- reviewer: independent re-review
- base for this round: 7d3528c through HEAD (rewritten history)

### Finding disposition

1. **Original MUST-FIX (aggregate RED/GREEN commits)** — ADDRESSED.
   New history from `7d3528c` is:
   - `81c3c3b` test: characterize non-streaming JSON byte identity
   - `fb8e778` test: characterize missing non-streaming usage fallback
   - `6da318d` test: characterize malformed non-streaming usage fallback
   - `d85b1dc` test: characterize non-streaming observation overflow
   - `06c2756` test: RED valid non-streaming usage replaces estimate
   - `0a449ee` feat: reconcile lower actual non-streaming usage
   - `93b369c` test: RED higher actual non-streaming usage raises current usage
   - `955a8e9` feat: raise current usage on higher non-streaming actual
   - `750525f` docs: report, ledger status, review provenance

   Each required test appears in its own stated commit. The four characterization commits contain only the named test and pass honestly on pre-integration behavior (verified: byte identity and overflow pass at their commits; missing and malformed pass at their commits). The valid-usage RED commit fails with `429 !== 200` because the estimate is retained without reconciliation. The higher-actual RED commit fails with `200 !== 429` because the first incremental implementation does not reconcile an actual above the estimate. The first GREEN and second GREEN commits pass their targeted tests.

2. **Original SHOULD-FIX (report falsely claimed no deviation / lacked per-cycle RED evidence)** — ADDRESSED.
   The rewritten report discloses the original aggregate-commit deviation and the mixed-history rationale, and records per-cycle RED/GREEN commands and observed failures. The original false "Deviations: None" statement is gone.

### New finding (must-fix)

1. **Missing/malformed usage is not reconciled, so no fallback is recorded** — `server.js:506-511` currently reads:
   ```js
   if (!error && budgetReservation && (sseObserver || jsonObserver)) {
     if (sseObserver) {
       budgetReservation.reconcile(observedUsage);
     } else if (jsonObserver && observedUsage !== null) {
       budgetReservation.reconcile(observedUsage);
     }
   }
   ```
   Requirement 3 requires `reconcile(observedUsage)` for a successful non-streaming completion, including the `null` delivered for missing, malformed, or unusable usage, so that `reconcile(null)` retains the estimate and records one fallback. The `observedUsage !== null` guard skips that call, so missing/malformed/unusable usage retains the estimate but records no fallback. The same guard also would skip any future usable zero total only if it were null, but zero itself is currently passed; the defect is specifically the null exclusion. The report's "No residual condition remains in the final tree" and "non-streaming branch reconciles a finite usable actual" statements overstate the implementation.

   Evidence: `server.js:506-511`; report lines in the "Deviations and mixed-history rationale" and "Server integration points" sections.

   Required fix: on a successful non-streaming completion with a live reservation, call `budgetReservation.reconcile(observedUsage)` unconditionally (including `null`), matching the SSE branch and the original requirement. The incremental upper-bound guard must not remain in the final tree.

### New finding (should-fix)

1. **Report overstates final implementation** — The report says "No residual condition remains in the final tree" and describes the non-streaming branch as reconciling "a finite usable actual." The final tree still contains the `observedUsage !== null` residual condition, so those statements are inaccurate. Update the report after the must-fix is resolved.

### Verification evidence

- Focused RED/GREEN evidence verified in temporary worktrees:
  - `06c2756`: `valid non-streaming usage replaces the estimate` → `429 !== 200` (RED, as reported).
  - `0a449ee`: `higher actual non-streaming usage raises current usage` is not yet present; the first GREEN contains only the lower-actual condition `observedUsage <= budgetReservation.cost.totalTokens`.
  - `93b369c`: `higher actual non-streaming usage raises current usage` → `200 !== 429` (RED, as reported).
  - Final tree: both required tests pass (`1 pass, 0 fail` each).
- Characterization tests verified at their own commits: byte identity and overflow pass on pre-integration behavior; missing and malformed pass at their commits.
- `grep -q 'pipeline(src, res, onComplete)' server.js`: exit 0.
- `npm run check`: clean (prior run; final tree unchanged except docs).
- `git diff --check`: clean.

### Cannot-verify items

- Full `npm test` (189/189) was not rerun by the reviewer.
- Fallback-count behavior for missing/malformed usage was not exercised by a server-level test in this task; the defect is identified from the reconciliation call site and `budget.js` reconcile semantics.
- Task 3/4/5 behavior remains out of scope and untested here.
