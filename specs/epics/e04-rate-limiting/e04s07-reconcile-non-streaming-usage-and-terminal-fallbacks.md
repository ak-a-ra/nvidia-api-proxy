# e04s07: Reconcile non-streaming usage and terminal fallbacks

* Issue: [#20](https://github.com/ak-a-ra/nvidia-api-proxy/issues/20)
* Parent issue: [#13](https://github.com/ak-a-ra/nvidia-api-proxy/issues/13)
* Parent stories: 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 97, 100, 101, 146, 166
* Type: feat
* Risk: P0
* Context: infra
* Status: passing

## 1. Business narrative

e04s06 reconciled streamed responses, and e04s04/e04s05 made the reservation
atomically global and per-model. The remaining hole is every response that is
not `text/event-stream`: a non-streaming JSON completion, a no-body status, a
HEAD, an upstream 429, and every failure terminal. Today those paths never
touch the reservation, so an accurate response leaves the estimate standing —
a 12-token completion holds a 1125-token reservation for a full window — while
a body that reports more than was reserved is charged the estimate, not the
truth. Both errors run in the same direction: TPM drifts away from reality.

This story closes the loop without changing what the Client receives. A
non-streaming body still passes through byte-identically; the proxy copies at
most a fixed 1,048,576-byte window and parses that copy once the response
completes. Valid usage replaces the estimate in the same global and requested-
model reservations. Every terminal path that cannot report actual usage — no
body, HEAD, 204, 304, usage-less, malformed, over-bound, and upstream 429 —
retains the estimate conservatively. Nothing retries, replays, cools down, or
opens a circuit: an upstream 429 is the provider's answer, delivered exactly
once.

## 2. Problem statement

Non-streaming completion has three requirements the codebase does not yet
meet:

1. **A bounded copy of a whole body.** An SSE observer parsed incrementally
   because bytes had to keep flowing. A JSON body can only be parsed whole, so
   the copy is bounded by a fixed byte cap, not by an event-size heuristic, and
   the bound must detach cleanly without stalling or altering the forwarded
   bytes.
2. **One outcome per terminal path.** Every path that ends a request must land
   the reservation in exactly one recorded state — reconciled with actual
   usage, or a fallback that keeps the estimate — and must release admission
   exactly once. Today the no-body branch records nothing at all.
3. **Terminal paths that must not invent policy.** A 429 from the upstream, a
   pre-header failure, a mid-stream failure, and an active disconnect each have
   a required behavior that already exists in part; e04s07 proves it and makes
   sure none of them silently frees capacity.

### Requirements (delta tags)

#### ADDED: A bounded copy of the non-streaming body

In rate-limit mode, when the request holds a reservation and the response body
is not `text/event-stream`, the response body is copied internally with a
running byte total. The copy retains at most `JSON_OBSERVATION_BYTE_BOUND`
(1,048,576) bytes. The bytes forwarded to the Client are the bytes the upstream
produced, in the same order and the same chunk boundaries, with no transform
inserted into the forwarding path.

#### ADDED: Valid non-streaming usage replaces the estimate

When the response completes successfully and the copy parses as JSON carrying a
usable `usage` object, its total token count (`total_tokens`, else
`prompt_tokens + completion_tokens`) replaces the estimated `totalTokens` in
the same global reservation and, when the request named a configured model, in
the same model reservation. RPM counts are unchanged.

#### ADDED: Observation overflow detaches cleanly

When the running byte total would exceed the bound, the copy is dropped,
observation stops, `onUsage(null)` fires, the estimate is retained, one
fallback is recorded, and pass-through stays byte-identical and uninterrupted.

#### ADDED: No-body, HEAD, 204, 304, and empty bodies retain the estimate

A response with no body stream, a HEAD response, a 204, a 304, and a 200 whose
body is empty each retain the estimate and record exactly one fallback outcome.
None of them may fail while observing, and all of them must release admission
exactly once.

#### ADDED: The upstream 429 passes through untouched

An upstream 429 reaches the Client with its original status, headers, and body,
exactly once. The proxy adds no retry, replay, cooldown, backoff, or circuit
policy, contacts the upstream no more than the Client's single request, and
retains the estimate (a 429 body carries no usable usage).

#### MODIFIED: The non-streaming pass-through path gains a copy

**Before:** non-SSE bodies flow through `pipeline(src, res, onComplete)` with
no observation; the estimate is permanent for every non-streaming response.

**After:** in rate-limit mode with a live reservation and a body stream, the
same `pipeline(src, res, onComplete)` keeps owning the bytes and the error
path, while a bounded copy is collected from the same chunks and reconciled on
successful completion. No transform is added, so framing, `content-length`
restoration, and the idle watchdog behave exactly as before. Non-SSE responses
in disabled mode keep the original path unchanged.

#### MODIFIED: The no-body branch records one fallback

**Before:** `if (!upstream.body) { res.removeListener(...); return res.end(); }`
— the branch ends the response and records nothing; the estimate stands
silently.

**After:** the branch ends the response and, when a reservation exists, calls
`budgetReservation.reconcile(null)`, which retains the estimate and records
exactly one fallback outcome.

#### MODIFIED: `observer.js` owns the non-streaming copy too

**Before:** `observer.js` owns SSE parsing only; the usage-validity rules
(`total_tokens`, else `prompt_tokens + completion_tokens`, finite and
non-negative) are private to `createSseObserver`.

**After:** the validity rules move to an exported `usageTotalFromUsage(usage)`
that both observers call, so the definition of "usable usage" exists once.
`createJsonObserver(onUsage)` and `JSON_OBSERVATION_BYTE_BOUND` join
`SSE_OBSERVATION_BYTE_BOUND` in the same module.

#### MODIFIED: Every terminal path reconciles at most once and releases once

**Before:** reconciliation is reachable only from the SSE completion path;
abnormal termination (disconnect, mid-stream failure, pre-header failure)
records no outcome at all.

**After:** the same asymmetry holds deliberately for the new paths — a
completed response records exactly one outcome, an abnormal termination records
none — while each of them still releases admission exactly once. Story #13's
"at most one outcome per admitted request" is satisfied as a cap, not as a
minimum.

## 3. Actors

* **Client application** — receives the non-streaming response byte-identically.
* **Proxy** — forwards bytes, observes a bounded copy, reconciles on completion.
* **Upstream (NVIDIA NIM)** — produces the JSON body, the 429, or the failure.
* **Operator** — gets TPM that matches what was actually spent.

## 4. Preconditions

* Rate limiting enabled (both `PROXY_RPM` and `PROXY_TPM` set) and the request
  holds a reservation.
* The response is not `text/event-stream`.

Without those preconditions nothing is observed, no reservation exists, and the
behavior of a build without rate limiting is preserved exactly.

## 5. Solution and main flow

1. `server.js` computes `isSse` as before. It adds `isJson`: rate-limit mode,
   a live reservation, a body stream, and not SSE.
2. When `isJson`, `server.js` creates a `createJsonObserver` whose `onUsage`
   stores the captured total, and registers `jsonObserver.observe(chunk)` on
   the same `src` data events the idle watchdog already listens to. The
   forwarded stream is untouched.
3. `pipeline(src, res, onComplete)` keeps owning the bytes and the error path.
4. In `onComplete`, with no error and a reservation, `server.js` ends the
   observer — `sseObserver.end()` for SSE, `jsonObserver.end()` for
   non-streaming — and then calls
   `budgetReservation.reconcile(capturedTotal)`, where `capturedTotal` is the
   observer's value or `null`.
5. `end()` decodes the whole bounded copy, parses it once as JSON, and invokes
   `onUsage(total | null)` exactly once. A detached observer invokes
   `onUsage(null)`.
6. The no-body branch calls `budgetReservation.reconcile(null)` before
   `res.end()`, so HEAD, 204, 304, and empty 200 bodies record one fallback.
7. On pre-header failure, mid-stream failure, or active disconnect, no
   observer is ended and no outcome is recorded; the estimate stands.

## 6. Constraints and alternative flows

* **No buffering of the forwarding path.** The copy lives beside the pipe, not
  inside it: no `Transform` is inserted for non-SSE responses, so framing and
  `content-length` restoration are bit-for-bit what e04s04/e04s06 shipped.
* **Byte cap semantics.** The copy retains a running total of up to and
  including 1,048,576 bytes. A chunk that would push the total past that drops
  the copy and detaches.
* **Parse once, at the end.** JSON cannot be parsed incrementally, so
  `createJsonObserver` accumulates and parses at `end()`; there is no partial
  parse and no "last usable fragment" rule.
* **At most one outcome.** `reconcile` is already single-shot; no path calls it
  twice, and no abnormal-termination path calls it at all.
* **Abnormal termination records no outcome.** A pre-header failure, a
  mid-stream failure, and an active disconnect keep the estimate with no
  counter movement, symmetric with the landed e04s06 SSE paths.
* **No upstream 429 policy.** Pass-through only. No retry, replay, cooldown,
  backoff, circuit breaker, or extra upstream contact.
* **Disabled mode and SSE.** Unchanged from e04s05/e04s06.

## 7. Domain glossary

* **Non-streaming observer** — bounded whole-body copy parser; the sibling of
  the SSE observer, differing in that it parses once at the end instead of
  incrementally.
* **Observation overflow** — a response body whose byte total exceeds the fixed
  bound; the copy is dropped, not truncated, and the estimate is retained.
* **Terminal path** — any way a request's response ends: completed body,
  no-body status, HEAD, 204, 304, upstream 429, pre-header failure, mid-stream
  failure, active disconnect, shutdown.
* **Estimate fallback** — the recorded outcome when a terminal path cannot
  supply usable usage; the reservation keeps the estimate.

## 8. Interfaces and contracts

`budget.js` exports (unchanged):

```
createBudget(rateLimit, limits, modelLimits) -> { enabled, effective, modelEffective, reserve, release, close, reconciledCount, fallbackCount }
estimateCost(json, buffer) -> { inputTokens, outputTokens, requestCharge, totalTokens, fallback, model }
```

* `reserve(cost)` → `{ admitted, cost, reservation }` when admitted.
* `reservation.reconcile(actualTotalTokens)` → `true` when reconciled, `false`
  when the value was unusable (fallback recorded). A second call is a no-op.

`observer.js` exports (changes in **bold**):

```
createSseObserver(onUsage) -> { observe(chunk), end(), detach() }
SSE_OBSERVATION_BYTE_BOUND = 262144
**createJsonObserver(onUsage) -> { observe(chunk), end(), detach() }**
**JSON_OBSERVATION_BYTE_BOUND = 1048576**
**usageTotalFromUsage(usage) -> number | null**
```

* `createJsonObserver` — accumulates raw chunks while the running byte total
  stays within `JSON_OBSERVATION_BYTE_BOUND`; past the bound it drops the copy
  and detaches. `observe(chunk)` never throws and is inert after `end()` or
  `detach()`. `end()` decodes the copy, parses it once as JSON, invokes
  `onUsage(total | null)` exactly once, and is inert on a second call.
  `usageTotalFromUsage(usage)` returns a finite non-negative number for a
  usable `usage` object and `null` otherwise; both observers call it.
* `server.js` reads `isJson = budget.enabled && Boolean(budgetReservation) &&
  !isSse && Boolean(upstream.body)`. It is not conditioned on `content-type`.

## 9. Configuration

No new variables. `CONFIG_ENV_VARS` in `server.test.js` needs no entry.

## 10. Data and state

Observer state lives in `observer.js`. Reconciliation state lives in the
reservation handle. Counters live in `budget.js`. No new module.

## 11. Invariants

1. Non-streaming bytes are byte-identical to upstream bytes.
2. The first non-streaming chunk reaches the Client before the response
   finishes.
3. The observer never delays, reorders, compresses, or rewrites the stream.
4. The copy holds at most 1,048,576 bytes; overflow detaches without affecting
   pass-through.
5. Valid usage replaces the estimate in the global and model windows.
6. Lower actual credits; higher actual raises; no revocation.
7. No-body, HEAD, 204, 304, and empty bodies retain the estimate and record one
   fallback.
8. An upstream 429 passes through exactly once, with no added policy.
9. Pre-header failure answers a generic local 502 with no internal details.
10. Mid-stream failure destroys only that response stream.
11. Active disconnect commits the estimate, cancels upstream work, and sends no
    502.
12. Each admitted request records at most one outcome; every terminal path
     releases admission exactly once.
13. Disabled mode and SSE responses are unchanged.

## 12. Failure modes

| Failure | Answer |
|---|---|
| Usage present and valid | reconcile to actual total |
| Usage missing | retain estimate, one fallback |
| Usage malformed | retain estimate, one fallback |
| Body not JSON | retain estimate, one fallback |
| Body empty | retain estimate, one fallback |
| Copy over 1,048,576 bytes | drop copy, detach, retain estimate, one fallback |
| No body (200) | retain estimate, one fallback |
| 204 / 304 | retain estimate, one fallback |
| HEAD | retain estimate, one fallback |
| Upstream 429 | pass through exactly once, retain estimate, one fallback |
| Pre-header upstream failure | generic local 502, no outcome recorded |
| Mid-stream upstream failure | destroy that stream, no outcome recorded |
| Active client disconnect | commit the estimate, no outcome recorded |
| Shutdown mid-response | unchanged from e04s03/e04s06 |

## 13. Security and privacy

* No new secret exposure. Usage totals are not logged; the log line's closed
  field set is unchanged.
* Model IDs, rejection reasons, DNS names, and URLs stay inside the proxy; the
  502 body stays generic.
* The copy is response bytes only; nothing is written to disk or to a log.

## 14. Observability

No new log line. `reconciledCount` and `fallbackCount` are internal counters;
they are not exposed until e04s08 (#21, story 123).

## 15. Dependencies

None added. Node built-ins only (`node:stream`, `Buffer`).

## 16. Risks and assumptions

* **Copy growth.** A single chunk larger than the bound must not be joined into
  the copy before the check; the running total is checked per chunk.
* **Idle-watchdog co-listener.** `src.on("data", ...)` already exists for the
  watchdog, so adding a second data listener follows a landed pattern; a
  throwing listener would take the process down, so `observe()` must never
  throw and is guarded defensively at the call site.
* **HEAD body shape.** `upstream.body` is null for HEAD in the current
  undici shape, so HEAD takes the no-body branch; if a future runtime yields an
  empty body stream, the JSON observer parses an empty body and records the
  same fallback. Either shape reaches the same outcome.
* **Content-type sniffing.** Observation is content-type agnostic on purpose: a
  body that carries usage but is mislabeled must still reconcile, and an HTML
  error page simply fails to parse and records a fallback.
* **Reconciliation accuracy.** Totals are replaced verbatim; no re-estimation.

## 17. Acceptance criteria (Gherkin)

```gherkin
Feature: Non-streaming usage reconciliation and terminal fallbacks

  Scenario: exact bytes and a bounded copy
    Given rate limiting is enabled
    And the upstream answers a non-streaming JSON response
    When the proxy forwards it
    Then the client receives bytes byte-identical to the upstream
    And the internal copy holds at most 1048576 bytes

  Scenario: valid usage replaces the estimate
    Given a reservation estimated at 1125 tokens
    And the response reports usage.total_tokens 12
    When the response completes
    Then the reservation's token cost becomes 12
    And a second request inside the window is admitted

  Scenario: lower and higher actual usage
    Given usage lower than the estimate
    Then current usage falls without interrupting the response
    Given usage higher than the estimate
    Then current usage rises and the delivered response is untouched

  Scenario: missing and malformed usage retain the estimate
    Given a response with no usage or with malformed usage
    When the response completes
    Then the estimate stands and one fallback is recorded

  Scenario: overflow detaches without affecting pass-through
    Given a body larger than 1048576 bytes
    When it is observed
    Then the copy is dropped and observation detaches
    And the client still receives the full body byte-identically
    And the estimate is retained

  Scenario: no-body statuses retain the estimate
    Given a 200 with no body, a 204, a 304, or a HEAD response
    When the response ends
    Then the estimate stands, one fallback is recorded, and no observer failure occurs

  Scenario: upstream 429 passes through exactly once
    Given an upstream that answers 429
    When the proxy forwards it
    Then the client receives the original status, headers, and body
    And the upstream is contacted exactly once
    And no retry, replay, cooldown, or circuit behavior appears

  Scenario: failure terminals stay conservative
    Given an upstream failure before headers
    Then the client receives a generic local 502 with no internal details
    Given an upstream failure mid-body
    Then only that response stream is destroyed
    Given an active client disconnect
    Then the estimate is committed, upstream work is cancelled, and no 502 is sent

  Scenario: one outcome and one release per terminal path
    Given any sequence of terminal paths
    Then each admitted request records at most one outcome
    And every terminal path releases admission exactly once
```

## 18. Out of scope

Aggregate stats and `/stats` (#21, e04s08). Integration, documentation, and
release pass (#22, e04s09). Budget waiting (deferred). Retry, replay, cooldown,
and circuit-breaker policy for upstream 429 — explicitly excluded by story 166.

## 19. Zoom-out checks

### `observer.js` (modified)

* **Purpose**: own the copy of a response body — SSE parsing and, now, the
  bounded whole-body copy — plus the shared definition of usable usage.
* **Callers**: `server.js` only; `server.test.js` imports it directly for unit
  tests.
* **Contracts**: existing `createSseObserver` and
  `SSE_OBSERVATION_BYTE_BOUND` keep their behavior byte-for-byte; the shared
  helper is extracted without changing any SSE outcome.

### `server.js` (modified)

* **Purpose**: HTTP entry; owns the bytes and the request lifecycle.
* **Callers**: node; `server.test.js` spawns it; `perf-bench.js` and
  `specs/epics/e04-rate-limiting/smoke-bind-host.mjs` import it.
* **Contracts**: non-streaming bodies keep `pipeline(src, res, onComplete)`
  with no transform; the copy is a side listener. `content-length`
  restoration, the idle watchdog, `STRIPPED_HEADERS`, the disconnect abort, and
  the legacy pass-through path in disabled mode are unchanged.

### `budget.js` (unchanged)

* **Purpose**: own the numbers and reconciliation.
* **Change surface**: none. `reconcile(null)` → fallback and `reconcile(total)`
  → replace are the landed e04s05/e04s06 contract.

### `admission.js`, `config.js` (unchanged)

* **Purpose**: concurrency and config parsing.
* **Change surface**: none.

### `server.test.js` (modified)

* **Purpose**: hermetic process-level integration suite.
* **Change surface**: new stub modes and a new `describe` block; every existing
  test stays byte-identical, including the 237-test count stated in living docs
  until the doc task updates it.

## 20. Slopcheck

* No external packages proposed. Zero-dependency maintained — `[OK]`.
* `Buffer` and `TextDecoder` are Node built-ins — `[OK]`.
* No new abstraction without a reason for depth: `createJsonObserver` exists
  because a JSON body cannot be parsed incrementally like SSE, and
  `usageTotalFromUsage` exists because two observers must agree on what a
  usable `usage` object is, or a fix to one would silently miss the other.

## 21. Risks

See §16. The dominant risk is a regression in the landed pass-through path: the
copy is added as a side listener rather than a transform specifically so the
forwarding chain, framing, and `content-length` restoration are untouched, and
the byte-identity tests in task 2 guard exactly that.

## 22. Out-of-scope references

Issues #21, #22. `docs/adr/0002-config-operational-fail-fast.md` gains an
`## Non-streaming usage reconciliation (e04s07)` block mirroring the e04s06
one. `docs/research/config-invariant-guard-tests.md` is a dated historical
note and must not be updated.

## References

* Issue #20 — acceptance criteria (quoted in the task ledger briefs).
* Issue #13 — parent epic, stories 81–95, 97, 100, 101, 146, 166.
* `docs/adr/0002-config-operational-fail-fast.md`.
* Landed prior art: `describe("e04s06 SSE usage reconciliation")` in
  `server.test.js`, `observer.js`, `budget.js` reservation.
