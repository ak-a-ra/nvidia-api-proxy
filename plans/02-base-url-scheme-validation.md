# Plan 02: Validate NVIDIA_BASE_URL scheme (reject non-http(s))

Category: Correctness/security · Priority: high · Effort: small (one branch in server.js + 1 test + count sync) · Introduced-by: n/a (original)

## Problem

`validateConfig` (`server.js:12-30`) accepts **any** parseable URL as `NVIDIA_BASE_URL`, including
`file:`, `data:`, and malformed `https:/` URLs. Two bad outcomes:

- `file:///etc/passwd` → undici fetch throws `TypeError` before DNS, caught by the generic handler
  → opaque `502` per request with no diagnostic signal; a `file:` base can never serve.
- `data:text/plain,hi` is even accepted. Neither is ever a legitimate upstream.

Rejecting non-`http(s)` schemes at startup converts a doomed config into the documented fatal
regime (exit 1) — consistent with ADR 0001: *base URL problems are structural and must be fatal*.

## Evidence

- `server.js:18-23`: try `new URL(rawBase)` → only parse errors are fatal. Scheme never checked.
- `server.js:110-113` `upstreamUrl()`: builds `` `${base.origin}${...}` `` — for a `file:` URL,
  `origin` is the string `"null"`, so the fetch URL is `null/v1/...` → guaranteed throw.
- ADR `docs/adr/0001-config-validation-fail-fast-vs-degrade.md` Decision §1: base-URL problems are
  fatal at startup. This change narrows "not parseable" → "not parseable **or wrong scheme**";
  it does not alter the credential degrade regime (Decision §2/§3 untouched).
- No GitHub issue known open (`AGENTS.md`, 2026-09-18: all closed); treat as original finding.
  Re-check with `gh issue list` before coding.

## Goal

`NVIDIA_BASE_URL` whose protocol is not `http:` or `https:` is rejected at startup with exit code 1
and a clear stderr message. Nothing else about URL handling changes.

## Implementation

**`server.js`** — inside `validateConfig`, make the parse-and-scheme check one unit. Current code
(`server.js:18-23`) is `try { new URL(rawBase); } catch { ...exit(1) }`. Replace with:

```js
    try {
      const parsed = new URL(rawBase);
      // Only http(s) can be an upstream: other schemes are structurally
      // unusable (file: has no origin, data: is inline), so they are a
      // doomed config — same fatal regime as an unparseable URL.
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        console.error(`NVIDIA_BASE_URL must use http or https, got: ${rawBase}`);
        process.exit(1);
      }
    } catch {
      console.error(`NVIDIA_BASE_URL is not a valid URL: ${rawBase}`);
      process.exit(1);
    }
```

- Edge case to preserve: parse errors must still hit the existing "not a valid URL" message
  (a test asserts that exact text — see Existing-tests below). Scheme failure gets its **own**
  message; keep both distinct so each test pins its branch.

**Conventions to match** (verified in `server.js`): ESM, `node:` imports only (no new imports
needed), plain double quotes, 2-space indent, explanatory comment above the code, `validateConfig`
stays the single source of truth for config rules (ADR 0001 Consequences).

## Tests

**`server.test.js`** — the "startup" `describe` block (starts `server.test.js:175`) already has the
exact pattern to copy: `exits 1 when NVIDIA_BASE_URL is not a valid URL` (l. 186-194) uses
`runProxyOnce` (defined l. 150-173) which spawns `server.js` as a bare child and resolves
`{ code, stderr }`. Add directly after it:

```js
  test("exits 1 when NVIDIA_BASE_URL is not http(s)", async () => {
    const { code, stderr } = await runProxyOnce({
      NVIDIA_BASE_URL: "file:///etc/hosts",
      NVIDIA_API_KEY: "k",
      PROXY_AUTH_TOKEN: "t",
    });
    assert.equal(code, 1);
    assert.ok(stderr.includes("must use http or https"));
  });
```

- Assert `code === 1` and the **exact new message substring** `must use http or https`
  (pinned so regressions in wording are caught, mirroring l. 183/193 style).
- Do not add variants for every bad scheme — one representative per failure mode, per repo style.

**Test-count sync (mandatory, all three places):** suite goes 30 → 31. After running the suite,
update the real new total in:

- `README.md` line ~9 badge: `tests-30%20passing` → `tests-31%20passing` (URL-encoded);
- `README.md` line ~70 tip: "(30 tests, no deps needed)" → "(31 tests, ...)";
- `AGENTS.md` `npm test` bullet: "(30 tests, ...)" → "(31 tests, ...)".

**Docs (same PR):** ADR 0001 — append one sentence to Decision §1: a parseable URL whose scheme is
not http(s) is also structural and fatal. Do not rewrite the ADR.

## Existing tests you must not break

- l. 176-184 (`NVIDIA_BASE_URL` missing → exit 1, message "NVIDIA_BASE_URL is required") — your
  edit must keep the early missing/blank check before URL parsing, so this path is unchanged.
- l. 186-194 (`"not-a-url"` → "not a valid URL") — parse catch still fires before scheme check.

## Verification

1. `npm test` → 31 passing, zero failures.
2. `NVIDIA_BASE_URL=file:///tmp node server.js` → exits 1 with the new message; with a valid
   `NVIDIA_BASE_URL` → starts (kill it after confirming).
3. `git diff` shows changes only in: `server.js` (one branch), `server.test.js` (one test),
   README.md (2 count spots), AGENTS.md (1 count spot), ADR 0001 (1 sentence).

## Maintenance note

Future config variables follow ADR 0001's regime test — this change does not touch that logic.
`upstreamUrl()` continues to assume `base.origin` is meaningful, which the new guard guarantees.

## Escape hatches

- If `gh issue list` shows an open issue already covering scheme validation → STOP, link it, report.
- If `runProxyOnce` or the startup-test pattern differs from the cited line numbers (file may have
  shifted) → re-locate by test names, don't guess.
- If any existing test fails after your change → STOP, report which and why.

