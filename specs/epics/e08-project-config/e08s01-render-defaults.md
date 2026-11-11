# e08s01: Safe traffic-protection defaults in Render blueprint

* Story: e08s01
* Epic: e08 — Project configuration
* Issue: [#25](https://github.com/ak-a-ra/nvidia-api-proxy/issues/25)
* Status: todo
* BCPs: 2
* Type: docs | Context: render.yaml / README

## 1. Business narrative

The checked-in render.yaml configures the NVIDIA endpoint and timeouts, but does not configure the proxy's traffic guards. PROXY_MAX_CONCURRENT_REQUESTS absent disables concurrency ceiling; PROXY_RPM and PROXY_TPM absent disable the global rolling budget. README describes these protections as available features while a fresh Render blueprint does not enable them.

## 2. Problem statement

Fresh Render deployment does not imply rate limiting is active; operators may assume protection that is not enabled.

## 3. Actors

- Operator — deploys via Render; expects documented effective protections.

## 4. Preconditions

- npm test passes (248 tests).
- render.yaml and README exist.

## 5. Solution and main flow

- Choose and document a conservative default concurrency ceiling, queue size, and queue timeout for the Render blueprint, or expose an explicit setup profile that enables them.
- Document that RPM/TPM remain operator-supplied because they depend on NVIDIA account quota.
- Make README Render deployment instructions show how to configure the complete guard set.

## 6. Constraints and alternative flows

- RPM/TPM values must remain aligned with operator's actual NVIDIA quota (operator-supplied).

## 7. Domain glossary

None new.

## 8. Interfaces and contracts

render.yaml and README updated.

## 9. Configuration

render.yaml env vars documented.

## 10. Data and state

None.

## 11. Invariants

- A fresh deployment's effective protections are clearly documented.
- Render setup does not imply rate limiting is active when PROXY_RPM/PROXY_TPM unset.
- Chosen default values justified and configurable.

## 12. Failure modes

None.

## 13. Security and privacy

None.

## 14. Observability

README documents the guard set.

## 15. Dependencies

Depends on e04 (traffic guards exist). Blocks nothing.

## 16. Risks and assumptions

- Default values are guidance, not code enforcement.

## 17. Acceptance criteria (Gherkin)

```gherkin
Scenario: Fresh deployment protections documented
  Given a fresh Render blueprint
  When the operator reads README
  Then effective protections are clearly documented

Scenario: Rate limiting not implied when RPM/TPM unset
  Given PROXY_RPM and PROXY_TPM unset
  When the blueprint is deployed
  Then setup does not imply rate limiting is active
```

## 18. Out of scope

- Hardcoding RPM/TPM values.

## 19. Verification

README renders; render.yaml valid YAML. Docs-only change; npm test still green.

## 20. References and traceability

- Issue [#25](https://github.com/ak-a-ra/nvidia-api-proxy/issues/25)
- render.yaml
- README.md Render deployment section
