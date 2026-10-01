# Task report — e04s01 / task 2: configurable bind host (`PROXY_HOST`)

- **Status:** done
- **Branch:** `epic-14-config-owner` (no push)
- **Baseline:** `7c654cd`, suite 34/34, worktree clean apart from untracked `briefs/`
- **Ledger verify command:** exits 0
- **`specs/execution-status.yaml`:** left at `e04s01: failing`, as required

## Commits

| SHA | What |
| --- | --- |
| `cafcc41` | `feat(config): make the bind host configurable via PROXY_HOST` — code, tests, all ten doc count sites, and the task 2 ledger flip |
| `37f6209` | `docs: log task 2 (configurable bind host) in LOG.md` — the three appended `LOG.md` lines, carrying `cafcc41` |

## New test count

```
ℹ tests 37
ℹ suites 3
ℹ pass 37
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

34 before, +3 new. No existing test was weakened, deleted, reordered, or skipped; `node --test --test-name-pattern 'PROXY_HOST'` selects exactly the three new tests.

## What changed

- `config.js` — `parseConfig` reads `PROXY_HOST` and returns it as `host`, defaulting to the string `0.0.0.0` when unset, empty, or whitespace-only. The value is passed through verbatim (untrimmed) and is **not** URL-validated, DNS-resolved, or rejected when unknown; the comment in the file records why, so a later "just validate it" edit is a deliberate reversal. The returned shape keeps `baseURL` / `apiKey` / `proxyToken` / `unconfigured` and both failure regimes, and `readSeconds` is untouched.
- `server.js:237` — `server.listen(PORT, config.host, ...)` replaces the `"0.0.0.0"` literal. `export default server` kept.
- `server.test.js` — additive only:
  - harness: the child's `listening` handler reports `address` alongside `port` over the IPC message, and `startProxyServer` surfaces it as `proxy.address`. Nothing that reads `msg.port` changes; `withProxy`, the stub upstream, and every existing assertion are untouched.
  - `bind host` suite, appended at the end of the file:
    1. `PROXY_HOST=127.0.0.1 binds loopback and serves /health` — asserts `proxy.address === "127.0.0.1"` and `/health` 200 `{ status: "ok" }`.
    2. `PROXY_HOST unset, empty, or whitespace-only binds 0.0.0.0` — the default-path regression guard, one spawn per variant.
    3. `PROXY_HOST=127.0.0.1 leaves header forwarding, credential swap, path mapping, and /health unchanged` — one request covers all four: gzipped body and `content-encoding` reach the upstream byte-identical, `Bearer pt-secret` is accepted downstream and `Bearer sk-test` is substituted upstream, the path and query arrive verbatim, and `/health` answers 200. It reuses `withProxy` / `proxiedFetch` / `zlib` rather than duplicating the four existing tests, and asserts only on fields the stub already records, so the stub needed no change.
- `specs/epics/e04-rate-limiting/e04s01-tasks.yaml` — task 2 `status: failing` → `passing`.

The bound address is asserted from `server.address()` in the child, not from `os.networkInterfaces()`, so no test silently passes by skipping a half of the assertion on a host with no non-loopback address.

## Docs updated for the count (34 → 37, same commit as the tests)

Found with the brief's grep, edited by content:

- `AGENTS.md:89` — `npm test` bullet; `AGENTS.md:107` — the site-inventory line, whose `tests-34%20passing` reference follows the badge
- `CONVENTIONS.md:17`
- `README.md:9` — shields badge `tests-37%20passing`; `README.md:86` — tip
- `specs/README.md:19`
- `specs/product/VISION_LATEST.yaml:20`
- `specs/tech-architecture/TEST_PLAN_LATEST.md:44`, `:294`, `:351` (`The 34-test suite` → `The 37-test suite`)
- `specs/tech-architecture/tech-stack.md:129` — `**Test Count**: 37 tests`

Left untouched on purpose: `plans/*.md`, `docs/research/config-invariant-guard-tests.md`, and `specs/epics/e04-rate-limiting/briefs/*` (task briefs and prior reports are records of what was true when written).

## Verification run

1. Ledger verify — `node --test --test-name-pattern 'PROXY_HOST' server.test.js` (3 tests, 3 pass) plus the `config.js` grep guard, which prints `no new security findings in affected paths: bind host is the only exposure change`. Exit 0.
2. `npm test` — 37 tests, 37 pass, 0 fail.
3. Count grep — every living site reads 37; the only remaining `34` hits outside `plans/` and `docs/research/` are non-count statements (see below).
4. Default path unchanged: `NVIDIA_BASE_URL=… PORT=0 node -e "import('./server.js')…"` prints `NVIDIA API proxy listening on port 0` with `PROXY_HOST` unset, i.e. it still binds the wildcard default.

## Could not do / notes

- Nothing required by the brief was skipped. Two deliberate non-changes, both outside the task's scope and flagged for the reviewer rather than fixed:
  - `PROXY_HOST` is **not** added to the startup-config table in `specs/tech-architecture/tech-stack.md`; the ledger gives that table to task 8, which adds `PROXY_HOST` together with the other new variables. Recorded in the `LOG.md` `next` line so it is not forgotten.
  - `specs/epics/e04-rate-limiting/e04s01-config-owner-and-bind-host.md:336` still reads "the unchanged existing suite (34 tests)" and `specs/epics/e01-ci-workflow/e01s01-tasks.yaml:22` still contains `tests-34%20passing` inside a CI-task verify command. Neither is a count statement about the current suite — one is a spec-time risk narrative, the other a `sed` pattern for a not-yet-implemented checker — and neither is in the `AGENTS.md` inventory of count sites. Task 12 re-syncs the final total anyway.
- Note for whoever runs task 12: its verify is `npm test && node scripts/check-test-count.mjs`, and `scripts/` does not exist in this repository, so that command cannot pass as written.

## Concerns

- `config.host` is a new key on the config object; `server.js` is its only consumer and the default export seam is unchanged, so nothing else observes it.
- An invalid or non-bindable `PROXY_HOST` now surfaces as an `EADDRNOTAVAIL` / `EADDRINUSE` throw from `server.listen` at startup instead of a config-regime error message. That is the brief's requirement 4, and it matches how `PORT` already behaves; the harness's `server.on("error")` path would report it as `error: <message>` if a test ever set a bad host.
- `PROXY_HOST` is a genuine exposure-surface change (wildcard by default, loopback opt-in), which is why the task is marked `security: high`. No value of it is written to logs or error responses.
