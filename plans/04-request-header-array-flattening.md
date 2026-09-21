# Plan 04: Fix request-header flattening (set-cookie from clients)

Category: Robustness · Priority: medium-low · Effort: small (one loop in server.js) · Introduced-by: n/a (original)

## Problem

Incoming **request** headers are copied with a plain loop (`server.js:143-146`):

```js
const headers = {};
for (const [name, value] of Object.entries(req.headers)) {
  if (!STRIPPED_HEADERS.has(name)) headers[name] = value;
}
```

`req.headers` values are typed `string | string[]`. When the value is an array, the loop stores the
array and undici's `fetch()` (called at `server.js:167`) **rejects array values** when building the
upstream request headers — in practice this manifests as the header being dropped or the request
failing, never as byte-faithful forwarding. Only one request header can realistically arrive as an
array here: **`set-cookie`** (Node's `http` docs: `set-cookie` values are "always ... set to an
array"; `cookie` arrives pre-merged into one `"; "`-joined string, and the wildcard in
`STRIPPED_HEADERS` covers hop-by-hop candidates). `server.js:147-148` then overwrites
`authorization` and `accept-encoding` with scalars, so the affected surface is exactly
`set-cookie`.

## Evidence

- `server.js:143-148` — copy loop + scalar overwrites; no array handling anywhere in the file's
  request direction.
- Contrast: the **response** direction already solved the multi-value problem — `server.js:184-190`
  iterates `upstream.headers` with `set-cookie` handled via `getSetCookie()` because "forEach over
  Headers merges duplicates with ', '".
- Node docs, `http.IncomingMessage.headers`: duplicate `set-cookie` headers are exposed as an array.
- Not covered by any test: the suite exercises **response** `set-cookie` (`server.test.js:312-322`)
  but never sends a request-side `set-cookie` header.

## Goal

Request headers copied into `headers` are always scalars: arrays joined with `", "`. Upstream
receives exactly what it would have received from the original client, keeping the proxy a
transparent drop-in.

## Implementation

**`server.js`** — replace the copy loop (`server.js:143-146`) with:

```js
    // Node's req.headers object is string | string[] per entry. undici's
    // fetch() rejects array values when building the upstream request, so
    // join any array into its comma form. In practice only set-cookie can
    // carry an array value at this point (cookie arrives pre-merged with
    // "; " by Node), and the wildcard in STRIPPED_HEADERS covers the
    // remaining hop-by-hop candidates.
    const headers = {};
    for (const [name, value] of Object.entries(req.headers)) {
      const v = Array.isArray(value) ? value.join(", ") : value;
      if (!STRIPPED_HEADERS.has(name)) headers[name] = v;
    }
```

- Do **not** restructure the loop; do not touch `STRIPPED_HEADERS`, the `authorization` overwrite
  (`server.js:147`), or `accept-encoding` (`server.js:148`). All keep exact semantics.
- Conventions: ESM, no new imports, double quotes, comment above the code, surgical patch only.

## Tests

One new test in `describe("proxy")` (`server.test.js:197`+), modeled on
`gzip request body ... reach the upstream unchanged` (l. 538-554), which asserts raw upstream
observations via `receivedRequests`. The stub records only a few request headers
(`authorization`, `content-encoding`) at `server.test.js:19-26`, so first add
`setCookie: req.headers["set-cookie"]` to that `receivedRequests.push({...})` object, then add:

```js
  test("request set-cookie header forwarded to upstream without corruption", async (t) => {
    const { proxy, receivedRequests } = await withProxy(t, { body: "{}" });
    const res = await proxiedFetch(proxy.port, "/v1/models", {
      headers: {
        authorization: "Bearer pt",
        // Node exposes a request set-cookie as an array on req.headers;
        // undici rejects array values if the proxy copies it as-is
        "set-cookie": "sid=abc; Path=/",
      },
    });
    assert.equal(res.status, 200);
    assert.equal(receivedRequests[0].setCookie, "sid=abc; Path=/");
  });
```

- Assertion is exact string equality on what the upstream received — pins both halves of the fix:
  not rejected, not reformatted.

**Test-count sync (mandatory, all three places):** suite goes 30 → 31. README.md badge (~line 9,
URL-encoded), README.md tip (~line 70), AGENTS.md `npm test` bullet.

## Docs

None required — README already documents header fidelity generically
("multi-value set-cookie preserved"), which stays true.

## Existing tests you must not break

- All 30 current tests; the change is additive inside one loop. In particular
  `POST body forwarded byte-identical...` (l. 198-219) and the gzip test (l. 538-554) exercise the
  same copy path and must stay green.
- The `content-length` / `content-encoding` restoration logic downstream (`server.js:198-208`) must
  remain byte-identical — do not touch it.

## Verification

1. `npm test` → 31 passing.
2. `git diff` scope: `server.js` (one loop + comment), `server.test.js` (stub field + 1 test),
   README.md (2 count spots), AGENTS.md (1 count spot).

## Maintenance note

If Node ever changes the `req.headers` shape (legacy but stable API), revisit. Response-direction
multi-value handling (`getSetCookie`, `server.js:184-190`) is the sibling pattern — keep the two
comments consistent when editing either.

## Escape hatches

- If your Node build yields only strings from `Object.entries(req.headers)` → the guard makes the
  fix a no-op there; report the observation, keep the defensive join.
- If the `receivedRequests.push` site moved (another plan merged first) → re-locate by searching
  `receivedRequests.push` and add the field there.
- If any existing test fails → STOP, report.

