# NVIDIA API Proxy Tech Stack

## Stack

- **Language**: JavaScript (ESM)
- **Runtime**: Node.js >= 18.14
- **Package Manager**: npm
- **Test Runner**: Node built-in `node --test`
- **Dependencies**: 0 (zero dependencies)

## Architecture

Entry point: `server.js`. Single-file proxy with no external dependencies.

### Module Lifecycle

Environment variables read at module import; server starts listening immediately. This explains why tests spawn child processes to achieve per-test isolation.

### Request/Response Data Flow

```
Client → server.js/http.createServer
    ↓
/health? → 200/503 (no auth)
    ↓
/v1/*? → 404 if bare /v1 or /v1/
    ↓
/v1/*? → 401 if auth fails
    ↓
/v1/*? → 503 if unconfigured (no upstream contact)
    ↓
/v1/*? → fetch() → pipeline() → Client
    ↓
  upstream abort? → AbortError swallowed only for "client disconnected"
      ↑           other aborts follow normal error path
  disconnect? → upstream fetch aborted
```

## Startup Configuration

| Variable | Required | Behavior on Missing |
| --- | --- | --- |
| `NVIDIA_BASE_URL` | Yes | Exit code 1 |
| `NVIDIA_API_KEY` | Yes | Runtime 503 |
| `PROXY_AUTH_TOKEN` | Yes | Runtime 503 |
| `PORT` | No | Default 10000 |
| `UPSTREAM_CONNECT_TIMEOUT_SECONDS` | No | Default 30 (0 disables) |
| `UPSTREAM_IDLE_TIMEOUT_SECONDS` | No | Default 120 (resets per chunk, 0 disables) |

## Path Mapping

Incoming `/v1/*` path + query forwarded verbatim to `BASE_ORIGIN`. Base origin (scheme + host) extracted from `NVIDIA_BASE_URL`; all base path/query are ignored. Bare `/v1` or `/v1/` returns 404.

Examples:
- Base: `https://nvidia.com/v1` → Origin: `https://nvidia.com`; client `/v1/models` → `https://nvidia.com/v1/models`
- Base: `https://nvidia.com` → Origin: `https://nvidia.com`; client `/v1/chat/completions` → `https://nvidia.com/v1/chat/completions`

## Authentication & Credential Swap

- Client authenticates with `Authorization: Bearer <PROXY_AUTH_TOKEN>`
- SHA-256 digest + `timingSafeEqual` comparison (no length-mismatch throw or timing leak)
- Authenticated request: client token replaced with `NVIDIA_API_KEY` in upstream request
- Unauthenticated `/v1/*`: 401 `{ error: "Unauthorized" }` — never contacts upstream
- Authenticated but unconfigured `/v1/*`: 503 `{ error: "Proxy is not configured" }` — never contacts upstream
- Response body never names missing credential

## Header & Cookie Fidelity

- Shared stripping set: hop-by-hop headers plus `host` and `content-length`: `connection`, `keep-alive`, `proxy-authenticate`, `proxy-authorization`, `te`, `trailer`, `transfer-encoding`, `upgrade`, `host`, `content-length`
- `host`: re-derived per upstream call
- `content-length`: stripped during copy, selectively restored for pass-through responses and HEAD
- Response additionally strips: `content-encoding` (fetch auto-decompresses)
- Multi-value `set-cookie`: copied via `upstream.headers.getSetCookie()`, not merged with `, `
- Request `set-cookie` arrays: collapsed to one comma-joined value before forwarding

## Streaming & Timeout Behavior

- SSE: unbuffered via `pipeline()`, chunks flow immediately
- `duplex: "half"` required when request body is stream and response read
- Connect timeout: `CONNECT_TIMEOUT_SECONDS` (default 30s) aborts before headers
- Idle timeout: `IDLE_TIMEOUT_SECONDS` (default 120s), resets on each chunk, cuts silent streams
- `pipeline()` owns error path: mid-stream upstream failure destroys response, never crashes process

## Cancellation

- Client disconnect detected via `res.on("close")`
- Per-request `AbortController` aborted on disconnect
- AbortError for "client disconnected": swallowed silently, no 502 sent
- Other abort sources follow normal error path

## Shutdown

SIGTERM handler:
1. `server.closeIdleConnections()` — drop idle keep-alive sockets
2. `server.close(callback)` — graceful wait for in-flight streams; callback fires when complete
3. If callback hasn't fired by 10s: force `process.exit(0)` via unref'd timer

## Error Handling

- Local errors (401, 404, 503): generated via `sendJson()`, `req.resume()` drains first
- Upstream failures: 502 `{ error: "Bad gateway" }` — no internal details leaked
- Stream errors: `console.error`, response destroyed
- AbortError for client disconnect: swallowed silently

## API & Response Shapes

- Pass-through: upstream status, body, content-type; content-length preserved when no content-encoding
- Generated responses: lowercase-key JSON
  - 401: `{ error: "Unauthorized" }`
  - 404: `{ error: "Not found" }`
  - 502: `{ error: "Bad gateway" }`
  - 503: `{ error: "Proxy is not configured" }`
  - /health: `{ status: "ok" }` or `{ status: "unconfigured" }`
- All generated responses set `content-type: application/json; charset=utf-8` and `content-length`

## Gray Areas

- **Type Safety**: None — JavaScript dynamic typing
- **Observability**: Startup `console.log`; `console.error` for config failures, caught errors, stream errors
- **Request Size Limits**: None imposed
- **Rate Limiting**: Not implemented
- **Retries**: Not implemented
- **Circuit Breaker**: Not implemented
- **Metrics**: Not implemented
- **Upstream Health Checks**: Not implemented

## Testing

- **Test Count**: 75 tests
- **Location**: `server.test.js`
- **Runner**: `node --test` (integration tests, no coverage instrumentation/thresholds)
- **Pattern**: Process-level integration tests with local HTTP stubs
- **Isolation**: Each test spawns proxy child process + stub upstream
- **Cleanup**: LIFO via `t.after` (proxy killed before stub closed)
- **Environment**: Child processes receive per-test environment; `null` = leave unset sentinel
- **Stub Modes**: `sse`, `stall`, `slowfinish`, `silent`, `activelong`, `midabort`, `abortable`
- **No CI**: Tests only run locally

## Deployment Signal

Render config in `render.yaml`:
- Free plan, health check on `/health`
- Pinned defaults: `NVIDIA_BASE_URL=https://integrate.api.nvidia.com/v1`, connect/idle timeouts

## Known Limitations & Planning Signals

| Issue | Status | Plan |
| --- | --- | --- |
| #9: Opt-in request logging | Open | `plans/05-opt-in-request-logging.md` |
| #10: Token-side config guards | Open | `plans/03-config-guard-tests-round-2.md` |
| #12: CI workflow | Open | `plans/01-ci-github-actions.md` |

## Conventions & Constraints

- ESM only (`"type": "module"`)
- Node built-ins only: `node:http`, `node:stream`, `node:crypto`
- No lint/typecheck/formatter config
- Surgical patch philosophy
- Error messages never leak DNS names or URLs
