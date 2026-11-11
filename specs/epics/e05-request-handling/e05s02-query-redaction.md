* Story: e05s02
* Epic: e05 — Request handling
* Issue: [#34](https://github.com/ak-a-ra/nvidia-api-proxy/issues/34)
* Status: todo
* BCPs: 2
* Type: feat | Context: request-handling / logging / privacy

## 1. Business narrative

server.js opt-in per-request logging (PROXY_LOG_REQUESTS) writes one JSON line per request on response close. The line includes the client's own request target verbatim — pathname plus raw query string — unredacted. A secret passed in a query parameter (API key, token, PII) reaches stdout in plain text. AGENTS.md acknowledges this is disclosed behavior, but issue #34 asks for redaction so no secret ever reaches logs.

## 2. Problem statement

The log line's `path` field is `${incoming.pathname}${incoming.search}`, so any query-string value the client sends is logged in full. No redaction, no allowlist, no truncation. Operators enabling PROXY_LOG_REQUESTS inadvertently log secrets.

## 3. Actors

- Operator — enables request logging and expects no credential/PII in stdout.
- Authenticated client — sends requests possibly with query-string secrets; expects them never logged.

## 4. Preconditions

- npm test passes (249 tests).
- logRequestOnClose exists and logs closed field set ts/method/path/status/ms.

## 5. Solution and main flow

- Change logRequestOnClose to log `incoming.pathname` only, dropping `incoming.search` (query string redacted).
- Update the comment above the function to state logged fields accurately (pathname only, query string redacted).
- Keep the closed field set ts/method/path/status/ms; status is last-written status or 0.
- Per-request byte-identical forwarding unaffected (query string still forwarded upstream verbatim).

## 6. Constraints and alternative flows

- Zero runtime dependencies (Node built-ins only).
- Upstream forwarding still uses pathname + search verbatim — only the log line changes.
- Alternative: allowlist/redact specific parameter names — deferred; full query redaction is the slice.
- /health, /stats, and every local rejection still log when flag is on.

## 7. Domain glossary

- logRequestOnClose — opt-in per-request JSON logger on response close.
- pathname — URL path without query string (what gets logged after redaction).
- search — raw query string including leading ? (redacted from logs).

## 8. Interfaces and contracts

No public API change. Internal function signature unchanged: logRequestOnClose(req, res, startedAt, incoming). The logged `path` value becomes incoming.pathname instead of `${incoming.pathname}${incoming.search}`.

## 9. Configuration

No new env vars. PROXY_LOG_REQUESTS gates the logger as before.

## 10. Data and state

No new state. The only data change is dropping incoming.search from the logged object.

## 11. Invariants

- Log line never contains the client's raw query string.
- Log line field set stays closed: ts/method/path/status/ms.
- Upstream request still receives full URL including query string.
- No header, body, credential, proxy key/token, or upstream host logged.

## 12. Failure modes

- stdout EPIPE/ENOSPC inside the close handler — already swallowed by try/catch, unchanged.

## 13. Security and privacy

- Query-string secrets (API keys, tokens, PII) never written to stdout logs.
- The proxy's own auth token and upstream key never logged (pre-existing, unchanged).
- Upstream host never logged (pre-existing, unchanged).

## 14. Observability

Black-box HTTP test: send a request with a secret in the query string, capture stdout, assert the logged line's `path` is the pathname only and does not contain the secret. Also assert status/ms fields present.

## 15. Dependencies

Depends on e04 (config, budget, admission) complete. Blocks nothing new.

## 16. Risks and assumptions

- Tests spawn server.js as child process with per-test env (hermetic), per AGENTS.md testing quirks.
- Query redaction must not break path mapping or upstream forwarding.

## 17. Acceptance criteria (Gherkin)

```gherkin
Scenario: Query string redacted from request log
  Given PROXY_LOG_REQUESTS is enabled
  When a client sends GET /v1/chat/completions?sk=secret123
  Then the logged line's path is /v1/chat/completions
  And the logged line does not contain secret123
  And the logged line contains ts, method, status, ms fields

Scenario: Pathname still logged without query string
  Given PROXY_LOG_REQUESTS is enabled
  When a client sends GET /v1/models?foo=bar
  Then the logged line's path is /v1/models
```

## 18. Out of scope

- Parameter-name allowlist or selective redaction.
- Redacting query string from upstream forwarding (must stay verbatim).
- Logging body or headers.

## 19. Verification

npm test full suite green. New black-box test asserts query redaction. See e05s02-tasks.yaml.

## 20. References and traceability

- Issue [#34](https://github.com/ak-a-ra/nvidia-api-proxy/issues/34)
- server.js logRequestOnClose (~line 217)
- AGENTS.md request logging section