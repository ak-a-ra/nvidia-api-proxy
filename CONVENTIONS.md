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
- `npm test` — runs all 33 tests
- `node --test --test-name-pattern "TEST_NAME"` — run single test by name

## Defensive Code Categories

- Rate limit
- Retry
- Circuit breaker
- Timeout
- Graceful degradation

## Architecture

- `server.js` — Main reverse proxy logic (~160 lines)
- `server.test.js` — Test suite (~550 lines)
- Key modules organized by concern (auth, routing, upstream handling)

## Naming Conventions

- Files: kebab-case (`server.js`, `server.test.js`)
- Variables: camelCase
- Functions: camelCase
- Constants: UPPER_SNAKE_CASE
- Directories: kebab-case

## File Organization

- Source code in project root
- No `src/` directory
- `render.yaml` for deployment config
- No `tests/` directory - tests inline in `server.test.js`

## Never-Do List

- Never add dependencies (Node built-ins only)
- Never modify upstream API endpoint
- Never expose NVIDIA API key to clients
- Never bypass authentication
- Never hardcode secrets in code
- Never modify test files (tests define invariants)

## Testing Philosophy

- Every feature has tests
- Tests assert server invariants
- Each test gets isolated upstream stub
- Env vars read at import time - tests spawn child processes
- No lint/typecheck/formatter config