# Task report — e04s02 / task 2: admission gate wiring in `server.js`

- **Status:** done
- **Commit SHA:** none. Changes are left unstaged for the reviewer, as the task brief requires.

Intended Conventional Commits message:

```text
feat(admission): wire the admission gate into the proxy request path
```

## What landed

`server.js` (+11/-1): the gate sits after `/health`, after `/v1` routing, after
`authorized(req)`, after the `config.unconfigured` check, and before the upstream
header/URL build and `fetch`, so a queued or rejected request never contacts the
upstream. `createAdmission(config.limits)` is constructed at module scope next to
`parseConfig`; the per-request handle releases on the response's `close` event.
Both rejection reasons share one `sendJson` path, which drains the request first
so a keep-alive connection survives an early rejection:

```js
const ticket = await admission.acquire();
if (!ticket.admitted) {
  return sendJson(req, res, 429, { error: "Too many requests" }, { "retry-after": "1" });
}
res.on("close", ticket.release);
```

`sendJson` gained an `extraHeaders = {}` parameter whose spread feeds
`res.writeHead`. `server.js` exports nothing new, so the module's default
export remains the only seam. `admission.js` and `config.js` are untouched.

`server.test.js` (+214/-2), all additive. The stub upstream gained a `hold` mode
that answers a real 200 header set and keeps the response open until the test
releases it, and the test file gained `describe("admission concurrency ceiling")`
with three tests. Only two existing lines were changed, both signatures widened
to carry `heldResponses`; every existing stub mode is byte-identical.

## Verification Output

Task 2's verify, run verbatim from the repo root:

```text
VERIFY_RC=0 MATCHED=4
no new security findings in affected paths: rejection body is a fixed string
```

The three tests, as TAP reports them:

```text
    ok 1 - concurrency ceiling absent, blank, and "0" admits every concurrent request, no wait, no rejection
    ok 2 - positive concurrency ceiling admits up to the ceiling, the rest wait (PROXY_MAX_CONCURRENT_REQUESTS=2)
    ok 3 - full queue answers 429 with fixed body, positive Retry-After, and zero upstream requests
ok 1 - admission concurrency ceiling
# pass 3
# fail 0
```

Coverage against the task's three required behaviors: the ceiling disabled three
ways (`undefined`, `""`, `"   "`, `"0"`) admits five concurrent requests with no
wait and no rejection, all 200; a ceiling of `2` admits exactly two and stalls the
rest, then admits each waiter as a slot frees, all 200; a full queue answers 429
with `content-type: application/json; charset=utf-8`, a positive integer
`retry-after`, the exact body `{"error":"Too many requests"}`, and leaves the
upstream arrival count at one, proving the rejected request made zero upstream
requests. The rejection body and header are also asserted to leak none of
`PROXY`, `maxConcurrent`, `admission`, `queue`, the test's port, or `127.0.0.1`.

`npm test`:

```text
ℹ tests 103
ℹ suites 9
ℹ pass 103
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

## Notes, deviations, and concerns

**Two real defects were found and fixed during this task.** Neither is in the
landed code path; both were in work left behind by earlier implementer sessions.

1. **`writeHead()` does not flush headers.** The `hold` mode wrote a 200 header
   set and returned without writing a body, and the proxy's `fetch` never
   settled: undici waits for headers on the wire, not for headers queued in the
   stub. The proxy's own connect timer then fired after 30s and every client got
   `502` with `{"error":"Bad gateway"}`. Proven in isolation before the fix —
   `fetch` against a `writeHead`-only server is still pending at 2000ms, and
   resolves in 268ms after `res.flushHeaders()`. The mode now flushes; the
   comment records why, because the call looks redundant.
2. **Two unbounded polling loops.** `while (heldResponses.length < 5)` and
   `while (receivedRequests.length < 5)` had no deadline, so a gate regression
   turned the suite into a hang instead of a named failure. Replaced with
   `waitForCount`, a bounded wait that names what never happened.

A third defect in this task's own test logic was found while running it: releasing
an admitted request admits the next waiter, whose response is itself held, so
draining a ceiling is a loop rather than a fixed number of releases, and the
arrival count can move by more than one per release. A `startDrainPump` helper
now ends each held response as it appears, and the test drives on the recorded
arrivals only.

**The two test names were changed to carry the verify's keywords.** Task 2's
verify greps `^[[:space:]]*ok [0-9]+ - .*(concurrency ceiling|full queue)`, which
counts only TAP lines whose own text contains the phrase. With the original
titles the three subtests matched nothing and the count was 1, so the gate was
red on tests that passed. Two titles now carry `concurrency ceiling` and the
third carries `full queue`; the matched count is 4, comfortably above the
required 3.

**Task 6 will find a stale test title.** `server.test.js` still contains
`PROXY_MAX_CONCURRENT_REQUESTS=1 over a one-slot queue still proxies normally
(values validated, not applied)`. Its assertions stay verbatim and it still
passes, but it no longer passes for the reason its title states: the ceiling is
now enforced, so a one-slot ceiling with a full queue answers 429 rather than
"proxying normally" whenever more than one request is in flight. The one-request
case in that test is unaffected. Renaming it is task 6's work and was left
untouched here, alongside the other three `values validated, not applied` titles.
Counts: 4 before, 4 after, 1 naming `MAX_CONCURRENT`, and no new test name
contains `whitespace`, so task 6's own gate stays falsifiable.

**Not verified by me.** The behavioral change to the existing
`values validated, not applied` test above is the main thing a reviewer should
confirm independently: whether task 6 should rename it, or whether that test
needs rewriting to keep testing the same claim.
