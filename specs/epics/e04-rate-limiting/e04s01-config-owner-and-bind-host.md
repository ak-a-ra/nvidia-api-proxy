# e04s01: Validated operational config owner and configurable bind host

* Story: `e04s01`
* Epic: `e04` — Rate limiting and admission control
* Issue: [#14](https://github.com/ak-a-ra/nvidia-api-proxy/issues/14) (slice 1 of 9)
* Status: failing
* BCPs: 9
* Type: refactor | Risk: P0 | Context: infra
* Maturity: 3 (Countable)

> This story is a prefactor with a large surface and no new user-facing feature. Every one
> of the nine later slices in the epic depends on the config owner it introduces, so a
> mistake here propagates. `risk: P0` follows the high-BCP heuristic (BCPs 9 ≥ 5), not a
> judgment that the work is complex.

## 1. Business narrative

Issue #13 adds opt-in rate limiting: a bounded queue, RPM/TPM budgets, per-model budgets, and
an authenticated stats endpoint. That is nine slices, and each of them must read and validate
environment variables. If each slice parses its own, the project ends up with nine
inconsistent parsing rules, nine places to fix a numeric-parsing bug, and no single place a
reviewer can look to answer "what does this deployment think its limits are".

This slice is the prefactor. It introduces one internal configuration owner that parses and
validates every operational variable the whole epic will need, and uses that owner to add a
`PROXY_HOST` bind-host option. No admission behavior is built here.

## 2. Problem statement

Configuration parsing is currently one function inside `server.js` handling three variables,
plus an ad-hoc `readSeconds` helper for two timeouts. The epic needs it to handle twelve
more, with stricter validation, without growing `server.js` past reviewable size.

## Requirements (delta tags)

#### MODIFIED: Startup configuration has a single internal owner

**Before:** `validateConfig(env)` lives in `server.js`, parses `NVIDIA_BASE_URL`,
`NVIDIA_API_KEY`, and `PROXY_AUTH_TOKEN`, and calls `process.exit(1)` on base-URL problems.
Timeout variables are read separately by a module-level `readSeconds(name, fallback)` helper
that returns a fallback for anything non-finite or negative.

**After:** one internal config owner parses and validates every operational variable in the
epic plus the existing three, at import time, returning one config object. The server entry
imports it and keeps no parsing logic. The existing config object shape
(`baseURL`, `apiKey`, `proxyToken`, `unconfigured`) is preserved so no existing test changes.

#### MODIFIED: Listener bind address is configurable

**Before:** `server.listen(PORT, "0.0.0.0", ...)` — the bind address is a hardcoded literal.

**After:** the bind address comes from the config owner as `config.host`, sourced from
`PROXY_HOST`, defaulting to `0.0.0.0`. This is the only change this story makes to network
exposure.

#### MODIFIED: Numeric env parsing is strict rather than lenient

**Before:** `readSeconds` maps any non-finite or negative value to the fallback, so
`UPSTREAM_IDLE_TIMEOUT_SECONDS=abc` silently becomes 120 and `= -1` silently becomes 120.

**After:** the two existing timeout variables keep their lenient fallback behavior — changing
it would be a behavior change outside this story's scope and is explicitly out of scope
below. All *new* operational variables use strict validation: absent/blank/zero where
specified, otherwise a malformed value is fatal at startup with exit code 1 and a stderr
message naming the variable.

#### ADDED: Rate variables are a mandatory pair

`PROXY_RPM` and `PROXY_TPM`. Both absent or blank → rate limiting disabled, behavior
identical to today. Exactly one non-blank → fatal. Non-blank values must be positive integers.

#### ADDED: Operational limit variables are validated at startup

`PROXY_MAX_CONCURRENT_REQUESTS` (absent/blank/`0` disables; otherwise positive safe integer),
`PROXY_MAX_QUEUE_SIZE` (default 32), `PROXY_QUEUE_TIMEOUT_SECONDS` (default 30),
`PROXY_SAFETY_MARGIN_PCT` (default 5, integer 0–50), `PROXY_MAX_BUFFERED_BODY_BYTES`
(default 8 MiB). Invalid values are fatal.

#### ADDED: Per-model limits are validated as a whole or rejected

`PROXY_MODEL_LIMITS_JSON`, a JSON object keyed by exact case-sensitive model ID, each entry
supplying positive integer `rpm`, `tpm`, or both. Malformed JSON, a non-object root, an empty
model key, a non-object entry, or invalid values are fatal whenever the variable is supplied.
Never partially applied — a silently dropped model limit is a budget that appears to exist and
does not.

#### ADDED: Six domain terms are recorded before the slices that need them

Admission control, Queue, Rate budget, Per-model budget, Safety margin, and Usage
reconciliation enter `CONTEXT.md` in this slice so the eight later specs inherit one
vocabulary instead of each inventing terms.

## 3. Actors

- **Operator** — wants to bind `127.0.0.1` for a local-only deployment, and wants an invalid
  operational value to fail loudly at startup instead of silently misbehaving.
- **Developer** — wants one place that owns "what is this process configured to do".
- **Security reviewer** — wants bind-host to be the only change to network exposure, and
  wants a malformed limit to fail closed rather than open.

## 4. Preconditions

- Suite green at 34/34 (verified on branch `epic-14-config-owner`).
- e01 (CI) and e02 (config guard baseline) landed, so new fatal rules land on a complete
  guard baseline rather than the partial one ADR 0001 documents.

## 5. Solution and main flow

Extract configuration parsing out of the request path into one internal module that
`server.js` calls once at startup. The owner parses and validates the nine new variables plus
`PROXY_HOST`, and returns one config object. `server.js` keeps the bind address and request
handling, and exposes no configuration or limiter internals.

## 6. Constraints and alternative flows

- **Zero dependencies** — Node built-ins only. No new package is introduced, so the
  [SLOPCHECK](#slopcheck) section is vacuous.
- **Preserve ADR 0001.** Missing `NVIDIA_API_KEY`/`PROXY_AUTH_TOKEN` must still degrade to
  runtime 503. This story extends the *operational* regime; it must not touch the *credential*
  regime. ADR 0002 records the extension.
- **No limiter internals exported** (#13 user story 138) and **no second test seam** (user
  story 139). Tests stay black-box through the existing child-process harness.
- **Default-off is load-bearing.** `PROXY_HOST` defaults to `0.0.0.0`, preserving current
  Render and container behavior.
- Alternative considered: parse lazily at first use. Rejected — a bad limit would surface as
  a per-request failure, which is exactly what ADR 0001 §Alternatives rejected for the base
  URL.
- Alternative considered: validate operational variables only in the slice that uses them.
  Rejected — nine separate parsing rules is the problem this story exists to prevent.
- Alternative considered: keep everything in `server.js` and just grow `validateConfig`.
  Rejected — #13 user stories 135–138 describe deep internal modules distinct from a server
  entry. This contradicts `CONVENTIONS.md` §File Organization and `AGENTS.md` §Repository
  knowledge, which both describe a single `server.js`; both are updated as part of this story.

## 7. Domain glossary

Existing terms reused: **Client**, **Upstream**, **Base URL**, **API key**, **Proxy token**,
**Credential swap**, **Unconfigured**, **Misconfigured**, **Health**, **Pass-through**,
**Local response**, **Path mapping**, **Header fidelity**, **Response stream**,
**Client disconnect**.

New terms (from #13, recorded here so later slices inherit one vocabulary):

- **Admission control** — decides whether a request may run now, must wait, or receives a
  Local response.
- **Queue** — the bounded FIFO set of authenticated requests waiting for capacity.
- **Rate budget** — a rolling 60-second allowance for requests per minute, or estimated and
  reconciled tokens per minute.
- **Per-model budget** — a rolling 60-second allowance applying only to requests naming an
  exact configured model ID.
- **Safety margin** — a percentage reduction applied to raw RPM and TPM limits before
  enforcement.
- **Usage reconciliation** — replacing a request's estimated token cost with valid actual
  usage reported by the Upstream.

## 8. Interfaces and contracts

New internal module, a root-level `config.js` exposing one parse/validate entry point,
imported by `server.js`. Not re-exported from the server entry. `config.js` complies with
`CONVENTIONS.md` ("source code in project root, no `src/` directory").

| Variable | Default | Invalid handling |
| --- | --- | --- |
| `PROXY_HOST` | `0.0.0.0` | fatal on malformed value |
| `PROXY_RPM` | unset | fatal if non-blank and not a positive integer |
| `PROXY_TPM` | unset | fatal if non-blank and not a positive integer |
| `PROXY_MAX_CONCURRENT_REQUESTS` | disabled | absent/blank/`0` disables; otherwise positive safe integer |
| `PROXY_MAX_QUEUE_SIZE` | 32 | fatal on invalid |
| `PROXY_QUEUE_TIMEOUT_SECONDS` | 30 | fatal on invalid |
| `PROXY_SAFETY_MARGIN_PCT` | 5 | fatal outside integer 0–50 |
| `PROXY_MODEL_LIMITS_JSON` | unset | fatal when supplied and malformed |
| `PROXY_MAX_BUFFERED_BODY_BYTES` | 8 MiB | fatal on invalid |

Exactly one of `PROXY_RPM`/`PROXY_TPM` non-blank is fatal.

## 9. Configuration

Read once at module import, matching current behavior. Whitespace-only counts as absent,
consistent with ADR 0001's `.trim()` treatment of credentials.

## 10. Data and state

The config object is built once at startup and is immutable. No counters, no queue state —
those are later slices.

## 11. Invariants

- Host binding changes **no** forwarded header, credential swap, path mapping, response, or
  health behavior. Only the listener address.
- `NVIDIA_BASE_URL` validation stays exactly as ADR 0001 specifies.
- Missing credentials still yield `unconfigured` and 503, never a crash.
- Fatal operational values exit 1 with stderr naming the variable.
- The server entry exports nothing new.
- Every pre-existing test passes unchanged.

## 12. Failure modes

- A whitespace-only value must not parse as a valid number: `Number("  ")` is `0`, which would
  silently disable a budget. The blank check must precede numeric parsing.
- `Number("1e3")` is `1000`. Whether scientific notation is accepted is a decision this
  story must make explicitly and pin in a test, not leave to `Number()`.
- Splitting config into a module risks breaking the import-time read the test harness
  depends on. The child-process harness in `server.test.js` is the guard.
- A partially applied `PROXY_MODEL_LIMITS_JSON` fails open. Reject the whole value.

## 13. Security and privacy

- `PROXY_HOST=127.0.0.1` is the security-relevant half: it removes external exposure for
  local-only deployments, and must change nothing else about request handling.
- `PROXY_MODEL_LIMITS_JSON` parses operator-supplied JSON at startup. Malformed input must be
  fatal, never partially applied.
- No config value is ever echoed into a response body.
- Credential degradation must be preserved exactly, or the auth-before-unconfigured ordering
  that prevents leaking credential configuration to anonymous callers regresses.

## 14. Observability

None added. `/health` keeps its existing contract; this story must not change the reported
shape.

## 15. Dependencies

- Blocked by: nothing. This is the unblocked root of the chain.
- Blocks: #15 → #16 → #17 → #18 → #19 → #20 → #21 → #22.
- Should follow e01 (CI) and e02 (config guard baseline).

## 16. Risks and assumptions

- **The prefactor rewrites working code.** Mitigation: `server.js` keeps its structure, only
  configuration parsing moves, and every existing test must pass untouched.
- **Premature generality.** The owner validates nine variables that slices #15–#22 consume
  later. Accepted deliberately per #13; unused variables are validated but not acted on.
- **Convention conflict.** `CONVENTIONS.md` and `AGENTS.md` both describe a single-file
  `server.js`. This story contradicts them and updates both.
- Assumption: a single new root-level source file is acceptable.

## 17. Acceptance criteria (Gherkin)

```gherkin
Scenario: Default host preserves current behavior
  Given no operational variables are set
  When the proxy starts
  Then it listens on 0.0.0.0
  And every existing test still passes

Scenario: Loopback-only binding works
  Given PROXY_HOST is 127.0.0.1
  When the proxy starts
  Then it is reachable on 127.0.0.1
  And no forwarded header, credential swap, path mapping, or health response changes

Scenario: Rate limiting stays disabled when both rate variables are absent
  Given neither PROXY_RPM nor PROXY_TPM is set
  When the proxy starts
  Then startup succeeds
  And request handling is identical to a build without rate limiting

Scenario: Exactly one rate variable is fatal
  Given PROXY_RPM is set and PROXY_TPM is absent
  When the proxy starts
  Then the process exits 1
  And stderr names the variable

Scenario: Malformed operational values are fatal
  Given PROXY_MAX_QUEUE_SIZE is "abc" or PROXY_SAFETY_MARGIN_PCT is 51
  When the proxy starts
  Then the process exits 1

Scenario: Malformed model limits are fatal
  Given PROXY_MODEL_LIMITS_JSON is "{not json}"
  When the proxy starts
  Then the process exits 1

Scenario: A blank operational value is absent, not zero
  Given PROXY_RPM is " " and PROXY_TPM is " "
  When the proxy starts
  Then startup succeeds with rate limiting disabled

Scenario: Credential degradation is unchanged
  Given NVIDIA_API_KEY is absent
  When the proxy starts
  Then it starts rather than exiting
  And /health reports 503 unconfigured

Scenario: No new test seam
  Given the config owner exists
  When the server entry's exports are inspected
  Then no configuration or limiter internals are exported
```

## 18. Out of scope

- Any admission, queue, budget, estimator, usage-observer, or stats behavior — all later
  slices.
- Acting on the validated values beyond `PROXY_HOST`; validation only.
- Changing the credential regime in ADR 0001.
- Tightening the lenient `readSeconds` fallback for the two existing timeout variables. It is
  preserved as-is; tightening it is a separate behavior change.
- Request buffering, which belongs to later slices.
- A unit-test seam for the config module.

## 19. Zoom-out check — `server.js`

**Purpose.** Single-file reverse proxy owning config validation, HTTP server lifecycle,
bearer auth, path mapping, header fidelity, upstream fetch and streaming, the two timeout
windows, and graceful shutdown. It is simultaneously the process entry point and the only
module in the project.

**Callers.**

1. `npm start` → `node server.js` (also `render.yaml`).
2. `server.test.js` — spawns it as a child with `import server from <abs path>`, relies on
   the **default export**, `listening`/`error` events, and the IPC port handshake.
3. `perf-bench.js` — same child-process pattern.
4. Named exports `CONNECT_TIMEOUT_SECONDS` and `IDLE_TIMEOUT_SECONDS`.

**Contracts that must survive this story.**

- `export default server` is the only supported test seam; it must remain the default export.
- Environment variables are read once at import; changing this breaks the whole harness.
- `process.exit(1)` plus a stderr message on a bad `NVIDIA_BASE_URL`.
- Credential degrade: `/health` → 503 `{ status: "unconfigured" }`; proxied request → 503
  `{ error: "Proxy is not configured" }`.
- 401 precedes 503 for unauthenticated callers when unconfigured.
- `/health` is unauthenticated; bare `/v1` and `/v1/` return 404.
- SIGTERM drops idle connections, lets in-flight streams finish, exits 0 within 10s.

## 20. Slopcheck

No external package is proposed. The project is zero-dependency by hard constraint
(`CONVENTIONS.md` Never-Do list, README badge, `package.json` has no `dependencies` field).
The tag set is therefore empty and no human approval is required.

## 21. Risks section

- Refactor regression in working code → detected by the unchanged existing suite (56 tests)
  in task 1 and task 12.
- Silent fail-open on a malformed limit → detected by the fatal-exit tests in tasks 3–6.
- Convention drift in `AGENTS.md` / `CONVENTIONS.md` → detected by tasks 9 and 10.

## 22. Out-of-scope references

See §18.

## References

- Issue [#14](https://github.com/ak-a-ra/nvidia-api-proxy/issues/14)
- Issue [#13](https://github.com/ak-a-ra/nvidia-api-proxy/issues/13) — user stories 1–26
- `docs/adr/0001-config-validation-fail-fast-vs-degrade.md` — preserved, extended by ADR 0002
- `server.js` — `validateConfig`, `readSeconds`, `server.listen`
- `CONTEXT.md` — glossary
- `specs/tech-architecture/tech-stack.md` — startup configuration table
