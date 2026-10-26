# e04s07 Task 3 Report: Reconcile no-body terminal paths

## Status

`passing`

## Branch and worktree

- Branch: `e04s07-reconcile-non-streaming-usage`
- Worktree: `/data/data/com.termux/files/home/workspace/e04s07-reconcile-non-streaming-usage`
- Base commit: `f2f5464`

## Commits

| Hash | Subject | Files changed |
| --- | --- | --- |
| `b6c8c6d` | `test(e04s07): characterize 204 no-body response retains the estimate` | `server.test.js` |
| `7864c45` | `test(e04s07): characterize 304 no-body response retains the estimate` | `server.test.js` |
| `43826c6` | `test(e04s07): characterize empty 200 body retains the estimate` | `server.test.js` |
| `29e4b06` | `test(e04s07): characterize terminal path records at most one outcome` | `server.test.js` |
| `452a055` | `test(e04s07): RED HEAD no-body response retains the estimate` | `server.test.js` |
| `97968cd` | `fix(server): avoid forwarding buffered bodies on GET/HEAD in rate-limit mode` | `server.js` |
| `d71c752` | `fix(server): record no-body fallback via reconcile(null)` | `server.js` |

The task-status update and this report are committed after the verification evidence below.

## Test count

- Before task 3: 189 tests in 21 suites.
- After task 3: 194 tests in 21 suites.

## Tests added

1. `204 no-body response retains the estimate`
2. `304 no-body response retains the estimate`
3. `empty 200 body retains the estimate`
4. `a terminal path records at most one outcome`
5. `HEAD no-body response retains the estimate`

## Focused characterization evidence

- `204 no-body response retains the estimate`: PASS before the production change.
- `304 no-body response retains the estimate`: PASS before the production change.
- `empty 200 body retains the estimate`: PASS before the production change.
- `a terminal path records at most one outcome`: PASS before the production change.
- `HEAD no-body response retains the estimate`: RED before the supporting fix, with `502 !== 200` (`AssertionError: Expected values to be strictly equal, actual: 502, expected: 200`).

Reason the four GREEN tests were already green before their production change:

- The three HTTP retention tests assert only that the estimate remains charged. That estimate is charged when the reservation is created, so retention holds without an explicit no-body reconciliation call.
- The unit test exercises `createBudget` and the already single-shot `reconcile(null)` contract.

Reason the HEAD test was RED:

- In rate-limit mode, `readBodyWithCap` returns a Buffer even for a HEAD request with no body. The old body selection forwarded that empty Buffer to `fetch`, and `fetch` rejects GET/HEAD requests with a body (`TypeError: Request with GET/HEAD method cannot have body.`), producing a 502.

## Focused GREEN evidence

- Supporting fix `97968cd`: `HEAD no-body response retains the estimate` changes from RED to PASS.
- No-body fallback fix `d71c752`: no-body responses call `budgetReservation.reconcile(null)` before listener cleanup and `res.end()`.
- Task 3 verify command exits 0 with 5 matching tests.

## Task 3 verify output

Command run verbatim:

```
out=$(node --test --test-reporter=tap --test-name-pattern 'no-body response retains the estimate|empty 200 body retains the estimate|records at most one outcome' server.test.js 2>&1); rc=$?; test "$rc" -eq 0 || { printf '%s\n' "$out"; exit "$rc"; }; n=$(printf '%s\n' "$out" | grep -cE '^[[:space:]]*ok [0-9]+ - .*(no-body response retains the estimate|empty 200 body retains the estimate|records at most one outcome)'); test "$n" -ge 5 || { printf 'expected at least 5 tests, got %s\n' "$n"; exit 1; }
```

Result: exit code 0, `VERIFY rc=0 count=5`.

## Final verification

- `npm test`: 194 tests, 194 pass, 0 fail, 21 suites.
- `npm run check`: lint, typecheck, and format:check all clean.
- `git diff --check`: clean.

## Exact no-body branch change

Current branch in `server.js`:

```js
if (!upstream.body) {
  if (budgetReservation) {
    budgetReservation.reconcile(null);
  }
  res.removeListener("close", onDownstreamClose);
  return res.end();
}
```

Ordering:

1. `budgetReservation.reconcile(null)` runs first when a live reservation exists.
2. Existing close-listener cleanup remains intact.
3. `res.end()` runs last.

No observer is created on this path. A no-body 200, 204, 304, HEAD, or empty-body response releases admission through the existing response-close lifecycle. When rate limiting is disabled or no reservation exists, behavior is unchanged.

## Mixed-history rationale and human ruling

Task 3 has one production behavior change: recording the no-body fallback. The five required tests cannot honestly fail before that change:

- The three GREEN HTTP tests already pass because no-body paths already retain the estimate.
- The budget unit test already passes because `reconcile(null)` is already single-shot.
- Fallback counters remain internal until e04s08, so no public HTTP assertion can observe the new fallback record.

The HEAD test is genuinely RED until the supporting GET/HEAD request-body selection fix is applied, so it is committed as an honest RED test commit.

Following the approved ruling from task 2 and the user-approved fix round:

1. Each required test was added in its own test-only commit. Four are honest GREEN characterization commits; the HEAD test is an honest RED commit.
2. The supporting GET/HEAD request-body selection fix was added in a separate GREEN commit.
3. The minimum no-body fallback change was added in a separate GREEN commit.
4. No failures were faked, no assertions were weakened, no test hooks were added, and no new observable state was exposed.

## User ruling for the supporting fix

The GET/HEAD request-body selection change is necessary, not optional:

- Rate-limit mode buffers the request body and therefore holds a Buffer even when the original request had no body.
- Forwarding that Buffer on GET or HEAD makes `fetch` throw `TypeError: Request with GET/HEAD method cannot have body.`.
- The fix selects `undefined` for GET/HEAD before considering the buffered body, while leaving POST/PUT/PATCH forwarding unchanged.

## Deviations resolved in fix round 1

1. Removed stray shell text from the report.
2. Corrected the report's false claim that the HEAD characterization test was green before the production change.
3. Renamed the empty 200 test to the exact required name `empty 200 body retains the estimate`.
4. Updated the task 3 verify matcher in `e04s07-tasks.yaml` to include `empty 200 body retains the estimate` and still require at least 5 matching tests.
5. Corrected the report base commit to `f2f5464`.
6. Split the GET/HEAD request-body selection change from the no-body fallback change into separate commits.

## Fix round 1 evidence

- HEAD test commit `452a055` is RED: `502 !== 200`.
- Supporting fix commit `97968cd` makes `HEAD no-body response retains the estimate` PASS.
- No-body fallback commit `d71c752` adds only `budgetReservation.reconcile(null)` to the `!upstream.body` branch.
- Updated verify command exits 0 with 5 matching tests.
- Full suite: 194 tests, 194 pass, 0 fail.
- `npm run check`: clean.
- `git diff --check`: clean.

## Concerns and facts for later tasks

- Fallback counters are still internal to `budget.js`; public observability arrives in e04s08.
- The GET/HEAD body-selection correction in rate-limit mode means request bodies are not forwarded for those methods.
- Test count is now 194 in 21 suites; task 6 owns living-doc count synchronization.
- Task 3's status row in `e04s07-tasks.yaml` is set to `passing`.
TL;DR: Task 3 complete after fix round 1: honest RED/PASS history, split GET/HEAD and no-body fixes, exact test names, verify 5/5, full suite 194/194, checks clean.
EOF
echo written