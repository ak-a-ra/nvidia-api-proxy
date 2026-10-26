# e04s07 Task 3 Review (Fix Round 1)

## Scoped verdict

**FAIL** — all code, scope, naming, and history findings are addressed, but one original must-fix remains open: the report still ends with stray `EOF` / `echo written` shell text despite claiming it was removed.

## Original findings and disposition

### Must-fix

1. Stray `EOF` / `echo written` in report.
   - Disposition: **NOT ADDRESSED**.
   - Evidence: `specs/epics/e04-rate-limiting/briefs/e04s07-t03-report.md` still ends with literal `EOF` and `echo written` (verified via `tail`). The rewritten report's "Deviations resolved in fix round 1" item 1 incorrectly claims this was removed.

2. False GREEN evidence for HEAD characterization.
   - Disposition: **ADDRESSED**.
   - Evidence: commit `452a055` (`test(e04s07): RED HEAD no-body response retains the estimate`) is genuinely RED (`502 !== 200`, verified at that snapshot). Report now states RED with the exact assertion error and no longer claims the HEAD test was green before the production change.

### Should-fix

1. Empty-200 test name not exact.
   - Disposition: **ADDRESSED**.
   - Evidence: final tree has exact name `empty 200 body retains the estimate` (server.test.js). Task 3 verify matcher updated to include it; verify passes with 5 tests.

2. Report base commit wrong.
   - Disposition: **ADDRESSED**.
   - Evidence: report now states base commit `f2f5464`, matching `2579f09`'s parent and the review package base.

3. GET/HEAD body-selection change bundled/out of scope.
   - Disposition: **ADDRESSED**.
   - Evidence: split into separate commits: `97968cd` (GET/HEAD buffered-body selection only) and `d71c752` (no-body `reconcile(null)` only). `d71c752` diff is exactly 3 lines in the `!upstream.body` branch. Report documents the necessity and the user ruling.

## Verification performed

- Commit order/history:
  - GREEN characterizations: `b6c8c6d`, `7864c45`, `43826c6`, `29e4b06`
  - RED: `452a055` (HEAD test fails `502 !== 200`)
  - Supporting GREEN: `97968cd` (HEAD test becomes PASS)
  - No-body GREEN: `d71c752` (only `budgetReservation.reconcile(null)` added)
  - Status/report: `ab63a2c`
- At `29e4b06`, the four GREEN characterization tests pass.
- At `452a055`, the HEAD test is RED.
- At `97968cd`, the HEAD test is PASS.
- Exact test names present, including `empty 200 body retains the estimate`.
- Task 3 verify command: exit 0, count 5.
- `npm run check`: lint, typecheck, and format:check clean.
- `git diff --check`: clean.
- No new breakage found in the rewritten tree.

## Open findings

1. **Must-fix (open):** report still contains stray `EOF` and `echo written` at the end of `specs/epics/e04-rate-limiting/briefs/e04s07-t03-report.md`. Remove those two lines; the report must end at its `TL;DR` line. The report's own "Deviations resolved" claim for this item is inaccurate until fixed.

## Report inaccuracies still present

- "Removed stray shell text from the report" (deviation item 1) is false while the stray lines remain.

TL;DR: Fix round 1 addresses all but one original finding; scoped verdict FAIL due to the still-present stray shell text in the report. Open count: 1.