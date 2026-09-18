# AGENTS.md

Zero-dependency Node.js (ESM) reverse proxy for the NVIDIA NIM API. All logic lives in `server.js` (~160 lines); tests in `server.test.js`. No lint/typecheck/formatter config exists.

## Commands

- `npm test` — full suite (23 tests, Node's built-in `node --test` runner, no deps to install)
- `node --test --test-name-pattern "SIGTERM"` — run a single test by name (needs Node ≥ 20)
- `npm start` — requires `NVIDIA_BASE_URL` (exits code 1 if missing) plus `NVIDIA_API_KEY` and `PROXY_AUTH_TOKEN` (missing ones → 503 responses, not a crash)
- No CI: tests only run when you run them locally — run `npm test` before pushing

## Hard constraints

- Never add a dependency. Node built-ins only (`node:` imports); zero-deps is advertised in the README badge and `package.json`
- ESM only (`"type": "module"`) — use `import`, not `require`

## Testing quirks

- Env vars (`NVIDIA_API_KEY`, `PROXY_AUTH_TOKEN`, `NVIDIA_BASE_URL`, `PORT`) are read at **module import time** in `server.js`. Setting `process.env` and re-importing in-process does not work — tests spawn `server.js` as a child process with a per-test env and get the port back over IPC (see `startProxyServer` / `withProxy` in `server.test.js`)
- In test helpers, `null` is the "leave unset" sentinel; `undefined` collides with destructuring defaults
- Each test gets a stub upstream HTTP server; cleanups register via `t.after` (LIFO: proxy child killed before stub closed)

## server.js invariants (tests assert these)

- `duplex: "half"` is required when the request body is a stream and the response is read — omitting it throws `ERR_STREAM_DUPLICATE_STREAM_OUTPUT`
- Multi-value `set-cookie` must go through `upstream.headers.getSetCookie()`; iterating `upstream.headers` merges duplicates with `", "` and corrupts cookies
- `STRIPPED_HEADERS` intentionally includes non-hop-by-hop headers (`host`, `content-length`) — see the comment above it before "fixing" this
- Error responses never leak internals (DNS names, URLs): upstream failures are a clean `502 { error: "Bad gateway" }`
- Bare `/v1` or `/v1/` returns 404 — only `/v1/*` paths are proxied; path mapping forwards the incoming `/v1` path verbatim onto the base host (the base's own `/v1` suffix is ignored), so bases with or without `/v1` both work — see server.test.js "path mapping" tests
- `sendJson` drains the request first (`req.resume()`) so keep-alive connections survive early rejections
- SIGTERM: drop idle connections, let in-flight streams finish, force-exit after 10s (test asserts exit code 0)

## Deploy / repo notes

- `render.yaml` is the deploy config (free plan, health check `/health`) and also pins the `NVIDIA_BASE_URL` value
- Known limitations are tracked as GitHub issues — check `gh issue list` before treating current behavior as intentional or final
