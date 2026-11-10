# e08s03: lint and format include admission.js and observer.js

* Story: e08s03
* Epic: e08 — Project configuration
* Issue: [#31](https://github.com/ak-a-ra/nvidia-api-proxy/issues/31)
* Status: todo
* BCPs: 2
* Type: chore | Context: lint / format / package.json

## 1. Business narrative

The lint, lint:fix, format and format:check scripts list explicit files: server.js, config.js, budget.js and server.test.js. admission.js and observer.js are never linted or format-checked.

## 2. Problem statement

admission.js and observer.js skipped by lint/format scripts.

## 3. Actors

- Developer — runs lint/format; expects all source checked.

## 4. Preconditions

- npm test passes (243 tests).
- package.json scripts exist.

## 5. Solution and main flow

- Include admission.js and observer.js in lint, lint:fix, format, format:check scripts (whole-project or explicit file list).
- Then fix any findings that appear.

## 6. Constraints and alternative flows

- Zero runtime dependencies (lint/format are dev-only).

## 7. Domain glossary

None new.

## 8. Interfaces and contracts

package.json scripts updated.

## 9. Configuration

None.

## 10. Data and state

None.

## 11. Invariants

- admission.js and observer.js linted and format-checked.
- Any findings fixed.

## 12. Failure modes

None.

## 13. Security and privacy

None.

## 14. Observability

npm run check passes including admission.js and observer.js.

## 15. Dependencies

Depends on admission.js and observer.js existing (e04s02, observer.js). Blocks nothing.

## 16. Risks and assumptions

- Pre-existing lint/format findings in those files must be fixed, not silenced.

## 17. Acceptance criteria (Gherkin)

```gherkin
Scenario: admission.js linted
  Given npm run lint
  Then admission.js is checked

Scenario: observer.js format-checked
  Given npm run format:check
  Then observer.js is checked

Scenario: All findings fixed
  Given npm run check runs
  Then no lint or format findings remain
```

## 18. Out of scope

- Adding new runtime dependencies.

## 19. Verification

npm run check passes; admission.js and observer.js included.

## 20. References and traceability

- Issue [#31](https://github.com/ak-a-ra/nvidia-api-proxy/issues/31)
- package.json scripts lint, lint:fix, format, format:check
