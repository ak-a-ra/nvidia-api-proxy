# e08s02: Align Node.js engine requirement with supported runtime

* Story: e08s02
* Epic: e08 — Project configuration
* Issue: [#26](https://github.com/ak-a-ra/nvidia-api-proxy/issues/26)
* Status: todo
* BCPs: 2
* Type: fix | Context: package.json / Node engine

## 1. Business narrative

package.json declares node >=18.14, but the response path calls upstream.headers.getSetCookie() directly in server.js. CI tests Node 20, 22, 24, not 18.14. The repo's own CI planning notes identify missing/incomplete getSetCookie() support in older Node 18 as the reason not to test Node 18. The package advertises a runtime range wider than the project verifies and than this response-header path supports.

## 2. Problem statement

engines.node range wider than actual supported/tested runtime.

## 3. Actors

- Operator — deploys on Node 18; expects the proxy to work or to be told it won't.

## 4. Preconditions

- npm test passes (248 tests).
- package.json engines.node exists.

## 5. Solution and main flow

- Either raise the declared minimum to the lowest tested/supported version, or add a compatibility implementation for multiple Set-Cookie headers and test the declared minimum runtime.
- Do not claim Node 18.14 support unless the full suite and multi-cookie response path pass there.

## 6. Constraints and alternative flows

- Zero runtime dependencies.
- CI matrix tests Node 20, 22, 24.

## 7. Domain glossary

None new.

## 8. Interfaces and contracts

package.json engines.node range.

## 9. Configuration

None.

## 10. Data and state

None.

## 11. Invariants

- package.json engine range matches actual supported/tested runtime range.
- CI tests the declared minimum, or the minimum is explicitly documented as unsupported.
- Multiple Set-Cookie headers preserved on every supported Node version.

## 12. Failure modes

None.

## 13. Security and privacy

None.

## 14. Observability

CI tests declared minimum.

## 15. Dependencies

Depends on server.js getSetCookie usage. Blocks nothing.

## 16. Risks and assumptions

- Raising the floor may exclude Node 18 users; document the decision.

## 17. Acceptance criteria (Gherkin)

```gherkin
Scenario: Engine range matches tested runtime
  Given package.json engines.node
  When compared to CI matrix
  Then they align

Scenario: Multiple Set-Cookie preserved
  Given a response with multiple Set-Cookie headers
  When forwarded through the proxy
  Then all are preserved
```

## 18. Out of scope

- Dropping Node 18 support without a fix.

## 19. Verification

package.json updated; npm test green.

## 20. References and traceability

- Issue [#26](https://github.com/ak-a-ra/nvidia-api-proxy/issues/26)
- package.json engines.node
- server.js getSetCookie usage
