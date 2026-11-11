# e07s02: Rename/split costOverLimitRejectionsCount by reason

* Story: e07s02
* Epic: e07 — Rate-limit correctness
* Issue: [#32](https://github.com/ak-a-ra/nvidia-api-proxy/issues/32)
* Status: todo
* BCPs: 2
* Type: fix | Context: budget / /stats

## 1. Business narrative

In budget.js, reserve(), costOverLimitRejectionsCount is incremented for every rejection from the global or model window, including rpm and model_rpm. The name suggests only cost (token) rejections are counted, so /stats misleads operators.

## 2. Problem statement

/costOverLimitRejections name misleads; RPM rejections counted as cost over-limit.

## 3. Actors

- Operator — reads /stats; expects accurate counter semantics.

## 4. Preconditions

- npm test passes (248 tests).
- budget.js reserve and /stats implemented (e04s04, e04s06).

## 5. Solution and main flow

- Rename costOverLimitRejectionsCount (e.g. budgetRejectionsCount) or split into per-reason counters (rpm, tpm, model_rpm, model_tpm).
- Update README /stats contract.
- Update tests.

## 6. Constraints and alternative flows

- Do not expose internal rejection reasons to clients.

## 7. Domain glossary

None new.

## 8. Interfaces and contracts

budget.js counter field name changes; /stats contract updated.

## 9. Configuration

None.

## 10. Data and state

Counter state in budget.js.

## 11. Invariants

- Counter name matches what it counts.
- /stats contract accurate.

## 12. Failure modes

None.

## 13. Security and privacy

None.

## 14. Observability

Tests assert counter semantics per rejection reason.

## 15. Dependencies

Depends on budget.js. Blocks nothing.

## 16. Risks and assumptions

- Renaming may break /stats consumers; README updated to match.

## 17. Acceptance criteria (Gherkin)

```gherkin
Scenario: Counter reflects rejection reason
  Given an rpm rejection
  When /stats is read
  Then the counter is not labeled as cost-only
```

## 18. Out of scope

- Exposing internal rejection reasons to clients.

## 19. Verification

npm test full suite green. README /stats contract updated.

## 20. References and traceability

- Issue [#32](https://github.com/ak-a-ra/nvidia-api-proxy/issues/32)
- budget.js reserve
