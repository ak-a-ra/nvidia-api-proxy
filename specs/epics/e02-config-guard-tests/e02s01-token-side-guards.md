# e02s01: Pin the token-side config invariants ADR 0001 leaves uncovered

* Story: `e02s01`
* Epic: `e02` — Config guard tests, token side
* Issue: [#10](https://github.com/ak-a-ra/nvidia-api-proxy/issues/10)
* Status: todo
* BCPs: 2
* Type: test | Context: domain

## 1. Business narrative

ADR 0001 splits configuration into two regimes: a bad `NVIDIA_BASE_URL` is fatal at startup,
while missing credentials degrade to a 503 that self-describes. The ADR's own Compliance
section admits the guard coverage is asymmetric: "Whitespace-only credentials counting as
missing is pinned on the API-key side by the two tests above... The token side of `.trim()` is
not covered by a dedicated test." The `unconfigured` flag uses `!env.NVIDIA_API_KEY?.trim() ||
!env.PROXY_AUTH_TOKEN?.trim()` — one line, two operands, only one pinned.

## 2. Problem statement

A change that made the token check case of `NVIDIA_API_KEY`'s would pass the suite. The
whitespace-token path is unguarded, so the asymmetry is silent.

## 3. Actors

- **Maintainer** — needs the config regime to be protected by tests before the rate-limiting
  epic adds new fatal rules to the same function.
- **Security reviewer** — needs the auth-before-unconfigured ordering pinned on both sides.

## 4. Preconditions

- Suite green at 34/34.
- The existing `runProxyOnce` helper spawns `server.js` bare and captures exit code and
  stderr — the right seam for startup-fatal assertions.

## 5. Solution and main flow

Add black-box tests for the token side of the config regime, mirroring the existing key-side
tests. No production code changes: this story only closes coverage gaps that already exist.

## 6. Constraints and alternative flows

- **No new test seam.** Tests go through the existing `runProxyOnce` / `withProxy` child-process
  harness, per `CONVENTIONS.md` and the #13 constraint that no limiter test export exists.
- **Black-box only.** Assertions target external HTTP behavior and process exit codes, so
  internal refactors do not force test rewrites.
- `null` is the "leave unset" sentinel in `startProxyServer`; `undefined` collides with
  destructuring defaults. Do not pass `undefined`.
- Alternative considered: refactor `validateConfig` to make the credential check table-driven.
  Rejected — that is production change under a test-only story, and #14 will restructure this
  area anyway.

## 7. Domain glossary

Existing terms: **Unconfigured**, **Misconfigured**, **Health**, **Proxy token**, **API key**,
**Local response**, **Credential swap**. No new domain terms.

## 8. Interfaces and contracts

No interface changes. Tests assert the existing contracts:

- token missing or whitespace-only → `/health` 503 `{ status: "unconfigured" }`
- token missing → authenticated proxied request gets generic 503, never contacts upstream
- 401 precedes 503 when unauthenticated and unconfigured (the non-leak invariant)

## 9. Configuration

No new env vars. Tests exercise `NVIDIA_API_KEY` and `PROXY_AUTH_TOKEN` values including `" "`.

## 10. Data and state

None.

## 11. Invariants

- Error responses never leak internals: both 503 bodies stay generic.
- Unauthenticated `/v1/*` gets 401, not 503, when credentials are missing — pinning
  auth-before-unconfigured ordering.
- Upstream is never contacted for any local response.

## 12. Failure modes

- A 401/503 ordering regression would leak whether a credential is configured to an anonymous
  caller. That is the specific defect this story prevents.
- Tests spawn child processes; if a test leaves one running it can hang the suite. Register
  cleanup with `t.after` as the existing tests do.

## 13. Security and privacy

Directly security-relevant. The tests exist to keep the proxy from revealing credential
configuration to unauthenticated callers, and to keep both credentials on the degrade side of
the ADR 0001 split.

## 14. Observability

None added. This story changes only tests and documentation.

## 15. Dependencies

None. Should land before e04, whose first slice adds new fatal configuration rules to the same
code path (#13 user story 150: "I want issue #10 to land first if scheduling permits").

## 16. Risks and assumptions

- Risk: test names must not duplicate existing ones. Check the current suite first; the
  key-side tests already exist, the token-side equivalents do not.
- This story adds tests, so the count changes. Sync every living doc that states the count
  using `scripts/check-test-count.mjs` from e01, or the `AGENTS.md` grep until e01 lands.

## 17. Acceptance criteria (Gherkin)

```gherkin
Scenario: Whitespace-only proxy token counts as missing
  Given PROXY_AUTH_TOKEN is " " and NVIDIA_API_KEY is set
  When the client requests /health
  Then the response is 503 with status "unconfigured"
  And no upstream is contacted

Scenario: Whitespace-only proxy token yields the generic 503 on a proxied path
  Given PROXY_AUTH_TOKEN is " " and NVIDIA_API_KEY is set
  When an authenticated client requests /v1/models
  Then the response is 503 with the generic unconfigured body
  And the body does not name which credential is missing
  And the upstream received no request

Scenario: Unauthenticated callers see 401 before the unconfigured 503
  Given both credentials are missing
  When an unauthenticated client requests /v1/models
  Then the response is 401
  And the response does not reveal the credential configuration

Scenario: The existing suite still passes
  Given the new token-side tests are added
  When the full suite runs
  Then every test passes
  And every living doc states the new total
```

## 18. Out of scope

- Changing `validateConfig` or any production behavior.
- Refactoring the credential check to be table-driven.
- The rate-limiting epic's new fatal configuration rules.
- Adding a test seam or exporting internals.

## 19. Verification

`npm test`, then `node scripts/check-test-count.mjs` (or the `AGENTS.md` grep) once the count
moves. See `e02s01-tasks.yaml`.

## 20. References and traceability

- Issue [#10](https://github.com/ak-a-ra/nvidia-api-proxy/issues/10)
- `docs/adr/0001-config-validation-fail-fast-vs-degrade.md` §Compliance — states the gap
  this story closes
- `plans/03-config-guard-tests-round-2.md` — the agent-executable plan
- `server.test.js` — `runProxyOnce`, `withProxy`, and the existing key-side tests
