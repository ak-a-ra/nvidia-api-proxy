# e04s08 tracer bullet brief

Branch: `feat/e04s08-stats` (from `main` @ `6ac2c66`). Work only on `server.js` and `server.test.js`. Never run `git add -A`; the branch carries uncommitted spec files (`specs/...`) that must stay unstaged/untracked and must not be committed by this task.

Goal: first public-interface TDD tracer for `GET /stats`.

RED: add one black-box test in `server.test.js` using the existing harness (`childEnv`, `startProxyServer`/`withProxy`, stub upstream): `GET /stats returns 401 without a token` — configured proxy, no `Authorization` header, assert status `401`, body `{ "error": "Unauthorized" }`, upstream received zero requests. Run it and confirm it fails because `/stats` currently 404s. Commit test-only: `test(stats): GET /stats returns 401 without a token`.

GREEN: minimal `server.js` change only — after `/health` and before the `/v1` checks, add a `/stats` branch that returns `401 { "error": "Unauthorized" }` when `authorized(req)` is false. Do not add the 200 path, counters, admission/budget bypass logic beyond placement, or doc changes yet. Run the new test plus `npm test`; commit `feat(stats): return 401 for unauthenticated GET /stats`.

Evidence required in report: `git log -2 --oneline` showing RED then GREEN, failing-test output line from RED, passing output for the new test, and `npm test` summary (`# tests N`, `# pass N`, `# fail N`). `scripts/verify-tdd-red-commit.sh` is absent in this repo; use `git log -2 --oneline` as the RED/GREEN evidence.

Hard constraints: zero runtime deps, ESM, no new env var, no `CONFIG_ENV_VARS` change, no weakened/skipped tests, no secrets/model IDs/paths in responses, `/stats` must not contact upstream for the 401 path. Do not edit `e04s08-tasks.yaml` statuses in this tracer task.

Report: write `specs/epics/e04-rate-limiting/briefs/e04s08-t00-tracer-report.md` with status, commits, test summary, concerns.
