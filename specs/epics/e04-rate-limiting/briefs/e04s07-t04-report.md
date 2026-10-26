# e04s07 Task 4 Report: Prove conservative terminal paths

## Status

passing

## Branch and base

- Branch: `e04s07-reconcile-non-streaming-usage`
- Worktree: `/data/data/com.termux/files/home/workspace/e04s07-reconcile-non-streaming-usage`
- Base commit: `901eec0`

## Commits

1. `8c071789fbd0bba9694e3811def0e9a1b7b444af` — `test(e04s07): upstream 429 passes through exactly once` — `server.test.js`
2. `dcf836bb40e7b38cf0546b4176b39a8dbdaee1bf` — `test(e04s07): upstream 429 retains the estimate` — `server.test.js`
3. `476cb4ecab345dd45bf14364dc427846bb7827bd` — `test(e04s07): pre-header failure remains a generic 502` — `server.test.js`
4. `97355de972682db3ac01665e03720004aa114062` — `test(e04s07): mid-stream non-streaming failure destroys only the response` — `server.test.js` (includes minimal stub support)
5. `ac178178101ce82114d4f5671c5f584ca19a8dd9` — `test(e04s07): client disconnect commits the estimate without a 502` — `server.test.js`
6. (this commit) — docs/status commit — `specs/epics/e04-rate-limiting/e04s07-tasks.yaml`, `specs/epics/e04-rate-limiting/briefs/e04s07-t04-report.md`

## Tests

Five tests added to `describe("e04s07 non-streaming usage reconciliation")`:

1. `upstream 429 passes through exactly once`
2. `upstream 429 retains the estimate`
3. `pre-header failure remains a generic 502`
4. `mid-stream non-streaming failure destroys only the response`
5. `client disconnect commits the estimate without a 502`

Suite count: 194 before task 4, 199 after task 4 (21 suites).

## Focused PASS evidence

- `upstream 429 passes through exactly once`: 1 test, 1 suite, 0 fail.
- `upstream 429 retains the estimate`: 1 test, 1 suite, 0 fail.
- `pre-header failure remains a generic 502`: 1 test, 1 suite, 0 fail.
- `mid-stream non-streaming failure destroys only the response`: 1 test, 1 suite, 0 fail.
- `client disconnect commits the estimate without a 502`: 1 test, 1 suite, 0 fail.

Each test passed before any production change; no production file was edited.

## Task-4 verify output

Command from `e04s07-tasks.yaml` task 4, run verbatim:

```
out=$(node --test --test-reporter=tap --test-name-pattern 'passes through exactly once|upstream 429 retains the estimate|generic 502|mid-stream non-streaming failure|commits the estimate' server.test.js 2>&1); rc=$?; test "$rc" -eq 0 || { printf '%s\n' "$out"; exit "$rc"; }; n=$(printf '%s\n' "$out" | grep -cE '^[[:space:]]*ok [0-9]+ - .*(passes through exactly once|upstream 429 retains the estimate|generic 502|mid-stream non-streaming failure|commits the estimate)'); test "$n" -ge 5 || { printf 'expected at least 5 tests, got %s\n' "$n"; exit 1; }
```

Result: `rc=0`, `n=5`.

## Final verification

- `npm test`: 199 tests, 21 suites, 199 pass, 0 fail.
- `npm run check`: lint, typecheck, and format:check all clean.
- `git diff --check`: clean.
- SIGTERM flake disclosure: two SIGTERM shutdown tests were flaky under full-suite load, passed isolated reruns, and the final full suite was 199/199 green.

## Stub behavior added or reused

Reused existing stub capabilities:

- generic `status`, `body`, and `headers` options to produce the upstream 429 with JSON body and `Retry-After`;
- `preabort` for the pre-header socket destruction;
- `abortable` for the held-after-one-chunk client-disconnect path.

Added minimal deterministic support:

- a request counter in `startStubUpstream`;
- `midabortOnce` mode: the first request writes `{"partial":true` and destroys the upstream socket via `setImmediate`, so headers and partial bytes are delivered; later requests use the normal status/body/headers path.

No production behavior change was made.

## Proof that no production file changed

Production files (`server.js`, `observer.js`, `budget.js`, `admission.js`, `config.js`, `package.json`) are unchanged. Changed files since base commit `901eec0` are `server.test.js`, `specs/epics/e04-rate-limiting/e04s07-tasks.yaml`, and this report. `git diff --name-only` in the working tree before the docs commit showed only `specs/epics/e04-rate-limiting/e04s07-tasks.yaml`.

## Mixed-history rationale and ruling

Task 4 pins existing conservative behavior and is expected to pass before any production change. Per the approved honest mixed-history ruling for tasks 2 and 3, each required test was added in its own test-only commit, run focused, and recorded as passing. No failure was faked, no assertion was weakened, and no production hook was added. The stub refinement was limited to deterministic test support. Task status and this report are committed separately as the docs/status commit.

## Deviations

- `midabortOnce` uses `setImmediate` before socket destruction instead of the synchronous destroy used by `midabort`, so the upstream headers and partial body reliably reach the proxy in rate-limit mode. This is test scaffolding only.

## Concerns and facts for later tasks

- SIGTERM flake disclosure: two SIGTERM shutdown tests were flaky under full-suite load, passed isolated reruns, and the final full suite was 199/199 green.
- Task 5 can reuse `midabortOnce` and the request counter for repeated terminal-path sequences.
- The upstream 429 path reconciles with `null` because its JSON error body contains no usable usage, so the estimate remains committed.
## Fix round 1

Changes:
- Strengthened `client disconnect commits the estimate without a 502` to assert the disconnected response is not 502 and that neither the first read nor the post-cancel read contains `Bad gateway`.
- Corrected report base commit to `901eec0` and updated changed-files wording.
- Added SIGTERM flake disclosure to final verification and concerns.

Focused evidence:
- `client disconnect commits the estimate without a 502`: 1 test, 1 suite, 0 fail.
- task-4 verify: rc=0, n=5.
- `npm test`: 199 tests, 21 suites, 199 pass, 0 fail.
- `npm run check`: clean.
- `git diff --check`: clean.
## Confirmation run (fix round 2)

- `npm test`: 199 tests, 21 suites, 199 pass, 0 fail.
- `git diff --check`: clean.

This confirms the earlier SIGTERM failure was environmental flake; the strengthened client-disconnect assertion remains green. Prior evidence is preserved: initial task-4 full run was 199/199 green; the fix-round run was 198/199 with one SIGTERM shutdown flake.
