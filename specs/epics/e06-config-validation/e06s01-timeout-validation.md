# e06s01: Move upstream timeout env vars into parseConfig

* Story: e06s01
* Epic: e06 — Config validation
* Issue: [#33](https://github.com/ak-a-ra/nvidia-api-proxy/issues/33)
* Status: todo
* BCPs: 3
* Type: fix | Context: config / timeout

## 1. Business narrative

UPSTREAM_CONNECT_TIMEOUT_SECONDS and UPSTREAM_IDLE_TIMEOUT_SECONDS are read from process.env at module load, outside parseConfig(env). An invalid value (for example abc or -5) silently falls back to the default, unlike every other variable, which fails fast.

## 2. Problem statement

Invalid timeout values are silently accepted instead of failing fast at startup.

## 3. Actors

- Operator — sets timeout env vars; expects invalid values to fail fast.

## 4. Preconditions

- npm test passes (243 tests).
- config.js parseConfig implemented (e04s01).

## 5. Solution and main flow

- Move the two timeout env var reads into parseConfig.
- Apply digits-only validation (allowing 0 to disable).
- Fail fast on invalid input.
- Add tests.

## 6. Constraints and alternative flows

- Keep default values: connect 30, idle 120.
- 0 disables timeout.
- Only the two timeout variables use this leniency per existing convention.

## 7. Domain glossary

None new.

## 8. Interfaces and contracts

parseConfig gains validation for UPSTREAM_CONNECT_TIMEOUT_SECONDS and UPSTREAM_IDLE_TIMEOUT_SECONDS.

## 9. Configuration

UPSTREAM_CONNECT_TIMEOUT_SECONDS, UPSTREAM_IDLE_TIMEOUT_SECONDS now validated in parseConfig.

## 10. Data and state

None.

## 11. Invariants

- Invalid timeout value fails fast at startup (exit 1).
- Valid digits pass through.
- 0 disables timeout.

## 12. Failure modes

- abc or -5 → exit 1 with stderr naming the variable.

## 13. Security and privacy

None.

## 14. Observability

Tests cover valid, invalid, zero, and missing values.

## 15. Dependencies

Depends on config.js. Blocks nothing.

## 16. Risks and assumptions

- Changing parseConfig must not break existing timeout behavior for valid values.

## 17. Acceptance criteria (Gherkin)

```gherkin
Scenario: Invalid connect timeout fails fast
  Given UPSTREAM_CONNECT_TIMEOUT_SECONDS=abc
  When the proxy starts
  Then it exits 1 with stderr naming the variable

Scenario: Invalid idle timeout fails fast
  Given UPSTREAM_IDLE_TIMEOUT_SECONDS=-5
  When the proxy starts
  Then it exits 1

Scenario: Zero disables timeout
  Given UPSTREAM_CONNECT_TIMEOUT_SECONDS=0
  When the proxy starts
  Then connect timeout is disabled

Scenario: Valid value passes through
  Given UPSTREAM_IDLE_TIMEOUT_SECONDS=60
  When the proxy starts
  Then idle timeout is 60 seconds
```

## 18. Out of scope

- Changing default timeout values.

## 19. Verification

npm test full suite green. New tests in server.test.js for timeout validation.

## 20. References and traceability

- Issue [#33](https://github.com/ak-a-ra/nvidia-api-proxy/issues/33)
- config.js readSeconds, parseConfig
