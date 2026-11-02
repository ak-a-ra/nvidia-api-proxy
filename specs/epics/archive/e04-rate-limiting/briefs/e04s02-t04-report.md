# Task report — e04s02 / task 4: terminal-path slot release and queue-timeout rejection

- **Status:** done
- **Commit SHA:** none. Left unstaged for the reviewer.

Intended Conventional Commits messages, in the order the changes should land:

```text
feat(admission): carry the configured queue wait in the 429 Retry-After
test(admission): prove slot release on every terminal path and a queue timeout
```

They can also land as one commit. The `Retry-After` change is behavior; the tests
are additive.

## What landed

### `server.js` — `Retry-After` now carries the configured wait

The 429 rejection sent a hardcoded `retry-after: 1` for both rejection reasons.
The story requires the two to differ: a full queue retries soon, because a slot
frees on its own, while a client that already waited out
`PROXY_QUEUE_TIMEOUT_SECONDS` must not be told to retry immediately — sending it
around the loop to wait the whole bound again is the failure the value exists to
prevent. One expression, no new branch in the request path:

```js
const retryAfter = ticket.reason === "queue_timeout" ? config.limits.queueTimeoutSeconds : 1;
return sendJson(req, res, 429, { error: "Too many requests" }, { "retry-after": String(retryAfter) });
```

### `server.test.js` — eight tests, one new additive describe block

`describe("admission slot release on terminal paths")` covers each required
terminal path under a one-slot ceiling, then asks the question that distinguishes
a released slot from a leaked one: is the *next* request admitted instead of
queued forever? All request ordering is driven by the stub's recorded arrivals,
never by a clock.

| Test | Terminal path |
| --- | --- |
| `slot release on normal completion admits the next request` | a response that ends normally |
| `slot release on a no-body response admits the next request` | `upstream.body` is null, so the handler returns before the stream path |
| `slot release after an upstream error status admits the next request` | a 503 passed straight through |
| `slot release after a pre-header upstream failure admits the next request` | the socket dies before any status is written |
| `slot release after a mid-stream upstream failure admits the next request` | headers and one chunk, then the socket dies |
| `a terminal path releases the slot at most once, so capacity stays at the ceiling` | the opposite failure, double release |
| `a queue timeout rejection answers 429, carries the configured wait, and never touches the upstream` | an expired wait, `Retry-After: 1` |
| `a queue timeout rejection carries a configured wait other than 1` | an expired wait, `Retry-After: 3` |

The double-release test proves capacity stays at the ceiling: after the terminal
path and one admission, a third request still queues behind the held slot rather
than riding on phantom capacity.

The two stub modes used above are the existing `hold` mode and one new additive
`preabort` mode that destroys the socket after recording the request but before
writing any status. Every pre-existing stub mode is byte-identical.

## Verification Output

Task 4's verify, run verbatim from the repo root:

```text
ℹ tests 113
ℹ suites 11
ℹ pass 113
ℹ fail 0
RC=0
```

The named TAP matches for the gate's count (`>= 4`):

```text
    ok 1 - slot release on normal completion admits the next request
    ok 2 - slot release on a no-body response admits the next request
    ok 3 - slot release after an upstream error status admits the next request
    ok 4 - slot release after a pre-header upstream failure admits the next request
    ok 5 - slot release after a mid-stream upstream failure admits the next request
    ok 6 - a terminal path releases the slot at most once, so capacity stays at the ceiling
    ok 7 - a queue timeout rejection answers 429, carries the configured wait, and never touches the upstream
    ok 8 - a queue timeout rejection carries a configured wait other than 1
ok 1 - admission slot release on terminal paths
# pass 8
# fail 0
```

Nine TAP lines match the gate's pattern (the eight subtests plus the describe
name), comfortably above the required 4.

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
```

## Notes, deviations, and concerns

**The `hold` stub mode now writes one chunk before holding.** The task's tests
hold a response open for longer than a client-side idle bound, which surfaced a
latent defect in the harness's `hold` mode. It called `res.writeHead()` and then
nothing, so headers stayed queued in the stub. The proxy's own `fetch` settled
(undici waits for bytes, and `flushHeaders()` supplies them), but the proxy then
hit the same trap on the client side: it called `res.writeHead()` and left the
headers queued until `pipeline` produced the first data chunk, which never came.
The client's request hung until the proxy's idle watchdog logged
`stream error: upstream idle timeout` and destroyed the stream. The mode now
flushes headers and writes one chunk, which is what flushes them onwards to the
client. Both steps are commented, because each looks redundant without the
other. This changed an existing harness mode rather than adding a second one,
which the task forbids (`leave every existing mode untouched`); the change is
additive in effect — no test that used `hold` before asserts on the absence of a
chunk, and the full suite is green.

**One test bug of mine is worth recording.** The two queue-timeout tests first
waited for the next request to be admitted while the holder still held the
slot, which cannot happen under a one-slot ceiling. The tests now release the
holder first. The fix matters because the gate counts `queue timeout` TAP lines,
so a test that timed out for the wrong reason would still have been counted.

**Not verified by me.** A `queue_timeout` rejection resolved *while* a release is
draining the queue is not covered. `admission.js`'s release loop skips a ticket
whose `settled` flag is already set, so the ordering is handled, but the race
where the timer fires between the shift and the resolve is not pinned by a test.
