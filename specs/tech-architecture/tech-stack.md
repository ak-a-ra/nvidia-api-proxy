# NVIDIA API Proxy Tech Stack

## Stack

- **Language**: JavaScript (ESM)
- **Runtime**: Node.js >= 18.14
- **Package Manager**: npm
- **Test Runner**: Node built-in `node --test`
- **Dependencies**: 0 (zero dependencies)

## Architecture

Entry point: `server.js`. Two source modules and no external dependencies: `server.js` owns HTTP handling, `config.js` owns every configuration rule.

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

| Variable | Required | Default | Invalid value | Rule |
| --- | --- | --- | --- | --- |
| `NVIDIA_BASE_URL` | Yes | — | Fatal, exit 1 | Missing, unparseable, or not http(s) |
| `NVIDIA_API_KEY` | Yes | — | Degrades, never fatal | Absent or whitespace-only → `unconfigured` → runtime 503 |
| `PROXY_AUTH_TOKEN` | Yes | — | Degrades, never fatal | Absent or whitespace-only → `unconfigured` → runtime 503 |
| `PORT` | No | `10000` | Not validated | Only `Number()` coercion; a non-numeric value becomes `NaN` and `listen()` throws |
| `UPSTREAM_CONNECT_TIMEOUT_SECONDS` | No | `30` (`0` disables) | Falls back to default | Empty, whitespace, non-finite, or negative → fallback |
| `UPSTREAM_IDLE_TIMEOUT_SECONDS` | No | `120` (resets per chunk, `0` disables) | Falls back to default | Same lenient `readSeconds` rule — the named exception to strict validation |
| `PROXY_HOST` | No | `0.0.0.0` | Not parsed | Absent, empty, or whitespace-only → default; any other value reaches `listen()` verbatim, untrimmed. An unbindable address fails as a `listen()` error event, not as a named-variable message |
| `PROXY_RPM` | No | unset | Fatal, exit 1 | Mandatory pair with `PROXY_TPM`. Non-blank must be a positive integer, decimal digits only. Both absent or blank → rate limiting disabled |
| `PROXY_TPM` | No | unset | Fatal, exit 1 | Same pair rule, applied symmetrically |
| `PROXY_MAX_CONCURRENT_REQUESTS` | No | disabled | Fatal, exit 1 | Absent, blank, or `0` disables the ceiling; otherwise a positive integer, decimal digits only |
| `PROXY_MAX_QUEUE_SIZE` | No | `32` | Fatal, exit 1 | Positive integer, decimal digits only; `0` is fatal |
| `PROXY_QUEUE_TIMEOUT_SECONDS` | No | `30` | Fatal, exit 1 | Positive integer, decimal digits only; `0` is fatal |
| `PROXY_SAFETY_MARGIN_PCT` | No | `5` | Fatal, exit 1 | Integer `0`–`50`, decimal digits only |
| `PROXY_MAX_BUFFERED_BODY_BYTES` | No | `8388608` (8 MiB) | Fatal, exit 1 | Positive integer, decimal digits only; `0` is fatal |
| `PROXY_MODEL_LIMITS_JSON` | No | unset | Fatal, exit 1 | Rejected whole, never partially, when supplied: bad JSON, non-object root, blank/padded/control-character model key, non-object entry, entry supplying neither `rpm` nor `tpm`, unknown field in an entry, non-positive-integer budget |

All nine `PROXY_*` operational variables are **validated and stored, not enforced**. Only
`config.host` is read after parsing, by `server.listen`; the rate pair, ceilings, and per-model
map sit on the config object until the later slices act on them. An operator who sets a limit
today sees no change in traffic. Regime rationale: `docs/adr/0002-config-operational-fail-fast.md`.

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
- **Request Size Limits**: None imposed — `PROXY_MAX_BUFFERED_BODY_BYTES` is validated and stored, not applied
- **Rate Limiting**: Not implemented — the eight limit variables are validated at startup and never read again; `PROXY_HOST` only selects the bind address
- **Retries**: Not implemented
- **Circuit Breaker**: Not implemented
- **Metrics**: Not implemented
- **Upstream Health Checks**: Not implemented

## Testing

- **Test Count**: 84 tests
- **Location**: `server.test.js`
- **Runner**: `node --test` (integration tests, no coverage instrumentation/thresholds)
- **Pattern**: Process-level integration tests with local HTTP stubs
- **Isolation**: Each test spawns proxy child process + stub upstream
- **Cleanup**: LIFO via `t.after` (proxy killed before stub closed)
- **Environment**: Child processes receive per-test environment; `null` = leave unset sentinel
- **Stub Modes**: `sse`, `stall`, `slowfinish`, `silent`, `activelong`, `midabort`, `abortable`
- **CI**: `.github/workflows/ci.yml` runs `npm test` on Node 20, 22, and 24 (push to `main` and every pull request)

## Deployment Signal

Render config in `render.yaml`:
- Free plan, health check on `/health`
- Pinned `NODE_VERSION=24`, matching a CI-tested leg
- Pinned defaults: `NVIDIA_BASE_URL=https://integrate.api.nvidia.com/v1`, connect/idle timeouts

## Known Limitations & Planning Signals

| Issue | Status | Plan |
| --- | --- | --- |
| #9: Opt-in request logging | Open | `plans/05-opt-in-request-logging.md` |
| #10: Token-side config guards | Closed | `plans/03-config-guard-tests-round-2.md` (`2b13861`) |
| #12: CI workflow | Closed | `plans/01-ci-github-actions.md` (`1bc34cd`) |

## Conventions & Constraints

- ESM only (`"type": "module"`)
- Node built-ins only: `node:http`, `node:stream`, `node:crypto`
- No lint/typecheck/formatter config
- Surgical patch philosophy
- Error messages never leak DNS names or URLs
