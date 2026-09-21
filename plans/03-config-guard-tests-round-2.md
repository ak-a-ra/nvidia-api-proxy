# Plan 03: Close config-invariant test gaps

Category: Tests · Priority: medium · Effort: small (2 tests + count sync) · Introduced-by: n/a (coverage debt)

## Problem

Two invariants from ADR 0001 are enforced in `server.js` but not pinned by tests, so a future
refactor could silently break them:

1. **Whitespace-only `PROXY_AUTH_TOKEN` counts as missing** — `server.js:28` uses
   `!env.PROXY_AUTH_TOKEN?.trim()`. The token side of the `.trim()` has **no dedicated test**:
   ADR 0001 §Compliance says so explicitly ("The token side of `.trim()` is not covered by a
   dedicated test"), and `docs/research/config-invariant-guard-tests.md` records the same gap
   (key side got pinned incidentally via `key: " "`; token side untouched).
2. **Auth-before-unconfigured ordering is tested only for missing API key** (`server.test.js:261-268`).
   Missing-token variant (401 on `/v1/*` when only `PROXY_AUTH_TOKEN` is absent) is unpinned —
   if someone reorders the `authorized()` / `unconfigured` checks, that case regresses silently.

(The `/health` 503 body invariant is already covered: `server.test.js:251-256` asserts the full
body via `deepEqual`. Do not duplicate it.)

## Evidence

- `docs/adr/0001-config-validation-fail-fast-vs-degrade.md` l. 123-125: "Whitespace-only
  credentials counting as missing is pinned on the API-key side by the two tests above (they pass
  `\" \"` as the key). The token side of `.trim()` is not covered by a dedicated test."
- `docs/research/config-invariant-guard-tests.md` gap table (l. 6-12): token `.trim()` side listed
  as covered only incidentally, on the key side.
- `server.js:28`: `unconfigured: !env.NVIDIA_API_KEY?.trim() || !env.PROXY_AUTH_TOKEN?.trim()`.
- `server.js:135-141`: 401 (`authorized`) checked before 503 (`unconfigured`) — the ordering the
  research doc calls "the non-leak invariant".

## Goal

Two new tests in `server.test.js`, inside the existing `describe("proxy")` block, pinning:
(a) missing token + valid bearer on `/v1/*` → 401, upstream never contacted; (b) whitespace-only
token behaves like a missing token (401 on `/v1/*`, 503 on `/health`).

## Implementation

No production code changes. Tests only, plus count sync. Match existing style: `withProxy` helper,
`proxiedFetch`, `assert` from `node:assert/strict`, comments above the tests explaining the
invariant (mirror the comment style at `server.test.js:258-259`).

**Helper facts (verified, from the research doc + reads of `server.test.js`):**

- `withProxy(t, opts)` (l. 122-142): starts stub upstream + proxy child; `key`/`token` default to
  `"sk"`/`"pt"`; pass `null` to leave a var unset (inherits ambient shell env), pass a value like
  `" "` to set it explicitly. `proxyEnv` flows verbatim into the child env.
- `proxiedFetch(port, path, opts)` (l. 144-146): thin `fetch` wrapper returning standard `Response`.
- Control flow (`server.js:131-141`): `/v1/*` guard → 401 → 503 → proxy; rejection happens before
  the upstream `fetch` (`server.js:167`), so `receivedRequests.length === 0` is assertable (pattern
  used at `server.test.js:267`, `281`, `309`).

## Tests

Insert after the test `unauthenticated request gets 401 (not 503) when only the API key is missing`
(`server.test.js:261-268`), keeping related invariants together:

```js
  // Non-leak invariant, token side: auth is checked before the unconfigured
  // flag regardless of which credential is missing. A proxy whose only
  // problem is an absent PROXY_AUTH_TOKEN must answer 401 on /v1/*, never
  // 503 — and must reject before contacting the upstream.
  test("unauthenticated request gets 401 (not 503) when only the proxy token is missing", async (t) => {
    const { proxy, receivedRequests } = await withProxy(t, { token: null });
    const res = await proxiedFetch(proxy.port, "/v1/models", {
      headers: { authorization: "Bearer whatever" },
    });
    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), { error: "Unauthorized" });
    assert.equal(receivedRequests.length, 0);
  });

  // Whitespace-only credentials count as missing (server.js uses .trim());
  // the API-key side is pinned by the tests above passing key: " ". Pin the
  // token side: a whitespace token behaves like an absent one.
  test("whitespace-only proxy token counts as missing (401 + health 503)", async (t) => {
    const { proxy, receivedRequests } = await withProxy(t, { token: "   " });
    const res = await proxiedFetch(proxy.port, "/v1/models", {
      headers: { authorization: "Bearer whatever" },
    });
    assert.equal(res.status, 401);
    assert.equal(receivedRequests.length, 0);

    const health = await proxiedFetch(proxy.port, "/health");
    assert.equal(health.status, 503);
    assert.deepEqual(await health.json(), { status: "unconfigured" });
  });
```

Note on `token: null`: with the token unset, `TOKEN_DIGEST` is `null` and `authorized()` returns
false for every request — including your probe — so 401 with upstream untouched is exactly what
must be pinned.

**Test-count sync (mandatory, all three places):** suite goes 30 → 32. After running the suite,
update the real new total in: README.md badge (line ~9, URL-encoded), README.md tip (line ~70),
AGENTS.md `npm test` bullet.

## Docs (same PR)

- ADR 0001 §Compliance: replace the sentence "The token side of `.trim()` is not covered by a
  dedicated test." with a pointer to the two new tests (one sentence, no rewrite).
- `docs/research/config-invariant-guard-tests.md`: do **not** edit — it is a dated research record.

## Existing tests you must not break

- `health 503 when unconfigured (missing proxy token)` (`server.test.js:251-256`) also passes
  `token: null` and asserts the `/health` 503 body — keep it; your new tests complement it.
- `withProxy` defaults remain untouched.

## Verification

1. `npm test` → 32 passing, zero failures.
2. `node --test --test-name-pattern "proxy token is missing"` → only the new test runs, passes.
3. `git diff` shows changes only in `server.test.js` (2 tests), README.md (2 count spots),
   AGENTS.md (1 count spot), ADR 0001 (1 sentence).

## Maintenance note

Future invariants from ADRs should get pinned tests in the same PR that changes behavior — this
plan clears pre-existing debt; don't let new debt accrue the same way.

## Escape hatches

- If the ambient shell environment exports a real `PROXY_AUTH_TOKEN` (would make `token: null`
  inherit it — check `printenv PROXY_AUTH_TOKEN` is empty first) → STOP and report; the research
  doc's "Ambient-env caveat" applies.
- If line numbers drifted → re-locate by test names cited above.
- If either new test fails → STOP, report the failure verbatim; do not adjust production code.


