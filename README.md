<div align="center">

# nvidia-api-proxy

*Put your NVIDIA API key behind a token you control*

[Features](#features) • [Quick start](#quick-start) • [Configuration](#configuration) • [Deploy](#deploy-to-render)

</div>

A zero-dependency Node.js reverse proxy for the [NVIDIA NIM API](https://docs.api.nvidia.com/).
Client apps call the proxy exactly like `https://integrate.api.nvidia.com/v1` — same paths, same
bodies — but authenticate with **your** token. The real key stays server-side, never shipped to clients.

## Features

- **Transparent drop-in** — point clients at the proxy, keep every path, query, and body byte-identical
- **Key isolation** — clients send `PROXY_AUTH_TOKEN`, the proxy swaps in the real `NVIDIA_API_KEY` upstream
- **Streaming first** — SSE responses pass through unbuffered, chunk by chunk
- **Header fidelity** — multi-value `set-cookie` preserved, hop-by-hop headers stripped both ways
- **Constant-time auth** — token comparison via `timingSafeEqual`, no timing side channels
- **Deploy ready** — Render config included, graceful SIGTERM shutdown for zero-downtime deploys
- **Zero dependencies** — Node.js built-ins only (Node >= 18.14)

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

> [!TIP]
> Run the test suite (14 tests, no deps needed):
> ```bash
> npm test
> ```

## Configuration

| Env var             | Required | Purpose                                                      |
| ------------------- | -------- | ------------------------------------------------------------ |
| `NVIDIA_API_KEY`    | yes      | Real NVIDIA key, sent upstream as `Bearer <key>`              |
| `PROXY_AUTH_TOKEN`  | yes      | Token clients must send as `Authorization: Bearer <token>`    |
| `NVIDIA_BASE_URL`   | yes      | Upstream base URL, e.g. `https://integrate.api.nvidia.com/v1` |
| `PORT`              | no       | Listen port (default `10000`, binds `0.0.0.0`)                |

> [!NOTE]
> With missing required vars, `/health` returns `503 { status: "unconfigured" }` and proxied calls
> return `503`. If `NVIDIA_BASE_URL` is unset at startup, the process exits with code 1.

## Endpoints

| Route        | Behavior                                                                                     |
| ------------ | -------------------------------------------------------------------------------------------- |
| `GET /health`| `200 { status: "ok" }` when configured, `503 { status: "unconfigured" }` otherwise            |
| `ANY /v1/*`  | Proxied to upstream; requires `Authorization: Bearer <PROXY_AUTH_TOKEN>`                      |
| anything else| `404 { error: "Not found" }`                                                                  |

### Path mapping

Incoming `/v1/...` paths map onto the configured base URL with its trailing `/v1` segment removed,
so any correctly-shaped base works:

```
client:  /v1/chat/completions?stream=true
base:    https://integrate.api.nvidia.com/v1
upstream: https://integrate.api.nvidia.com/chat/completions?stream=true
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
