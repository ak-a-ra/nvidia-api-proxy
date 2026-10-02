<div align="center">

# nvidia-api-proxy

*Put your NVIDIA API key behind a token you control*

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18.14-3c873a?style=flat-square&logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen?style=flat-square)](package.json)
[![Tests](https://img.shields.io/badge/tests-99%20passing-blue?style=flat-square)](server.test.js)

[Features](#features) • [Quick start](#quick-start) • [Configuration](#configuration) • [Endpoints](#endpoints) • [Deploy](#deploy-to-render)

</div>

A zero-dependency Node.js reverse proxy for the [NVIDIA NIM API](https://docs.api.nvidia.com/).
Client apps call the proxy exactly like `https://integrate.api.nvidia.com/v1` — same paths, same
bodies — but authenticate with **your** token. The real key stays server-side, never shipped to clients.

```mermaid
flowchart LR
    client["Client app<br/>Bearer my-secret-token"] -->|"/v1/chat/completions"| proxy["nvidia-api-proxy"]
    proxy -->|"Bearer nvapi-…<br/>(key swapped in)"| nim["integrate.api.nvidia.com"]
```

<figure>
<svg viewBox="0 0 900 260" role="img" aria-label="Client to NVIDIA via proxy request flow">
<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 L10 5 L0 10 Z" fill="currentColor"/></marker></defs>
<rect x="50" y="80" width="160" height="100" rx="8" fill="none" stroke="currentColor"/><text x="130" y="115" text-anchor="middle" font-size="13">Client</text><text x="130" y="135" text-anchor="middle" font-size="11">Bearer PROXY_TOKEN</text><text x="130" y="155" text-anchor="middle" font-size="11">/v1/*</text>
<rect x="370" y="50" width="160" height="160" rx="8" fill="none" stroke="currentColor"/><text x="450" y="75" text-anchor="middle" font-size="13">Proxy server.js</text><text x="450" y="100" text-anchor="middle" font-size="11">/health</text><text x="450" y="120" text-anchor="middle" font-size="11">auth + path</text><text x="450" y="140" text-anchor="middle" font-size="11">upstreamUrl()</text><text x="450" y="160" text-anchor="middle" font-size="11">CONNECT timeout</text><text x="450" y="180" text-anchor="middle" font-size="11">IDLE watchdog</text>
<rect x="690" y="80" width="160" height="100" rx="8" fill="none" stroke="currentColor"/><text x="770" y="115" text-anchor="middle" font-size="13">NVIDIA NIM</text><text x="770" y="135" text-anchor="middle" font-size="11">Bearer NVIDIA_API_KEY</text><text x="770" y="155" text-anchor="middle" font-size="11">https://integrate.api.nvidia.com/v1</text>
<line x1="210" y1="130" x2="370" y2="130" stroke="currentColor" marker-end="url(#arrow)"/><text x="290" y="120" text-anchor="middle" font-size="11">request</text>
<line x1="530" y1="130" x2="690" y2="130" stroke="currentColor" marker-end="url(#arrow)"/><text x="610" y="120" text-anchor="middle" font-size="11">fetch duplex half</text>
<line x1="690" y1="180" x2="530" y2="180" stroke="currentColor" marker-end="url(#arrow)"/><text x="610" y="205" text-anchor="middle" font-size="11">upstream body</text>
<line x1="210" y1="180" x2="370" y2="180" stroke="currentColor" marker-end="url(#arrow)"/><text x="290" y="205" text-anchor="middle" font-size="11">response</text>
<text x="450" y="230" text-anchor="middle" font-size="11">strip hop-by-hop + content-encoding, copy set-cookie via getSetCookie</text>
</svg>
</figure>


## Features

- 🎯 **Transparent drop-in** — point clients at the proxy, keep every path, query, and body byte-identical
- 🔑 **Key isolation** — clients send `PROXY_AUTH_TOKEN`, the proxy swaps in the real `NVIDIA_API_KEY` upstream
- ⚡ **Streaming first** — SSE responses pass through unbuffered, chunk by chunk
- 📨 **Header fidelity** — multi-value `set-cookie` preserved, hop-by-hop headers stripped both ways
- 🛡️ **Constant-time auth** — token comparison via `timingSafeEqual`, no timing side channels
- 🚀 **Deploy ready** — Render config included, graceful SIGTERM shutdown for zero-downtime deploys
- ✂️ **Client disconnect cancels upstream** — if a client aborts or disconnects mid-request, the upstream fetch is cancelled too, so abandoned calls don't hold sockets or quota
- 📦 **Zero dependencies** — Node.js built-ins only (Node >= 18.14)

## Quick start

```bash
git clone https://github.com/ak-a-ra/nvidia-api-proxy
cd nvidia-api-proxy

export NVIDIA_API_KEY="nvapi-..."          # your real NVIDIA key
export PROXY_AUTH_TOKEN="my-secret-token"  # token your clients will use
export NVIDIA_BASE_URL="https://integrate.api.nvidia.com/v1"

npm start
```

Call it like the NVIDIA API, with your own token:

```bash
curl http://localhost:10000/v1/chat/completions \
  -H "Authorization: Bearer my-secret-token" \
  -H "Content-Type: application/json" \
  -d '{"model": "meta/llama-3.1-8b-instruct", "messages": [{"role": "user", "content": "hi"}]}'
```

Any OpenAI-compatible client works the same way — just set the base URL to your proxy and use
`PROXY_AUTH_TOKEN` as the API key:

```js
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "https://your-proxy.example.com/v1",
  apiKey: "my-secret-token", // your PROXY_AUTH_TOKEN, not the NVIDIA key
});
```

> [!TIP]
> Run the test suite (99 tests, no deps needed):
> ```bash
> npm test
> ```

## Configuration

| Env var             | Required | Purpose                                                      |
| ------------------- | -------- | ------------------------------------------------------------ |
| `NVIDIA_API_KEY`    | yes      | Real NVIDIA key, sent upstream as `Bearer <key>`              |
| `PROXY_AUTH_TOKEN`  | yes      | Token clients must send as `Authorization: Bearer <token>`    |
| `NVIDIA_BASE_URL`   | yes      | Upstream base URL, e.g. `https://integrate.api.nvidia.com/v1` |
| `PORT`              | no       | Listen port (default `10000`)                                 |
| `PROXY_HOST`        | no       | Bind address (default `0.0.0.0`; use `127.0.0.1` to restrict to loopback) |
| `UPSTREAM_CONNECT_TIMEOUT_SECONDS` | no | Seconds to wait for upstream response headers (default `30`, `0` disables) |
| `UPSTREAM_IDLE_TIMEOUT_SECONDS`    | no | Seconds a response stream may stay silent before it is cut (default `120`, `0` disables; resets on every chunk) |
| `PROXY_RPM`        | no | Requests per minute, paired with `PROXY_TPM` (default `unset`; both absent or blank leaves rate limiting disabled) |
| `PROXY_TPM`        | no | Tokens per minute, paired with `PROXY_RPM` (default `unset`; exactly one of the pair set is fatal) |
| `PROXY_MAX_CONCURRENT_REQUESTS` | no | Requests allowed to run at once (default disabled — absent, blank, or `0`) |
| `PROXY_MAX_QUEUE_SIZE` | no | Requests that may wait for capacity (default `32`) |
| `PROXY_QUEUE_TIMEOUT_SECONDS` | no | Seconds a request may wait before rejection (default `30`) |
| `PROXY_SAFETY_MARGIN_PCT` | no | Headroom reserved against the rate budgets, `0`–`50` (default `5`) |
| `PROXY_MAX_BUFFERED_BODY_BYTES` | no | Ceiling on a buffered request body in rate-limit mode (default `8388608`, 8 MiB) |
| `PROXY_MODEL_LIMITS_JSON` | no | JSON object of per-model budgets keyed by exact model ID, e.g. `{"meta/llama-3.1-8b-instruct":{"rpm":10,"tpm":20000}}` (default `unset`) |
| `PROXY_LOG_REQUESTS` | no | Write one JSON line per request to stdout (default `off`; accepts `1`/`true`/`yes`/`on` or `0`/`false`/`no`/`off`, case-insensitive — any other value is fatal) |

> [!IMPORTANT]
> Every `PROXY_*` row above except `PROXY_HOST` and `PROXY_LOG_REQUESTS` is **validated and stored,
> not enforced** — the proxy parses them at startup and nothing reads them at request time, so
> setting a limit changes no traffic yet. A supplied value its rule rejects is fatal: the process
> exits with code 1 and a line on stderr naming the variable. The two exceptions are live:
> `PROXY_HOST` selects the address `server.listen` binds, and `PROXY_LOG_REQUESTS` writes the
> request lines described below.

Copy-paste-ready local setup — fill in the two values marked `FIXME`:

```bash
# ---- required ----
export NVIDIA_API_KEY="FIXME"    # your real NVIDIA key (nvapi-...)
export PROXY_AUTH_TOKEN="FIXME"  # token your clients will send
# ---- optional (defaults shown; uncomment to override) ----
# export NVIDIA_BASE_URL="https://integrate.api.nvidia.com/v1"  # pinned by render.yaml
# export PORT="10000"
# export PROXY_HOST="0.0.0.0"             # live: bind address; 127.0.0.1 restricts to loopback
# export UPSTREAM_CONNECT_TIMEOUT_SECONDS="30"  # 0 disables
# export UPSTREAM_IDLE_TIMEOUT_SECONDS="120"    # 0 disables; resets on every chunk

# ---- rate limiting (stored, not enforced yet; PROXY_RPM and PROXY_TPM are a mandatory pair) ----
# export PROXY_RPM="60"                   # requests per minute
# export PROXY_TPM="200000"                # tokens per minute
# export PROXY_MAX_CONCURRENT_REQUESTS="16"  # absent, blank, or 0 disables the ceiling
# export PROXY_MAX_QUEUE_SIZE="32"         # requests that may wait for capacity
# export PROXY_QUEUE_TIMEOUT_SECONDS="30"  # how long a request may wait
# export PROXY_SAFETY_MARGIN_PCT="5"       # headroom reserved against the budgets, 0-50
# export PROXY_MAX_BUFFERED_BODY_BYTES="8388608"  # buffered-body ceiling in rate-limit mode, 8 MiB
# export PROXY_MODEL_LIMITS_JSON='{"meta/llama-3.1-8b-instruct":{"rpm":10,"tpm":20000}}'  # per-model budgets

# ---- request logging (live, default off) ----
# export PROXY_LOG_REQUESTS="1"     # 1/true/yes/on enable; 0/false/no/off disable; unset or blank is off

npm start
```

> [!NOTE]
> With missing required vars, `/health` returns `503 { status: "unconfigured" }` and proxied calls
> return `503`. If `NVIDIA_BASE_URL` is unset or not a valid URL at startup, or a `PROXY_*` limit
> is supplied with a value its rule rejects, the process exits with code 1.

> [!NOTE]
> `PROXY_MODEL_LIMITS_JSON` is rejected whole — one malformed model entry stops the process rather
> than dropping that entry. A duplicated model key is the one accepted exception: JSON keeps the
> last one, so writing the same model twice silently loses the earlier budget.

> [!NOTE]
> `PROXY_LOG_REQUESTS` accepts only the eight words above, case-insensitively and after trimming.
> Anything else — `maybe`, `TRUE_`, a stray space inside a word — is **fatal**: the process exits
> with code 1 and one stderr line naming the variable, the rule, and the value, rather than
> starting up with the typo reinterpreted as "on".

### Request logging

Set `PROXY_LOG_REQUESTS` to `1`, `true`, `yes`, or `on` to write one JSON object per request to
stdout. `0`, `false`, `no`, and `off` keep it off, and unset or blank is off — an unset variable is
indistinguishable from today's build.

```json
{"ts":"2026-10-01T16:43:01.186Z","method":"POST","path":"/v1/chat/completions?stream=true","status":502,"ms":1204}
```

| Field | Meaning |
| ------------- | ------------------------------------------------------------------------------- |
| `ts` | ISO 8601 timestamp, taken when the line is written |
| `method` | Request method |
| `path` | Incoming path and query string, verbatim — exactly the string forwarded upstream |
| `status` | Last status written to the client, or `0` if the response was destroyed before any status was written |
| `ms` | Milliseconds from request arrival to the response closing |

Those five fields are the whole line. **A line never contains** request or response headers, the
`authorization` header value, `NVIDIA_API_KEY`, `PROXY_AUTH_TOKEN`, any request or response body, or
the upstream host and port.

That list is about the proxy's own state, not about the caller's request. `path` is the one
client-controlled field, and it is copied byte for byte — query string included, with no redaction
and no filtering of credential-shaped parameter names. A caller who puts a secret in a query
parameter (`?api_key=…` is a common convention on OpenAI-compatible gateways, and `NVIDIA_BASE_URL`
is yours to choose) puts that secret in the log. **With logging on, never pass a credential in a
URL.** The proxy's own key and token are excluded; a caller's own URL is not.

A line is written on the response's `close` event, so a streamed response is logged when the stream
completes and its client-visible bytes are unchanged. `/health` and the local rejections (`401`,
`404`, `503`) are logged like any other request. Enabling logging changes no response status, body,
or header, and a log write that fails is swallowed rather than reaching the request path. There is
no level setting, no format setting, and no rotation — the platform log owns those.

## Endpoints

| Route         | Behavior                                                                              |
| ------------- | ------------------------------------------------------------------------------------- |
| `GET /health` | `200 { status: "ok" }` when configured, `503 { status: "unconfigured" }` otherwise     |
| `ANY /v1/*`   | Proxied to upstream; requires `Authorization: Bearer <PROXY_AUTH_TOKEN>`               |
| bare `/v1` or `/v1/` | `404 { error: "Not found" }` — the proxy forwards `/v1/*` paths, not the `/v1` prefix itself |
| anything else | `404 { error: "Not found" }`                                                          |

### Path mapping

The proxy forwards the incoming path verbatim onto the base URL's host — the `/v1` a client
sends is the one the upstream sees. Any correctly-shaped base works, with or without a
trailing `/v1`:

```
client:   /v1/chat/completions?stream=true
base:     https://integrate.api.nvidia.com/v1
upstream: https://integrate.api.nvidia.com/v1/chat/completions?stream=true

client:   /v1/models
base:     https://integrate.api.nvidia.com        (origin-only works too)
upstream: https://integrate.api.nvidia.com/v1/models
```

Error responses never leak internal details (DNS names, URLs) — upstream failures return a clean
`502 { error: "Bad gateway" }`.

## Deploy to Render

The repo ships with `render.yaml` (free plan, health check on `/health`):

```bash
render blueprint launch
```

Set `NVIDIA_API_KEY` and `PROXY_AUTH_TOKEN` as secret environment variables when prompted.

> [!WARNING]
> Anyone holding `PROXY_AUTH_TOKEN` can spend your NVIDIA quota. Use a long random token and share
> it only with clients you trust.
