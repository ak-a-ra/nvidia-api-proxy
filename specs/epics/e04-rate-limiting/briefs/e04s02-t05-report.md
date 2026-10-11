# Task report — e04s02 / task 5: health bypass, inert 429, and pass-through parity

- **Status:** done
- **Commit SHA:** none. Left unstaged for the reviewer.

Intended Conventional Commits message:

```text
test(admission): prove health bypass, an inert 429 body, and ceiling parity
```

Additive only: `server.js`, `admission.js`, and `config.js` are byte-identical
after this task. Every property it asks for is proved from outside the gate
through the black-box child-process harness, because a second test seam is
forbidden by the story.

## What landed

`describe("admission gate: local endpoints and pass-through parity")` — three
tests, no production code.

| Test | Property |
| --- | --- |
| `health bypass: /health answers 200 under full saturation` | `/health` answers 200 `{status:"ok"}` while the gate is rejecting |
| `429 body is the fixed string and leaks no model, path, queue depth, budget, or upstream host` | the rejection is exactly `{"error":"Too many requests"}` and carries nothing else |
| `pass-through parity with the ceiling enabled leaks no behavior change` | an admitted request is proxied exactly as an ungated one |

### The saturation state

All three tests observe the same state the task names: a one-slot ceiling with a
one-slot queue, the `hold` stub mode keeping one response streaming, and the
queue full. The gate's saturation is *proved*, not assumed — a further request
is fired and must be rejected with 429 before `/health` is called, so the 200 is
answered from a gate that is demonstrably rejecting. Counts come from the stub's
records (`heldResponses`, `receivedRequests`), never from a clock; the only
`sleep` is the 100ms that lets a queued request reach the gate, and every
decisive fact after it is arrival-driven.

### The leak assertion

The forbidden list is built from the rejected request's own target and body
(`nemotron`, `chat/completions`, `/v1`), the upstream host and port the holder
reached (`127.0.0.1`, the proxy port), and the gate's vocabulary
(`PROXY`, `maxConcurrent`, `admission`, `queue`, `depth`, `budget`) — so every
fact the rejection could plausibly carry is checked against, including the
casing drift `Too Many`. It extends the existing forbidden lists from task 2 and
task 4, which already covered the port, the variable prefix, the module name and
the loopback address.

### The parity assertion

Each request shape runs through two children: one with the ceiling absent
(today's path) and one with it enabled. Both sides of the comparison are checked
— the client-visible response (`status`, body, headers minus `date`, multi-value
`set-cookie` through `getSetCookie()`, since iterating `Headers` merges the
values) and the stub's record of what arrived upstream (`method`, path,
authorization, body, content-encoding, set-cookie, raw bytes). The shapes:

1. **JSON pass-through** — path mapping and query forwarding
   (`/v1/chat/completions?stream=true`), credential swap
   (`Bearer sk-test` upstream, `Bearer pt-secret` downstream), byte-identical
   body, response header fidelity including a custom `x-upstream-marker` and two
   cookies.
2. **gzip request body** — `content-encoding: gzip` passes through untouched and
   the compressed bytes arrive at the upstream verbatim (`rawBody` deep-equals
   `zlib.gzipSync(payload)`).
3. **SSE streaming** — both chunks arrive through the gate and the full response
   is identical to the ungated one.

This mirrors the logging-parity test's dual-child shape comparison, extended to
the upstream record.

## Verification Output

Task 5's verify, run verbatim from the repo root:

```text
no new security findings in affected paths: overload response is inert
EXIT=0
```

The named TAP matches for the gate's count (`>= 2`):

```text
    ok 1 - health bypass: /health answers 200 under full saturation
    ok 2 - 429 body is the fixed string and leaks no model, path, queue depth, budget, or upstream host
    ok 3 - pass-through parity with the ceiling enabled leaks no behavior change
ok 1 - admission gate: local endpoints and pass-through parity
# pass 3
# fail 0
```

Four TAP lines match the pattern (three subtests plus the describe name), against
the required 2. The describe name deliberately carries neither `health bypass`,
`leak`, nor `429 body` as a keyword, so each count comes from a title that states
the property it proves.

Full suite, after the task's verify:

```text
ℹ tests 116
ℹ suites 12
ℹ pass 116
ℹ fail 0
```

## `npm run check` Output

`npm run check` initially failed on Prettier: the new block was written before
formatting, and `server.test.js` was the only flagged file. `prettier --write
server.test.js` fixed it; `git diff --stat` confirms the change is a pure
309-line insertion with no unrelated reformat. The re-run:

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

**The parity claim is about an admitted request, not a queued one.** The task's
parity list (path mapping, query forwarding, credential swap, header fidelity,
byte-identical body, SSE) is asserted for requests that pass the gate without
waiting; tasks 2-4 own the waiting path. This is the boundary the story draws:
e04s02 guarantees a waiter cannot leak (admission or timeout, idempotent
release), while e04s03 (#16) owns a queued request whose client disconnects.

**The `date` response header is filtered from the header comparison.** The two
children answer microseconds apart, so `date` differs by clock, not by behavior —
the same exclusion the logging-parity test uses.

**Not covered here: queue-timeout rejection during a concurrent release.** The
race where the timer fires between the shift and the resolve in the release loop
is the same gap task 4's report recorded; this task does not close it, and
e04s03 (#16, abort-aware admission) is the natural owner.

**Count drift is untouched by design.** The suite moved 113 → 116, but the living
docs still state 100 (task 4's report recorded 113 and the docs had not been
synced even then). Task 8 owns the sync and its gate fails on the pre-story floor
of 100, which is why this task does not touch any count.
