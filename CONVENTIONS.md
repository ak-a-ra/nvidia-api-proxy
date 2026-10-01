# NVIDIA API Proxy - Project Conventions

## Overview

Zero-dependency Node.js reverse proxy for NVIDIA NIM API. Client apps call the proxy exactly like `https://integrate.api.nvidia.com/v1` — same paths, same bodies — but authenticate with **your** token. The real key stays server-side, never shipped to clients.

## Stack

- Language: JavaScript (ESM)
- Runtime: Node.js >= 18.14
- Package manager: npm
- Test runner: Node built-in `node --test`

## Commands

- `npm start` — runs the proxy server
- `npm test` — runs all 82 tests
- `node --test --test-name-pattern "TEST_NAME"` — run single test by name

## Defensive Code Categories

Categories this project recognizes. Only the marked ones are implemented — do not assume the rest
exist in `server.js`.

- **Timeout** — implemented: `UPSTREAM_CONNECT_TIMEOUT_SECONDS` (30), `UPSTREAM_IDLE_TIMEOUT_SECONDS` (120)
- **Graceful degradation** — implemented: missing key/token yields 503, not a crash
- Rate limit — planned, not implemented. Opt-in admission subsystem, issues #13–#22
- Retry — not implemented. Deliberately rejected: replaying a non-idempotent request is unsafe
- Circuit breaker — not implemented

## Architecture

- `server.js` — HTTP handling: server lifecycle, auth, path mapping, upstream fetch and streaming, timeouts, shutdown (~249 lines)
- `config.js` — Configuration: parsing and validation for every environment variable (~303 lines)
- `server.test.js` — Test suite (~1553 lines)
- Modules split by concern; `config.js` imports nothing from `server.js`, so configuration can be read without starting a listener

## Naming Conventions

- Files: kebab-case (`server.js`, `server.test.js`)
- Variables: camelCase
- Functions: camelCase
- Constants: UPPER_SNAKE_CASE
- Directories: kebab-case

## File Organization

- Source code in project root
- No `src/` directory
- `config.js` owns all configuration parsing — every environment variable is read and validated there, and `server.js` keeps no parsing logic
- `server.js` owns HTTP handling and calls into `config.js` once at startup
- `render.yaml` for deployment config
- No `tests/` directory - tests inline in `server.test.js`

## Never-Do List

- Never add dependencies (Node built-ins only)
- Never modify upstream API endpoint
- Never expose NVIDIA API key to clients
- Never bypass authentication
- Never hardcode secrets in code
- Never weaken, delete, or skip an existing test to make a change pass. Adding new tests is required, not forbidden — see below.

## Testing Philosophy

- Every feature has tests
- Tests assert server invariants
- Each test gets isolated upstream stub
- Env vars read at import time - tests spawn child processes
- No lint/typecheck/formatter config

**Existing tests are the invariant contract, not untouchable files.** The intent of the old
"never modify test files" rule was to stop an implementer from rewriting a failing assertion until
it agreed with the code. Adding tests, and extending an existing test's fixture setup, are normal
work. What stays forbidden: deleting a test, relaxing an assertion, adding a skip or `only`, or
loosening a stub so a real defect stops showing.

When a change adds or removes tests, sync the new total into **every** living doc that states a
count — the README badge and tip, `AGENTS.md` `npm test` bullet, this file, and the four `specs/`
docs. Re-derive the site list rather than trusting a remembered one:

```
grep -rnE 'tests(-| )?[0-9]{2}|[0-9]{2}[ -]tests?' --include='*.md' --include='*.yaml' .
```

`plans/*.md` and `docs/research/config-invariant-guard-tests.md` are dated historical records —
leave them unchanged.