# e06s02: PORT validation min 1 to match comment

* Story: e06s02
* Epic: e06 — Config validation
* Issue: [#35](https://github.com/ak-a-ra/nvidia-api-proxy/issues/35)
* Status: todo
* BCPs: 2
* Type: fix | Context: config / PORT

## 1. Business narrative

The comment says PORT must be a valid TCP port, 1-65535, but the code uses min 0, so PORT=0 is accepted and binds a random ephemeral port. A deploy could silently run on an unexpected port.

## 2. Problem statement

PORT=0 accepted though comment says 1-65535; deploy could bind unexpected port.

## 3. Actors

- Operator — sets PORT; expects validation to match documented range.

## 4. Preconditions

- npm test passes (243 tests).
- config.js parseConfig PORT validation exists.

## 5. Solution and main flow

- Decide intent: min 1 to match the comment, or keep 0 and update comment and README.
- Apply the decision in parseConfig.
- Add tests for both paths.

## 6. Constraints and alternative flows

- Whichever choice, comment and code must agree.

## 7. Domain glossary

None new.

## 8. Interfaces and contracts

PORT validation boundary in parseConfig.

## 9. Configuration

PORT env var.

## 10. Data and state

None.

## 11. Invariants

- Comment and code agree on PORT range.

## 12. Failure modes

- Out-of-range PORT fails fast.

## 13. Security and privacy

None.

## 14. Observability

Tests for PORT=0, PORT=1, PORT=65535, PORT=65536, invalid PORT.

## 15. Dependencies

Depends on config.js. Blocks nothing.

## 16. Risks and assumptions

- The decision (min 1 vs keep 0) affects deploy behavior; document either way.

## 17. Acceptance criteria (Gherkin)

```gherkin
Scenario: PORT comment and code agree
  Given the comment states 1-65535
  When PORT is validated
  Then accepted range matches the comment
```

## 18. Out of scope

- Changing server listen behavior beyond PORT validation.

## 19. Verification

npm test full suite green.

## 20. References and traceability

- Issue [#35](https://github.com/ak-a-ra/nvidia-api-proxy/issues/35)
- config.js parseConfig PORT
