# Plan 04: Fix request-header flattening (set-cookie from clients)

Category: Robustness · Priority: low · Effort: small (one loop in server.js) · Introduced-by: n/a (original)

**Revision note (2026-09-23, tree at `e1a482d`):** this plan was rewritten after its original
claims were measured against the live runtime. The original asserted that undici *rejects* array
header values. Measured on Node v24.18.0 / undici 7.28.0: it does not. The corrected problem,
goal, and test appear below; raw observations are in "Measured evidence". Do **not** reintroduce
the "undici rejects" framing in code comments or test names.

## Problem (measured, corrected)

`server.js:153-156` copies incoming request headers with a plain loop:

```js
const headers = {};
for (const [name, value] of Object.entries(req.headers)) {
  if (!STRIPPED_HEADERS.has(name)) headers[name] = value;
}
```

`req.headers` values are `string | string[]`. `set-cookie` is the only request header Node exposes
as an array, and `STRIPPED_HEADERS` (`server.js:76-87`) does not contain it, so it reaches this
loop intact. The `authorization` / `accept-encoding` overwrites (`server.js:157-158`) are scalars
and unaffected.

The loop stores the array as-is and hands it to `fetch()` at `server.js:181`. Measured: `fetch()`
**accepts** the array, the request succeeds (HTTP 200), and the header is **silently collapsed**
into a single comma-joined value with **no space** after the comma. The entire observable
difference between the current code and this fix is that separator:

```
current code     ->  ["sid=abc; Path=/,theme=dark; Path=/"]
after this fix   ->  ["sid=abc; Path=/, theme=dark; Path=/"]
```

So the defect is a silent reshaping, not a rejection.

## Goal (corrected)

Normalize request header values to scalars before they reach `fetch()`, so the proxy emits what
undici's own canonical API emits. Measured: `Headers.append("set-cookie", ...)` twice — the
idiomatic multi-value path — yields exactly `"sid=abc; Path=/, theme=dark; Path=/"`,
byte-identical to `array.join(", ")`. The fix aligns the copy loop with that canonical join and
removes a dependency on undocumented array coercion.

**Explicitly not the goal, and not achievable here:** byte-faithful forwarding of N separate
`set-cookie` request headers. Measured: raw array, `join(", ")`, `Headers.append` ×2, and
`new Headers([pairs])` **all** collapse to one comma-joined header. Fidelity would require
replacing `fetch()` with `node:http` for the upstream call — a rewrite, out of scope. Do not write
comments claiming the client's headers reach the upstream unchanged.

## Implementation

**`server.js`** — replace the copy loop at `server.js:153-156` with:

```js
    // Node's req.headers values are string | string[]. undici accepts an array
    // but silently collapses it into one comma-joined value, so normalize to a
    // scalar here and join with ", " — byte-identical to what
    // Headers.append("set-cookie", ...) produces. In practice only set-cookie can
    // arrive as an array (cookie is pre-merged by Node; STRIPPED_HEADERS covers
    // the hop-by-hop candidates). The response direction solves its sibling
    // problem with getSetCookie() below.
    const headers = {};
    for (const [name, value] of Object.entries(req.headers)) {
      const v = Array.isArray(value) ? value.join(", ") : value;
      if (!STRIPPED_HEADERS.has(name)) headers[name] = v;
    }
```

- Do **not** restructure the loop, rename variables, or touch `STRIPPED_HEADERS`
  (`server.js:76-87`), the `authorization` overwrite (`server.js:157`), `accept-encoding`
  (`server.js:158`), the response copy / `getSetCookie()` block (`server.js:197-203`), or the
  content-length restoration block (`server.js:212-222`). Those keep exact semantics.
- Conventions: ESM, no new imports, double quotes, comment above the code, surgical patch only.

## Tests

Two measured facts constrain the test:

1. `proxiedFetch` (`server.test.js:158-160`) is plain `fetch`, and undici **cannot** send two
   `set-cookie` request headers — every spelling collapses to one. So `proxiedFetch` cannot
   exercise this fix at all. Build the request with `node:http`: `http.request(...)` plus
   `r.setHeader("set-cookie", [a, b])`, which does put two headers on the wire.
2. Node reports an incoming `set-cookie` **always as an array**, so the stub's recorded value must
   be compared with `assert.deepEqual`, never `assert.equal` against a string. A single header is
   recorded as `["sid=abc; Path=/"]`. The original plan's
   `assert.equal(receivedRequests[0].setCookie, "sid=abc; Path=/")` therefore fails against both
   fixed and unfixed code — it was red on arrival.

First add `setCookie: req.headers["set-cookie"]` to the `receivedRequests.push({...})` object at
`server.test.js:19-26` (that site has not moved), then add to `describe("proxy")`
(`server.test.js:221`):

```js
  test("request set-cookie headers reach the upstream as one comma-joined header", async (t) => {
    const { proxy, receivedRequests } = await withProxy(t, { body: "{}" });
    // proxiedFetch cannot be used here: undici collapses duplicate set-cookie
    // request headers into one before they leave, so node:http builds the wire
    // request to guarantee two headers actually arrive at the proxy.
    const res = await new Promise((resolve, reject) => {
      const r = http.request(
        {
          host: "127.0.0.1",
          port: proxy.port,
          path: "/v1/models",
          method: "GET",
          headers: { authorization: "Bearer pt" },
        },
        (response) => {
          response.resume();
          response.on("end", () => resolve(response));
        }
      );
      r.on("error", reject);
      // Two headers so the pre-fix and post-fix bytes differ: unfixed, undici
      // coerces the array to "a,b"; fixed, the loop joins to "a, b".
      r.setHeader("set-cookie", ["sid=abc; Path=/", "theme=dark; Path=/"]);
      r.end();
    });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(receivedRequests[0].setCookie, [
      "sid=abc; Path=/, theme=dark; Path=/",
    ]);
  });
```

`http` is already imported at `server.test.js:1`; `withProxy` is at `server.test.js:138`.

- This assertion pins both halves: the request was not rejected (status 200) and the join
  separator is `", "` — the single byte pair that distinguishes fixed from unfixed code. It must
  fail against the unpatched loop (which yields `",theme"`) and pass after.
- A single-header test was deliberately **not** added: with one header, fixed and unfixed code both
  produce `["sid=abc; Path=/"]`, so it would pin nothing.

**Test-count sync (mandatory, all three places):** suite goes **33 → 34**. Read the real total from
`npm test` output before editing — do not assume 33.

- `README.md:9` — badge `tests-33%20passing` → `tests-34%20passing`
- `README.md:86` — tip "(33 tests, no deps needed)" → 34
- `AGENTS.md:89` — `npm test` bullet "(33 tests, ...)" → 34

## Docs

None required — README's header-fidelity claim describes the **response** direction
(`server.test.js:336`), which is untouched by this plan.

## Existing tests you must not break

- All 33 current tests. The change is additive inside one loop, but
  `POST body forwarded byte-identical...` and the gzip test (`server.test.js:562-576`) exercise
  the same copy path and must stay green.
- The response-side `set-cookie` test (`server.test.js:336`) and the content-length restoration
  tests must remain byte-identical — do not touch `server.js:212-222`.

## Verification

1. `npm test` → **34** passing, 0 failing.
2. `git diff` scope is exactly: `server.js` (one loop + its comment), `server.test.js` (one stub
   field + one test), `README.md` (2 count spots), `AGENTS.md` (1 count spot). Nothing else.

## Measured evidence (2026-09-23, Node v24.18.0, undici 7.28.0)

Stub upstream recording `req.headers["set-cookie"]`, with the real `server.js` spawned and
`NVIDIA_BASE_URL` pointed at that stub:

```
1 x set-cookie   proxy 200   upstream saw ["sid=abc; Path=/"]
2 x set-cookie   proxy 200   upstream saw ["sid=abc; Path=/,theme=dark; Path=/"]
1 x cookie with a comma in Expires
                 proxy 200   upstream saw ["sid=abc; Expires=Wed, 21 Oct 2015 07:28:00 GMT"]
```

Header-injection API comparison against the same stub:

```
array.join(', ') -> scalar string       ["sid=abc; Path=/, theme=dark; Path=/"]
raw array into fetch (current code)     ["sid=abc; Path=/,theme=dark; Path=/"]
Headers.append(set-cookie) x2           ["sid=abc; Path=/, theme=dark; Path=/"]
Headers init array-of-pairs             ["sid=abc; Path=/, theme=dark; Path=/"]
```

Keep in mind: no client in the wild sends request-side `set-cookie` (it is a response header), so
the real-world impact of this plan is hygiene and forward-compatibility, not a user-visible bug.
That is why the priority is `low`.

## Maintenance note

If Node ever changes the `req.headers` shape (legacy but stable API), revisit. Response-direction
multi-value handling (`getSetCookie`, `server.js:197-203`) is the sibling pattern — keep the two
comments consistent when editing either.

## Escape hatches

- If any current test fails → STOP and report; do not adjust an existing test to fit.
- If the new test passes against the **unpatched** loop, the array never reached `fetch()` on your
  runtime — report the observation and keep the defensive join.
- Line numbers have drifted twice already (`acf146c`, `e1a482d`). If a ref does not match, re-locate
  by searching the code text (`for (const [name, value] of Object.entries(req.headers))`,
  `receivedRequests.push`, `describe("proxy")`), never by the numbers above.
