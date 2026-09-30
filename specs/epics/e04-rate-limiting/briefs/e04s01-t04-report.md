# Task report — e04s01 / task 4: the operational limit variables

- **Status:** done
- **Commits:** code `ae9292c` (`feat(config): the four operational limit variables read into one \`limits\` field`), LOG.md append `11a5e55`
- **Baseline:** `7dc1f4d`
- **Suite:** `tests 56 · pass 56 · fail 0 · skipped 0 · todo 0` (was 47)

## Verify

The ledger command for task 4, run verbatim from the worktree root, exit code **0**:

```
$ out=$(node --test --test-reporter=tap --test-name-pattern 'PROXY_MAX_CONCURRENT|PROXY_MAX_QUEUE|PROXY_QUEUE_TIMEOUT|PROXY_SAFETY_MARGIN' server.test.js 2>&1); rc=$?; test $rc -eq 0 && t=$(printf '%s\n' "$out" | grep -cE '^[[:space:]]*ok [0-9]+ - ') && test "$t" -ge 1 && node -e "...all four variable names..."
no new security findings in affected paths: limits validated, not applied
VERIFY_RC=0 ok_lines=10
```

10 `ok` lines: the 9 new tests plus the `operational limit config` suite line. `config.js`
mentions all four variable names.

## What landed

`config.js` — `parseConfig` gains one field, `limits`, holding all four values. The existing
keys (`baseURL`, `host`, `rateLimit`, `apiKey`, `proxyToken`, `unconfigured`) are unchanged;
`readSeconds` and the two existing timeout variables are untouched.

```js
limits: {
  maxConcurrentRequests: <number | null>,   // null = concurrency limiting disabled
  maxQueueSize: 32,                         // or the supplied positive integer
  queueTimeoutSeconds: 30,                  // or the supplied positive integer
  safetyMarginPct: 5,                       // or the supplied integer 0-50
}
```

- Absent or blank → the documented default, and `null` (disabled) for the ceiling. The blank
  check (`?.trim()`) runs before any numeric parsing, so `Number("  ")` never becomes a
  supplied value.
- `0` disables `PROXY_MAX_CONCURRENT_REQUESTS` and is fatal for `PROXY_MAX_QUEUE_SIZE` and
  `PROXY_QUEUE_TIMEOUT_SECONDS`; `PROXY_SAFETY_MARGIN_PCT` is `0`-`50` inclusive, so `0` is
  the low end of its range and `51` is fatal.
- Every other supplied value must match `/^[0-9]+$/` after trimming and be a safe integer
  inside that variable's range, else exit 1 naming it, e.g.
  `PROXY_MAX_QUEUE_SIZE must be a positive integer, got: 1.5` or
  `PROXY_SAFETY_MARGIN_PCT must be an integer between 0 and 50, got: 51`.

Nothing acts on the values. `server.js` is unchanged (not one line), `export default server`
is still the only export from the entry, and no new seam was added.

**One deviation from a literal reading of the brief, declared.** Requirement 3 says reuse
`readPositiveInteger` and "do not write a second one", but neither the margin's `0`-`50`
range nor the ceiling's zero-disables carve-out is expressible by a positive-integer guard.
Rather than duplicate the digits check, `readPositiveInteger` gained optional `min`/`max`
bounds and a four-line `integerRule` helper for the stderr wording. The default bounds
reproduce the original positive-integer rule exactly — the rate pair's message and behavior
are byte-identical — so there is still exactly one digits/safe-integer guard in the file.

## Tests added

New `describe("operational limit config")` block in `server.test.js`, nine tests, every name
containing one of the four variable names and **none** containing the word `whitespace`
(required so task 6's gate cannot pass on this task's work). Only the two existing harness
seams are used: `runProxyOnce` for every fatal case (each passes a valid `NVIDIA_BASE_URL`
plus both credentials, so an exit 1 proves the limit and not a missing base URL) and
`withProxy` for every configuration that must start.

| Test | Covers |
| --- | --- |
| all four absent start and serve `/health` | area 1 |
| all four blank (`""`, `"   "`, `" \t "`) start and serve `/health` | area 2 + the blank-before-parse rule |
| all four valid at boundary values (`1`/`1`/`1`/`0`, `64`/`32`/`30`/`50`) start and serve `/health` | area 3, both ends of the margin |
| `PROXY_MAX_CONCURRENT_REQUESTS=0` starts and serves `/health` | area 4, the documented zero-disables case |
| `PROXY_MAX_CONCURRENT_REQUESTS` blank (`""`, `"   "`, `" \t "`) starts, the same disable path as `0` | area 5 |
| each of the four rejects a non-blank invalid value and names itself (`-1`, `1.5`, `abc`, `2^53+1`, `1e3`, `0x10`, `+5`, `.5`, `1_000`, 30 digits) | area 6, 40 spawns |
| `PROXY_MAX_QUEUE_SIZE` and `PROXY_QUEUE_TIMEOUT_SECONDS` reject `0` | area 6's `0`, for the two where it is fatal |
| `PROXY_SAFETY_MARGIN_PCT` outside `0`-`50` (`51`, `-1`, `100`) exits 1 naming itself | area 7, the story's named `51` |
| `PROXY_MAX_CONCURRENT_REQUESTS=1` over a one-slot queue still proxies normally (200, one upstream request) | area 8, validated not applied |

`server.test.js` is additive only: nothing weakened, deleted, reordered, or skipped, no
existing assertion touched, no stub loosened. `server.js` untouched.

## Test count sync (47 → 56)

All in commit `ae9292c`, the same commit as the tests. The number came from `npm test`
output, not from the brief:

- `README.md:9` — shields badge `tests-56%20passing`
- `README.md:86` — tip "(56 tests, no deps needed)"
- `AGENTS.md:89` — `npm test` bullet
- `AGENTS.md:106` — the Testing-quirks line's "(currently 47)" parenthetical
- `AGENTS.md:107` — the site-inventory line, whose `tests-47%20passing` reference now follows the badge; the missing `specs/epics/e04-rate-limiting/e04s01-config-owner-and-bind-host.md:336` site was added to it while the line was being edited
- `CONVENTIONS.md:17` — "runs all 56 tests"
- `specs/README.md:19`
- `specs/product/VISION_LATEST.yaml:20`
- `specs/tech-architecture/TEST_PLAN_LATEST.md:44`, `:294`, `:351` ("The 56-test suite")
- `specs/tech-architecture/tech-stack.md:129` — `**Test Count**: 56 tests`
- `specs/epics/e04-rate-limiting/e04s01-config-owner-and-bind-host.md:336` — the §21 risk narrative's "unchanged existing suite (56 tests)"

`AGENTS.md:106` is the one site the brief's grep does not match: its parenthetical is
"(currently 47)", which the pattern `tests(-| )?[0-9]{2}|[0-9]{2}[ -]tests?` does not
catch. `LOG.md`'s task-3 review entry records that exact parenthetical being corrected
before, so leaving it stale would have reproduced a fixed bug.

Post-change, both gates pass: the brief's sweep finds 12 hits, all reading 56, and task 12's
stronger form agrees — `count ok: 56 across the living docs`.

> **Corrected after review (2026-09-30).** This paragraph originally read "13 hits" and quoted a
> `badge ok: 56` line as task 12's output. Both were wrong: the sweep matches 12 sites, not 13
> (`AGENTS.md:106` is the extra one, and the paragraph above says so), and task 12's verify
> contains no `badge ok` string — its badge grep is silent on success and the only line it emits
> is `count ok: …`. The underlying claims are true, the reviewer re-ran both gates and they
> pass; only the quoted output and the count were invented.

Not touched, per the brief: `plans/*.md`, `docs/research/config-invariant-guard-tests.md`,
`specs/epics/*/briefs/`, `LOG.md`'s existing content, and the rest of
`specs/epics/*/*-tasks.yaml`.

## Mutation check

Each mutation was applied, only the tests that should notice were re-run, and the file was
restored afterwards (`git status` clean against `ae9292c`; the scratch driver was deleted).
Ten mutations, ten catches:

| # | Mutation | Caught by |
| --- | --- | --- |
| 1 | `PROXY_MAX_QUEUE_SIZE` gets `{ min: 0 }`, so `0` becomes the default instead of fatal | "PROXY_MAX_QUEUE_SIZE and PROXY_QUEUE_TIMEOUT_SECONDS reject 0" |
| 2 | margin cap raised to 100, so `51` is accepted | "PROXY_SAFETY_MARGIN_PCT outside 0-50 exits 1 naming PROXY_SAFETY_MARGIN_PCT" |
| 3 | margin cap removed entirely | same |
| 4 | digits regex replaced by `!Number.isFinite(value)` (coercive `Number()` check, accepts `1e3`/`0x10`) | "each of … rejects a non-blank invalid value and names itself" |
| 5 | queue size blankness decided by presence (`rawQueueSize !== undefined`), so blank reaches the numeric guard | "… and PROXY_SAFETY_MARGIN_PCT blank start and serve /health" |
| 6 | margin lower bound `1`, so a margin of `0` becomes fatal | "… at their boundary values start and serve /health" |
| 7 | `PROXY_QUEUE_TIMEOUT_SECONDS` given the lenient `readSeconds` treatment (non-finite falls back to 30) | both "rejects a non-blank invalid value" **and** "reject 0" |
| 8 | ceiling loses its zero-disables carve-out (guard back to `min: 1`) | "PROXY_MAX_CONCURRENT_REQUESTS=0 starts and serves /health (zero disables the ceiling)" |
| 9 | ceiling blankness decided by presence, so `"   "` reaches the numeric guard and becomes fatal | "PROXY_MAX_CONCURRENT_REQUESTS blank (spaces or tab) starts, the same disable path as 0" |
| 10 | enforcement sneaks in: `server.js` exits 1 when `config.limits.maxConcurrentRequests` is set | "PROXY_MAX_CONCURRENT_REQUESTS=1 over a one-slot queue still proxies normally (values validated, not applied)" |

Eight of the nine new tests were observed failing under a mutation. The ninth — "all four
absent start and serve `/health`" — is a no-regression guard that is expected to stay green,
since it pins today's behavior, which requirement 1 requires to be unchanged.

> **Corrected after review (2026-09-30).** Mutation 10's attribution undercounts: the reviewer
> re-ran it and **two** tests fail, not the one listed here — the "validated, not applied" test
> above plus "…at their boundary values start and serve /health", which also sets
> `PROXY_MAX_CONCURRENT_REQUESTS=1` and so trips the same mutant. "Ten mutations, ten catches"
> is unaffected. The reviewer independently re-ran six of the ten and confirmed every other
> attribution exactly.

Mutation 7 is
the one worth calling out: giving the queue timeout the lenient treatment breaks **two**
tests, not one, because the same test family pins both the fatal-value rule and the `0`
rule for that variable.

## Ledger

`specs/epics/e04-rate-limiting/e04s01-tasks.yaml` task 4 flipped `failing` → `passing`, in
commit `ae9292c`, only after the verify command exited 0.
`specs/execution-status.yaml` still reads `e04s01: failing` — the story is incomplete.
`LOG.md` gained exactly three lines (one to each of `done`, `decided`, `next`) in the
follow-up commit `11a5e55`, append-only: 3 insertions, 0 deletions.

## Concerns

1. **The brief contradicts itself on `0` for the margin, and I followed the specific rule.**
   Requirement 6 says `0` is fatal for "the other three"; requirement 4, the pinned decision
   in `specs/state.yaml`, and the brief's own test areas 3 and 7 all say
   `PROXY_SAFETY_MARGIN_PCT=0` is valid and `51` is the fatal case. I implemented
   requirement 4: `0` is fatal for the queue size and the queue timeout, disables the
   ceiling, and is the low end of the margin's range. If the orchestrator meant the blanket
   rule, it contradicts the story's Gherkin and the state file, and the fix is one bound.
2. **The stored defaults are not observable through the black-box harness.** The `limits`
   *shape* — 32 / 30 / 5, and `null` for a disabled ceiling — is reviewed by eye, not by
   test: the child-process seam cannot see the config object and a second seam is forbidden.
   Every test here proves startup behavior, which is what the brief asks for, but a later
   slice that reads `limits` inherits an untested shape. `LOG.md`'s `next` section already
   requires task 7's ADR 0002 to say so for every config field; that note now covers `limits`
   as well.
3. **`README.md`'s configuration table has no rows for the four new variables.** Task 2 added
   a `PROXY_HOST` row as review fallout; task 3 added none for the rate pair and this task
   follows that precedent rather than widening scope. `specs/tech-architecture/tech-stack.md`'s
   startup-config table is explicitly task 8's, and `docs/adr/` is task 7's. The brief lists
   no README env-var requirement, so an operator reading only the README will not see these
   four yet.
4. **The `limits` field's line count makes `AGENTS.md`'s module-size note staler.**
   `AGENTS.md:85` and `CONVENTIONS.md:34` both say `server.test.js` is "~705 lines" and
   `config.js` "~52 lines"; the real numbers are now 1111 and 156. The 52 was already stale
   after task 3, and the brief scopes no line-count update, so I left both. Task 9 owns the
   module-split documentation.
5. **The ambient environment can leak into these tests.** `withProxy` and `runProxyOnce`
   both inherit `process.env`, so a machine or CI runner with any of the four set in the
   shell would break the "all four absent" and "all four blank" cases. Pre-existing harness
   behavior that the `PROXY_HOST` and rate-pair tests already live with; not changed here.
6. **The fatal-case tests surface a 4s harness timeout instead of an assertion failure when
   a guard is missing** (`'proxy process did not exit'` rather than `expected 0 to equal 1`).
   Same as task 3: correct, but slow and easy to misread as flakiness.

## Not done

- No red-first run of the new tests against the unmodified `config.js`; the mutation table
  above is the substitute, and each new behavior was observed failing at least once except
  the no-regression "all absent" guard, which is green by design.
- No push, no PR, nothing outside this worktree touched.
- Tasks 5-12 untouched. `tech-stack.md`'s startup-config table, `docs/adr/0002`, and
  `CONTEXT.md`'s glossary remain tasks 7 and 8, as the `next` section of `LOG.md` records.
