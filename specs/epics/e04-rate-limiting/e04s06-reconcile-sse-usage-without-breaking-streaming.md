# e04s06: Reconcile SSE usage without breaking streaming

* Issue: [#19](https://github.com/ak-a-ra/nvidia-api-proxy/issues/19)
* Parent issue: [#13](https://github.com/ak-a-ra/nvidia-api-proxy/issues/13)
* Type: feat
* Risk: P0
* Context: infra
* Status: passing

## 1. Business narrative

The proxy reserves an estimated token cost before the upstream is contacted,
and since e04s05 that reservation is atomically global and per-model. But the
estimate is never corrected: a response that reports `usage.total_tokens` leaves
the estimate in place, so a cheap completion can hold a 4096-token reservation
for a full minute and an expensive one can spend more than was reserved. This
story corrects that for streamed responses, without making them buffered or
transformed: every SSE byte the upstream sends reaches the client unchanged and
early, while an internal observer parses a copy incrementally and reconciles
valid actual usage into the same reservation.

Per-model reconciliation stays symmetric with global reconciliation: the same
actual total replaces the estimate in both windows. Missing, malformed, or
unusable usage keeps the estimate and records one fallback outcome. A client
disconnect, a mid-stream failure, or a shutdown never turns a partial result
into a zero-cost request.

## 2. Problem statement

Correcting an estimate requires three things the codebase did not have:

1. **A reconcilable reservation** — `budget.reserve` charged the window and
   discarded the handle, so no later caller could replace the cost.
2. **An incremental SSE observer** — the response is a stream, and usage can
   arrive in a `data:` event whose delimiter and JSON are split across arbitrary
   chunk boundaries. The observer must retain incomplete event state without
   delaying the bytes it is observing.
3. **A bounded observation** — an incomplete event that grows past 262,144
   bytes must detach observation rather than grow unbounded memory, and the
   detach must not affect pass-through.

## Requirements (delta tags)

### ADDED: The observer receives a copy

In rate-limit mode, when the upstream response is `text/event-stream`, the
proxy tees the body through a pass-through transform: every byte is forwarded
to the client in the same order and the same chunk boundaries the upstream
produced, while a copy is handed to an internal SSE observer. The observer
never delays, reorders, compresses, or rewrites the response stream.

### ADDED: SSE parsing across chunk boundaries

The observer accumulates decoded text and splits complete events on blank-line
delimiters (`\n\n`, `\r\n\r\n`, or `\r\r`). Incomplete event state is
retained across `observe()` calls. Usage is found even when every delimiter and
every JSON fragment is split across chunks.

### ADDED: A fixed 262,144-byte observation bound

One incomplete event may grow to at most 262,144 bytes. Exceeding the bound
detaches the observer: no further parsing, no reconciliation, and the estimate
is retained. Pass-through is unaffected.

### ADDED: Valid usage replaces the estimate

When a complete SSE event parses as JSON and carries a usable `usage` object,
the observer captures its total token count. On successful stream completion,
that total replaces the estimated `totalTokens` in the same global reservation
and, when the request named a configured model, in the same model reservation.
RPM counts are unchanged.

### ADDED: Lower and higher actual usage

A lower actual total credits the reservation (current usage falls). A higher
actual total raises current usage. Neither interrupts the delivered stream nor
revokes work already admitted.

### ADDED: Missing or unusable usage retains the estimate

A stream with no usage, malformed usage, or usage split so it never becomes a
complete parseable event retains the estimate and records one estimate-fallback
outcome.

### ADDED: No reconciliation on abnormal termination

A client disconnect, a mid-stream upstream failure, or a shutdown that cuts the
stream keeps the estimate. A partial result is never replaced with zero cost.

### ADDED: Early delivery

The first upstream chunk reaches the client before the response finishes. The
observer does not gate the first byte.

### MODIFIED: The streaming path gains an observer

**Before:** `pipeline(src, res)` forwards the upstream body with no observation.

**After:** In rate-limit mode, for `text/event-stream` responses, the body
passes through a transform that forwards bytes unchanged and feeds a copy to
the SSE observer. Non-SSE responses and disabled mode keep the original
`pipeline(src, res)` path unchanged.

### MODIFIED: The budget reservation becomes reconcilable

**Before:** `budget.reserve(cost)` charged the window and returned no handle;
the estimate was permanent.

**After:** `budget.reserve(cost)` returns a reservation handle. The handle
exposes `reconcile(actualTotalTokens)` (replace the estimate with a valid
actual total, or record one fallback when the value is unusable) and the budget
exposes `reconciledCount` and `fallbackCount` counters. A reservation may be
reconciled at most once.

## 3. Actors

* **Client application** — receives the SSE stream byte-identically.
* **Proxy** — forwards bytes, observes a copy, reconciles on completion.
* **Upstream (NVIDIA NIM)** — produces SSE events and usage.
* **Operator** — benefits from accurate token accounting.

## 4. Preconditions

* Rate limiting enabled (both `PROXY_RPM` and `PROXY_TPM` set). Without the
  global pair the gate is not entered and no reservation exists to reconcile.
* Response content type is `text/event-stream`.

## 5. Solution and main flow

1. `budget.reserve(cost)` returns `{ admitted, cost, reservation }` on success.
   The reservation holds the charge handles for the global window and, when
   applicable, the model window.
2. `server.js` stores the reservation alongside the request.
3. For an SSE response in rate-limit mode, the upstream body is piped through
   a pass-through transform that forwards each chunk and calls
   `observer.observe(chunk)`. `pipeline(transform, res)` owns the error path.
4. The observer parses complete events and captures the last usable
   `usage.total_tokens` (or `prompt_tokens + completion_tokens`).
5. On successful completion, `pipeline`'s callback calls `observer.end()` and
   then `reservation.reconcile(capturedTotal)` (or `reconcile(null)` when no
   usable usage was captured, which records one fallback).
6. On error or client disconnect, reconciliation is skipped and the estimate
   stands.

## 6. Constraints and alternative flows

* **No buffering of the response.** The transform pushes each chunk as it
  arrives; the observer never awaits the stream.
* **No transformation.** Bytes are forwarded verbatim; only a copy is decoded.
* **Bound.** An incomplete event exceeding 262,144 bytes detaches observation.
  Detach keeps any usage already captured and stops further parsing.
* **At most one reconciliation.** A second call is a no-op.
* **Non-SSE and disabled mode.** Unchanged from e04s05/e04s04.
* **Non-streaming JSON.** Out of scope (e04s07).

## 7. Domain glossary

* **SSE observer** — incremental parser of a copied response stream.
* **Reconcilable reservation** — a reservation whose token cost can be
  replaced once with actual usage.
* **Detach** — stop observing without affecting pass-through.

## 8. Interfaces and contracts

`budget.js` exports (changes in **bold**):

```
createBudget(rateLimit, limits, modelLimits) -> { enabled, effective, modelEffective, reserve, release, close, reconciledCount, fallbackCount }
estimateCost(json, buffer) -> { inputTokens, outputTokens, requestCharge, totalTokens, fallback, model }
```

* `reserve(cost)` → `{ admitted, cost, retryAfter }` when disabled or rejected;
  `{ admitted: true, cost, reservation }` when admitted.
* `reservation.reconcile(actualTotalTokens)` → `true` when reconciled, `false`
  when the value was unusable (fallback recorded).

`observer.js` exports:

```
createSseObserver(onUsage) -> { observe(chunk), end() }
SSE_OBSERVATION_BYTE_BOUND = 262144
```

* `observe(chunk)` — feed a Buffer chunk; never throws.
* `end()` — flush, parse any final incomplete event, invoke `onUsage(totalOrNull)`.

## 9. Configuration

No new variables.

## 10. Data and state

Observer state lives in `observer.js` only. Reconciliation state lives in the
reservation handle. Counters live in `budget.js`.

## 11. Invariants

1. Pass-through bytes are byte-identical to upstream bytes.
2. First chunk reaches the client before completion.
3. Observer never delays, reorders, compresses, or rewrites the stream.
4. Incomplete event state survives chunk boundaries.
5. Bound exceeded detaches observation without affecting pass-through.
6. Valid usage replaces the estimate in global and model windows.
7. Lower actual credits; higher actual raises; no revocation.
8. Missing/malformed/incomplete usage retains the estimate and records one
   fallback.
9. Abnormal termination retains the estimate.
10. A reservation is reconciled at most once.
11. Disabled mode and non-SSE responses are unchanged.

## 12. Failure modes

| Failure | Answer |
|---|---|
| Usage present and valid | reconcile to actual total |
| Usage missing | retain estimate, one fallback |
| Usage malformed | retain estimate, one fallback |
| Usage split so never complete | retain estimate, one fallback |
| Incomplete event over bound | detach, retain estimate |
| Client disconnect | skip reconciliation, retain estimate |
| Mid-stream upstream failure | skip reconciliation, retain estimate |
| Shutdown | skip reconciliation, retain estimate |
| Non-SSE response | no observer, retain estimate |

## 13. Security and privacy

* No new secret exposure. Usage totals are not logged (the log line's closed
  field set is unchanged).
* Model ID and rejection reasons stay inside the proxy.

## 14. Observability

No new log line. `reconciledCount` and `fallbackCount` are internal counters;
they are not exposed until e04s08.

## 15. Dependencies

None added. Node built-ins only (`node:stream`, `node:util`/TextDecoder).

## 16. Risks and assumptions

* **Chunk boundaries.** The observer decodes with a streaming TextDecoder so a
  multi-byte character split across chunks is not corrupted.
* **Multiple usage events.** The last usable one wins, matching OpenAI's
  final-usage event.
* **Reconciliation accuracy.** Token totals are replaced verbatim; no
  re-estimation.

## 17. Acceptance criteria (Gherkin)

```gherkin
Feature: SSE usage reconciliation

  Scenario: exact bytes and early delivery
    Given rate limiting is enabled
    And the upstream streams an SSE response
    When the proxy forwards it
    Then the client receives bytes byte-identical to the upstream
    And the first chunk arrives before the response finishes

  Scenario: usage split across chunks
    Given an SSE event whose delimiters and JSON are split across chunks
    When the observer runs
    Then usage is found and reconciled

  Scenario: bound exceeded detaches
    Given an incomplete SSE event larger than 262144 bytes
    When it is observed
    Then observation detaches
    And pass-through is unaffected

  Scenario: valid usage replaces the estimate
    Given a reservation estimated at 4096 tokens
    And the SSE response reports usage.total_tokens 10
    When the stream completes
    Then the reservation's token cost becomes 10

  Scenario: lower actual credits
    Given a first request estimated high but reporting low actual usage
    When a second request arrives inside the window
    Then it is admitted because capacity was credited

  Scenario: higher actual raises without revocation
    Given a reservation estimated low but reporting high actual usage
    When the stream completes
    Then current usage rises and the already-delivered stream is untouched

  Scenario: missing usage retains the estimate
    Given an SSE response with no usage
    When the stream completes
    Then the estimate stands and one fallback is recorded

  Scenario: malformed usage retains the estimate
    Given an SSE response with malformed usage
    When the stream completes
    Then the estimate stands and one fallback is recorded

  Scenario: client disconnect retains the estimate
    Given a client that disconnects mid-stream
    When the upstream aborts
    Then the estimate stands and no reconciliation to zero occurs

  Scenario: mid-stream failure retains the estimate
    Given an upstream that fails mid-stream
    When the response ends in error
    Then the estimate stands
```

## 18. Out of scope

Non-streaming JSON reconciliation and terminal fallbacks (#20, e04s07).
Aggregate stats and `/stats` (#21, e04s08). Integration, documentation, and
release pass (#22, e04s09). Budget waiting (deferred).

## 19. Zoom-out checks

### `observer.js` (new)

* **Purpose**: own SSE parsing and bounded observation.
* **Callers**: `server.js` only.
* **Contracts**: `createSseObserver(onUsage)`, `observe(chunk)`, `end()`,
  `SSE_OBSERVATION_BYTE_BOUND`.

### `budget.js` (modified)

* **Purpose**: own the numbers and reconciliation.
* **Callers**: `server.js` only.
* **Contracts**: `reserve` returns a reservation handle; counters exposed.

### `server.js` (modified)

* **Purpose**: HTTP entry; owns bytes.
* **Callers**: node.
* **Contracts**: SSE pass-through gains an observer transform in rate-limit
  mode only. Non-SSE and disabled paths unchanged.

### `config.js` (unchanged)

* **Purpose**: config parsing.
* **Change surface**: none.

### `admission.js` (unchanged)

* **Purpose**: concurrency.
* **Change surface**: none.

## 20. Slopcheck

* No external packages. Zero-dependency maintained.
* `TextDecoder` is a Node built-in.
* No new abstraction without a reason: the observer isolates parsing from the
  forwarding path, which is the requirement.

## 21. Risks

See §16.

## 22. Out-of-scope references

Issues #20–#22. ADR 0002 may need an amendment recording reconciliation.

## References

* Issue #19 — acceptance criteria.
* Issue #13 — parent epic, stories 76–99.
* `docs/adr/0002-config-operational-fail-fast.md`.
* Existing tests: `describe("e04s04 global RPM/TPM budgets")` and
  `describe("e04s05 per-model budgets")` in `server.test.js`.
