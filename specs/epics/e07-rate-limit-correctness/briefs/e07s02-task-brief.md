# e07s02: Rename/split costOverLimitRejectionsCount by reason

## Mission
Rename `costOverLimitRejectionsCount` to `budgetRejectionsCount` in budget.js and /stats key in server.js. Update all test references. No test count change (rename, no new behavior).

## Files to change
1. `budget.js`: rename counter var + getter + increment sites (lines 358, 368, 416, 425, 510-512)
2. `server.js`: line 299 /stats key `costOverLimitRejections` → `budgetRejections`
3. `server.test.js`: lines 961, 997, 1041, 6236, 6242, 6244, 6255, 6269, 6390-6392

## Constraints
- Do not expose internal rejection reasons to clients (keep single aggregate counter, just rename)
- Zero runtime deps, ESM only
- Run `npm test` and `npm run check` before commit
- Test count stays 258 (no new tests)

## Acceptance
- `npm test` 258 pass / 0 fail
- `npm run check` clean
- `git grep costOverLimitRejections` returns nothing
- Commit on branch `e07s02-stats-counter-naming`

## Worktree
`/data/data/com.termux/files/home/projects/e07s02-stats-counter-naming` (branched from 470c675)

## Count
258 → 258 (no change)