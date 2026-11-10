# e07s01: Non-retryable 413/400 for request cost exceeding whole TPM

* Story: e07s01
* Epic: e07 — Rate-limit correctness
* Issue: [#29](https://github.com/ak-a-ra/nvidia-api-proxy/issues/29)
* Status: todo
* BCPs: 3
* Type: fix | Context: budget / TPM

## 1. Business narrative

In budget.js, createWindow().check rejects when used.tokens + cost.totalTokens > tpmLimit. If one request's estimated cost exceeds the effective TPM by itself, it is rejected even with an empty window. With no events, oldestTokenEvent is null and retryAfterSeconds(null) returns 1, so the client is told to retry in 1 second and keeps getting 429 forever.

## 2. Problem statement

A request whose cost exceeds the whole TPM gets 429 forever with Retry-After: 1 — non-retryable condition misreported as retryable.

## 3. Actors

- Client — sends an over-budget request; expects a clear non-retryable rejection.
- Operator — expects /stats to reflect the rejection reason correctly.

## 4. Preconditions

- npm test passes (243 tests).
- budget.js createWindow and retryAfterSeconds implemented (e04s04).

## 5. Solution and main flow

- When cost.totalTokens > tpmLimit on its own, return a non-retryable 413 or 400 instead of 429.
- Add a test.

## 6. Constraints and alternative flows

- Keep generic 429 body for retryable cases unchanged.

## 7. Domain glossary

None new.

## 8. Interfaces and contracts

budget.js check returns a non-retryable rejection for self-exceeding cost.

## 9. Configuration

None.

## 10. Data and state

None.

## 11. Invariants

- A self-exceeding request is not told to retry in 1 second.
- Retryable 429 behavior unchanged.

## 12. Failure modes

- None new.

## 13. Security and privacy

None.

## 14. Observability

Test that over-TPM request returns 413/400, not 429 with Retry-After: 1.

## 15. Dependencies

Depends on budget.js (e04s04). Blocks nothing.

## 16. Risks and assumptions

- Choosing 413 vs 400 must be documented.

## 17. Acceptance criteria (Gherkin)

```gherkin
Scenario: Over-TPM request returns non-retryable status
  Given cost.totalTokens > tpmLimit
  When the request is checked
  Then it returns 413 or 400, not 429

Scenario: Retryable 429 unchanged
  Given cost within TPM but window full
  When the request is checked
  Then it returns 429 with a positive Retry-After
```

## 18. Out of scope

- Changing the generic 429 body for retryable cases.

## 19. Verification

npm test full suite green. New test for over-TPM rejection.

## 20. References and traceability

- Issue [#29](https://github.com/ak-a-ra/nvidia-api-proxy/issues/29)
- budget.js createWindow, check, retryAfterSeconds
