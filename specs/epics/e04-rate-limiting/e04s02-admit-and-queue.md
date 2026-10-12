# e04s02: Admit and queue work with bounded concurrency

* Story: `e04s02`
* Epic: `e04` — Rate limiting and admission control
* Issue: [#15](https://github.com/ak-a-ra/nvidia-api-proxy/issues/15) (slice 2 of 9)
* Status: failing
* BCPs: 8
* Type: feat | Risk: P0 | Context: infra
* Maturity: 3 (Countable)

> First slice of e04 that changes traffic. Everything before it stored limits and
> enforced none, so every statement here about observable behavior is new. `risk: P0`
> follows the high-BCP heuristic (BCPs 8 ≥ 5) and the fact that the change sits on the
> request path of a live streaming proxy.

## 1. Business narrative

An operator who has set `PROXY_MAX_CONCURRENT_REQUESTS=16` today gets a proxy that
ignores it. The number is parsed, validated, stored on the config object, and read by
nothing, so a burst of clients still sends unbounded concurrent work upstream and can
exhaust quota, sockets, or provider capacity before a human sees a signal.

This slice makes that one limit real. Requests beyond the ceiling wait in one bounded
FIFO queue instead of piling onto the upstream, and a request that cannot get in within
the configured wait gets an explicit local 429 rather than joining a backlog nobody
will serve. It is deliberately the smallest slice that is genuinely useful: an operator
can bound upstream concurrency today, without the token accounting, per-model budgets,
or stats that the later slices add.

## 2. Problem statement

There is no admission point in the request path at all. `server.js` authenticates,
checks `unconfigured`, rewrites headers, and fetches — every authenticated request
contacts the upstream immediately. The two knobs that would bound this
(`PROXY_MAX_QUEUE_SIZE`, `PROXY_QUEUE_TIMEOUT_SECONDS`) have no consumer.

The naive fix is worse than the bug: counting active requests with a bare integer and
rejecting when it is full turns a momentary burst into 429s, and releasing that integer
from three or four scattered `res.on("close")` handlers is how a proxy ends up with a
leaked counter that rejects every request forever, or a double release that admits twice
as much work as the operator configured.

## Requirements (delta tags)

#### ADDED: An admission gate bounds concurrent upstream work

A positive `PROXY_MAX_CONCURRENT_REQUESTS` caps how many authenticated requests may be
between "about to contact the upstream" and "terminal outcome". The count starts
**before** the upstream fetch and ends when the response stream finishes, when a
no-body response ends, or when the request fails — so a slow connect window occupies a
slot and cannot be used to exceed the ceiling.

#### ADDED: Excess work waits in one bounded FIFO queue

A request that cannot be admitted immediately is queued. The queue is FIFO and shared.
A request may be admitted immediately only when no older request is waiting, so a
later arrival can never overtake an earlier one. Waiting is event-driven: a waiter is
resolved by the release that frees capacity, and never by a polling loop.

#### ADDED: A full queue or an expired wait is a local 429

Both rejections return status 429, body exactly `{"error":"Too many requests"}`, and a
positive `Retry-After`. Neither contacts the upstream. Queue-full retries soon;
queue-timeout carries the configured wait, because a client that already waited that
long should not be told to retry immediately.

#### ADDED: Every terminal outcome releases capacity exactly once

Normal completion, a no-body response, an upstream error status, a pre-header upstream
failure, a mid-stream upstream failure, and a client disconnect each release the slot,
through one cleanup path, with no double release.

#### MODIFIED: Health bypasses admission

**Before:** `/health` is answered before any proxying work begins.

**After:** unchanged in observable behavior, and now explicitly required to stay so —
`/health` keeps its existing response contract and answers during full saturation, so a
deployment probe never depends on service capacity.

#### MODIFIED: The concurrency ceiling is no longer stored-only

**Before:** `PROXY_MAX_CONCURRENT_REQUESTS`, `PROXY_MAX_QUEUE_SIZE`, and
`PROXY_QUEUE_TIMEOUT_SECONDS` are parsed, validated, stored on `config.limits`, and read
by nothing. `README.md`, `tech-stack.md`, and ADR 0002 §Decision 1.4 all say so in those
words.

**After:** the three variables are enforced. That makes those statements false, so this
story amends them rather than leaving them stale. `PROXY_RPM`, `PROXY_TPM`,
`PROXY_SAFETY_MARGIN_PCT`, `PROXY_MAX_BUFFERED_BODY_BYTES`, and `PROXY_MODEL_LIMITS_JSON`
remain stored-only, and their "validated, not applied" tests are untouched.

#### MODIFIED: Admission control and Queue move from planned to live

**Before:** `CONTEXT.md` defines both terms and states that they "name limits this proxy
validates and stores but does not enforce".

**After:** both terms stay defined and their definitions are unchanged; the paragraph
that disclaims enforcement is corrected for the concurrency ceiling while the
rate-budget and per-model disclaims stay. Note the current text names all five terms
in one sentence — "Admission control, Queue, Rate budget, Per-model budget, and Safety
margin" — so Admission control and Queue are disclaimed together with the three that
stay unenforced; only that shared sentence is amended, and usage reconciliation is a
separate sentence that stays as it is.

#### REMOVED: One test claims the concurrency ceiling changes no traffic

**Before:** `PROXY_MAX_CONCURRENT_REQUESTS=1 over a one-slot queue still proxies normally
(values validated, not applied)`.

**After:** (removed as a *claim*, not as coverage) — the assertion is kept verbatim and
the title is corrected. ADR 0002 §Coverage promised that a later enforcing slice would
have to change this test deliberately rather than discover the change in production;
this is that change. A single request under a one-slot ceiling still proxies normally,
which is why the assertion is not weakened. The three sibling tests for the rate pair,
the body-buffer cap, and the per-model map keep their titles, because those limits are
still stored-only.

## 3. Actors

- **Operator** — wants the ceiling they configured to bound real upstream work, and
  wants overload to be visible as an explicit 429 rather than as a silent backlog.
- **Client** — wants a bounded wait and, if it cannot be served, a decision rather than
  an indefinite hang.
- **Developer** — wants one owner of admission state so slots cannot leak and cleanup
  cannot be retried into corruption.
- **Security reviewer** — wants a rejection body that reveals no model, path, queue,
  budget, or upstream detail.

## 4. Preconditions

- Suite green at the merge base. That is a dated record, not the current count — §21
  carries the live figure, which is the one to read and the one the count gate checks.
  The floor is 100, and task 8's gate fails until the suite is above it, so a build that
  adds no black-box test cannot report itself done.
- e04s01 landed: the three variables are already parsed, validated, fatal-on-bad-value,
  and stored, so this story adds enforcement only. It changes no parsing rule and adds
  no environment variable.

## 5. Solution and main flow

One new internal module owns admission state. It exposes a narrow interface: construct
it with the configured limits, then `acquire()` returns either an immediate admission, a
pending ticket resolved later, or a rejection. A single `release()` frees a slot and
wakes the oldest waiter.

`server.js` calls `acquire()` after the `unconfigured` check and before it builds the
upstream request, so a queued request never touches the upstream. Everything after
admission — header fidelity, credential swap, path mapping, the connect and idle
windows, `pipeline`, and the existing error path — is unchanged code, reached unchanged.

Reason for Depth for the new module: it is the only thing standing between a leaked
counter and a proxy that either rejects every request forever or admits unbounded work,
so the invariants (release exactly once, FIFO, no bypass) belong behind one owner
interface rather than spread across request-handler branches. One sentence of reason is
required by the skill's depth gate; this is it.

## 6. Constraints and alternative flows

- **Zero dependencies** — Node built-ins only. [SLOPCHECK](#20-slopcheck) is vacuous.
- **Root-level module, not `src/`** — `CONVENTIONS.md` §File Organization, as `config.js`
  already established.
- **No new test seam** (#13 story 139) and **no limiter internals exported** (story 138).
  Tests stay black-box through the existing child-process harness.
- **Streaming is preserved by construction, not by effort.** Admission is decided before
  the fetch, and the request body stays the `req` stream passed to `fetch` with
  `duplex: "half"`. Nothing buffers, so nothing can reorder or truncate bytes. Body
  buffering belongs to the rate-budget slices and stays out of scope.
- **A queued request holds an unread socket.** The client is subject to normal stream
  backpressure while it waits; the bytes are already arriving and are forwarded intact
  once admitted. This is why the ceiling can be enforced without touching the body.
- Alternative considered: a shared timer that polls the queue every N ms. Rejected —
  it is the fine-grained busy polling #13 story 68 forbids, and it wakes the event loop
  for every waiting client on every tick even when nothing changed.
- Alternative considered: reject immediately when full instead of queueing. Rejected —
  it converts a brief burst into 429s, which is the failure this story exists to prevent.
- Alternative considered: keep the counter in `server.js`. Rejected — four terminal
  paths would each need release logic, and #13 stories 59–61 ask for one owner.

## 7. Domain glossary

Reused unchanged: **Client**, **Upstream**, **Credential swap**, **Local response**,
**Path mapping**, **Header fidelity**, **Response stream**, **Connect window**,
**Idle window**, **Client disconnect**, **Health**, **Pass-through**, **Unconfigured**.

**Admission control** and **Queue** keep their `CONTEXT.md` definitions verbatim — this
story makes them real rather than redefining them. Only the shared sentence disclaiming
enforcement changes, and it must keep naming Rate budget, Per-model budget, and Safety
margin, since those three limits stay unenforced. Usage reconciliation is a separate
sentence with no implementation at all and is untouched.

## 8. Interfaces and contracts

New root-level `admission.js`, imported by `server.js`, not re-exported from it.
`server.js`'s existing exports (`CONNECT_TIMEOUT_SECONDS`, `IDLE_TIMEOUT_SECONDS`,
`default server`) are unchanged.

| Variable | Default | Behavior in this story |
| --- | --- | --- |
| `PROXY_MAX_CONCURRENT_REQUESTS` | disabled | absent/blank/`0` → no gate at all; positive integer → ceiling enforced |
| `PROXY_MAX_QUEUE_SIZE` | `32` | waiting-room capacity; a 33rd waiter is rejected 429 |
| `PROXY_QUEUE_TIMEOUT_SECONDS` | `30` | longest wait before a queued request is rejected 429 |

Disabled means disabled: when the ceiling is absent the module admits everything
immediately, allocates no queue, and starts no timer, so the request path is today's
path.

## 9. Configuration

No new variables, no new parsing rules, no change to ADR 0002's fail-fast-vs-degrade
regime. The three limits arrive from `config.limits` exactly as e04s01 stored them.

## 10. Data and state

Three mutable fields in one owner: an active count, a FIFO list of pending tickets, and
a per-ticket settled flag. A ticket holds its resolve function and its timeout handle.
No counters, no histories — those are the stats slice (#21).

## 11. Invariants

- Active count never exceeds the ceiling at any observable moment.
- A slot is released exactly once per admission; the release handle is idempotent.
- A request is admitted at most once; a timed-out ticket is never admitted later.
- No waiter is overtaken. Admission happens in queue order, always.
- `/health` answers 200 (or 503 unconfigured) during full saturation.
- A rejected request contacts the upstream zero times.
- With the ceiling disabled, behavior is byte-identical to today.
- After admission, path mapping, query forwarding, credential swap, header fidelity,
  body bytes, SSE pass-through, connect window, and idle window are unchanged.
- Every pre-existing test passes, except the one whose title is corrected by task 6.

## 12. Failure modes

- **Double release** inflates the free capacity above the ceiling. Prevented by a
  settled flag inside the release handle, not by counting calls.
- **Leaked slot** rejects every future request forever. Prevented by routing all four
  terminal outcomes plus disconnect through one cleanup path.
- **Queue growth without a bound** is the outage this slice prevents; the bound is
  `maxQueueSize` and it must reject, not grow.
- **A timeout firing as a release is admitted** would double-admit. The ticket's settled
  flag and its removal from the queue at timeout time together prevent it.
- **Rejection after the client vanished.** Writing a 429 to a destroyed response was
  measured during planning: `writeHead`/`end` after `res.destroy()` does not throw
  synchronously and the process survives, but the write must still be guarded so it
  cannot reach a closed socket.
- **`sendJson` drains the request** (`req.resume()`), which is what keeps keep-alive
  usable after an early rejection. The rejection paths must go through it.

## 13. Security and privacy

- The 429 body is a fixed string. It carries no model, path, queue depth, budget, or
  upstream detail, so overload never leaks operational state.
- `Retry-After` reveals only a configured, non-secret value. It is not a cross-origin
  signal and carries no host.
- Admission sits **after** authentication and after the `unconfigured` check, so
  unauthenticated callers still get 401 and still cannot probe queue state. Placing it
  earlier would let an anonymous caller distinguish "queue full" from "authorized",
  which is a credential-state leak the ADR 0001 ordering exists to prevent.
- A queued request holds a connection and its buffered bytes; that memory is bounded by
  the queue size times stream backpressure, not by any unbounded read.

## 14. Observability

No new endpoint and no new log fields. `/health` is unchanged. `PROXY_LOG_REQUESTS` keeps
its five-field line; a 429 is logged exactly like any other local response, through the
existing `close` hook, with no extra field distinguishing a rejection from a 404.

## 15. Dependencies

- Blocked by: #14 (e04s01) — complete. Its config owner supplies all three limits.
- Blocks: #16 → #17 → #18 → #19 → #20 → #21 → #22.
- Same-dependency note as e04s01: this story adds tests, so it touches the count-sync
  sites. Run sequentially with any other test-adding work, never in parallel.

## 16. Risks and assumptions

- **Concurrency bugs are timing-shaped.** Mitigation: every timing claim is driven
  through the stub upstream's observable record (arrival order, teardown flags) rather
  than by sleeping and hoping. No test asserts an ordering the stub did not record.
- **A hung waiter** holds a socket until the configured timeout. Bounded by design, and
  that bound is the story's point.
- **Assumption:** the stub upstream gains modes for this slice. Existing modes are
  untouched; new ones are additive, so no existing test changes shape.
- **Assumption:** one new root-level source file, on the `config.js` precedent.

## 17. Acceptance criteria (Gherkin)

```gherkin
Scenario: Ceiling absent or disabled admits everything
  Given PROXY_MAX_CONCURRENT_REQUESTS is absent, blank, or "0"
  When more concurrent requests arrive than any other run would allow
  Then every one reaches the upstream
  And no request waits and no request is rejected

Scenario: The ceiling bounds concurrent upstream work
  Given PROXY_MAX_CONCURRENT_REQUESTS is 2
  When four requests are in flight at once
  Then exactly two contact the upstream before one of them finishes
  And the other two wait

Scenario: A slot is held across the connect window and the whole stream
  Given PROXY_MAX_CONCURRENT_REQUESTS is 1
  When one upstream response is still streaming
  Then a second request waits rather than contacting the upstream

Scenario: The queue is FIFO and cannot be overtaken
  Given PROXY_MAX_CONCURRENT_REQUESTS is 1
  When three requests arrive in order while the single slot is busy
  Then they reach the upstream in that same order

Scenario: A full queue is rejected locally
  Given PROXY_MAX_CONCURRENT_REQUESTS is 1 and PROXY_MAX_QUEUE_SIZE is 2
  When a fourth request arrives while one runs and two wait
  Then it receives 429 with body {"error":"Too many requests"} and a positive Retry-After
  And the upstream received exactly three requests

Scenario: An expired wait is rejected locally
  Given PROXY_MAX_QUEUE_TIMEOUT_SECONDS is 1
  When a queued request waits past that bound
  Then it receives 429 with the same body and a positive Retry-After
  And it never contacted the upstream

Scenario: Capacity is released exactly once on every terminal path
  Given PROXY_MAX_CONCURRENT_REQUESTS is 1
  When a request completes normally, returns no body, returns an upstream error status,
       fails before response headers, or fails mid-stream
  Then the next request is admitted each time

Scenario: Health stays available under saturation
  Given PROXY_MAX_CONCURRENT_REQUESTS is 1 and both slots are busy and the queue is full
  When /health is requested
  Then it answers 200 with its existing body

Scenario: Rejections leak nothing
  Given a request is rejected for a full queue or an expired wait
  Then the response body is exactly {"error":"Too many requests"}
  And it names no model, path, queue depth, budget, or upstream host

Scenario: Pass-through is unchanged after admission
  Given PROXY_MAX_CONCURRENT_REQUESTS is 4
  When a request is proxied
  Then path mapping, query forwarding, credential swap, header fidelity, request body
       bytes, SSE streaming, connect window, and idle window behave exactly as with the
       ceiling disabled
```

## 18. Out of scope

- Rate budgets, RPM/TPM enforcement, the token estimator, per-model budgets, the safety
  margin, and body buffering — all later slices.
- Abort-aware and shutdown-safe admission: a queued disconnect removing its waiter, and
  SIGTERM rejecting waiters with 503, are #16. This story makes a waiter wait, times it
  out, and releases it; it does not add the disconnect and shutdown paths.
- `/stats` and every counter — #21.
- No retry, no replay, no backoff, no per-client quota, no distributed coordination.
- No change to any parsing rule, no new environment variable, no change to `/health`'s
  contract, and no change to the existing 401/404/502/503 responses.
- `perf-bench.js` is not extended; it is not part of this story's verification.

## 19. Zoom-out check — `server.js`

**Purpose.** HTTP handling: server lifecycle, bearer auth, path mapping, header
fidelity, upstream fetch and streaming, the two timeout windows, and graceful shutdown.
Since e04s01 it also calls the config owner once at startup and holds no parsing logic.

**Callers.**

1. `npm start` → `node server.js` (also `render.yaml`).
2. `server.test.js` — spawns it as a child, relies on the **default export**, the
   `listening`/`error` events, and the IPC port handshake.
3. `specs/epics/e04-rate-limiting/smoke-bind-host.mjs` — same child-process pattern.
4. Named exports `CONNECT_TIMEOUT_SECONDS` and `IDLE_TIMEOUT_SECONDS`.
5. `config.js` — called once at import; this story adds no call into it.

**Contracts that must survive this story.**

- `export default server` remains the only supported test seam.
- Environment variables are read once at import.
- `process.exit(1)` plus a stderr message on a bad `NVIDIA_BASE_URL` (ADR 0001).
- Credential degrade: `/health` → 503 `{ status: "unconfigured" }`; proxied request →
  503 `{ error: "Proxy is not configured" }`.
- 401 precedes 503 for unauthenticated callers when unconfigured.
- `/health` is unauthenticated; bare `/v1` and `/v1/` return 404.
- `duplex: "half"` whenever the body is a stream and the response is read.
- Multi-value `set-cookie` via `getSetCookie()`; `content-length` restored selectively;
  `content-encoding` stripped from responses only.
- Errors never leak internals: upstream failure → clean 502 `{ error: "Bad gateway" }`.
- `sendJson` drains the request first so keep-alive survives early rejections.
- `pipeline(src, res)` owns the stream error path.
- Client disconnect aborts the upstream fetch; that `AbortError` is swallowed without a 502.
- SIGTERM drops idle connections, lets in-flight streams finish, exits 0 within 10s.

## 20. Slopcheck

No external package is proposed. The project is zero-dependency by hard constraint
(`CONVENTIONS.md` Never-Do list, README badge, `package.json` has no `dependencies`).
The tag set is empty and no human approval is required.

## 21. Risks section

- Slot leak or double release → detected by task 4, which drives every terminal path and
  then proves the next request is admitted.
- Queue not FIFO, or an arrival overtaking a waiter → detected by task 3.
- Overload leaking internals → detected by task 2's exact-body assertion and task 5's
  leak check.
- Regression in the existing suite (the baseline is the detector; the count is carried by
  task 8's gate, which derives it from `npm test` and also refuses to pass while the
  suite sits at the pre-story floor of 100).
- Docs left asserting "stored, not enforced" → detected by task 7.
- A stale count in `specs/state.yaml`'s handoff note → not detectable by the count scan,
  which needs the word "tests" next to the number and that file states bare figures.
  Task 8 names the file instead; AGENTS.md already lists the handoff note as a site to
  keep current.

## 22. Out-of-scope references

See §18.

## References

- Issue [#15](https://github.com/ak-a-ra/nvidia-api-proxy/issues/15)
- Issue [#13](https://github.com/ak-a-ra/nvidia-api-proxy/issues/13) — user stories
  9–15, 58–74, 96–101, 135–144, 156–166
- `docs/adr/0002-config-operational-fail-fast.md` — §Decision 1.4 and §Coverage both
  state the eight limits are unenforced; this story amends both
- `server.js` — the request handler this story gates
- `config.js` — `limits.maxConcurrentRequests`, `limits.maxQueueSize`,
  `limits.queueTimeoutSeconds`
- `CONTEXT.md` — glossary
- `specs/tech-architecture/tech-stack.md` — startup configuration table
