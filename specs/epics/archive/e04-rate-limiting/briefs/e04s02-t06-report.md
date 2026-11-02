# Task report — e04s02 / task 6: rename the stale concurrency test title

- **Status:** done
- **Commit SHA:** none. Left unstaged for the reviewer.

Intended Conventional Commits message:

```text
test(admission): state the surviving claim of the one-slot ceiling test
```

## What landed

One title change in `server.test.js`. The test at the old line 1269 read:

```text
PROXY_MAX_CONCURRENT_REQUESTS=1 over a one-slot queue still proxies normally (values validated, not applied)
```

e04s02 makes the concurrency ceiling live, so the parenthetical claim — that the
value is parsed but never applied — is false for this variable. ADR 0002 already
recorded that a later enforcing slice would have to change this test
deliberately, and this is that change. The title now states the claim the
assertions actually prove:

```text
PROXY_MAX_CONCURRENT_REQUESTS=1 over a one-slot queue admits a single request and proxies it normally
```

A comment above the test records why the title moved: the ceiling is now
enforced, the surviving claim is the narrower one the two assertions already
proved (200 status, exactly one upstream arrival), and the three sibling
stored-only titles — the rate pair, the body-buffer cap, and the per-model map —
are untouched because those limits are still parsed and stored only.

**Every assertion is verbatim.** The test body is byte-identical: same
`withProxy` configuration (`PROXY_MAX_CONCURRENT_REQUESTS=1`,
`PROXY_MAX_QUEUE_SIZE=1`, `PROXY_QUEUE_TIMEOUT_SECONDS=1`), same POST to
`/v1/chat/completions` with the `nemotron` body, same two assertions
(`res.status === 200`, `receivedRequests.length === 1`). No assertion was
weakened, relaxed, skipped, or deleted. A single request under a one-slot
ceiling is admitted at once, so the test still passes for the reason its new
title states.

## Verification Output

Task 6's verify, run verbatim from the repo root:

```text
9
titles reconciled: one corrected, three stored-only claims intact
VERIFY_EXIT=0
```

Nine TAP lines match `PROXY_MAX_CONCURRENT_REQUESTS` — the renamed test, the
whitespace test, the boundary test, and the other ceiling tests in the block.
The title check confirms no line still pairs the stored-only phrase with the
concurrency variable, and that at least three stored-only titles remain.

Full suite after the change:

```text
ℹ tests 116
ℹ suites 12
ℹ pass 116
ℹ fail 0
```

## `npm run check` Output

```text
> nvidia-api-proxy@1.0.0 lint
> node ./node_modules/eslint/bin/eslint.js server.js config.js server.test.js

> nvidia-api-proxy@1.0.0 typecheck
> node ./node_modules/typescript/bin/tsc -p tsconfig.json

> nvidia-api-proxy@1.0.0 format:check
> node ./node_modules/prettier/bin/prettier.cjs --check server.js config.js server.test.js eslint.config.js

Checking formatting...
All matched files use Prettier code style!
CHECK_EXIT=0
```

## Notes, deviations, and concerns

None. The change is a title and a comment; the suite is unchanged at 116 tests,
same as before this task, which is correct — task 6 corrects a document (a test
title), it does not add coverage. Task 7 is the slice that corrects the prose
documents for the same reason this task corrected the title.
