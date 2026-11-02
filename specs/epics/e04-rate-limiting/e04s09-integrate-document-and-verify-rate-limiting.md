# e04s09: Integrate, document, and verify rate limiting

* Story: `e04s09`
* Epic: `e04` — Rate limiting and admission control
* Issue: [#22](https://github.com/ak-a-ra/nvidia-api-proxy/issues/22) (slice 9 of 9)
* Parent issue: [#13](https://github.com/ak-a-ra/nvidia-api-proxy/issues/13)
* Status: failing
* BCPs: 7
* Type: feat | Risk: P1 | Context: infra
* Maturity: 3 (Countable)

## 1. Business narrative

All eight rate-limiting slices are landed: config owner (e04s01), admission (e04s02), abort-aware admission (e04s03), global budgets (e04s04), per-model budgets (e04s05), SSE usage reconciliation (e04s06), non-streaming reconciliation (e04s07), authenticated aggregate stats (e04s08). No story documents the completed feature as one coherent surface. Issue #22 is the release pass: integrate the work, close every documentation drift, run the full suite, and ship the verified capsule. The story changes no production behavior — every line it touches is docs, specs, and the count gate.

## 2. Problem statement

Drift is the defect. Slices shipped fast and each touched `CONVENTIONS.md`, `README.md`, tech-stack.md, TEST_PLAN_LATEST.md, VISION_LATEST.yaml, SCOPE_LATEST.yaml, and `AGENTS.md` in places; the release-plan note said two existing docs contradict the epic. `e04s08` already warned issue #22 owns the living-doc sync and the test-count gate. Without e04s09 the repo has an implemented rate-limiting feature whose documentation describes a stale state: test counts that no longer match, ADR text that says limits "stay invisible," scope text that says reconciliation remains, and an epic manifest that still lists e04s09 as `blocked` with null spec/tasks. Fixing docs by hand without a gate guarantees the next drift.

## 3. Requirements (delta tags)

All tags are `MODIFIED` — no new runtime surface, no new exports, no new dependencies.

#### MODIFIED: docs/adr/0002-config-operational-fail-fast.md must agree with implemented state

**Before:** Consequences text says five rate-limiting limits "stay invisible until #17–#22" and the per-model map "stays invisible until #17–#22."

**After:** Text states all eight rate-limiting limits are enforced since e04s04 (four globals) and e04s05 (per-model), matching tech-stack.md and config.js. ADR 0002 itself is not regenerated; only the stale consequence sentences are corrected to match the shipped code.

#### MODIFIED: test-count gate derives N from the TAP summary and sweeps living docs

**Before:** No e04s09 capsule exists; prior stories each hand-synced their own count.

**After:** The count gate runs `npm test`, derives `N` from `node --test --test-reporter=tap server.test.js | grep -E '^# tests [0-9]+$'`, fails on any living doc stating a different number. Living docs in scope: README.md badge and tip, AGENTS.md `npm test` bullet + count site list, CONVENTIONS.md, specs/README.md, tech-stack.md test line, TEST_PLAN_LATEST.md test lines, VISION_LATEST.yaml, state.yaml handoff note, and story specs that state a count (including e04s08 §21). Excluded: plans/, docs/research/config-invariant-guard-tests.md, LOG.md, specs/epics/*/briefs/, *-tasks.yaml, specs/verifications/.

#### MODIFIED: domain docs define the six glossary terms consistently

**Before:** tech-stack.md §Rate Limiting and SCOPE_LATEST accepted-tradeoffs mention admission, queue, rate budget, safety margin, body cap, and per-model windows piecemeal; observer glossary is scattered.

**After:** Domain documentation defines Admission control, Queue, Rate budget, Per-model budget, Safety margin, and Usage reconciliation and uses those terms consistently across tech-stack.md, SCOPE_LATEST.yaml, TEST_PLAN_LATEST.md, and CONVENTIONS.md.

#### MODIFIED: product scope records opt-in defaults, protected stats, configurable Host, accepted buffering tradeoff

**Before:** SCOPE_LATEST accepted-tradeoffs paragraph still says issues #21–#22 remain and names the body-copy tradeoff as pending.

**After:** SCOPE_LATEST records opt-in defaults (rate limiting off), protected stats (/stats authenticated, no public metrics), configurable Host (PROXY_HOST bind address), and the accepted request-buffering tradeoff (bounded copy only in rate-limit mode, original bytes forwarded unmodified).

#### MODIFIED: operator documentation lists every new env var, valid values, defaults, exact Local 413/429/503 contracts, authenticated stats contract

**Before:** README.md Configuration table lists env vars but the /stats route contract is absent; Local 413/429/503 contracts are described across sections rather than gathered.

**After:** README.md gathers every new env var (`PROXY_RPM`, `PROXY_TPM`, `PROXY_MAX_CONCURRENT_REQUESTS`, `PROXY_MAX_QUEUE_SIZE`, `PROXY_QUEUE_TIMEOUT_SECONDS`, `PROXY_SAFETY_MARGIN_PCT`, `PROXY_MAX_BUFFERED_BODY_BYTES`, `PROXY_MODEL_LIMITS_JSON`, `PROXY_HOST`, `PROXY_LOG_REQUESTS`) with valid values, defaults, exact local contracts (413 Request too large / 429 Too many requests / 503 Service unavailable / Proxy is not configured), and the authenticated /stats contract (SHA-256 + timingSafeEqual, 401 before 503, bypasses admission and budgets, self-exclusion).

#### MODIFIED: technical architecture and ADR agree on module boundaries, fail-fast config, credential degradation, cleanup ownership, single-process scope

**Before:** tech-stack.md data flow shows /health then /v1/* then 401 then 503 then fetch; no /stats node; rate limiting described as enforced since e04s05.

**After:** tech-stack.md data flow adds /stats (auth-before-unconfigured, no admission, no upstream); data-flow table reconciled with server.js; ADR 0002 consequence sentences corrected to shipped state; module-boundary claims (config owns parsing, admission owns active/queue, budget owns windows, server owns bytes/status) confirmed against source.

#### MODIFIED: server entry exports no limiter internals; no second test seam; no limiter test export

**Before:** e04s08 verified admission.js/budget.js counter getters via direct import; no admission/budget/estimator/observer export list exists in server.js.

**After:** Confirmed server.js exports only `CONNECT_TIMEOUT_SECONDS` and `IDLE_TIMEOUT_SECONDS`; no admission, budget, estimator, or usage-observer internals are exported; no second test seam exists; the only import seam in server.test.js is the pre-existing `estimateCost`/`createSseObserver`/`createJsonObserver` direct import.

#### MODIFIED: nothing added that issue #22 forbids

**Before:** N/A.

**After:** Confirmed no compression, model fallback, retry/replay, Upstream 429 cooldown, per-Client quota, distributed coordination, persistent state, public stats, or dependency was added. `package.json` `dependencies` stays absent; `npm test` stays `node --test server.test.js`.

#### MODIFIED: final manual smoke covers Health, rate-limited request, saturated Queue, streaming pass-through, authenticated stats

**Before:** No smoke script exists.

**After:** A documented manual smoke sequence (commands only, runnable against a local proxy) covers the five scenarios; commands exit non-zero on failure.

## 4. Actors

* **Operator** — runs the count gate, `npm run check`, manual smoke; reads docs.
* **Reviewer** — checks spec/tasks/epic.yaml/execution-status.yaml consistency.
* **CI** — runs `npm test` on Node 20/22/24 and `npm run check` on Node 24.

## 5. Preconditions

* e04s01–e04s08 all landed and green (237 tests).
* `scripts/` contains only `check-state-yaml.py`; `scripts/lib/plan-consistency-check.sh` and `scripts/sync-status-from-epics.sh` do not exist — `execution-status.yaml` is synced by hand.
* No new environment variable; `CONFIG_ENV_VARS` unchanged.
* Issue #22 acceptance criteria are verified, not implemented: no production code changes unless a doc check reveals drift to fix in docs only.

## 6. Solution and main flow

1. Write `specs/epics/e04-rate-limiting/e04s09-integrate-document-and-verify-rate-limiting.md` (this file) in countable-story format, matching e04s08's section numbering and delta-tag style.
2. Write `specs/epics/e04-rate-limiting/e04s09-tasks.yaml` with runnable verify commands, all `status: failing`, bcps 7, type feat.
3. Update `epic.yaml` e04s09 entry: `status: todo`, spec/tasks filenames set, `blocked_by: [e04s08]`, bcps 7.
4. Update `specs/execution-status.yaml` e04s09: `blocked` → `todo` (hand-synced; no sync script exists).
5. Run `npm test`; derive N from TAP `# tests N` line; run count-gate sweep over living docs.
6. Run `npm run check` (lint + typecheck + format:check).
7. Run manual smoke sequence (Health, rate-limited request, saturated Queue, streaming pass-through, authenticated stats).
8. Correct any living-doc drift found (docs only, no production code).

## 7. Domain glossary

Reused unchanged: **Client**, **Upstream**, **Proxy Token**, **API Key**, **Credential Swap**, **Local Response**, **Pass-through**, **Path mapping**, **Header fidelity**, **Response Stream**, **Client Disconnect**, **Health**, **Unconfigured**, **Rate budget**, **Admission control**, **Queue**.

* **Usage reconciliation** — replacing an estimated token cost with actual usage parsed from a completed response (SSE via `createSseObserver`, non-streaming via `createJsonObserver`), moving `usageReconciled` +1 and `usageEstimateFallbacks` +0 on success.
* **Safety margin** — `PROXY_SAFETY_MARGIN_PCT` (0–50, default 5) shaved off each advertised effective limit, floored at one.
* **Per-model budget** — `PROXY_MODEL_LIMITS_JSON` keyed model budgets, enforced atomically with the global pair, inert without it.
* **Queue** — bounded FIFO waiters behind `admission.js`, sized by `PROXY_MAX_QUEUE_SIZE`, timed by `PROXY_QUEUE_TIMEOUT_SECONDS`.

## 8. Interfaces and contracts

No production interface changes. The existing contracts, confirmed against source:

* `GET /stats` — 401 / 503 / 404 / 200 with the 21-key allowlist object; self-exclusion; no upstream contact.
* `admission.js` — `createAdmission(limits)` returns `{ acquire, close, active, queued, admitted, waits, queueFullRejections, queueTimeoutRejections, queuedClientDisconnects }`; none exported by server.js.
* `budget.js` — `createBudget(...)` returns `{ enabled, effective, modelEffective, reserve, release, close, usageReconciled, usageEstimateFallbacks, costOverLimitRejections, trackedModels }`; `estimateCost(json, buffer)` pure; none exported by server.js.
* `observer.js` — `createSseObserver`, `createJsonObserver`, `usageTotalFromUsage`; `JSON_OBSERVATION_BYTE_BOUND`; none exported by server.js.
* `server.js` exports only `CONNECT_TIMEOUT_SECONDS`, `IDLE_TIMEOUT_SECONDS`.

## 9. Configuration

No new variables. `CONFIG_ENV_VARS` unchanged.

| Variable | Role in this story |
|---|---|
| `PROXY_RPM` / `PROXY_TPM` | global budget pair, effective limits in /stats |
| `PROXY_SAFETY_MARGIN_PCT` | `safetyMarginPct` in /stats |
| `PROXY_MAX_CONCURRENT_REQUESTS` | `maxConcurrentRequests` (null when disabled) |
| `PROXY_MAX_QUEUE_SIZE` | `maxQueueSize` |
| `PROXY_QUEUE_TIMEOUT_SECONDS` | `queueTimeoutSeconds` |
| `PROXY_MAX_BUFFERED_BODY_BYTES` | body cap; 413 contract |
| `PROXY_MODEL_LIMITS_JSON` | per-model map, inert without global pair |
| `PROXY_HOST` | bind address (no validation rule) |
| `PROXY_LOG_REQUESTS` | closed-vocabulary opt-in flag |

## 10. Data and state

No new state. Existing process-memory counters in admission.js, budget.js, server.js. No persistence, no reset, no cross-request state beyond counters. `trackedModels` is a count only, never a list of IDs.

## 11. Invariants

1. Full suite green (237 tests) with `node --test` only, no install.
2. Every living doc stating a test count states the same verified N.
3. Zero runtime dependencies; `dependencies` absent in `package.json`.
4. No exported limiter internals from server.js; no second test seam.
5. /stats bypasses admission, budgets, upstream; self-exclusion.
6. /stats auth-before-unconfigured ordering; 401 before 503.
7. Existing routes byte- and behavior-unchanged.

## 12. Failure modes

| Failure | Answer |
|---|---|
| Count gate finds a living doc stating a stale N | verify exits non-zero; docs corrected by hand |
| `npm run check` finds lint/typecheck/format failure | verify exits non-zero; fix docs, not silence rules |
| Manual smoke returns non-200 on Health | smoke command exits non-zero; investigate proxy config |
| Authenticated /stats returns 401/503 unexpectedly | smoke command exits non-zero; check token and config |

## 13. Security and privacy

* No new attack surface: /stats reuses existing `authorized()` digest + `timingSafeEqual`.
* /stats body names no credential, key, upstream host, or which credential is missing.
* `trackedModels` is a count only; no model IDs surface.
* No new dependency, no new export, no new test seam.

## 14. Observability

`/stats` is the release-pass observable endpoint beyond `/health`. No new log field; /stats itself is logged by the existing opt-in request logger with the unchanged five-field line (`ts`/`method`/`path`/`status`/`ms`).

## 15. Dependencies

None added. Node built-ins only.

## 16. Risks and assumptions

* **Doc drift is the real defect**: the code is already shipped; e04s09's risk is missing a stale claim. The count gate and doc sweep are the mitigation.
* **Count gate false negative**: pattern-matching greps must count named ok lines or use the `# tests N` TAP summary, never vacuous greps (e04s05 lesson).
* **Sync-by-hand**: no `scripts/lib/plan-consistency-check.sh` or `scripts/sync-status-from-epics.sh` exists; `execution-status.yaml` and `epic.yaml` are edited by hand, as prior stories did.
* **No issue creation**: issue #22 is not opened/closed/edited by this story.

## 17. Acceptance criteria (Gherkin)

```gherkin
Feature: integrate, document, and verify rate limiting

  Scenario: full suite green with node --test only
    Given a fresh clone with no node_modules
    When `npm test` runs
    Then the exit code is 0
    And the TAP summary line is "# tests 237"

  Scenario: every living doc states the same test count
    When the count-gate sweep runs over living docs
    Then no doc outside plans/, docs/research/config-invariant-guard-tests.md, LOG.md,
         specs/epics/*/briefs/, *-tasks.yaml, specs/verifications/ states a number other than 237

  Scenario: domain glossary terms are defined and used consistently
    Given tech-stack.md, SCOPE_LATEST.yaml, TEST_PLAN_LATEST.md, CONVENTIONS.md
    Then Admission control, Queue, Rate budget, Per-model budget, Safety margin, and Usage reconciliation
         are each defined and referenced without contradiction

  Scenario: product scope records accepted rate-limit commitments
    Given SCOPE_LATEST.yaml accepted-tradeoffs
    Then it records opt-in defaults, protected /stats, configurable Host, and the bounded-body-copy tradeoff

  Scenario: operator docs list every new env var and exact local contracts
    Given README.md Configuration and Endpoints
    Then PROXY_RPM, PROXY_TPM, PROXY_MAX_CONCURRENT_REQUESTS, PROXY_MAX_QUEUE_SIZE,
         PROXY_QUEUE_TIMEOUT_SECONDS, PROXY_SAFETY_MARGIN_PCT, PROXY_MAX_BUFFERED_BODY_BYTES,
         PROXY_MODEL_LIMITS_JSON, PROXY_HOST, PROXY_LOG_REQUESTS are listed with values, defaults,
         and Local 413/429/503 contracts plus authenticated /stats contract

  Scenario: technical architecture and ADR agree with shipped code
    Given tech-stack.md data flow and docs/adr/0002-config-operational-fail-fast.md Consequences
    Then /stats appears before /v1/* with auth-before-unconfigured, no admission, no upstream
         and no rate-limiting limit is described as "invisible" or "stored, not enforced"

  Scenario: server entry exports no limiter internals
    Given server.js export list
    Then no admission, budget, estimator, or observer symbol is exported
    And no second test seam exists

  Scenario: no forbidden capability was added
    Given package.json and the codebase
    Then no compression, model fallback, retry/replay, Upstream 429 cooldown, per-Client quota,
         distributed coordination, persistent state, public stats, or dependency exists

  Scenario: CI compatibility is confirmed
    Given `npm run check` and the CI matrix
    Then lint, typecheck, and format:check all exit 0

  Scenario: final manual smoke passes
    Given a local proxy with rate limiting enabled
    Then Health returns 200, one rate-limited request returns 200/429 as allowed,
         one saturated Queue returns 429, streaming pass-through is byte-identical,
         authenticated /stats returns 200 with the 21-key allowlist
```

## 18. Out of scope

* Production code changes (unless a doc check reveals drift to fix in docs only).
* New env vars, new endpoints, new exports, new test seams.
* Opening, editing, or closing GitHub issues.
* Touching plans/, LOG.md, briefs/, docs/research/config-invariant-guard-tests.md, other stories' *-tasks.yaml, or specs/verifications/.

## 19. Zoom-out checks

### scripts/ (existence check)

* `scripts/lib/plan-consistency-check.sh` — does not exist.
* `scripts/sync-status-from-epics.sh` — does not exist.
* `scripts/check-state-yaml.py` — exists (the only script).
* Consequence: `execution-status.yaml` is synced by hand, matching prior-story convention.

### ADR agreement

* `docs/adr/0002-config-operational-fail-fast.md` — no amendment to the decision regime; only stale Consequences sentences corrected to match e04s04/e04s05 shipped state.

### Count gate exclusion list (living docs in scope vs excluded)

* In scope: README.md, AGENTS.md, CONVENTIONS.md, specs/README.md, tech-stack.md, TEST_PLAN_LATEST.md, VISION_LATEST.yaml, state.yaml, story specs that state a count (e.g. e04s08 §21).
* Excluded: plans/*.md, docs/research/config-invariant-guard-tests.md, LOG.md, specs/epics/*/briefs/, specs/epics/*/*-tasks.yaml, specs/verifications/.

## 20. Slopcheck

* Zero runtime dependencies; Node built-ins only. `[OK]`.
* No new abstraction: this story adds no code at all; all verify commands are docs/count/shell gates. `[OK]`.
* No new test seam: nothing imported, nothing exported. `[OK]`.
* Count gate derives N from the TAP summary line, not from counting ok lines. `[OK]`.

## 21. Risks

See §16. The dominant risk is a stale number surviving in one living doc; the count gate and the sweep are the control. Suite is 237 tests; e04s09 adds zero tests, so N stays 237 and every living doc must agree.

## 22. Out-of-scope references

Issue #22 acceptance criteria are quoted in §17 and mapped one-to-one above. No ADR amendment beyond 0002 Consequences sentences. `docs/research/config-invariant-guard-tests.md` remains untouched.

## References

* Issue #22 — acceptance criteria (quoted verbatim in §17).
* Issue #13 — parent epic; `e04s09` is the head of the `#14 → … → #22` chain.
* `e04s08-expose-authenticated-aggregate-stats.md` — countable-story-format template (20+ sections).
* `e04s08-tasks.yaml` — tasks.yaml format template (bcps, issue, type, risk, context, allure).
* `docs/adr/0002-config-operational-fail-fast.md` — fail-fast regime for operational variables.
* `specs/tech-architecture/tech-stack.md` — startup-config table and data flow.
