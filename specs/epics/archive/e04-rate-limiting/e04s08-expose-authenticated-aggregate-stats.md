# e04s08: Expose authenticated aggregate stats

* Story: `e04s08`
* Epic: `e04` — Rate limiting and admission control
* Issue: [#21](https://github.com/ak-a-ra/nvidia-api-proxy/issues/21) (slice 8 of 9)
* Parent issue: [#13](https://github.com/ak-a-ra/nvidia-api-proxy/issues/13)
* Status: failing
* BCPs: 7
* Type: feat | Risk: P0 | Context: infra
* Maturity: 3 (Countable)

## 1. Business narrative

An operator running rate limiting in production can see nothing. The proxy enforces concurrency ceilings, RPM/TPM budgets, per-model budgets, and usage reconciliation, but exposes zero operational totals. An operator who wants to know whether the queue is filling, whether the token budget is near its ceiling, or whether overload rejections are climbing must grep logs or probe upstream quota blindly.

`GET /stats` closes that gap: an authenticated, fixed-size aggregate view of admission and rate-budget behavior. It is not a dashboard, not a metrics endpoint, not Prometheus, and not per-client. It returns one fixed object, never contacts the upstream, bypasses admission and budgets even under saturation, and exposes no paths, bodies, model IDs, or credentials. The endpoint reuses the existing SHA-256 digest plus `timingSafeEqual` authentication and keeps the auth-before-unconfigured ordering: a missing or invalid proxy token answers 401, and only an authenticated but unconfigured proxy answers 503.

## 2. Problem statement

The request path already produces the raw material: `admission.js` holds active/admitted/waits/queueFullRejections/queueTimeoutRejections/queuedClientDisconnects; `budget.js` holds reconciledCount/fallbackCount plus costOverLimitRejections and trackedModels; `server.js` holds completed/oversizedBodyRejections/activeClientDisconnects. None of these counters is exposed. Issue #21's acceptance criteria demand a single authenticated endpoint that reports them as a fixed-size allowlist, with lifetime (never reset) counters, privacy exclusions, and self-exclusion (calling /stats changes nothing).

## 3. Requirements (delta tags)

Net-new story; `ADDED` tags only.

#### ADDED: `GET /stats` requires the existing Proxy token

The endpoint reuses `authorized()` (SHA-256 digest + `timingSafeEqual`, never raw-byte comparison). Missing or invalid bearer credentials answer `401 { "error": "Unauthorized" }` with no upstream contact. Other HTTP methods on `/stats` remain generic unknown routes and answer `404 { "error": "Not found" }`.

#### ADDED: Authentication precedes the unconfigured check

Missing or invalid Proxy token receives `401` before any unconfigured response; a valid token while `NVIDIA_API_KEY` or `PROXY_AUTH_TOKEN` is missing receives the existing generic `503 { "error": "Proxy is not configured" }`. The upstream is never contacted for either outcome.

#### ADDED: /stats bypasses admission, Queue, and rate budgets

The branch is placed before `admission.acquire` and before `budget.reserve`, so it remains available while the proxy is saturated and never queues or rejects a stats request. It never contacts the upstream.

#### ADDED: Exact top-level allowlist field set

The 200 body is a single JSON object with exactly these top-level keys, in this set (order unspecified):

`rateLimitEnabled`, `effectiveGlobalRpm`, `effectiveGlobalTpm`, `safetyMarginPct`, `maxConcurrentRequests`, `maxQueueSize`, `queueTimeoutSeconds`, `active`, `queued`, `admitted`, `waits`, `queueFullRejections`, `queueTimeoutRejections`, `oversizedBodyRejections`, `costOverLimitRejections`, `queuedClientDisconnects`, `activeClientDisconnects`, `completed`, `usageReconciled`, `usageEstimateFallbacks`, `trackedModels`

#### ADDED: Disabled-rate-limit shape

When rate limiting is disabled (`PROXY_RPM`/`PROXY_TPM` absent or blank), `rateLimitEnabled` is `false`, `effectiveGlobalRpm` and `effectiveGlobalTpm` are `null`, `safetyMarginPct` is `5`, `maxConcurrentRequests` is `null`, `maxQueueSize` is `32`, `queueTimeoutSeconds` is `30`, and all counters are `0`. The response shape never changes.

#### ADDED: Fixed-size process-lifetime counters; no reset

Every counter is process-lifetime and monotonic. No public reset exists. No per-model limits, per-model counters, or model IDs appear. `trackedModels` is a single integer count of distinct model IDs the estimator has observed, not per-model data.

#### ADDED: Privacy exclusions

The response excludes paths, queries, bodies, prompts, completions, the API key, the Proxy token, upstream identity, and which credential is missing.

#### ADDED: Self-exclusion

`GET /stats` increments no counter, including `completed`, so repeated stats calls move nothing.

#### ADDED: Black-box tests cover every acceptance-criteria class

Authentication ordering, saturation bypass, exact field set, privacy, self-exclusion, and exact counter deltas per event class.

#### MODIFIED: server.js gains a /stats branch

**Before:** `/health` then `/v1` then `/v1/*` then auth then unconfigured then fetch.

**After:** `/health`, then `/stats` (auth-before-unconfigured, no admission, no upstream), then the unchanged `/v1/*` chain. No existing route changes behavior.

#### MODIFIED: admission.js exposes counters

**Before:** active count and queue state are private; no counter getters exist.

**After:** `active`, `admitted`, `waits`, `queueFullRejections`, `queueTimeoutRejections`, `queuedClientDisconnects` are readable getters; `settleTicket` increments `admitted`/`waits`/`queueFullRejections`/`queueTimeoutRejections`/`queuedClientDisconnects` exactly as each terminal ticket outcome lands.

#### MODIFIED: budget.js exposes counters

**Before:** `reconciledCount` and `fallbackCount` exist as private-with-getter; no `costOverLimitRejections` or `trackedModels`.

**After:** `usageReconciled` and `usageEstimateFallbacks` alias the existing counters; `costOverLimitRejections` and `trackedModels` are added getters. `reserve()` increments `costOverLimitRejections` on every rejection and records `cost.model` in `trackedModels`; `estimateCost()` stays pure.

#### MODIFIED: server.js exposes counters

**Before:** `completed`, `oversizedBodyRejections`, `activeClientDisconnects` do not exist.

**After:** `completed` increments once per terminal proxied outcome; `oversizedBodyRejections` increments once per 413 arm in `readBodyWithCap`; `activeClientDisconnects` increments once per swallowed `AbortError "client disconnected"` on an admitted request.

## 4. Actors

* **Operator** — calls `GET /stats` with the Proxy token to observe admission and rate-budget behavior.
* **Proxy** — answers `/stats` from in-process counters, never contacts the upstream, bypasses admission and budgets.
* **Client application** — unaffected; proxied traffic counters still move exactly as before.

## 5. Preconditions

* Rate limiting may be enabled or disabled; both shapes must be served.
* `NVIDIA_BASE_URL` valid; `NVIDIA_API_KEY` and `PROXY_AUTH_TOKEN` set for an authenticated stats call.
* No new environment variable; no entry added to `CONFIG_ENV_VARS` in `server.test.js`.
* `/stats` is not under `/v1`, so `authorized()` (scoped to `/v1/*`) must be called explicitly in the `/stats` branch.

## 6. Solution and main flow

1. `admission.js`: add `active`, `admitted`, `waits`, `queueFullRejections`, `queueTimeoutRejections`, `queuedClientDisconnects` getters; increment each once per the matching terminal ticket outcome inside `settleTicket`/`acquire`.
2. `budget.js`: add `costOverLimitRejections` getter (incremented in `reserve()` on rejection) and `trackedModels` getter (distinct model IDs seen in `cost.model`, recorded by `reserve()` and stored null-prototype so `"__proto__"` is an ordinary key); expose `usageReconciled`/`usageEstimateFallbacks` as aliases of the existing getters.
3. `server.js`: add `completed`, `oversizedBodyRejections`, `activeClientDisconnects` counters, incremented at their existing terminal sendJson/return/catch sites. Add a `/stats` branch after `/health` and before the `/v1/*` path check: `authorized() ? 401 : unconfigured ? 503 : method !== GET ? 404 : 200` with the exact 21-key allowlist object built from `config.rateLimit`, `config.limits`, and the counters. `/stats` increments no counter and calls neither `admission.acquire` nor `budget.reserve` nor `fetch`.
4. Tests: black-box integration tests through the existing child-process harness plus direct-import shape checks for `admission.js` and `budget.js`.

## 7. Domain glossary

Reused unchanged: **Client**, **Upstream**, **Proxy Token**, **API Key**, **Credential Swap**, **Local Response**, **Pass-through**, **Path mapping**, **Header fidelity**, **Response Stream**, **Client Disconnect**, **Health**, **Unconfigured**, **Rate budget**, **Admission control**, **Queue**.

* **Aggregate stats** — one fixed-size JSON object of process-lifetime counters, served on `GET /stats` after authentication, bypassing admission and budgets.
* **Self-exclusion** — a `/stats` call itself increments no counter, so repeated probes do not distort the very totals they observe.
* **trackedModels** — a single integer count of distinct model IDs the estimator has observed; not per-model data and never a list of IDs.

## 8. Interfaces and contracts

`admission.js` (changes):

```
createAdmission(limits) -> { acquire, close, active, admitted, waits,
  queueFullRejections, queueTimeoutRejections, queuedClientDisconnects }
```

`budget.js` (changes):

```
createBudget(rateLimit, limits, modelLimits) -> { enabled, effective,
  modelEffective, reserve, release, close,
  usageReconciled, usageEstimateFallbacks, costOverLimitRejections,
  trackedModels }
estimateCost(json, buffer) -> { inputTokens, outputTokens, requestCharge,
  totalTokens, fallback, model }
```

`server.js` (changes):

```
GET /stats -> 401 / 503 / 404 / 200 { <21-key allowlist object> }
counters: completed, oversizedBodyRejections, activeClientDisconnects
```

No new test seam: `admission.js` and `budget.js` keep being tested through the existing black-box child-process harness, plus direct unit imports for counter shapes (one seam already exists for `budget.js`/`observer.js` imports in `server.test.js`).

## 9. Configuration

No new variables. `CONFIG_ENV_VARS` in `server.test.js` needs no entry: `/stats` reads only existing config fields and counters.

| Variable | Role in this story |
|---|---|
| `PROXY_RPM` / `PROXY_TPM` | determine `rateLimitEnabled` and the effective global RPM/TPM values |
| `PROXY_SAFETY_MARGIN_PCT` | reported as `safetyMarginPct` |
| `PROXY_MAX_CONCURRENT_REQUESTS` | reported as `maxConcurrentRequests` (`null` when disabled) |
| `PROXY_MAX_QUEUE_SIZE` | reported as `maxQueueSize` (default `32`) |
| `PROXY_QUEUE_TIMEOUT_SECONDS` | reported as `queueTimeoutSeconds` (default `30`) |

## 10. Data and state

Counters live in `admission.js`, `budget.js`, and `server.js` as process-memory numbers. No persistence, no reset, no disk, no cross-request state beyond the counters themselves. `trackedModels` stores distinct model IDs in a null-prototype map keyed by the exact model string (config.js precedent), reporting only its size.

## 11. Invariants

1. `GET /stats` answers `401` before `503` for every missing/invalid credential combination.
2. `GET /stats` answers `200` while saturated; admission, Queue, and budgets are never consulted.
3. `GET /stats` contacts the upstream zero times.
4. The response key set is exactly the 21-key allowlist; no extra key, no missing key.
5. Disabled shape: `rateLimitEnabled === false`, `effectiveGlobalRpm === null`, `effectiveGlobalTpm === null`.
6. Counters are monotonic; no public reset.
7. No model IDs, paths, queries, bodies, credentials, or upstream identity appear.
8. `trackedModels` is a single integer, never per-model data.
9. A `/stats` call moves no counter, including `completed`.
10. Existing routes (`/health`, `/v1/*`, 401, 404, 502, 503, SSE pass-through, disconnect abort) are byte- and behavior-unchanged.

## 12. Failure modes

| Failure | Answer |
|---|---|
| Missing Proxy token | `401 { "error": "Unauthorized" }`, no upstream contact |
| Invalid Proxy token | `401 { "error": "Unauthorized" }`, no upstream contact |
| Valid token, missing API key | `503 { "error": "Proxy is not configured" }` |
| Valid token, missing Proxy token | `401` (no valid configured token exists) |
| Non-GET on /stats | `404 { "error": "Not found" }` |
| Saturated proxy | `200` stats, bypassed admission/budgets |
| Upstream unreachable | not contacted for /stats at all |

## 13. Security and privacy

* Auth is the existing digest + `timingSafeEqual` path; no raw-byte comparison.
* The body names no credential, no API key, no Proxy token, no upstream host or URL, and not which credential is missing.
* No per-model data; `trackedModels` is a count only.
* Counters are not logged; the log line's closed field set is unchanged.

## 14. Observability

`GET /stats` is the first observable endpoint beyond `/health`. It does not add a log field; `/stats` itself is logged by the existing opt-in request logger when `PROXY_LOG_REQUESTS` is on, with the unchanged five-field line.

## 15. Dependencies

None added. Node built-ins only (`node:crypto` already imported in `server.js`; `admission.js`/`budget.js` use no imports beyond existing).

## 16. Risks and assumptions

* **Counter drift**: each counter must be incremented at exactly one terminal site. Tasks 1–3 pin shapes; task 7's delta tests pin behavior.
* **Auth ordering**: `authorized()` must run before `config.unconfigured` in the `/stats` branch, or a missing token leaks as a 503.
* **Self-exclusion**: `completed` must not be incremented for `/stats`, or repeated probes inflate the very total they measure.
* **`trackedModels` null-prototype**: a model ID `"__proto__"` must be stored and counted as an ordinary key, never shadowed.

## 17. Acceptance criteria (Gherkin)

```gherkin
Feature: authenticated aggregate stats

  Scenario: authentication ordering — missing token
    Given the proxy is configured
    When GET /stats is requested with no Authorization header
    Then the status is 401
    And the body is { "error": "Unauthorized" }
    And the upstream receives zero requests

  Scenario: authentication ordering — invalid token
    Given the proxy is configured
    When GET /stats is requested with Authorization: Bearer wrong
    Then the status is 401
    And the upstream receives zero requests

  Scenario: valid token while unconfigured
    Given NVIDIA_API_KEY or PROXY_AUTH_TOKEN is missing
    And a valid Proxy token is supplied
    When GET /stats is requested
    Then the status is 503
    And the body is { "error": "Proxy is not configured" }

  Scenario: saturation bypass
    Given rate limiting is enabled and the concurrency ceiling is saturated
    And the Queue is full
    When GET /stats is requested with a valid token
    Then the status is 200
    And the body contains the full 21-key allowlist
    And no admission or budget decision was made for this request

  Scenario: upstream never contacted
    Given the stub upstream records every arrival
    When GET /stats is requested with a valid token
    Then the upstream received exactly zero requests

  Scenario: exact allowlist field set
    Given GET /stats returns 200
    Then the body's top-level keys are exactly
      rateLimitEnabled, effectiveGlobalRpm, effectiveGlobalTpm,
      safetyMarginPct, maxConcurrentRequests, maxQueueSize,
      queueTimeoutSeconds, active, queued, admitted, waits,
      queueFullRejections, queueTimeoutRejections,
      oversizedBodyRejections, costOverLimitRejections,
      queuedClientDisconnects, activeClientDisconnects, completed,
      usageReconciled, usageEstimateFallbacks, trackedModels

  Scenario: disabled rate-limit shape
    Given PROXY_RPM and PROXY_TPM are absent
    When GET /stats returns 200
    Then rateLimitEnabled is false
    And effectiveGlobalRpm is null
    And effectiveGlobalTpm is null
    And safetyMarginPct is 5
    And maxConcurrentRequests is null
    And maxQueueSize is 32
    And queueTimeoutSeconds is 30
    And every counter is 0

  Scenario: privacy exclusions
    Given GET /stats returns 200
    Then the body contains no path, query, body, prompt,
         completion, API key, Proxy token, upstream identity,
         missing-credential identity, model ID, or per-model entry

  Scenario: self-exclusion
    Given GET /stats returns 200 twice
    Then every counter's value is identical before and after both calls

  Scenario: exact counter deltas per event class
    Given a fresh proxy with a tight window
    When one proxied request completes
    Then completed increases by exactly 1
    When one request body exceeds PROXY_MAX_BUFFERED_BODY_BYTES
    Then oversizedBodyRejections increases by exactly 1
    When one request is over the effective TPM
    Then costOverLimitRejections increases by exactly 1
    When the Queue is full and a request is rejected
    Then queueFullRejections increases by exactly 1
    When a queued request's wait expires
    Then queueTimeoutRejections increases by exactly 1
    When a queued client disconnects
    Then queuedClientDisconnects increases by exactly 1
    When an admitted client disconnects mid-fetch
    Then activeClientDisconnects increases by exactly 1
    When usage reconciles to actual
    Then usageReconciled increases by exactly 1
    When usage is unusable and the estimate stands
    Then usageEstimateFallbacks increases by exactly 1
    When a new model ID is observed by the estimator
    Then trackedModels increases by at most 1
```

## 18. Out of scope

* Per-model stats, model-ID lists, per-model counters — explicitly forbidden by issue #21.
* Prometheus, metrics pipelines, dashboards, or any UI.
* Public or unauthenticated stats; health contract changes.
* Counter reset or any mutable state beyond monotonic increments.
* Budget waiting, retry, replay, cooldown, circuit breaker — none exist and none are added here.
* Issue #22 (integration, documentation, release pass) except the living-doc sync this story owns.

## 19. Zoom-out checks

### `admission.js` (modified)

* **Purpose**: own admission state — active count, FIFO queue, ticket settlement.
* **Callers**: `server.js` only.
* **Contracts**: `acquire()` returns admitted/rejected ticket; `release()` frees a slot; new counter getters are read-only and monotonic.

### `budget.js` (modified)

* **Purpose**: own the numbers — effective limits, rolling windows, estimator, counters.
* **Callers**: `server.js` only.
* **Contracts**: existing getters `reconciledCount`/`fallbackCount` kept as aliases; new getters `costOverLimitRejections`/`trackedModels`.

### `server.js` (modified)

* **Purpose**: HTTP entry; owns bytes, status codes, auth, and now the `/stats` branch.
* **Callers**: node; `server.test.js` spawns it; `perf-bench.js` and smoke scripts import it.
* **Contracts**: `/stats` before `/v1/*`, auth-before-unconfigured, bypasses admission/budgets/upstream, self-exclusion.

## 20. Slopcheck

* Zero runtime dependencies; Node built-ins only. `[OK]`.
* No new abstraction without a reason: counters are plain numbers with one getter each; `trackedModels` needs a null-prototype map because a model ID is operator-supplied text (config.js precedent). `[OK]`.
* No new test seam; the black-box harness plus one direct-import shape check per module. `[OK]`.

## 21. Risks

See §16. The dominant risk is an off-by-one in counter placement; task 7's exact-delta tests and task 4's stats tests guard it. The suite is 237 tests; this story adds black-box tests plus shape checks, raising the count, and the task-7 count gate must sweep living docs to the new number.

## 22. Out-of-scope references

Issue #22. `docs/adr/0002-config-operational-fail-fast.md` gains no amendment (this story reads existing config fields and adds no variable). `docs/research/config-invariant-guard-tests.md` is a dated historical note and must not be updated.

## References

* Issue #21 — acceptance criteria (quoted verbatim in §17).
* Issue #13 — parent epic, stories 123–134 name `/stats`, aggregate stats, and the operational view.
* `docs/adr/0001-config-validation-fail-fast-vs-degrade.md` — auth-before-unconfigured ordering.
* `docs/adr/0002-config-operational-fail-fast.md` — fail-fast regime for operational variables (no new variable added here).
* Landed prior art: `describe("e04s07 non-streaming usage reconciliation")` and `describe("admission concurrency ceiling")` in `server.test.js`; `admission.js`, `budget.js`, `observer.js`.
