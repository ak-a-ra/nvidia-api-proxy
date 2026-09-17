# nvidia-api-proxy

Reverse proxy for the NVIDIA NIM API. Exposes your NVIDIA API key behind a
Bearer token you control, so client apps never see the real key.

## How it works

- Clients call this proxy the same way they would call
  `https://integrate.api.nvidia.com/v1` — same paths, same bodies.
- The proxy authenticates clients with `PROXY_AUTH_TOKEN`, replaces their
  `Authorization` header with the real `NVIDIA_API_KEY`, and forwards the
  request to `NVIDIA_BASE_URL`.
- `/v1/...` paths map onto the configured base URL with its `/v1` segment
  removed, so any base ending in `/v1` works.
- Streaming (SSE) responses pass through unbuffered. Multi-value `set-cookie`
  headers are preserved.

## Configuration

| Env var           | Required | Purpose                                     |
| ----------------- | -------- | ------------------------------------------- |
| `NVIDIA_API_KEY`  | yes      | Real NVIDIA key, sent upstream              |
| `PROXY_AUTH_TOKEN`| yes      | Token clients must send as `Bearer <token>` |
| `NVIDIA_BASE_URL` | yes      | Upstream base, e.g. `https://integrate.api.nvidia.com/v1` |
| `PORT`            | no       | Listen port (default `10000`)               |

Missing required vars: `/health` returns `503`, proxied calls return `503`,
and startup exits 1 if `NVIDIA_BASE_URL` is unset.

## Endpoints

- `GET /health` — `{ status: "ok" }` (200) or `{ status: "unconfigured" }` (503)
- `ANY /v1/*` — proxied to upstream; requires `Authorization: Bearer <PROXY_AUTH_TOKEN>`
- anything else — 404

## Deploy

Configured for Render (`render.yaml`, free plan, health check on `/health`).
SIGTERM on deploy stops new connections and lets in-flight streams finish.
