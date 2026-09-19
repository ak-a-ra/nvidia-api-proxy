# ADR 0001: Config validation — fail-fast for base URL, degrade for credentials

* Status: accepted
* Date: 2026-09-19
* Deciders: maintainers
* Context file: [`CONTEXT.md`](../../CONTEXT.md) — see *misconfigured*, *unconfigured*, *health*

## Context and problem statement

The proxy needs three environment variables at runtime: `NVIDIA_BASE_URL` (where to forward),
`NVIDIA_API_KEY` (credential inserted upstream), and `PROXY_AUTH_TOKEN` (credential checked on
every inbound call). All three arrive from the deployment environment, so any of them can be
absent or wrong. The question is what the proxy should do for each failure mode: refuse to start,
start but refuse work, or start and misbehave.

Two properties pull in opposite directions:

* **Fail-fast** — a process that is doomed or dangerous should die before accepting traffic, so
  the deployer learns immediately (container restart loop, alert on the health check) instead of
  serving garbage quietly.
* **Degrade** — a process that cannot do *all* its work may still do *useful* work, and staying
  up keeps the failure visible and diagnosable (a health endpoint can report *why* it is not
  serving) rather than hiding behind a crash loop.

Applying one rule to all three variables breaks in both directions:

* If a bad `NVIDIA_BASE_URL` only degraded, the proxy would come up "healthy" on platforms that
  run the image with partial config, then 503 on every request — a doomed process advertising
  readiness. Worse, a subtly malformed base URL that only fails on first request would surface as
  mysterious per-request failures instead of an obvious startup error.
* If a missing `NVIDIA_API_KEY` were fatal, a proxy restart (crash loop) would be *required*
  before someone could even reach the health endpoint that tells them what is wrong — and the
  failure would look identical to a broken deployment, when in fact one environment variable is
  the entire fix. At the time this decision was made, the hosting platform could start the app
  before its configured secrets were attached; a hard failure there produced a restart loop that
  hid the real, one-line cause.

Splitting the two regimes by *what kind of state the variable describes* resolves the tension.

## Decision

1. **`NVIDIA_BASE_URL` problems are fatal at startup** (`process.exit(1)`): missing,
   whitespace-only, or not parseable as a URL.
2. **Missing `NVIDIA_API_KEY` or `PROXY_AUTH_TOKEN` is a runtime condition, not a crash.** The
   proxy starts normally, marks itself `unconfigured`, and:
   * `/health` reports 503 with `{ status: "unconfigured" }`;
   * proxied requests get 503 with `{ error: "Proxy is not configured" }`.
3. **Whitespace-only counts as missing** for the credential check (`.trim()`), because an empty
   credential is indistinguishable in effect from an absent one.

## Rationale

The split follows a simple test: *can the proxy be useful without this variable, and is the
variable's absence recoverable without redeploying a broken image?*

* Without a base URL there is no "upstream" — every request path is undefined. No degraded mode
  exists that is more useful than dying. And a malformed URL is a *structural* error — the config
  as written is wrong no matter what credentials arrive later — so failing at startup is the
  earliest, clearest signal.
* Without credentials the proxy still knows how to say "I am up but not usable," and the missing
  piece is data, not structure: set the variable and the deployment heals — note that env vars are
  read once at startup, so healing always requires a process restart; platforms like Render do
  this automatically when a variable changes, and no image rebuild is ever needed. A crash loop
  here would add noise (platform restart telemetry, opaque exit codes) to a problem whose
  diagnosis is "echo the env vars."

Degrading on credentials also preserves the *health* concept introduced in `CONTEXT.md`: the
health endpoint exists precisely to distinguish healthy from unconfigured, which requires a state
where the process is running but not serving. Fail-fast on credentials would collapse that
distinction.

The asymmetry is deliberate and load-bearing. Reviewers should not "fix" it by making
`NVIDIA_API_KEY` fatal for consistency — that reopens the crash-loop-on-missing-secret problem.

## Consequences

**Positive**

* Doomed configs never serve traffic; partial-but-recoverable configs stay up and self-describe.
* Health checks on the deploy platform distinguish "process broken" (no process) from "config
  incomplete" (503 unconfigured) — two different remediations, two different signals.
* A single function (`validateConfig`) owns the rule, so adding a future variable means picking
  its regime explicitly.

**Negative / neutral**

* Two regimes for three variables is a genuine asymmetry; it must be understood rather than
  memorized. The `validateConfig` comment in `server.js` documents it; this ADR explains *why*.
* The degraded 503 path must never leak *which* credential is missing to unauthenticated callers;
  both 503 bodies are generic on purpose.
* `unconfigured` is checked with `.trim()`, so an accidentally whitespace-filled secret is
  treated as missing. Correct, but surprising if someone expects a literal-space token to work —
  a trailing newline pasted into a dashboard field yields a 401-everything deployment that looks
  identical to an attack, burning debug time.
* `/health` is unauthenticated by design and reports configured vs unconfigured, so it is a
  public boolean state probe ("a credential is absent", never which one). This exposure is
  accepted — the health endpoint exists to self-describe and platform probes call it
  unauthenticated. Accepted exposure: presence of *a* missing credential. Rejected exposure:
  anything narrowing that to *which* credential, on `/health` or on proxied paths.

## Alternatives considered

* **Fail-fast on all three variables** — rejected: turns a missing secret into a restart loop and
  destroys the healthy/unconfigured distinction the health endpoint provides.
* **Degrade on all three variables** — rejected: a proxy with no valid base URL is structurally
  doomed, and per-request 503s with no startup signal hide the cause behind first-traffic noise.
* **Lazy validation** (validate base URL on first request) — rejected: same hiding problem, and
  it moves a deployment-time error into the request path where it is hardest to see.

## Compliance

Enforced by tests in `server.test.js`:

* `exits 1 when NVIDIA_BASE_URL is missing` / `exits 1 when NVIDIA_BASE_URL is not a valid URL` —
  fatal regime, exit code 1 asserted;
* `health 503 when unconfigured (missing proxy token)` — degrade regime for credentials,
  503 body pinned;
* `unauthenticated request gets 401 (not 503) when only the API key is missing` — pins the
  auth-before-unconfigured ordering (the non-leak invariant) and asserts the upstream is never
  contacted; also exercises the whitespace-credential `.trim()` path;
* `proxied request on unconfigured proxy returns generic 503 body` — pins the generic 503 body.

Whitespace-only credentials counting as missing is pinned on the API-key side by the two tests
above (they pass `" "` as the key). The token side of `.trim()` is not covered by a dedicated
test.

Rationale and test design documented in
[`docs/research/config-invariant-guard-tests.md`](../research/config-invariant-guard-tests.md).

## References

* `server.js` — `validateConfig` and its comment block (single source of truth for the rule).
* `CONTEXT.md` — glossary entries *misconfigured*, *unconfigured*, *health*.
* [`render.yaml`](../../render.yaml) — deployment pins `NVIDIA_BASE_URL`, so in practice the
  fatal branch guards against local/manual runs and platform regressions rather than daily deploys.
