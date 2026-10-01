# Plan 07: Fix the two disconnect tests (socket-count proxy → request teardown) + pin deploy Node

Category: Tests/CI · Priority: high (main is red) · Effort: small-medium · Introduced-by: plan 01
(`1bc34cd`) · Issue: n/a (regression found by the CI workflow plan 01 added)

## Problem

`main` is red. The first ever CI run (triggered by pushing `1bc34cd` + `96ef2c3`) failed on Node 20
and 22 with 34 pass / 2 fail; Node 24 passed 36/36. Failing tests:

- `downstream disconnect aborts pending upstream (pre-headers)` — `server.test.js:636`
- `downstream disconnect aborts active upstream stream` — `server.test.js:676`

Both fail at ~2115ms, i.e. exactly when their 2000ms poll budget expires. `gh run rerun --failed`
reproduced the identical result, so this is deterministic, not flaky.

No GitHub issue tracks this. Open issues as of 2026-10-01 are #9 (plan 05) and #13–#22 (rate-limit
epic); #10 and #12 are closed. Filing an issue is a repo-visible action — ask before creating one.

## Diagnosis (already complete — do not redo, do not re-probe)

A throwaway CI probe (branch `probe/node20-disconnect`, run `36813404665`, since deleted) instrumented
the stub upstream with `request` / `req-aborted` / `req-close` / `res-close` / `res-finish` /
`socket-open` / `socket-end` / `socket-close` events. Verdict per leg:

| Node | scenario | socket count hit 0 within 2s? | upstream actually torn down? |
| --- | --- | --- | --- |
| 20.20.2 | pending (pre-headers) | yes (85ms) | yes |
| 20.20.2 | active stream | **no** | yes |
| 22.23.3 | pending (pre-headers) | **no** | yes |
| 22.23.3 | active stream | **no** | yes |
| 24.21.0 | both | yes | yes |

In every failing leg the upstream exchange emits `req-aborted`, `socket-close#1`, `res-close`,
`req-close` — and then **`socket-open#2`**: undici on Node 20/22 tears down the aborted request but
opens a replacement connection and keeps the pooled socket alive. `sockets.size` therefore never
returns to 0.

**Conclusion: H2 (test artifact), not H1 (real leak).** `server.js` cancels upstream work correctly on
all three versions. `server.js` needs **no change**, and the `engines.node: ">=18.14"` claim stands.
The defect is that the two tests use the number of open TCP connections as a proxy for "the proxy
stopped doing upstream work" — a proxy that undici's connection pool invalidates on older Node.

Raw probe log kept at `~/probe.log` (outside the repo) if you want to re-read the raw event lists.

## Task 1 — rewrite the two disconnect tests to assert request teardown

**Files: `server.test.js` only.** No new test names, so the suite stays at 36 and **no test-count doc
sync is required**.

### 1.1. Record upstream teardown in the stub

In `startStubUpstream` (`server.test.js:11-92`), register per-request lifecycle observers in the
`http.createServer` callback **before** the body handling, so an abort that lands mid-body is still
observed. Track, per arriving request:

- `reqAborted` — `req.on("aborted")`
- `reqClosed` — `req.on("close")`
- `resClosed` — `res.on("close")`
- `resFinished` — `res.on("finish")`

Keep them in a `teardowns` array in arrival order, one record per request, each with a promise that
resolves as soon as `resClosed` becomes true. Return `teardowns` alongside the existing
`{ srv, receivedRequests, sockets }`.

Note the `req.on("end")` handler currently is where `receivedRequests.push(...)` happens — the
teardown observers must be registered at request entry, not inside that handler, so that an aborted
request (which never emits `end`) still produces a record.

### 1.2. Thread it through `withProxy`

`withProxy` (`server.test.js:139-157`) destructures `startStubUpstream`'s return value; add
`teardowns` to that destructure and to its own return object.

### 1.3. Rewrite the two tests

Replace the `sockets.size === 0` polls with a wait on the teardown record for the **first** upstream
request, with a timeout so a regression fails fast instead of hanging:

- `downstream disconnect aborts pending upstream (pre-headers)` — keep the existing wait for
  `receivedRequests.length === 1`, the `controller.abort()`, the swallowed `AbortError`, the
  `/health` 200 assertion and the `proxy.child.exitCode === null` assertion. Replace only the
  `socketClosed` block: await the first record's `resClosed` within a timeout, then assert
  `resClosed === true` **and** `resFinished === false` (the upstream response must have been torn
  down, not completed normally).
- `downstream disconnect aborts active upstream stream` — keep the existing first-chunk assertions
  (`"part1-"`), `reader.cancel()`, `/health` 200, and `exitCode === null`. Replace the
  `socketClosed` block the same way.

Prefer an event-driven wait (the record's promise, raced against a timeout) over a polling loop — the
current polling loop is what turned a 50ms event into a 2000ms failure.

### 1.4. Delete the now-dead `sockets` map

The `sockets` map (`server.test.js:84-90`, exposed at `:140` and `:156`) is used **only** by these two
tests — verified: the only other hits are its own declaration and the two `withProxy` plumbing lines.
Remove it, and drop `sockets` from both destructures and from `withProxy`'s return value. If you find
a consumer this plan missed, keep the map instead and say so in the report.

### 1.5. Mutation-check the new assertions (mandatory)

A test that cannot fail proves nothing. Temporarily break the disconnect handling in `server.js`
(remove/short-circuit the `ac.abort()` on downstream `close` at `server.js:178-179`), run the two
tests, and confirm **both fail**. Revert the mutation. Paste the failing output into the report.

## Task 2 — pin the deployed Node version

**File: `render.yaml`.** Nothing in the repo or the Render API responses reachable from this machine
revealed which Node version the deploy actually uses (Render dashboard is not accessible here, and
the two plausible `onrender.com` hostnames 404'd). Rather than keep depending on Render's default,
pin it.

- Add an env var to the existing `envVars` list:
  ```yaml
  # Pinned so the deployed runtime matches a CI-tested leg instead of
  # whatever Render defaults to (engines.node is ">=18.14" and Node 18 is
  # not in the CI matrix).
  - key: NODE_VERSION
    value: "24"
  ```
- Before committing, confirm from Render's official docs that `NODE_VERSION` is the supported key for
  pinning the Node runtime on a `runtime: node` service, and cite the URL in your report. If it is
  not, use the alternative Render documents for the same purpose (a `.node-version` file) and say so
  in the report — do not guess a key name.
- Do **not** touch `engines.node` in `package.json`. `>=18.14` is the supported-runtime claim and the
  matrix found no evidence against it; changing it is out of scope.

## Task 3 — doc sync for now-false statements

- `plans/README.md`:
  - status table — add row `7` for this plan (see the row format of the existing rows);
  - `Recommended execution order` — the "Plan 01 adds CI; until it merges, local runs remain the
    gate" claim and any statement that the workflow "has never run" are now false; replace with the
    fact that the workflow ran on its first push and exposed a Node 20/22-only failure which this plan
    fixes;
  - add this plan to "Landed since the audit" only after it lands, with its commit hash.
- `specs/tech-architecture/tech-stack.md`:
  - `:138` `**No CI**: Tests only run locally` — false; replace with the CI description (matrix
    20/22/24, `.github/workflows/ci.yml`).
  - `:141` "Render config in `render.yaml`" bullet list — add the pinned `NODE_VERSION`.
  - Known Limitations table — `#10` and `#12` are closed; update or remove those rows so the table
    does not claim open work that has landed.

## Verification gates

1. `npm test` locally on Node 24 → **36 pass, 0 fail**.
2. Mutation check per A5 → both tests fail when `server.js` stops aborting upstream.
3. Push the branch → the real gate is the **CI matrix**: all three legs (Node 20, 22, 24) green.
   Local runs cannot substitute: this bug exists only on Node 20/22, and this machine (Termux arm64)
   cannot run them — `nvm` has no Node 20/22 builds for it, and the official `linux-arm64` Node
   tarballs fail to execute because Termux uses bionic, not glibc. Verified 2026-10-01.
4. `git diff --stat` shows only `server.test.js`, `render.yaml`, and the doc files named above.

## ADR decision

**No new ADR.** The failure was a test-assertion defect, not a configuration fail-fast-vs-degrade
decision, so ADR 0001 is untouched. `NODE_VERSION` is not read by `server.js` and cannot change
startup-config behavior. If you conclude an ADR is warranted while implementing, stop and report it
rather than writing one.

## Out of scope

- Plan 05 (opt-in request logging, issue #9) — untouched.
- `server.js` — no production change; the probe proved the disconnect path correct on 20/22/24.
- `perf-bench.js` (untracked, pre-existing) — do not add, commit, or delete it.
- Loosening the poll budget to make the old assertions pass — that keeps a pool-dependent property
  and stays flaky. Rejected.