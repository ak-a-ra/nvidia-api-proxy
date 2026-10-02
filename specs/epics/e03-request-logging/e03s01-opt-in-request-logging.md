# e03s01: Opt-in request logging via PROXY_LOG_REQUESTS

* Story: `e03s01`
* Epic: `e03` — Opt-in request logging
* Issue: [#9](https://github.com/ak-a-ra/nvidia-api-proxy/issues/9)
* Status: passing
* BCPs: 3
* Type: feat | Context: infra

## 1. Business narrative

When the proxy misbehaves in production there is no way to see what it received. The only
signal today is `console.error` on the error paths — a request that is silently slow, or one
that gets a 502, leaves no trace of what was asked. Operators have to guess between a bad
request, a bad path, and an upstream problem. This is the observability gap that issue #9
identified, and the same gap that made the rejected `/health` upstream-probing proposal
unattractive.

## 2. Problem statement

No per-request visibility. A maintainer debugging a production incident cannot correlate a
client complaint with proxy activity.

## 3. Actors

- **Operator** — needs request lines in the platform log to diagnose a complaint.
- **Client** — must be unaffected: logging is opt-in and never changes a response.

## 4. Preconditions

- Suite green at 34/34. That is a dated precondition record, not the current count — the living
  count is the one in `README.md`'s badge and the count gate in `e03s01-tasks.yaml`, and those are
  the ones to read.
- `render.yaml` already captures stdout/stderr as the platform log.

## 5. Solution and main flow

Add `PROXY_LOG_REQUESTS`. When unset, blank, or otherwise falsy the proxy behaves exactly as
today — no log line, no extra work. When enabled, each request emits one structured line to
stdout with method, path, status, and duration. Failures to log must never affect the
response.

## 6. Constraints and alternative flows

- **Default-off.** An unset variable must be indistinguishable from today's behavior, per
  `SCOPE_LATEST.yaml`'s transparency promise and #13 user story 4.
- **Local response privacy.** A logged line is still operator-visible output; it must not
  contain the API key, the proxy token, the upstream host, or request/response bodies.
  #13 user stories 110–114 state the same exclusion rule for `/stats`, and the same reasoning
  applies here.
- **Zero dependencies** — no logger package; `console.log` with a JSON string.
- **No behavior change when enabled** beyond the extra stdout line. Header fidelity, path
  mapping, credential swap, and streaming are untouched.
- Alternative considered: log by default at a low level. Rejected — it changes operator
  cost and log volume for existing deployments without consent.
- Alternative considered: use `PROXY_LOG_LEVEL`. Rejected — one boolean is enough now, and a
  level invites a format contract this project does not need.

## 7. Domain glossary

Existing terms: **Client**, **Upstream**, **Local response**, **Upstream failure**, **Path
mapping**, **Pass-through**. No new domain terms are introduced by this story.

## 8. Interfaces and contracts

New env var `PROXY_LOG_REQUESTS`. Output: one JSON line per request on stdout, e.g.
`{"ts":"...","method":"POST","path":"/v1/chat/completions","status":502,"ms":1204}`.

## 9. Configuration

| Variable | Required | Default | Behavior |
| --- | --- | --- | --- |
| `PROXY_LOG_REQUESTS` | No | off | `1`/`true`/`yes`/`on` enable, `0`/`false`/`no`/`off` disable, case-insensitively and after trimming; unset or blank is off; any other value is fatal (exit 1) |

*Corrected at story closure against `readLogRequests` in `config.js`.* This row originally read
"any non-blank non-`0`/`false` value enables logging", which shipped differently by decision: that
rule would make `PROXY_LOG_REQUESTS=maybe` switch a feature on with no signal that a typo was
reinterpreted. The rationale and its reversal are recorded in `specs/state.yaml`, the regime in
`docs/adr/0002-config-operational-fail-fast.md`, and the operator-facing statement in `README.md`
and the `specs/tech-architecture/tech-stack.md` startup-configuration table. Sections 8, 11, 12, 13
and 16 below are unchanged and describe what shipped. Section 17's "set to a non-blank value" is
shorthand for "set to one of the four truthy words"; the scenario is left as written because it is
an acceptance criterion rather than a statement about the configuration surface.

Read at module import time like every other variable.

## 10. Data and state

None. Counters are not part of this story; issue #21 owns aggregate stats.

## 11. Invariants

- Logging never alters a response status, body, or headers.
- Logging never throws into the request path — a write failure is swallowed.
- Log lines never contain credentials, bodies, or upstream hostnames. Scope this: the proxy's own
  key and token, any header, and any body cannot reach the line, by construction. `path` is the
  client's own request target copied verbatim, query string included and unredacted, so a secret a
  caller puts in a query parameter does reach the line — logged verbatim by decision, not by
  oversight.
- `/health` requests are logged only if the operator enabled logging; it is not special-cased
  out.

## 12. Failure modes

- `console.log` to a closed or full stdout can throw. Wrap in try/catch so the request path
  is unaffected.
- Streaming responses have no meaningful duration until they finish. Log them on close with
  the elapsed time; do not buffer the response to compute it.

## 13. Security and privacy

The main risk is a log line becoming a credential leak. Request bodies (which may contain user
data) and all `authorization` headers are excluded by construction — the log records only
method, path, status, and duration. This is the same privacy boundary that keeps
`/stats` aggregate-only.

The boundary is about the proxy's own state, not the caller's request. `path` is the one field a
client controls, and it is the incoming request target verbatim, query string included, with no
redaction and no allowlist of credential-shaped parameter names. Query-string credentials are a
documented convention on several OpenAI-compatible bases, so a caller may legitimately pass a
secret that way and the proxy will log it. Logging `pathname` alone, or masking a guessed set of
parameter names, was considered and rejected: the first silently narrows what an operator
debugging a query-parameter problem can see, the second is incomplete by construction. The operator
is told instead — `README.md`, `specs/tech-architecture/tech-stack.md`, and ADR 0002 all state the
verbatim behavior in those words, and a test pins it so a future redaction is deliberate.

## 14. Observability

This story *is* the observability work. It adds no metrics, traces, or health surface.

## 15. Dependencies

Sequenced after e01 and e02: it adds tests, so it touches the same test-count sync sites.

## 16. Risks and assumptions

- Risk: writing a log line inside the `pipeline` callback could fire before the response
  finishes on a stream. Log on the `close` event, after the pipeline completes.
- Assumption: `render.yaml` surfaces stdout. Confirm before relying on this in production.

## 17. Acceptance criteria (Gherkin)

```gherkin
Scenario: Logging is off by default
  Given PROXY_LOG_REQUESTS is unset
  When a client sends an authenticated request
  Then the response is byte-identical to the logging-disabled case
  And no request log line is written

Scenario: Logging is enabled explicitly
  Given PROXY_LOG_REQUESTS is set to a non-blank value
  When a client sends an authenticated request
  Then exactly one JSON line is written with method, path, status, and duration
  And the line contains no credential, body, or upstream hostname

Scenario: Local responses are logged too
  Given logging is enabled
  When a client sends an unauthenticated request
  Then the 401 is logged with status 401
  And the response body is unchanged

Scenario: Streaming requests log on completion
  Given logging is enabled
  When a client consumes an SSE response
  Then the log line appears when the stream closes
  And the client-visible SSE bytes are byte-identical to the upstream

Scenario: A logging failure never breaks the request
  Given logging is enabled and stdout is unavailable
  When a client sends a request
  Then the response is still correct
```

*Second clarification, added at whole-story review (2026-10-01).* Scenario 2's "the line contains
no credential" is true of the proxy's configured `NVIDIA_API_KEY` and `PROXY_AUTH_TOKEN`, of any
`authorization` header, and of any body — the closed field set is what guarantees that. It is not
true of a secret the *client* puts in the request target: `path` is logged verbatim, query string
included, so `?api_key=…` is logged. Logged deliberately, disclosed in `README.md`,
`specs/tech-architecture/tech-stack.md` and ADR 0002, and pinned by `the query string is logged
verbatim: a client-supplied query credential reaches the line`. The scenario text is left as
written because it is an acceptance criterion; §11 and §13 above carry the scope. Same treatment as
§9's corrected row above.

## 18. Out of scope

- Log levels, formats, or rotation (platform-owned).
- Logging request or response bodies.
- Aggregate counters or a stats endpoint (issue #21).
- Structured logging with a third-party library.

## 19. Verification

`npm test`, then the count sync. See `e03s01-tasks.yaml`.

## 20. References and traceability

- Issue [#9](https://github.com/ak-a-ra/nvidia-api-proxy/issues/9)
- `plans/05-opt-in-request-logging.md` — the agent-executable plan
- `server.js` — the proxy handler where the log line belongs
- `specs/product/SCOPE_LATEST.yaml` — excludes "monitoring beyond health endpoint"; this
  story stays inside that by being opt-in and off by default
