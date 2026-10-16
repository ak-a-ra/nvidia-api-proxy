# e04s03: Make admission abort-aware and shutdown-safe

* Story: `e04s03`
* Epic: `e04` — Rate limiting and admission control
* Issue: [#16](https://github.com/ak-a-ra/nvidia-api-proxy/issues/16) (slice 3 of 9)
* Status: todo
* BCPs: 8
* Type: feat | Risk: P0 | Context: infra
* Maturity: 3 (Countable)

> Third slice of e04 that changes traffic. e04s02 made the bounded ceiling real and queued
> excess work, but it left two abandonment shapes open: a queued client that gives up
> still occupies a queue slot and (in the grace path) a held upstream call, and a
> SIGTERM with queued clients is not a defined behavior. This slice closes both, and
> carries no new environment variable, no new capacity counter, and no new endpoint.

## 1. Business narrative

A client that waits in the queue and then hangs up today keeps waiting until its queue
timeout fires, and only then does anything realise it left — the upstream is contacted
for nobody, and the wasted capacity is charged to a departed client. A client that is
already admitted and disconnects mid-stream aborts nothing, so the provider keeps
producing a response nobody will read. And a deploy-time SIGTERM with queued clients is
undefined: the server stops accepting, the queued timers keep counting, and nothing
tells those clients the proxy is going away.

This slice makes abandonment observable and bounded. A queued disconnect removes that
exact waiter, clears its timer and listeners, consumes no slot, and does nothing
upstream. An admitted disconnect aborts the existing upstream fetch and releases
admission exactly once. SIGTERM closes admission before the server waits, rejects every
queued client with a generic 503, and still lets admitted streams finish inside the
existing ten-second grace. Nothing about success changes: a request that completes
keeps completing, and the suite still exits 0.

## 2. Problem statement

There is no cancellation path on a queued ticket. `admission.acquire()` returns a
pending promise and registers one timeout; nothing removes that ticket when the client
disappears, so a departed client still wins a slot when one frees, and only its timer
can reclaim the queue entry. The `res.on("close", releaseOnce)` handler exists and
fires during the wait, but today it can only release an already-admitted ticket — it
cannot take the waiter out of the FIFO list, because admission owns that list.

There is an abort path for an admitted request, but it is wired only after admission
and only for the upstream fetch. A disconnect during the queue wait is not connected to
it, so the downstream close and the admission ticket live in two separate timelines.

SIGTERM is worse: `server.closeIdleConnections()` drops idle sockets and `server.close()`
waits for in-flight ones, but nothing closes admission first. Queued clients therefore
keep their timers and, when one fires, still receive the normal 429 shape against a
proxy that is already shutting down — including a stray upstream contact once a slot
frees. `/health` is untested in that state even though probes keep scraping it.

## Requirements (delta tags)

#### ADDED: A queued client can be cancelled by its own downstream signal

`admission.acquire(signal)` takes the downstream abort signal and registers a
cancellation path on the moment the ticket is enqueued. When that signal aborts
while the ticket is still waiting, the ticket is removed from the FIFO queue, its
timer is cleared, the abort listener is removed, and it is settled once with a
non-admitted result. It consumes no slot, contacts no upstream, and does not compete
for later admission.

#### ADDED: One settled transition per ticket

A ticket has exactly one terminal transition among `admitted`, `timed out`,
`cancelled`, and `rejected by load or shutdown`. A timer firing and a late release
or cancellation racing against it resolves the ticket once; the loser is a no-op and
never admits a second time or fires a second response. The same flag guards the
release handle's claim of that ticket, so no double-write and no orphaned timer.

#### ADDED: An admitted client disconnect aborts upstream work and releases capacity

The per-request `AbortController` that already owns the connect window and the
downstream close keeps its role, and the downstream close now covers both phases:
after the upstream fetch has started, a client disconnect aborts it and the existing
stream error path destroys the response, then the slot is released exactly once
through the same cleanup path. A disconnect before response headers, during the
connect window, or mid-stream is indistinguishable in outcome.

#### ADDED: Client disconnect is never a server error

A client-disconnect abort is swallowed in the catch block without a 502 and without
a retry hint, exactly as before. It is also never counted as an upstream status
or a local 429. No response is written to a socket the client has already closed.

#### ADDED: Admission close rejects every queued client with a generic 503

`admission.close()` rejects every queued ticket with not-admitted and a shutting-down
reason, without an upstream call and without running any release or waking any
waiter into admission. A client that arrived earlier but has not yet been resolved,
and one that arrives after close, both get status 503 and body
`{"error":"Service unavailable"}`. Close is idempotent: the second and later calls
change nothing.

#### ADDED: /health and admitted streams survive shutdown

While admission is closing or closed, `/health` keeps its existing contract and
success status, because it answers before any admission call. Admitted response
streams already in flight keep the existing behavior of `server.close()`: they run
to completion or are cut off by the existing ten-second grace, and SIGTERM still
exits with code 0.

#### MODIFIED: The admission interface gains cancellation and close

**Before:** `createAdmission(limits)` returns `{ acquire }`; admission has no close
path and no concept of a client signal, so every consumer of the queue is
immortal once enqueued.

**After:** `createAdmission(limits)` returns `{ acquire, close }` in both the
disabled and enabled shapes. `acquire(signal)` takes the downstream abort signal;
omitting it admits and executes as before, with no listener attached. `close()`
is synchronous and idempotent and shuts the door to new and queued work.

#### MODIFIED: SIGTERM now closes admission before the server

**Before:** `process.on("SIGTERM", ...)` calls `server.closeIdleConnections()`,
then `server.close(...)`, then a ten-second force exit. Admission is untouched, so
queued clients keep their timers.

**After:** the same handler calls `admission.close()` first, then keeps the existing
idle-drop, graceful close, and ten-second force exit unchanged. The order preserves
the admitted-stream grace and the clean exit code of the existing test, while making
shutdown prompt for queued clients.

#### MODIFIED: Rejection shape distinguishes overload from shutdown

**Before:** every `admitted: false` result becomes 429, body
`{"error":"Too many requests"}`, with `Retry-After` of the configured wait or 1.

**After:** a shutting-down reason becomes 503, body
`{"error":"Service unavailable"}`, with no `Retry-After` and no upstream contact.
Queue-full and queue-timeout stay exactly as they were, including their bodies and
retry semantics.

#### MODIFIED: Client disconnect on a queued ticket removes the waiter, not just a release

**Before:** `server.js` registers `res.on("close", releaseOnce)` before the wait,
so the downstream close fires while the ticket is pending; `releaseOnce` is a
no-op for an in-flight ticket, and admission only learns about the departure when
the timer fires or a slot frees into a dead waiter. The code comment names this as
the e04s03 work item.

**After:** the same downstream close drives `admission.acquire(signal)`, and admission
takes the waiter out of the FIFO list at that moment. The outer `releaseOnce`
remains for the admitted case, and the two paths cannot both touch a slot.

#### MODIFIED: The 429 arm is guarded against a destroyed response

**Before:** after `acquire()` resolves non-admitted, the handler unconditionally
calls `sendJson`, which calls `res.writeHead`/`res.end` on whatever socket remains.
A client that left while waiting can make that write land after destruction.

**After:** the rejection path checks `res.destroyed` (and a written/ended
response) before writing, skips the body when the socket is gone, and performs the
same single release-safe return a successful admission departure would. A departed
waiter never receives a late 429 or 503.

#### REMOVED: The queue-full rejection is no longer the only shutdown-adjacent path

**Before:** a full queue was the sole reason a client was turned away at the
door, and "full" implied a legitimate retry subject to backoff.

**After:** (removed as the *only* rejection class) — queue-full and queue-timeout
keep their exact contracts, but admission close adds a third class that is not a
retry situation. ADR 0002's text about what a rejection means stays scoped to the
two overload classes; only the shutdown class is new, and it is fatal to retry
against immediately.

## 3. Actors

- **Operator** — wants SIGTERM to reject queued clients promptly without cutting
  admitted streams short, and wants abandonment to free capacity instead of
  leaking.
- **Client** — wants a quick decision when it has given up, and wants a clean 503
  when the proxy is going away rather than an indefinite wait or a 429.
- **Developer** — wants cancellation to live next to the queue it cancels, so
  there is still one owner of admission state.
- **Security reviewer** — wants a shutting-down body as fixed as the 429 body:
  no model, path, queue depth, budget, host, or timing detail.

## 4. Preconditions

- e04s02 landed: `admission.js` owns the active count, the FIFO list, the
  per-ticket timer, the settled-in-release flag, and the 429 overload reasons;
  `server.js` calls `admission.acquire()` after auth and the unconfigured check,
  and routes all four terminal cleanup outcomes plus disconnect through one path.
- The `res.on("close", releaseOnce)` ordering decision from e04s02 (registered
  before the wait, so a close during the wait is observed) stands; only the
  admission-side of that close becomes live now.
- Stub upstream modes and the child-process black-box harness are unchanged; any
  new stub mode is additive.

## 5. Solution and main flow

Admission gains a settlement protocol. A ticket now carries a `settled` flag and
its abort listener, and every terminal transition funnels through one helper:
`settle(ticket, outcome)` flips the flag exactly once, removes the listener,
clears the timer, and resolves the pending promise with the chosen outcome. A
transition that lands after the flag is set is a documented no-op. Timeout,
cancellation, admission, and shutdown all call the same helper, so no path can
both write a result and leave a live listener behind.

`acquire(signal)` stores the signal on the ticket and, when one is present and
the ticket is enqueued, attaches `abort` once. The listener calls `settle` with
not-admitted (`cancelled`) and splices the ticket out of the FIFO list at that
moment. A ticket cancelled after it has already timed out, or already been
admitted by a free slot, is a no-op because the flag is already set.

`release()` already wakes the oldest unsettled waiter. It now skips any ticket
whose flag was set by cancellation or timeout while the release was in flight, so
a free slot never re-admits a departed or expired ticket. This is the timer-vs-
release race the slicing brief calls out: `settled` is the single arbiter and
the test drives both orderings (timer first, release first, timer mid-release).

`close()` sets a `closed` flag and walks the queue with `settle` (`shutting_down`),
without touching `active` or waking any waiter into admission. After close, every
`acquire` — including one for a socket that has not yet been detected as
departed — resolves immediately as not-admitted (`shutting_down`), so late
arrivals are rejected at the door rather than queued. `close()` called twice is
the second visit, and changes nothing.

`server.js` maps reasons in one place: `shutting_down` to 503
`{"error":"Service unavailable"}`; everything else overloads to the existing 429
with its existing retry rule. The rejection path is guarded once more before the
write, so a socket gone before the resolution is observed does not get a late
status. The downstream close handler that was already registered before the wait
now drives admission cancellation for queued tickets and the unchanged
upstream-abort for admitted ones, with the ticket's settlement being the single
source of truth about which phase it was in.

SIGTERM becomes `admission.close()` then the existing `server.closeIdleConnections()`
and `server.close(() => process.exit(0))`, plus the existing ten-second timer.
Admission close runs synchronously before the server begins waiting, so queued
clients get their 503 even while admitted streams are still live.

Reason for Depth for the settlement helper: a ticket can be admitted, timed out,
and cancelled against each other in any interleaving, and three independent
release paths (release, timeout, cancellation) cannot each carry their own
bookkeeping without a fourth that disagrees; routing all of them through one
settled flag is the condition for `settled` to mean what its name says. One
sentence is required; this is it.

## 6. Constraints and alternative flows

- **Zero dependencies** — Node built-ins only. [SLOPCHECK](#20-slopcheck) is vacuous.
- **Root-level `admission.js`**, on the `config.js` precedent; `server.js` imports
  `createAdmission` and `REJECTION_REASONS` and re-exports neither.
- **No new test seam and no limiter internals exported** (#13 stories 138–139).
  Tests stay black-box through the child-process harness, including the SIGTERM
  and race assertions.
- **The shutdown wait is not replaced.** `server.close()` and
  `closeIdleConnections()` keep their exact prior roles and the ten-second force
  exit keeps its existing timing, so admitted streams and exit code 0 are
  preserved rather than renegotiated.
- **The downstream abort listener is removed on every terminal transition.** A
  cancelled ticket that loses the race still unlinks its listener, so a
  settled ticket cannot hold the `res` object alive or fire a second time.
- **A disconnected queued ticket never reaches upstream.** Settlement happens
  before any slot frees, before any release, and before the fetch is created.
- **No body buffering.** Admission stays before the upstream request, so the
  `req` stream and `duplex: "half"` are untouched and streaming invariants hold.
- **A queue-full 429 is still written.** Only a cancelled or shutting-down
  ticket skips the write, and only because the client or the process has already
  gone.
- Alternative considered: keep a per-ticket `cancel()` exposed from `acquire`'s
  result. Rejected — it would make the ticket, not admission, the owner of the
  queue, which is the leaked-counter problem #13 stories 59–61 exist to prevent.
  The signal stays the only handle.
- Alternative considered: abort the upstream fetch with the same controller as
  the downstream close, so one abort means both. Rejected for this slice — the
  downstream abort controller lives past admission and into the fetch, and sharing
  it would let a queue-side cancel reach upstream work that has not started. The
  two controllers stay separate, settlement being the join point.

## 7. Domain glossary

Reused unchanged: **Client**, **Upstream**, **Credential swap**, **Local response**,
**Path mapping**, **Header fidelity**, **Response stream**, **Connect window**,
**Idle window**, **Client disconnect**, **Health**, **Pass-through**, **Unconfigured**,
**Admission control**, **Queue**, **Release**, **Settled**.

**Admission close** is new for this slice: the synchronous, idempotent transition
that refuses new tickets, drains queued ones as 503s, and leaves already
admitted work untouched.

**Cancelled** is new: a non-admitted outcome produced by a downstream abort while
the ticket was queued. It is not a rejection for capacity reasons and carries
no retry advice, because the client is gone.

**Shutdown-stopped** (reason `shutting_down`) is new: a non-admitted outcome
produced by admission close, mapped to the fixed 503 body.

## 8. Interfaces and contracts

`admission.js` keeps its existing surface and gains two members:

```
createAdmission(limits) -> { acquire, close }
acquire(signal?) -> Promise<{ admitted: true, release } | { admitted: false, reason }>
close() -> void   // idempotent; synchronous
REJECTION_REASONS.QUEUE_FULL
REJECTION_REASONS.QUEUE_TIMEOUT
REJECTION_REASONS.SHUTTING_DOWN   // new
// cancelled may be represented by an internal reason or by the not-admitted result
```

`REJECTION_REASONS.SHUTTING_DOWN` is the only reason a `shutting_down` result
is produced. Cancelled tickets need not be exported as a constant, because the
only consumer is `server.js`'s destroyed-response guard and not a documented
status; if exported, they are documented as never becoming a response.

`server.js` keeps `export default server`, `CONNECT_TIMEOUT_SECONDS`, and
`IDLE_TIMEOUT_SECONDS`. Its proxy-token digest, base origin, header sets, and
`sendJson` are unchanged. New internal behaviour: the rejection reason switch
described in §5, and the `admission.close()` call in the SIGTERM handler.

`server.js`'s SIGTERM signature does not change; tests call
`proxy.child.kill("SIGTERM")` and assert exit code 0 exactly as before.

## 9. Configuration

No new variables, no new parsing, no change to `config.limits`. `NVIDIA_BASE_URL`,
`UPSTREAM_CONNECT_TIMEOUT_SECONDS`, `UPSTREAM_IDLE_TIMEOUT_SECONDS`, and every
limiter setting retain their prior meanings. A deployment that does not set the
concurrency ceiling sees no admission object work beyond a `closed` flag, and
disabled-mode `acquire` stays immediate.

## 10. Data and state

Admission state gains, per ticket: a `settled` boolean, the abort listener, and
a `signal`. The shared state gains a `closed` boolean. The queue stays a FIFO
list and `active` stays a counter. No counters or histories are added — that is
#21.

## 11. Invariants

- Active count never exceeds the ceiling at any observable moment.
- A slot is released exactly once per admission; the release handle is
  idempotent; cancellation and shutdown never release or decrement `active`.
- A ticket is settled exactly once; a cancelled or timed-out ticket is never
  admitted later, by any ordering of timer, release, and cancellation.
- No waiter is overtaken, including across cancellation: a free slot still goes
  to the oldest unsettled waiter.
- A rejected-for-shutdown request contacts the upstream zero times.
- `/health` answers 200 (or 503 unconfigured) during full saturation and during
  shutdown processing.
- With the ceiling disabled, cancellation and close add no upstream-side change
  and no local shuffling; the only observable effect of close is the 503 for a
  race-free late arrival.
- After admission, path mapping, query forwarding, credential swap, header
  fidelity, body bytes, SSE pass-through, connect window, and idle window are
  unchanged.
- Every pre-existing terminal cleanup path keeps its release semantics, and the
  client-disconnect abort keeps producing no 502.
- `SIGTERM` still exits 0, still within the ten-second force exit, and still
  lets admitted streams finish within that window.

## 12. Failure modes

- **Double release** inflates free capacity above the ceiling. Prevented by the
  settled flag inside the release handle, and unchanged by this slice.
- **Leaked slot** rejects every future request forever. Prevented by routing
  all four terminal outcomes plus disconnect through one cleanup path, plus the
  new cancellation path that removes a waiter without touching `active`.
- **Double settlement** writes two results or fires two listeners. Prevented by
  `settled` being the single arbiter across `admitted`, timeout, cancellation,
  and shutdown; a loser is a no-op and unlinks its listener.
- **Timer proceeds after release.** The timer fires, sees `settled` set, and
  does nothing; no orphaned promise resolution.
- **Release proceeds after timeout.** The slot frees, but the release handle
  skips `settled` tickets while waking the next waiter.
- **Cancellation mid-release.** The same arbiter rejects the overlap; neither
  the departed ticket nor the departing signal gets a write and no slot is
  claimed by it.
- **Writing a status to a destroyed response.** Guarded before `sendJson` in
  the rejection path, and `sendJson` itself keeps draining the request so an
  already-closed socket does not throw in the close handler.
- **A shutdown that races a timer.** Close settles queued tickets first; a
  timer that fires a moment later does nothing, and no 429 is produced for a
  process that is already rejecting with 503s.
- **A 429 after destruction.** Prevented by the destroyed-response guard and
  by listener cleanup on settlement.

## 13. Security and privacy

- The 429 body stays exactly `{"error":"Too many requests"}` and the 503 body
  stays exactly `{"error":"Service unavailable"}`. Neither names a model, path,
  queue depth, budget, host, timing, or internal reason.
- `Retry-After` is present only on overload rejections and carries only the
  already-public configured value. It is absent on shutdown rejections, because
  no retry helps against a departing process.
- Admission stays after authentication and the unconfigured check, so
  unauthenticated callers still get 401 and cannot probe queue state during
  saturation or shutdown.
- Cancellation removes the listener on every transition, so a settled ticket
  cannot keep a `res` or its buffered bytes alive past their useful life.
- A queued request holds a connection and its bytes; that memory is bounded by
  queue size times stream backpressure, as before, and cancellation frees it
  at the moment of departure rather than at timeout.

## 14. Observability

No new endpoint, no new metric field, no new log field. `/health` is unchanged.
`PROXY_LOG_REQUESTS` keeps its five-field line; a 429, a 503, and a completed
response all log through the existing `close` hook with no extra field
distinguishing the cause. A shutdown body is not a status the client can
reproduce by guessing — it is only emitted during a real `SIGTERM`.

## 15. Dependencies

- Blocked by: #15 (e04s02) — complete. Its admission owner supplies the queue
  and the settled flag that this slice extends.
- Blocks: #17 → #18 → #19 → #20 → #21 → #22.
- Same-dependency note as e04s01/e04s02: this story adds black-box tests, so
  its verify gate is sequential with any other test-adding work, never parallel.

## 16. Risks and assumptions

- **Timing-shaped cancellation and shutdown bugs.** Mitigation: every assertion
  is driven by observable server behaviour (arrival order, teardown flags, exit
  code) rather than by sleeping. Where a fixed observation window is required
  (the no-bypass check), it is stated in the test name and sized to the
  documented 250 ms.
- **A cancelled waiter that loses the race to admission.** Mitigation: the
  `settled` arbiter means a losing cancellation simply unlinks its listener
  and writes nothing; no slot is claimed.
- **A SIGTERM during an active stream.** Mitigation: the existing ten-second
  grace is unchanged and tested by name.
- **Assumption:** the child-process harness already supports SIGTERM assertion
  and upstream abort observation through stub request bookkeeping; anything new
  is additive and documented in the same harness, not a parallel one.
- **Assumption:** queue size stays the default 32 unless a test overrides it;
  no global or per-test override changes the documented default.

## 17. Acceptance criteria (Gherkin)

```gherkin
Scenario: A queued disconnect removes the waiter without touching upstream
  Given PROXY_MAX_CONCURRENT_REQUESTS is 1 with one request holding the slot
  When a second request enters the queue and its client disconnects
  Then that waiter is removed and its timer is cleared
  And the upstream received exactly one request
  And a later third request can be admitted once the first finishes

Scenario: Timer and release race settles the ticket once
  Given a queued ticket whose timer and a freeing slot overlap
  When the timer fires first, then release races it, then the reverse order
  Then each overlap settles the ticket exactly once
  And no ticket is admitted after being cancelled or timed out
  And no slot leaks into a double admission

Scenario: Repeated cancellation and release transitions
  Given queued and admitted tickets in varying orders
  When clients cancel, timers fire, and releases arrive in interleaved sequences
  Then every transition settles once and capacity returns to baseline
  And no abandoned request reaches the upstream

Scenario: Client disconnect before headers aborts upstream and releases the slot
  Given PROXY_MAX_CONCURRENT_REQUESTS is 1
  When a request is admitted and its client disconnects before the response
  Then the upstream fetch is aborted
  And the slot is released exactly once
  And the process logs no 502 and writes no response body for it

Scenario: Client disconnect during streaming aborts upstream and releases the slot
  Given PROXY_MAX_CONCURRENT_REQUESTS is 1
  When a response is streaming and the client disconnects mid-stream
  Then the upstream body is aborted
  And the slot is released exactly once
  And the existing stream error path destroys the response without crashing

Scenario: Queued disconnect cancels the waiter without an upstream call
  Given a saturated ceiling with a queued client
  When that client disconnects while queued
  Then the waiter is cancelled and no upstream request is created for it
  And cancelling it twice has no further effect

Scenario: Client-disconnect abort is swallowed without 502
  Given a proxied client that disconnects
  When the disconnect resolves as an abort
  Then no 502 { "error": "Bad gateway" } is sent
  And no 429 or 503 is sent for it

Scenario: SIGTERM rejects queued requests with 503 and no upstream call
  Given requests are queued behind a saturated ceiling
  When SIGTERM is sent to the proxy child
  Then every queued client receives 503 with body { "error": "Service unavailable" }
  And the upstream received no request for any of them
  And the process exits 0

Scenario: Shutdown rejects late arrivals and keeps health responsive
  Given admission is closing or closed
  When a new client request arrives
  Then it receives 503 { "error": "Service unavailable" }
  And /health still answers with its existing contract during the same window

Scenario: Health stays responsive during shutdown queue saturation
  Given the queue is saturated at shutdown
  When /health is requested
  Then it answers promptly with its existing body and status

Scenario: Admitted stream finishes during SIGTERM grace
  Given a request is already admitted and streaming
  When SIGTERM is sent
  Then that stream may finish within the existing ten-second grace
  And exit code 0 is still observed

Scenario: Default queue size is 32
  Given an unset or default PROXY_MAX_QUEUE_SIZE
  When 34 requests arrive past a one-slot ceiling
  Then exactly 32 of them wait
  And the 34th is rejected with the existing 429 contract

Scenario: Destroyed response skips a late 429
  Given a queued client that has already disconnected
  When its expired wait or its settlement would otherwise write a 429
  Then no status, header, or body is written to the closed socket
  And no exception escapes the rejection path

Scenario: Fixed 250ms observation proves no bypass
  Given an older waiter queued ahead of a later arrival
  When a slot frees
  Then the older one is admitted and the later one stays queued
  And waiting 250 ms shows no arrival overtook its predecessor

Scenario: Full queue keeps the exact 429 contract
  Given the queue is full at saturation
  When another request arrives
  Then it receives 429 { "error": "Too many requests" } with a positive Retry-After
  And request logging and health behavior are unchanged
```

## 18. Out of scope

- Rate budgets, RPM/TPM enforcement, the token estimator, per-model budgets, safety
  margin, body buffering, `/stats`, and retry/backoff — all later slices.
- No new environment variable, no change to any parsing rule, no change to the
  `/health` or pass-through contracts, and no change to the existing 401/404/502
  responses except that client disconnect remains swallowed.
- No change to `perf-bench.js`.
- No per-client identity, no distributed coordination, and no admission metrics.

## 19. Zoom-out check — `admission.js`

**Purpose.** Admission state: the active count, the FIFO wait queue, per-ticket
settled state, the timeout that bounds a wait, and — after this slice — the
cancellation and close transitions. The only reader of `config.limits` at request
time, behind one narrow interface.

**Callers.**

1. `server.js` — constructs it once at import and calls `acquire` per proxied
   request and `close` on SIGTERM. Re-exports none of its internals.
2. `server.test.js` — drives it through the child-process black-box harness; no
   direct import or unit seam.

**Contracts that must survive this story.**

- `createAdmission(limits)` keeps its disabled short-circuit: a null ceiling
  admits immediately, allocates no queue, starts no timer.
- `acquire` absent a signal behaves as today, so a direct caller sees no change.
- `release` stays idempotent and unchanged in signature.
- The existing `REJECTION_REASONS.QUEUE_FULL` and `QUEUE_TIMEOUT` remain, with
  their existing values.
- Environment is read only by `config.js`; this module re-reads none.

## Zoom-out check — `server.js`

**Purpose.** HTTP handling: server lifecycle, bearer auth, path mapping, header
fidelity, upstream fetch and streaming, the two timeout windows, graceful
shutdown, opt-in logging, and — since e04s02 — the admission gate placed after
auth and the unconfigured check.

**Callers.**

1. `npm start` → `node server.js` (also `render.yaml`).
2. `server.test.js` — spawns it as a child; relies on the default export, the
   `listening`/`error` events, and the IPC port handshake.
3. `specs/epics/e04-rate-limiting/smoke-bind-host.mjs` — same child-process
   pattern.
4. Named exports `CONNECT_TIMEOUT_SECONDS` and `IDLE_TIMEOUT_SECONDS`.
5. `config.js` — called once at import; this story adds `admission.close()` only
   in the SIGTERM handler.

**Contracts that must survive this story.**

- `export default server` remains the only supported test seam.
- Environment variables are read once at import.
- `process.exit(1)` plus an stderr message on a bad `NVIDIA_BASE_URL`.
- Credential degrade: `/health` → 503 `{ status: "unconfigured" }`; proxied
  request → 503 `{ error: "Proxy is not configured" }`.
- 401 precedes 503 for unauthenticated callers when unconfigured.
- `/health` is unauthenticated; bare `/v1` and `/v1/` return 404.
- `duplex: "half"` whenever the body is a stream and the response is read.
- Multi-value `set-cookie` via `getSetCookie()`; `content-length` restored
  selectively; `content-encoding` stripped from responses only.
- Errors never leak internals: upstream failure → clean 502
  `{ error: "Bad gateway" }`.
- `sendJson` drains the request first so keep-alive survives early rejections.
- `pipeline(src, res)` owns the stream error path.
- Client disconnect aborts the upstream fetch; that `AbortError` is swallowed
  without a 502.
- SIGTERM drops idle connections, lets in-flight streams finish, exits 0 within
  ten seconds.

## 20. Slopcheck

No external package is proposed. The project is zero-dependency by hard
constraint (`CONVENTIONS.md` never-do list, README badge, `package.json` has
no `dependencies`). The tag set is empty and no human approval is required.

## 21. Risks section

- Race between timer and release double-settles a ticket → prevented by the
  settled arbiter and exercised by the named race tests.
- Cancelled waiter is skipped on release, then re-admitted later → prevented by
  `settled` making the skip permanent.
- Late 429 written to a destroyed socket → prevented by the destroyed-response
  guard and the (named) test.
- Shutdown leaves queued clients waiting past the SIGTERM → prevented by
  `admission.close()` running first, tested by name.
- Admitted stream cut by shutdown → prevented by unchanged `server.close()`
  and the ten-second grace, tested by name.
- `/health` stalls during shutdown → it never calls admission, tested by name.
- Regression in the existing suite → baseline plus the task-6 gate.
- Docs left asserting a stale admission shape → task 5 scans count and claims.

## 22. Out-of-scope references

See §18.

## References

- Issue [#16](https://github.com/ak-a-ra/nvidia-api-proxy/issues/16)
- Issue [#13](https://github.com/ak-a-ra/nvidia-api-proxy/issues/13) — user stories 9–15, 58–74, 96–101, 135–144, 156–166
- `docs/adr/0002-config-operational-fail-fast.md` — §Decision 1.4 and §Coverage
- `server.js` — request handler, release-on-close wiring, SIGTERM handler
- `admission.js` — queue owner this story extends
- `config.js` — limits owner, unchanged by this story
- `CONTEXT.md` — glossary
- `specs/tech-architecture/tech-stack.md` — startup configuration table
- `specs/epics/e04-rate-limiting/e04s02-admit-and-queue.md` — prior slice
- `specs/epics/e04-rate-limiting/briefs/e04s03-slicing-brief.md` — scoping brief
