# e04s07 Task 5 Report

## Status

passing

## Branch and worktree

- Branch: `e04s07-reconcile-non-streaming-usage`
- Worktree: `/data/data/com.termux/files/home/workspace/e04s07-reconcile-non-streaming-usage`
- Base commit: `88b19d0`

## Commits

1. `246b5b7bd85e9d298dc0d0adfac8bf6a724b98c2` — `test(e04s07): repeated cleanup sequences admit every request`
   - Files changed: `server.test.js`
2. `9752f252f41d6e1149801b3641fc63a5e603c546` — `test(e04s07): every terminal path in sequence releases each slot`
   - Files changed: `server.test.js`
3. `08fad7c0d552d077f8fc6ae6957e96e63d883841` — `test(e04s07): a second reconciliation records no additional outcome`
   - Files changed: `server.test.js`
4. `a086565b583fc96d06e3adf7b72737b336465431` — `test(e04s07): counters do not double-count across repeated paths`
   - Files changed: `server.test.js`
5. Docs/status commit (this report + task 5 status row) — `server.test.js` unchanged by this commit beyond prior test commits; `specs/epics/e04-rate-limiting/e04s07-tasks.yaml` and this report.

## Test counts

- Before: 199 tests in 21 suites.
- After: 203 tests in 21 suites.

## Test names

1. `repeated cleanup sequences admit every request`
2. `every terminal path in sequence releases each slot`
3. `a second reconciliation records no additional outcome`
4. `counters do not double-count across repeated paths`

## Focused PASS evidence

- `node --test --test-name-pattern "repeated cleanup sequences admit every request" server.test.js` → 1 pass, 0 fail.
- `node --test --test-name-pattern "every terminal path in sequence releases each slot" server.test.js` → 1 pass, 0 fail.
- `node --test --test-name-pattern "a second reconciliation records no additional outcome" server.test.js` → 1 pass, 0 fail.
- `node --test --test-name-pattern "counters do not double-count across repeated paths" server.test.js` → 1 pass, 0 fail.

## Task-5 verify command

Command run verbatim:

```
out=$(node --test --test-reporter=tap --test-name-pattern 'repeated cleanup|terminal path in sequence|second reconciliation|double-count' server.test.js 2>&1); rc=$?; test "$rc" -eq 0 || { printf '%s\n' "$out"; exit "$rc"; }; n=$(printf '%s\n' "$out" | grep -cE '^[[:space:]]*ok [0-9]+ - .*(repeated cleanup|terminal path in sequence|second reconciliation|double-count)'); test "$n" -ge 4 || { printf 'expected at least 4 tests, got %s\n' "$n"; exit 1; }
```

Result: `rc=0 n=4`.

## Final verification

- `npm test`: 203 tests, 203 pass, 0 fail, 21 suites.
- `npm run check`: lint, typecheck, and format:check all clean.
- `git diff --check`: clean.
- `git diff --name-only 88b19d0..HEAD` for production files (`server.js`, `observer.js`, `budget.js`, `admission.js`, `config.js`, `package.json`, `README.md`, `AGENTS.md`, `CONVENTIONS.md`, `CONTEXT.md`): no output, so no production file changed.

## Terminal sequences and stub modes

### Test 1 — `repeated cleanup sequences admit every request`

- Stub mode: `t05seq1` (deterministic, request-number-driven).
- Budget/ceiling: `PROXY_RPM=60`, `PROXY_TPM=100000`, `PROXY_SAFETY_MARGIN_PCT=0`, `PROXY_MAX_CONCURRENT_REQUESTS=1`.
- Sequence:
  1. JSON response with usable usage (`{"usage":{"total_tokens":12}}`) → 200.
  2. 204 no-body response → 204.
  3. Upstream 429 (`{"error":"rate limited"}`) → 429.
  4. JSON response without usable usage (`{"foo":1}`) → 200.
- Assertions: each request admitted and completes its terminal path; stub received exactly 4 requests for 4 client requests.

### Test 2 — `every terminal path in sequence releases each slot`

- Stub mode: `t05seq2` (deterministic, request-number-driven).
- Budget/ceiling: `PROXY_RPM=60`, `PROXY_TPM=100000`, `PROXY_SAFETY_MARGIN_PCT=0`, `PROXY_MAX_CONCURRENT_REQUESTS=1`, `PROXY_QUEUE_TIMEOUT_SECONDS=1`.
- Sequence:
  1. Normal JSON body (`{"usage":{"total_tokens":12},"marker":"ok"}`) → 200.
  2. 204 no-body → 204.
  3. HEAD → 200 with `content-length`, empty body.
  4. Client disconnect against an abortable upstream (`part1-` then held open).
  5. Normal JSON body → 200, proving the slot released after the disconnect.
- Assertions: each terminal path completes/disconnects, the following request is admitted, stub received exactly 5 requests for 5 attempted client requests, upstream aborted on disconnect.

### Test 3 — `a second reconciliation records no additional outcome`

- Unit-level `createBudget` test.
- `createBudget({ rpm: 60, tpm: 60 }, { safetyMarginPct: 0 }, null)`.
- Reserve one request; `reconcile(10)` returns `true`; `reconcile(20)` returns `false`.
- `reconciledCount === 1`, `fallbackCount === 0`.

### Test 4 — `counters do not double-count across repeated paths`

- Unit-level `createBudget` test.
- `createBudget({ rpm: 60, tpm: 60 }, { safetyMarginPct: 0 }, null)`.
- Reserve one request; `reconcile(null)` twice keeps `fallbackCount === 1` and `reconciledCount === 0`; a later `reconcile(10)` changes neither counter.

## Proof that no production file changed

- `git diff --name-only 88b19d0..HEAD` lists only `server.test.js` and the task 5 brief; no `server.js`, `observer.js`, `budget.js`, `admission.js`, `config.js`, `package.json`, or docs other than the brief/report/status row.
- Production-file diff for `server.js observer.js budget.js admission.js config.js package.json README.md AGENTS.md CONVENTIONS.md CONTEXT.md` is empty.

## Mixed-history rationale and human ruling

Task 5 pins existing exactly-once behavior and is expected to pass before any production change. Following the approved mixed-history ruling from tasks 2–4:

1. Each required test was added in its own test-only commit, with the minimal deterministic stub mode needed by that test.
2. Focused PASS evidence was recorded for each commit.
3. No fake failures, weakened assertions, production hooks, or production behavior changes were introduced.
4. Task-status and report docs are committed separately.

## Deviations from brief

- The `t05seq2` stub branch includes a fifth normal JSON response for the post-disconnect probe request. This is needed to prove slot release after the disconnect; the brief's four listed terminal paths remain the core sequence.
- `PROXY_QUEUE_TIMEOUT_SECONDS=1` was added to test 2 to fail fast if a slot leaks; it does not change the intended admission behavior.

## Concerns / facts for task 6

- Test count is now 203; living docs still state 175/199-era counts and must be synced by task 6.
- Story-level status and epic manifest updates are intentionally left to task 6.
- No production behavior changed; task 5 is test-only plus task-status/report docs.