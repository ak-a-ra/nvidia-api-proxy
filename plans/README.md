# Improvement plans — nvidia-api-proxy

Produced 2026-09-20 by a read-only codebase audit (`/improve`). Plans are self-contained: each can
be executed by an agent that has never seen this session. Execute in the order below.

## Status

| # | Plan | Category | Status | Depends on |
| --- | --- | --- | --- | --- |
| 1 | [01-ci-github-actions.md](01-ci-github-actions.md) | CI/DX | TODO | — |
| 2 | [02-base-url-scheme-validation.md](02-base-url-scheme-validation.md) | Correctness | TODO | — |
| 3 | [03-config-guard-tests-round-2.md](03-config-guard-tests-round-2.md) | Tests | TODO | — |
| 4 | [04-request-header-array-flattening.md](04-request-header-array-flattening.md) | Robustness | TODO | — |
| 5 | [05-opt-in-request-logging.md](05-opt-in-request-logging.md) | Observability/DX | TODO | — |

## Recommended execution order

`02 → 03 → 01 → 04 → 05`.

- Plans 02, 03, 04, 05 each add tests and therefore all touch the same three count-sync locations
  (README.md badge, README.md tip, AGENTS.md `npm test` bullet). **Run them sequentially**, not in
  parallel, or the count-sync edits will conflict.
- Plan 01 is independent and can go any time; it is placed third only because 02+03 are smaller and
  land the code invariants first.

## Executor constraints (apply to every plan)

- **Zero dependencies.** Node built-ins only (`node:` imports). Never add a package. README badge
  and `package.json` advertise `dependencies-0`.
- **ESM only** (`"type": "module"` in package.json) — `import`, never `require`.
- **Surgical patches.** Do not refactor, rename, or "improve" code outside the plan's stated files.
- **Test-count sync is mandatory** whenever a plan adds tests. After running the suite, update the
  actual new total in all three places:
  - `README.md` line ~9 — badge `tests-30%20passing` (URL-encoded count);
  - `README.md` line ~70 — tip "(30 tests, no deps needed)";
  - `AGENTS.md` — `npm test` bullet "(30 tests, ...)".
  Read the current count from `node --test` output; do not hardcode the numbers above.
- **Verification gates.** From the repo root:
  - full suite: `npm test` (Node built-in runner, no install step needed);
  - single test: `node --test --test-name-pattern "<substring>"` (Node ≥ 20 recommended).
- No CI exists at audit time — running `npm test` locally before finishing a plan is the only gate.
  (Plan 01 adds CI; until it merges, local runs remain the gate.)

## Audit limitations (be aware)

- The audit session could not execute shell commands (`/bin/bash` unavailable on the audit host), so
  `npm test`, `git log`, and `gh issue list` were **not** run. Findings come from full static reads
  of all 10 tracked files. Re-run `npm test` before starting and after finishing every plan.
- GitHub issue state unverified. Per `AGENTS.md` (as of 2026-09-18): issues #2–#7 all closed, none
  open. Before treating any current behavior as intentional/final, re-check `gh issue list`.

## Findings deliberately rejected (do not implement)

Recorded so executors don't pad scope:

- **CORS headers** — would enable browser clients to hold the proxy token; contradicts the
  key-isolation threat model in `CONTEXT.md`.
- **`/health` probing the upstream** — changes documented health semantics (configured vs
  unconfigured), adds egress chatter on Render free plan.
- **Per-client tokens / rate limiting** — feature expansion, not a defect; roadmap material only.
- **`server.on("error")` for EADDRINUSE** — current uncaught-error exit is acceptable on a managed
  platform that restarts; cosmetic only.
- **Forwarding `upstream.statusMessage`** — cosmetic, zero functional impact.
- **Request body size caps** — upstream enforces limits; only authed callers reach the proxy path.
