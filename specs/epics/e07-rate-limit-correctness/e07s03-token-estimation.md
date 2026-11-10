# e07s03: Conservative token estimation for large outputs and nested inputs

* Story: e07s03
* Epic: e07 — Rate-limit correctness
* Issue: [#27](https://github.com/ak-a-ra/nvidia-api-proxy/issues/27)
* Status: todo
* BCPs: 3
* Type: feat | Context: budget / token-estimation

## 1. Business narrative

The request-time TPM reservation can substantially undercount usage for valid OpenAI-compatible request bodies. In budget.js: MAX_REQUESTED_OUTPUT_TOKENS caps the estimated output reservation at 4096 even when the request asks for larger max_tokens / max_completion_tokens. countTextChars() only inspects shallow text / content properties. For generic objects it counts property names, not nested values. Tool definitions and JSON schemas contribute little or nothing. Multimodal payloads are not estimated using modality-aware accounting. Usage reconciliation happens after response completes, so it cannot prevent an initially under-reserved request from exceeding TPM.

## 2. Problem statement

TPM preflight estimate systematically undercounts large outputs, nested tool schemas, and unsupported modalities.

## 3. Actors

- Client — sends requests with large max_tokens or nested tools; expects honest reservation.
- Operator — expects TPM budget not silently exceeded.

## 4. Preconditions

- npm test passes (243 tests).
- budget.js estimateCost implemented (e04s04/e04s05).

## 5. Solution and main flow

- Do not silently cap requested output at 4096 for budget admission. Reserve the requested amount, or reject/require explicit configured policy when it exceeds a supported ceiling.
- Walk supported nested text/tool structures recursively.
- Add conservative accounting or explicit safe fallback for multimodal/unsupported payloads.
- Keep reconciliation as a correction, not the only protection.
- Add tests.

## 6. Constraints and alternative flows

- Zero runtime dependencies.
- Keep reconciliation.

## 7. Domain glossary

None new.

## 8. Interfaces and contracts

budget.js estimateCost signature/behavior changes for output cap and nesting.

## 9. Configuration

None.

## 10. Data and state

None.

## 11. Invariants

- Requests with max_tokens above 4096 cannot be admitted using a 4096-token output reservation.
- Nested tool descriptions and parameter schemas affect the estimate.
- Unsupported input cannot silently receive a near-zero input estimate.

## 12. Failure modes

None new.

## 13. Security and privacy

None.

## 14. Observability

Tests cover nested content, image/audio payloads, unknown content shapes.

## 15. Dependencies

Depends on budget.js. Blocks nothing.

## 16. Risks and assumptions

- Reserving full requested output may reject more requests; that is the intended conservative behavior.

## 17. Acceptance criteria (Gherkin)

```gherkin
Scenario: Large max_tokens not silently capped at 4096
  Given max_tokens above 4096
  When the estimate is computed
  Then output reservation is not capped at 4096

Scenario: Nested tool descriptions affect estimate
  Given nested tool definitions
  When the estimate is computed
  Then they contribute to input tokens

Scenario: Unsupported input not near-zero estimate
  Given image/audio payload
  When the estimate is computed
  Then input estimate is not near zero
```

## 18. Out of scope

- Removing reconciliation.
- Exact tokenization matching NVIDIA's counter.

## 19. Verification

npm test full suite green. New tests for nested content, image/audio, unknown shapes.

## 20. References and traceability

- Issue [#27](https://github.com/ak-a-ra/nvidia-api-proxy/issues/27)
- budget.js estimateCost, MAX_REQUESTED_OUTPUT_TOKENS, countTextChars
