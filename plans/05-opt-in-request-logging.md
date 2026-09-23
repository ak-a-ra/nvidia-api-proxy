# Plan 05: Opt-in request logging via PROXY_LOG_REQUESTS

Category: Observability/DX · Priority: medium-low · Effort: medium (server.js + 2 tests + count sync + docs)

## Problem

The proxy is silent in operation: only errors hit `console.error`. On a deployed Render instance
there is no way to answer "did my client's call reach the upstream, and with what status?" without
externally observable side effects. Debugging client integrations (wrong token, wrong path,
upstream 4xx) currently requires guesswork.

Full always-on logging would be wrong here: the proxy handles streaming responses and hostile
traffic; unconditional per-request logging adds noise and can leak credential-adjacent data
(authorization headers must **never** be logged). So: opt-in via env var, one line per request,
no secrets.

## Evidence

- `server.js` logging surface today: `console.log` on startup (l. 253), `console.error` in
  `validateConfig` (l. 15, 21), stream-error (l. 237), and generic catch (l. 242). Nothing per-request.
- Timeout knobs (`readSeconds`, `server.js:46-59`) establish the exact pattern for env-tunable
  operational knobs: read at import, null/empty → fallback, invalid → fallback. Reuse it.
- No GitHub issue open on this (`AGENTS.md`, 2026-09-18: all closed). Original finding.

## Goal

When `PROXY_LOG_REQUESTS` is set to a truthy value (`1`, `true`, `yes`, `on`, case-insensitive),
each proxied request logs one line:

```
[req] POST /v1/chat/completions 200 1234ms
```

(streams that end in an error get a status of `-`). `/health`, local 401/404/503, and upstream
failures all log too, since they are exactly what debugging needs. When unset/false: zero output
change, zero overhead beyond one boolean check.

## Implementation

**`server.js`** — three surgical insertions:

1. Below the `readSeconds` exports (`server.js:52-59`), add:

```js
// Opt-in per-request logging. Off by default: the proxy serves streaming
// traffic and must stay quiet unless asked. Truthy values follow the
// common 1/true/yes/on set, case-insensitive.
const LOG_REQUESTS = /^(1|true|yes|on)$/i.test(process.env.PROXY_LOG_REQUESTS ?? "");
```

2. In the request handler, right after the `incoming` URL is parsed (`server.js:117`) — so every
   branch (health, 401, 404, 503, proxied) is covered by one timer — add:

```js
    const startedAt = Date.now();
```

3. At the very end of the handler body (the line before the closing of the try block that wraps the
   whole handler, i.e. after the pipeline setup, currently ending ~`server.js:240`), add:

```js
    if (LOG_REQUESTS) {
      console.log(
        `[req] ${method} ${incoming.pathname}${incoming.search} ${res.statusCode} ${Date.now() - startedAt}ms`
      );
    }
```

   Because this line sits at the end of the `try` block **after the streaming `pipeline()` setup**,
   for streamed responses it fires when headers are written, not when the stream ends — status is
   accurate, duration is time-to-headers. Document that in the comment; do not try to hook
   `res.on("finish")` (adds a listener per request even when logging is off — rejected for
   simplicity). If the executor finds a cleaner zero-cost-when-off hook, prefer
   `res.on("finish", ...)` **registered inside `if (LOG_REQUESTS)`** — that is the one acceptable
   deviation.

Non-negotiables:

- **Never log `authorization` or any header values.** Path + method + status + duration only.
  This keeps the "scrubbed responses" guarantee of `CONTEXT.md` intact on the logging surface.
- Keep `sendJson` early-returns working: the log line must be at handler end, not inside each
  branch — one insertion, not many.
- Conventions: ESM, no new imports, double quotes, comment above each insertion, surgical patch.

## Tests

Two tests in `describe("proxy")`, using `proxyEnv` (flows verbatim into the child env):

```js
  test("PROXY_LOG_REQUESTS off by default logs nothing per request", async (t) => {
    // stdout/stderr of the proxy child are "ignore" (server.test.js:105), so
    // run the child with piped stdio for this test: reuse startProxyServer
    // via withProxy, then assert via the child's behavior instead — simplest
    // robust check: a request succeeds and the suite's stdio stays silent.
    const { proxy } = await withProxy(t, { body: "{}" });
    const res = await proxiedFetch(proxy.port, "/v1/models", {
      headers: { authorization: "Bearer pt" },
    });
    assert.equal(res.status, 200);
  });

  test("PROXY_LOG_REQUESTS=1 enables one [req] line per request", async (t) => {
    const { proxy } = await withProxy(t, {
      body: "{}",
      proxyEnv: { PROXY_LOG_REQUESTS: "1" },
    });
    const res = await proxiedFetch(proxy.port, "/v1/models", {
      headers: { authorization: "Bearer pt" },
    });
    assert.equal(res.status, 200);
    assert.equal(proxy.child.exitCode, null);
  });
```

**Required before finishing:** `startProxyServer` spawns the child with
`stdio: ["ignore", "ignore", "ignore", "ipc"]` (`server.test.js:105`), so stdout cannot be asserted
as written today. Modify `startProxyServer` (or add a wrapper) to pipe stdout when
`extraEnv.PROXY_LOG_REQUESTS` is set, collect `child.stdout` chunks, and strengthen the two tests:

- off → `collected.length === 0` after a successful request;
- on → `collected.join("")` includes `[req] POST /v1/models 200` and does **not** include
  `Bearer` or the token value `pt` (secrets-stay-out-of-logs assertion).

If piping proves invasive, the weak assertions above are the floor — but attempt the strong ones
first.

**Test-count sync (mandatory, all three places):** suite goes 30 → 32. README.md badge (~line 9),
README.md tip (~line 70), AGENTS.md `npm test` bullet.

**Superseded (2026-09-23):** "three places" is wrong — the rule is every living doc that states a
count (currently 34). The 30 → 32 figure and the line numbers above are stale; read the real total
from `node --test` and grep the sites, per `AGENTS.md` "Testing quirks".

## Docs

- README Configuration table: add row
  `| PROXY_LOG_REQUESTS | no | One log line per request ([req] method path status duration). Off by default |`.
- README copy-paste block: add commented example
  `# export PROXY_LOG_REQUESTS="1"  # request log lines for debugging`.
- AGENTS.md: mention the new env var under server.js invariants only if you touched behavior
  others rely on — one bullet: "`PROXY_LOG_REQUESTS` gates per-request logging; never log
  authorization values."

## Existing tests you must not break

- All 30 current tests: logging off by default means zero behavior change for them.
- `SIGTERM drops idle connections and exits promptly` (l. 466-477) is timing-sensitive; your
  insertion must not add per-request listeners (see the `res.on("finish")` note).

## Verification

1. `npm test` → 32 passing.
2. Manual: `PROXY_LOG_REQUESTS=1` + `npm start`, then a `curl` to `/health` and one proxied call →
   two `[req]` lines, no token material in output.
3. `git diff` scope: `server.js` (3 insertions), `server.test.js` (stdio tweak + 2 tests),
   README.md (2 count spots + 2 doc lines), AGENTS.md (1 count spot + optional bullet).

## Maintenance note

If structured logging is ever wanted (JSON lines), build on `LOG_REQUESTS` rather than replacing
it — the opt-in gate and the no-secrets rule are the durable parts.

## Escape hatches

- If a test proves the `[req]` line fires before `res.statusCode` is final for **non-streamed**
  responses (it must be final there) → STOP, report; the insertion point needs review.
- If adding stdout piping breaks the SIGTERM test → keep weak assertions, note the tradeoff in the PR.
- If `gh issue list` shows a logging feature request open → STOP, link it, align scope.

