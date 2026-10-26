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
