# Report — e04s01 / task 1: extract `config.js`

- **status:** done
- **commit:** `947c199` — `refactor(config): extract config parsing into config.js`
- **branch:** `epic-14-config-owner`
- **baseline:** `e801016`

## Test summary

`npm test` (exact summary line):

```
ℹ tests 34
ℹ suites 2
ℹ pass 34
ℹ fail 0
```

Count-sync grep unchanged: every living doc still states 34 (`README.md:9,86`, `AGENTS.md:89`,
`CONVENTIONS.md:17`, `specs/README.md:19`, `specs/tech-architecture/tech-stack.md:129`,
`specs/tech-architecture/TEST_PLAN_LATEST.md:44,294,351`, `specs/product/VISION_LATEST.yaml:20`).
Historical records in `plans/*.md` and `docs/research/config-invariant-guard-tests.md` untouched.

## Files changed

- `config.js` (new) — owns config parsing: `parseConfig(env)` (exported parse entry point,
  renamed from `validateConfig`, returns the unchanged `{ baseURL, apiKey, proxyToken,
  unconfigured }` shape) plus the private `readSeconds(name, fallback)` helper and the
  `CONNECT_TIMEOUT_SECONDS` / `IDLE_TIMEOUT_SECONDS` consts. All moved comments preserved
  verbatim (two-regime failure model, CONNECT/IDLE split, http(s)-only rationale).
- `server.js` — imports `parseConfig`, `CONNECT_TIMEOUT_SECONDS`, `IDLE_TIMEOUT_SECONDS`
  from `./config.js`, calls `parseConfig(process.env)` at import time, and re-exports the two
  timeout names with `export { CONNECT_TIMEOUT_SECONDS, IDLE_TIMEOUT_SECONDS };`.
  `export default server` unchanged. 7 insertions / 52 deletions.
- `specs/epics/e04-rate-limiting/e04s01-tasks.yaml` — task 1 `status: failing` → `passing`.

`server.test.js` verified byte-identical (`git diff --exit-code -- server.test.js` clean).

## Verification beyond the suite

Both failure regimes and the timing semantics were checked directly:

- missing `NVIDIA_BASE_URL` → stderr `NVIDIA_BASE_URL is required`, exit 1
- `NVIDIA_BASE_URL=ftp://x` → stderr `NVIDIA_BASE_URL must use http or https, got: ftp://x`, exit 1
- whitespace-only `NVIDIA_BASE_URL="   "` → treated as missing, exit 1 (`?.trim()` semantics kept)
- missing `PROXY_AUTH_TOKEN` with valid base → `unconfigured: true` (503 degrade regime, not a crash)
- `CONNECT_TIMEOUT_SECONDS` / `IDLE_TIMEOUT_SECONDS` resolve to 30 / 120 with unset env

Env is still read at module import time; no lazy getter, reload path, or setter added. No new env
var, no dependency, ESM only.

## Notes / concerns

- `specs/execution-status.yaml` left at `e04s01: failing`: the story-level status only changes when
  the story is done, and tasks 2–12 are still `failing`.
- `scripts/check-test-count.mjs` and `scripts/sync-status-from-epics.sh` do not exist in this repo
  (ledger task 12 references the former). Not created — out of scope for this task and not a blocker
  here, since the test count did not change.
- AGENTS.md §Repository knowledge still says "All logic in `server.js`". Updating it is task 9's
  scope, so the doc was deliberately left stale for one slice.
