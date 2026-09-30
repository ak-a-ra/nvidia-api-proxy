# LOG

Running log of work on `epic-14-config-owner` (issue #14, story e04s01). Live working agreement, not a changelog.

- Read `LOG.md` at the start of any task on this branch, before touching code.
- At the end of each task, append exactly three lines: one to `done`, one to `decided`, one to `next`.
- Never rewrite or delete earlier entries. Append only. History is the point.
- One line per entry, newest at the bottom of its section.

## done

One line per landed commit. Check any SHA against `git log`.

- `e801016` docs(plan): release index and epic capsules for #14: `specs/release-plan.yaml`, four epic capsules, `specs/execution-status.yaml`, `specs/state.yaml`; e04s02-e04s09 left `blocked` with no spec.
- `947c199` refactor(config): configuration parsing extracted from `server.js` into root-level `config.js` (52 lines); `server.js` down to 249 lines; config shape `baseURL`/`apiKey`/`proxyToken`/`unconfigured` and the `readSeconds` lenient fallback preserved, so no existing test changed; e04s01 task 1 -> `passing`.
- `f3d20de` docs: `AGENTS.md` ownership correction after the extraction: the Repository knowledge line now describes two modules instead of "all logic in server.js", the two config invariant bullets name `config.js` `parseConfig` and `readSeconds`, and task 9 is rescoped to `CONVENTIONS.md` with the `AGENTS.md` clause kept as a regression guard; no runtime change, `npm test` stays 34/34.
- `b003122` docs: this file created at the project root with the three-section `done` / `decided` / `next` structure; seeded from `git log`, `specs/state.yaml`, and the e04s01 ledgers, and verified line by line against them.
- `cafcc41` feat(config): bind host now read from `PROXY_HOST` in `config.js` (default `0.0.0.0`, exported as `config.host`) and used by `server.listen` in place of the literal; the proxy child additionally reports its bound address over IPC so tests assert on it instead of guessing a non-loopback address; three `PROXY_HOST` tests added and the suite synced to 37 tests across all ten living count sites in the same commit; e04s01 task 2 -> `passing`.

## decided

One line per decision recorded in `specs/state.yaml`.

- Plan only the unblocked slice of the rate limiting epic: #14-#22 is a strict linear blocked-by chain, so capsules for blocked slices would imply work that cannot start and go stale before it is reachable.
- Use the issue #13 body as the elaborate-spec output: no elaborate-spec run ever happened (`plan: complete: false`), and the 544-line body with 150 numbered user stories is more detailed than elaborate-spec would produce.
- Epic IDs follow capsule directory names, not WSJF rank; WSJF order lives only in `release-plan.yaml` so cross-references stay checkable.
- Hand-sync `specs/execution-status.yaml`: `scripts/sync-status-from-epics.sh` (likewise `scripts/validate-specs-yaml.sh` and `docs/countable-story-format.md`) does not exist in this repository, so the 20-section story format was reconstructed from the section anchors other skills cite.
- e04s01 extracts `config.js` only; the deep-module split (limiter, queue, usage reconciliation) belongs to e04s02-e04s09 and is deferred, leaving `server.js` with the HTTP logic.
- e04s01 executes through a subagent per task plus a reviewer subagent, per the `AGENTS.md` orchestrator role and the task-brief flow in `plans/README.md`; the bigpowers in-context chain does not apply to implementation on this branch.
- Branch work is logged in `LOG.md` at the project root, not only in commits: read it before a task, append one line each to `done`, `decided`, and `next` after one, never rewrite earlier entries.
- `PROXY_HOST` is passed to `server.listen` unvalidated and untrimmed (whitespace-only counts as unset, via the existing `?.trim()` convention): no URL parsing, no DNS resolution, no allowlist, because rejecting an unknown value would turn a working deploy into a startup crash and `listen()` already fails loudly at bind time; the comment in `config.js` states this so a later "just validate it" change is a deliberate reversal.

## next

One line per known upcoming step, oldest first.

- e04s01 task 2: add `PROXY_HOST` to the config owner with default `0.0.0.0` and move the hardcoded `server.listen(PORT, "0.0.0.0", ...)` (`server.js:237`) onto it, with a test that `PROXY_HOST=127.0.0.1` binds loopback; first change on this branch to what the proxy exposes on the network, so the task carries a security review.
- e04s01 tasks 3-12 stay `failing` until their own verify command exits 0, and `specs/execution-status.yaml` keeps the story at `failing` for as long as the story is incomplete.
- `specs/tech-architecture/tech-stack.md` startup-config table and `docs/adr/` need a new entry for every env var e04s01 adds; `AGENTS.md` now requires this, and task 7 writes ADR 0002 for the fail-fast-versus-degrade extension.
- e04s01 task 3 is next: `PROXY_RPM` and `PROXY_TPM` parsing, the first strictly-parsed operational pair. Note the bind host added in task 2 is still absent from the `tech-stack.md` startup-config table — task 8 owns that table and covers `PROXY_HOST` with the other nine variables.
