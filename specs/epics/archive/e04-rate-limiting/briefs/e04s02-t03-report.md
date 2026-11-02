# Task report — e04s02 / task 3: strict FIFO and no-bypass over the admission queue

- **Status:** done
- **Commit SHA:** none. Left unstaged for the reviewer.

Intended Conventional Commits message:

```text
test(admission): pin strict FIFO order and the no-bypass rule
```

## What landed

`server.test.js` only, one new additive describe block, `admission queue FIFO`,
with two tests. No production code changed: `server.js`, `config.js` and
`admission.js` are untouched, and the queue's ordering was already implemented
by task 1's `admission.js` FIFO list — this task proves it from outside the
module, through the black-box harness, as the task requires. Nothing is exported
and no test seam was added.

Both tests prove order from the stub's own recorded arrival list rather than from
a clock. Each request carries a distinct `tag` in its POST body, and the stub
already records each arriving request's body, so the order the stub saw the tags
in is exactly the order the queue admitted them. No test asserts an ordering the
stub did not record, and no wait is resolved by a timer: each admission point is
detected by the arrival list growing.

### Test 1 — `strict FIFO admits three waiters in arrival order with a one-slot ceiling`

A one-slot ceiling (`PROXY_MAX_CONCURRENT_REQUESTS: "1"`, queue size 3, queue
timeout 120s so the wait cannot expire mid-test) with four requests fired in
order `tag-0` through `tag-3`. `tag-0` takes the slot and is held open, so the
other three are waiters in a fixed order. The holder is released, and each freed
slot admits the oldest waiter whose own response is then held, so the drain is a
loop driven by the recorded arrivals rather than by a fixed number of releases.
The assertion is the one the task asks for:

```js
assert.deepEqual(arrivalOrder(receivedRequests), ["tag-0", "tag-1", "tag-2", "tag-3"]);
```

The queue size is 3 because the holder is not a waiter — at size 2 the third
waiter would be rejected with 429 and the test would silently become a
rejection test instead of an ordering test. That was measured, not assumed: the
first run at size 2 admitted only two waiters and timed out.

### Test 2 — `no bypass: a request that arrives after a waiter is admitted still waits behind it`

A one-slot ceiling with a queue of 4. `holder` occupies the slot and `first`
joins the queue; both positions are pinned by waits on the recorded state. Only
then does `late` arrive, while the slot is still held, so its queue position is
fixed before any release can happen. After the holder is released, `first` is
admitted before `late`, and the final recorded order is `holder`, `first`,
`late`. A LIFO queue, or a fresh arrival allowed to jump the line, would flip
that order, which is the failure the task asks to pin.

## Verification Output

Task 3's verify, run verbatim from the repo root:

```text
no new security findings in affected paths: FIFO order does not leak caller data
VERIFY_RC=0
```

The two tests as TAP reports them:

```text
    ok 1 - strict FIFO admits three waiters in arrival order with a one-slot ceiling
    ok 2 - no bypass: a request that arrives after a waiter is admitted still waits behind it
ok 1 - admission queue FIFO
# pass 2
# fail 0
```

`npm test`:

```text
ℹ tests 105
ℹ suites 10
ℹ pass 105
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
```

## Notes and deviations

**Production code is unchanged by this task.** The task's verify gate is entirely
about proving existing behavior, and `admission.js` already implements a FIFO
list resolved by the release that frees capacity. Landing tests only is the
honest shape for that. The gate also checks `admission.js` for `setInterval` and
`while (true)`, which stays absent.

**A 429 could have silently satisfied this task's gate.** Task 3's verify only
counts TAP lines matching `FIFO`, so a test whose waiter was rejected instead of
queued would still be counted as passing if its assertions did not catch it. The
first run of test 1 hit exactly this at `PROXY_MAX_QUEUE_SIZE: "2"`: the third
waiter was rejected, the test timed out on its own drain loop, and the recorded
order was short one tag. Raising the queue size to 3 is what makes the test
actually assert ordering. Note for task 4, which owns the queue-timeout rejection:
task 4's own verify counts `queue timeout` names, so a `FIFO`-tagged name there
would not be double-counted, and this block's names carry no `slot release`,
`queue timeout`, or `terminal` word, so task 4's gate stays falsifiable.

**Not verified by me.** Whether `admission.js`'s FIFO is first-wins under
concurrent releases — both tests free one slot at a time, so a burst of
simultaneous releases that must preserve order is not covered here. If that is
in scope for task 4's release-once coverage it should be added there.
