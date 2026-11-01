# e04s08 task 7 report — regression evidence, living-doc count sync, status/evidence

Branch: feat/e04s08-stats
Commit: 8aebdcc31f4488e445de424e8083eea79cee745e
Commit message: docs(e04s08): sync test count to 237 and land stats capsule
Committed paths only (explicit `git add`), no `git add -A`, no root dot-diff scratch files.

## git log -2 --oneline

```
8aebdcc docs(e04s08): sync test count to 237 and land stats capsule
c7d1395 feat(e04s08): wire activeClientDisconnects counter on real client-disconnect path
```

## Task 7 verify output

Command run exactly (task 7 `verify:` form), N derived from `# tests N` TAP line:

```
N=$(node --test --test-reporter=tap server.test.js 2>&1 | grep -E '^# tests [0-9]+$' | grep -oE '[0-9]+')
test -n "$N" || { echo 'no test count line'; exit 1; }          # N=237
npm test >/dev/null 2>&1 || { echo 'npm test failed'; exit 1; }   # rc 0
hits=$(grep -rnE '(^|[^A-Za-z0-9])[0-9]{2,4}[ -]tests?\b|tests-[0-9]{2,4}|\(currently [0-9]+\)' --include='*.md' --include='*.yaml' . | grep -v '^\./plans/' | grep -v 'docs/research/config-invariant-guard-tests' | grep -v '/briefs/' | grep -v '^\./LOG.md' | grep -v '/specs/verifications/' | grep -v -- '-tasks.yaml')
bad=$(printf '%s\n' "$hits" | grep -vE "(^|[^A-Za-z0-9])${N}[ -]tests?\b|tests-${N}\b|\(currently ${N}\)")
test -z "$bad" || { printf 'stale test count (suite is %s):\n%s\n' "$N" "$bad"; exit 1; }
grep -q 'e04s08-expose-authenticated-aggregate-stats.md' specs/epics/e04-rate-limiting/epic.yaml || { echo 'epic.yaml missing e04s08 spec'; exit 1; }
grep -q 'e04s08-tasks.yaml' specs/epics/e04-rate-limiting/epic.yaml || { echo 'epic.yaml missing e04s08 tasks'; exit 1; }
```

Result: `task 7 verify PASSED N=237`. Count sweep CLEAN N=237 — no stale living-doc test counts.

Pre-verify `npm run check` rc 0 (lint + typecheck + format:check).

## Grep count sweep output

Sweep pattern (exclusions applied: `plans/`, `docs/research/config-invariant-guard-tests.md`, `LOG.md`, `specs/epics/*/briefs/`, `specs/epics/*/*-tasks.yaml`, `specs/verifications/`):

```
# tests 237   <- TAP summary (N derived here)
hits = all living-doc test-count references       (203→237 synced across all sites)
bad = (none)                                     <- count sweep CLEAN
```

Living docs synced to 237:
- README.md badge `tests-237%20passing` + tip
- AGENTS.md count bullet + site list
- CONVENTIONS.md `npm test` line
- specs/README.md, specs/tech-architecture/tech-stack.md test line, TEST_PLAN_LATEST.md (×3), product/VISION_LATEST.yaml
- specs/state.yaml handoff note
- specs/epics/e04-rate-limiting/e04s01-config-owner-and-bind-host.md:345 risk note
- specs/epics/e04-rate-limiting/e04s07-reconcile-...md living-doc count note
- e04s08 story spec §21 risk note (203→237)

Skipped per exclusions: `plans/*.md`, `docs/research/config-invariant-guard-tests.md`, `LOG.md`, `specs/epics/*/briefs/`, `specs/epics/*/*-tasks.yaml`, `specs/verifications/`.

## Story spec prose fix (authoritative 21-key enumeration)

e04s08 story spec said "24-key allowlist" in narrative but §3/§17 enumerate 21 keys. Changed prose to 21 (§6, §8 interface, invariant #4, Gherkin "exact allowlist field set"). §21 risk note kept as risk context (now states 237). No tests renamed.

## Status set after verify

- epic.yaml: e04s08 `status: passing`, `bcps: 7`, `spec: e04s08-expose-authenticated-aggregate-stats.md`, `tasks: e04s08-tasks.yaml`
- specs/execution-status.yaml: `e04s08: passing`; `e04s09` stays `blocked` with `blocked_by: [e04s08]`
- e04s08-tasks.yaml: story `status: passing`; all 7 tasks `status: passing`
- Added specs/verifications/e04s08-verify.yaml (date 2026-11-01, commands/npm run check/TAP summary/task-7 gate, results 237/237/0, reviewer verdicts t01 PASS / t02 waived combined commit / t04 PASS / t05 review file may be missing note if so, doc count 237)
- specs/state.yaml: `vcs.branch: feat/e04s08-stats`, `vcs.commit: 8aebdcc...`, `handoff.next_skill: verify-work`, handoff note records e04s08 landed, 237 tests, 21-key allowlist; metrics.story_start retained (2026-10-26T00:42:18Z)

## Stray root dot-diff files (left untracked, not committed)

These were present before this task and were deliberately not staged/committed:

- `.g_test_diff.txt`
- `.green.diff`
- `.green_server.diff`
- `.green_test.diff`
- `.red.diff`

Also untracked (pre-existing e04s08 briefs/reports, out of scope for this commit):

- `specs/epics/e04-rate-limiting/briefs/e04s08-t00-tracer-report.md`
- `specs/epics/e04-rate-limiting/briefs/e04s08-t00-tracer.md`
- `specs/epics/e04-rate-limiting/briefs/e04s08-t01-report.md` through `e04s08-t07.md` (t01–t05 with reviews, t07 brief)

## Concerns

- e04s08-tasks.yaml task 7 description still contains the stale ledger sentence "keep status todo (not passing)... execution-status.yaml: e04s08 stays todo"; user brief explicitly overrides it (set passing after verify), applied. If the ledger sentence is meant as authoritative future reference, it is now inconsistent with the landed state.
- t05 review file may be missing — noted in `specs/verifications/e04s08-verify.yaml` reviewer verdicts; no t05-review.md found in briefs/ for e04s08.
- t02 waived as combined commit per brief; no separate t02 commit exists.
- Stray root dot-diff files remain untracked as required; not swept into any commit.

## Constraints honored

- Zero runtime deps added; no code behavior changes; no tests weakened; no tasks.yaml count-sync issues; explicit-path commit only; root dot-diff scratch files left untracked and listed.
