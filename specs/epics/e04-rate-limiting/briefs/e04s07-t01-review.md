# e04s07 Task 1 Review

## Verdict

PASS

## Spec-compliance verdict

PASS. All brief requirements are implemented in `observer.js` and exercised by the eight required tests in `server.test.js`.

## Code-quality verdict

PASS. Implementation is minimal, pure, dependency-free, formatted, linted, and typechecks. No runtime dependency or protected-file changes.

## Scope

Verified unchanged against base `e10638858526be25e9ad2102c98eb48b8b5a4a02`:
- `server.js`, `budget.js`, `admission.js`, `config.js`, `package.json`: unchanged.
- Changed files: `observer.js`, `server.test.js`, `specs/epics/e04-rate-limiting/e04s07-tasks.yaml` (task 1 status `failing` -> `passing`), `specs/epics/e04-rate-limiting/briefs/e04s07-t01-report.md`, and this review file.

## Findings

### Must-fix

None.

### Should-fix

None.

### Consider

1. `observer.js:18-23` — `usageTotalFromUsage` fallback returns `prompt + completion` without checking that the sum is finite. Two finite non-negative components can sum to `Infinity` in JavaScript, so the helper can return a non-finite value despite its "finite total" contract. A `Number.isFinite(prompt + completion)` guard would make the contract exact. This is not covered by existing tests and is unlikely to matter for real usage, but it is a latent edge case for later reconciliation callers.
2. `observer.js:9-23` with `createSseObserver` delegation — delegating SSE validity/total to `usageTotalFromUsage` changes one previously possible SSE outcome: a usage object with a negative `total_tokens` plus valid `prompt_tokens`/`completion_tokens` now reports the component sum instead of the negative total. No existing SSE test covers this, and the brief explicitly mandates the shared helper, but the story zoom-out says SSE outcomes should be unchanged. Worth confirming this latent edge case is acceptable to the story owner.
3. `observer.js:149-163` — `observe()` converts arbitrary input via `Buffer.from(chunk)`. For non-Buffer inputs such as a string this is correct (UTF-8 bytes), but a numeric input allocates a zero-filled buffer of that size. Later `server.js` integration is expected to pass response chunks, so this is not a current defect; it is a robustness note for the public unit API.

## Verification evidence

- Task-1 verify command (focused): `n=8`, `rc=0` for `json observer|usageTotalFromUsage`.
- SSE regression check: `SSE usage reconciliation` — 14 tests, 14 pass, 0 fail.
- Import check: `rc=0`.
- `npm run check`: lint, typecheck, and format:check all clean.
- `git diff --check`: clean.
- Manual prettier/eslint on `observer.js`: clean.

## Cannot-verify

- Full suite was not rerun during this review, per instruction. The report's first run (`183 tests, 182 pass, 1 fail`, SIGTERM) and second run (`183 tests, 183 pass, 0 fail`) were not independently reproduced here. Focused checks above pass.
- RED-cycle outputs were not reconstructed; the report's recorded RED evidence is accepted as documented.
- Local Node is v26.4.0, while CI targets Node 20/22/24. The reported SIGTERM flake is environment-specific and was not investigated.

## Report inaccuracies

- `e04s07-t01-report.md` deviations section says "`observer.js`, `server.test.js` changes only", but the diff also changes `specs/epics/e04-rate-limiting/e04s07-tasks.yaml` (task 1 status row), which is explicitly in scope. The report should list that file too.
- The report's "Additional full-suite rerun" claim (`183 tests, 183 pass, 0 fail`) cannot be verified from this review; it is neither confirmed nor refuted here.
- The pre-existing SIGTERM failure is described as a flake in the second run; this review did not reproduce it and cannot confirm the flake diagnosis, only that it is unrelated to the changed files.
## Scoped re-review: fix round 1/5

### Findings

1. `usageTotalFromUsage` non-finite sum guard — ADDRESSED.
   - Fix: `observer.js:17-22` now computes `const sum = prompt + completion;` and returns it only when `Number.isFinite(sum)` is true; otherwise returns `null`.
   - Test: `server.test.js:5037-5041` adds `usageTotalFromUsage({ prompt_tokens: Number.MAX_VALUE, completion_tokens: Number.MAX_VALUE })` → `null` ("non-finite sum is unusable").
   - RED/GREEN evidence in report: `AssertionError [ERR_ASSERTION]: non-finite sum is unusable` (`Infinity !== null`), then `pass 1, fail 0`.
2. Report scope/deviations statement — ADDRESSED.
   - `specs/epics/e04-rate-limiting/briefs/e04s07-t01-report.md:108` now states "`observer.js`, `server.test.js`, and `specs/epics/e04-rate-limiting/e04s07-tasks.yaml` changed".

### New-breakage check (fix diff only)

- Changed files in fix round: `observer.js`, `server.test.js`, report. No protected files (`server.js`, `budget.js`, `admission.js`, `config.js`, `package.json`) changed.
- Focused helper test: pass 1, fail 0.
- SSE reconciliation regression: pass 14, fail 0.
- `npm run check`: clean.
- `git diff --check`: clean.
- Report states full suite `183 tests, 183 pass, 0 fail`; not independently rerun in this scoped review.

### Scoped verdict

PASS. Both open findings addressed; no new breakage found in the fix diff. The earlier non-blocking "consider" items (SSE negative-total edge case and `Buffer.from` numeric input) remain unchanged and are not part of this fix round.

TL;DR: Fix round 1 scoped re-review PASS — finite-sum guard and report scope statement both addressed, no new breakage.
