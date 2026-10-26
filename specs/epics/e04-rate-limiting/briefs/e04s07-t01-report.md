# e04s07 Task 1 Report

- status: `done_with_concerns`
- branch: `e04s07-reconcile-non-streaming-usage`
- worktree: `/data/data/com.termux/files/home/workspace/e04s07-reconcile-non-streaming-usage`
- base commit: `e10638858526be25e9ad2102c98eb48b8b5a4a02` (`chore(e04s07): add task 1 brief and progress ledger`)

## Commits

1. `f6af2df8d995384d3b1c25b10ccf74c3a0023f46` `test(e04s07): json observer captures valid usage from a complete body` — `server.test.js`
2. `21d515f0031bef6da4073d20f8a5a2c6221e43b5` `feat(observer): add basic createJsonObserver for complete JSON bodies` — `observer.js`
3. `6934163082e4b8565ba899fcc07fd51ebeef3f31` `test(e04s07): json observer returns null for a body without usage` — `server.test.js`
4. `0d304b4dade69d5ed6803998e4749e106e054d84` `feat(observer): handle missing usage in JSON observer` — `observer.js`
5. `da2e818244e84e201d7d4f733fa09d486217b9c6` `test(e04s07): json observer returns null for malformed usage` — `server.test.js`
6. `71517fa683b05df30fccdc99d5f7806173d601e0` `feat(observer): validate JSON usage total_tokens type` — `observer.js`
7. `4cb08e9e5fe64bd699b924dd21bdc85f8f414738` `test(e04s07): json observer returns null for a non-JSON body` — `server.test.js`
8. `f000d5f1af393cb5e785aeba54af0397eef4ecbc` `feat(observer): tolerate non-JSON bodies in JSON observer` — `observer.js`
9. `11f62732b511f11ef30ad6adbd636e9df30da336` `test(e04s07): json observer decodes a multi-byte split body` — `server.test.js`
10. `f951b5751bab6eea3ed301f6f7988988ee064db8` `feat(observer): decode multi-byte JSON bodies from retained bytes` — `observer.js`
11. `e2d8847453e26ef1cd541dbbb42e8edeb64edecf` `test(e04s07): json observer detaches past the byte bound` — `server.test.js`
12. `eeb009f9e4474f2fb767ff0e48c9ff1f4d10b331` `feat(observer): detach JSON observer past byte bound` — `observer.js`
13. `f99cb5452a429be44592d05cdf5f64f25a415caf` `test(e04s07): json observer invokes onUsage exactly once` — `server.test.js`
14. `beadfac7f648ea7c5d4014b46cdeb7160f1ee7b5` `feat(observer): make JSON observer callbacks failure-contained` — `observer.js`
15. `f240c267bdd72330af4ebc4a6465c433e2a5099d` `test(e04s07): usageTotalFromUsage rejects unusable values` — `server.test.js`
16. `312a2defcbb728688db0fb6c5dcba7720cd1832f` `feat(observer): extract shared usageTotalFromUsage and delegate observers` — `observer.js`
17. `1d4edf04d1f223136adcafb259c3bc1ce384bdc6` `refactor(test): consolidate observer imports` — `server.test.js`
18. `417a30fc046a743d7fe1ab60d569cb1affb32598` `chore(e04s07): mark task 1 passing` — `specs/epics/e04-rate-limiting/e04s07-tasks.yaml`
19. `087bd19ea6c199fbe73ae1a3ef284f7230d9f6d2` `style(test): apply prettier formatting` — `server.test.js`

## Test counts

- before: 175 tests, 20 suites
- after: 183 tests, 21 suites

## Required test names

1. `json observer captures valid usage from a complete body`
2. `json observer returns null for a body without usage`
3. `json observer returns null for malformed usage`
4. `json observer returns null for a non-JSON body`
5. `json observer decodes a multi-byte split body`
6. `json observer detaches past the byte bound`
7. `json observer invokes onUsage exactly once`
8. `usageTotalFromUsage rejects unusable values`

## Verification

Task-1 verify command (verbatim) exited 0:

```
n=8 rc=0
sse rc=0
import check rc=0
```

`npm test`: 183 tests, 182 pass, 1 fail. The single failure is
`SIGTERM rejects queued requests with 503 and no upstream call` and reproduces
identically on base commit `e10638858526be25e9ad2102c98eb48b8b5a4a02`; it is
unrelated to this task and appears environment/Node-version specific (local Node
v26.4.0; CI targets Node 20/22/24).

`npm run check`: clean (lint, typecheck, format:check).

`git diff --check`: clean.

## Public exports and callback semantics implemented

- `usageTotalFromUsage(usage) -> number | null`: returns `usage.total_tokens` when it
  is a finite non-negative number; otherwise `usage.prompt_tokens +
  usage.completion_tokens` when both are finite non-negative numbers; otherwise
  `null`. Missing, null, non-object, array, non-finite, negative, and non-number
  components are unusable. No rounding, clamping, coercion, or normalization.
- `JSON_OBSERVATION_BYTE_BOUND = 1048576`.
- `createJsonObserver(onUsage) -> { observe(chunk), end(), detach() }`:
  - accumulates raw bytes; checks the prospective total before retaining a chunk;
  - exactly 1,048,576 bytes stays within the bound; a chunk pushing past it drops
    the copy and detaches before retention;
  - `observe()` never throws and is inert after `end()` or `detach()`;
  - `end()` decodes and parses the retained copy once, then invokes
    `onUsage(total | null)` exactly once; inert on repeat calls;
  - `detach()` drops the copy, marks detached, and invokes `onUsage(null)` once if
    no outcome was delivered; after detachment `end()` is inert;
  - callback failures are contained.
- `createSseObserver` keeps its lifecycle and delegates `isValidUsage`/`usageTotal`
  to `usageTotalFromUsage`; SSE outcomes unchanged.

## RED evidence

Cycles 1-4 and 6-8 were observed red before their GREEN commits:

- Cycle 1: `SyntaxError: ... does not provide an export named 'createJsonObserver'`
- Cycle 2: `TypeError: Cannot read properties of undefined (reading 'total_tokens')`
- Cycle 3: `AssertionError: Expected values to be strictly equal: 'bad' !== null`
- Cycle 4: `SyntaxError: Unexpected token 'o', "not json" is not valid JSON`
- Cycle 6: `AssertionError: overflow detaches and delivers null once`
- Cycle 7: `AssertionError: Got unwanted exception: callback failure is contained`
- Cycle 8: `SyntaxError: ... does not provide an export named 'usageTotalFromUsage'`

Cycle 5's test passed on its first run because the then-current string-based
accumulation happened to retain the numeric total; the GREEN commit switched
accumulation to bounded `Buffer` chunks decoded once at completion so split
multi-byte characters decode correctly. No behavior regression resulted.

## Deviations and concerns

- Test imports were consolidated and Prettier formatting applied in separate
  commits (`1d4edf0`, `087bd19`) after the eight RED/GREEN cycles.
- `observer.js`, `server.test.js` changes only; `server.js`, `budget.js`,
  `admission.js`, `config.js` untouched.
- One pre-existing SIGTERM test fails on local Node v26.4.0 (see above);
  not caused by this task.

TL;DR: Added shared `usageTotalFromUsage`, `JSON_OBSERVATION_BYTE_BOUND`, and `createJsonObserver` in `observer.js`, delegated SSE validity to the helper, added eight tests, marked task 1 passing; check clean, 182/183 pass with one pre-existing SIGTERM failure.

## Additional full-suite rerun

A second `npm test` run after the report commit completed with `183 tests, 183 pass, 0 fail`
(duration 520s). This confirms the earlier SIGTERM failure was a flake and not a
task-1 regression.
