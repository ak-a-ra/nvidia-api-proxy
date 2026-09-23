# Plan 01: Add GitHub Actions CI

Category: CI/DX · Priority: high · Effort: small (one new file + docs touch) · Introduced-by: n/a (gap) · Issue: #12

## Problem

No CI. Tests (30, Node built-in runner) only run when a developer remembers `npm test` locally —
`AGENTS.md` states this explicitly. A regression can merge silently. Zero-dependency constraint
makes CI trivial: nothing to install, so a workflow is ~10 lines.

## Evidence

- `find` (audit): no `.github/`, no `ci.yml`, no CI config anywhere.
- `AGENTS.md` → Commands: "No CI: tests only run when run locally — run `npm test` before pushing".
- `package.json` → `"test": "node --test"`; `"engines": {"node": ">=18.14"}`; `"type": "module"`.

## Goal

Every push and PR runs the suite automatically on the supported Node versions. Test-count badge in
README stays manual (see Maintenance note).

## Implementation

Create **`/data/data/com.termux/files/home/workspace/nvidia-api-proxy/.github/workflows/ci.yml`**:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        node: [20, 22, 24]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node }}
      - run: npm test
```

Notes for the executor:

- Do **not** add `npm install`, `npm ci`, or a cache step — `package.json` has no dependencies and
  no lockfile exists; `npm test` works on a bare checkout.
- Node versions: the package claims `>=18.14`, but the test suite relies on
  `getSetCookie()` support in userland `fetch` (used at `server.test.js:320`, `res.headers.getSetCookie()`),
  which Node 18's undici does not fully provide. Pin the matrix to 20/22/24 to match the dev machine
  (Node 24 per `AGENTS.md`) and document 18 support as runtime-only. **If X turns out true — you find
  `getSetCookie` works on Node 18 — still keep 20/22/24**; report the discovery in the PR description
  instead of changing the matrix.
- Runner choice `ubuntu-latest`; the suite spawns child processes (`server.test.js`) and binds
  127.0.0.1 — both fine there.
- Expected runtime < 1 min per matrix leg.

Docs updates (same PR):

- `AGENTS.md` → Commands section: replace the "No CI: tests only run when run locally — run
  `npm test` before pushing" bullet with: "CI: GitHub Actions runs `npm test` on Node 20/22/24 for
  every push/PR — see `.github/workflows/ci.yml`. Run `npm test` locally before pushing anyway."
- No test count changes, so README badge/tip and AGENTS count stay untouched.

## Tests / verification

1. `npm test` locally → all tests pass (no new tests required).
2. `git diff --stat` → only `.github/workflows/ci.yml` (new) and `AGENTS.md` (one bullet).
3. Manual workflow check is optional; the workflow is exercised on the next push. Do not push.

## Maintenance note

- When a future plan adds tests, CI needs no edits (runner reads the suite). Only the README badge /
  count mentions need syncing.
- If the repo gains dependencies someday (it shouldn't), revisit the no-install step.

## Escape hatches

- If `.github/` already exists with workflows → STOP, report contents, do not duplicate.
- If `npm test` fails locally before you change anything → STOP, report the failure verbatim.
