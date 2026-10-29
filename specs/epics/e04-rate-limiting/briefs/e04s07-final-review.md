# e04s07 Final Whole-Branch Review

## Verdict

PASS. No must-fix or should-fix findings. Branch implements all story invariants for non-streaming usage reconciliation and terminal fallbacks; deferred minor findings triaged below.

Base: `8142d64` → HEAD `0185fb6`. Production changes limited to `observer.js` and `server.js`; tests in `server.test.js`. Documentation and ADR updates are in scope for task 6.

## Must-fix (0)

None.

## Should-fix (0)

None. All deferred minor findings are triaged as accepted/parked (see below); no code or test change required.

## Consider / deferred and parked triage

1. **Task 1 — negative `total_tokens` SSE behavior change** (`observer.js:6-23`, `observer.js:96-110`): Accepted. `usageTotalFromUsage` now falls back from an unusable/negative `total_tokens` to `prompt_tokens + completion_tokens`. This is consistent with the helper contract and is locked by `server.test.js:5110-5125`; no separate SSE-only validity copy is warranted.
2. **Task 1 — `Buffer.from` numeric input** (`observer.js:155`): Parked. Server callers pass byte chunks (`Buffer`/`Uint8Array`/string); no current caller passes a number. Optional future hardening only; not a defect in this branch.
3. **Task 2 — higher-actual test uses `PROXY_TPM: 2500`** (`server.test.js:5224-5234`): Accepted. The test still proves a higher actual raises current usage and blocks the next request; the window value is an arithmetic fixture, not a behavior defect.
4. **Task 5 — proof-section wording** (`specs/.../briefs/e04s07-t05-report.md:88-89`): Cosmetic only. The first line names only `server.test.js` and the task brief, while the range also includes the report and status row; the second line correctly states no production/docs files changed. No action required.
5. **Task 6 — line-count approximations** (`AGENTS.md:85`, `CONVENTIONS.md:33,37`): Resolved/accepted. `observer.js` (~211) and `server.js` (~587) now match `wc -l`; the stale `CONVENTIONS.md` ~481 concern no longer appears in the current tree.

## Invariant verification (file:line evidence)

- Non-streaming eligibility is content-type agnostic: `server.js:461` `isJson = budget.enabled && Boolean(budgetReservation) && !isSse && Boolean(upstream.body)`.
- No transform in non-SSE forwarding path: `server.js:554` `pipeline(src, res, onComplete)`; observer is a side `src.on("data", ...)` listener at `server.js:477-488`, beside idle watchdog `server.js:452`.
- Byte cap: `observer.js:26` `JSON_OBSERVATION_BYTE_BOUND = 1048576`; overflow detaches at `observer.js:156-159`.
- Valid usage replaces estimate; null records fallback: `server.js:509-513` calls `budgetReservation.reconcile(observedUsage)` only when `!error && budgetReservation && (sseObserver || jsonObserver)`.
- No-body/HEAD/204/304/empty bodies: `server.js:426-430` calls `budgetReservation.reconcile(null)` before `res.end()`.
- SSE unchanged except shared helper delegation: `observer.js:96`, `observer.js:106`, `observer.js:110`; SSE tests pass (14/14).
- Upstream 429 pass-through and conservative terminals: no retry/circuit code present; tests pin status/headers/body and single upstream contact.
- Exactly-once reconciliation: `reconcile` single-shot semantics plus task 5 unit tests (`server.test.js:5524-5545`).

## Deferred/parked items triage

All five deferred minor findings remain non-blocking and are accepted/parked. None invalidates the implementation or its tests.

## Report inaccuracies

- `e04s07-t05-report.md:88` cosmetic range wording (noted above).
- Historical task reports record SIGTERM environmental flake variants (198/199 vs 199/199); final suite is reported 203/203 green. No code change implied.
- No production behavior or test assertion inaccuracy found.

## Cannot-verify

- Full suite was not rerun by this final reviewer (per instruction, report records 203/203 green). Focused checks passed: 28 e04s07 tests + 14 SSE tests, `npm run check` clean.
- Per-task RED commits were not replayed here; accepted from task review evidence.
- Living-doc count gate was checked by grep with `N=203` (0 stale hits) without rerunning the full suite.

## Final verification evidence

- Focused tests: 28 passed, 0 failed (`json observer`, `non-streaming`, `no-body`, `429`, `terminal`, `cleanup` patterns).
- SSE regression: 14 passed, 0 failed.
- `npm run check`: lint, typecheck, and format:check all clean.
- Test-count grep with `N=203`: 0 stale hits (excluding plans, briefs, verifications, task ledgers, LOG, research note).
- `git diff --check`: clean.

TL;DR: Branch passes final review with 0 must-fix and 0 should-fix; all deferred minor findings triaged as accepted/parked, focused checks and quality gate clean.