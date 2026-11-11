# Task Brief — e05s02 Query Redaction (issue #34 P1)

## Story
Log pathname only, redact query string from opt-in request logs.

## Constraints (hard)
- Zero runtime dependencies (Node built-ins only). ESM only.
- npm test plain `node --test`; must stay green.
- `npm run check` (lint + typecheck + format:check) must pass before commit.
- Never weaken/delete tests.
- Test count synced in all living docs if suite size changes (currently 249).
- Config hermeticity: new env vars must be added to CONFIG_ENV_VARS in same commit as config.js.
- Hermetic child-process env: server.js spawned per test with per-test env overrides.

## Story spec
`specs/epics/e05-request-handling/e05s02-query-redaction.md` (20 sections).

## Tasks (e05s02-tasks.yaml)
t01: Locate logRequestOnClose, confirm path includes search/query.
t02: Change to pathname only (redact query), update comment.
t03: Add black-box HTTP test — query-string secret not logged, closed field set kept.
t04: Run full suite, lint, format:check.

## Implementation scope
- server.js `logRequestOnClose` (line ~217): log `incoming.pathname` only, drop `incoming.search`.
- Update comment above function to state logged fields accurately (pathname only, query redacted).
- Upstream forwarding unchanged (pathname + search verbatim).

## Tests to add
Black-box HTTP test: send GET /v1/chat/completions?sk=secret123 with PROXY_LOG_REQUESTS=1, capture stdout, assert logged `path` is /v1/chat/completions and does not contain secret123; assert ts/method/status/ms present.

## Deliverables
- IMPLEMENTER_REPORT_E05S02.md (status, commits, test summary, concerns).
- All e05s02-tasks.yaml tasks marked passing.
- npm test green, npm run check clean.
- state.yaml handoff → reviewer-e05s02.

## Orchestrator rules
Lead never writes implementation code. Dispatch implementer → read report → dispatch reviewer → resolve findings.

## Repo paths
Main repo: /data/data/com.termux/files/home/projects/nvidia-api-proxy
Worktree: /data/data/com.termux/files/home/projects/e05s02-query-redaction
Base commit: bbcc029 (e05s01 complete, count 248).