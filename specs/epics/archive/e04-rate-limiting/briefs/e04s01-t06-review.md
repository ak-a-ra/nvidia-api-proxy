# Task review — e04s01 / task 6: a whitespace-only operational value is absent, not a number

Commit `42b2d2b`, parent `dfe0c41`, branch `epic-14-config-owner`. Reviewed read-only; the
worktree was not modified. Mutations were run in a throwaway copy under `$HOME/.cache/t06rev`,
since a mutation test cannot be run without editing `config.js`. That copy is deleted and
`git status --untracked-files=all` in the worktree is empty.

**Verdict: SHIP.** Nothing blocks. The findings below are nits and one carried-forward risk for
task 12.

---

## 1. Spec compliance

Requirements from `specs/epics/e04-rate-limiting/briefs/e04s01-t06.md`, checked against story
§11/§12 (`e04s01-config-owner-and-bind-host.md:186-205`) and task 6 of
`e04s01-tasks.yaml:80-96`. Story wins on disagreement; there was no disagreement to resolve.

| # | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Test names contain `whitespace` **and** a task-4 variable; all four variables covered | Met | `server.test.js:1148`, `:1167`, `:1182`. `PROXY_MAX_QUEUE_SIZE` + `PROXY_QUEUE_TIMEOUT_SECONDS` share one name, so the four variables are covered by three tests. The verify's `grep -cE` returns 3. |
| 2 | Each whitespace-only shape starts the proxy and serves `/health` 200, following the `server.test.js:1058` shape | Met | All three loop `["", "   ", " \t "]`, fresh `withProxy` per iteration, message `expected a successful start for ${JSON.stringify(blank)}`. |
| 3 | Cover the two variables where `0` is fatal; state the limit of what is provable in a comment | Met | Name at `:1148` says "where 0 is fatal" and names both. Comment at `:1131-1146` states the config object is invisible to the child-process harness and that no test claims whitespace reaches the same internal state as `0`. |
| 4 | `PROXY_SAFETY_MARGIN_PCT` boundary stays pinned, nothing weakened | Met | `:1094-1103` and `:1022-1043` untouched (0 deletions in `server.test.js`). |
| 5 | Verify's static half still sees `trim()` in `config.js`; blank checks not reworded | Met | `git diff dfe0c41..42b2d2b -- config.js \| wc -l` → `0`. |
| M1 | `server.js` byte-identical | Met | `git diff dfe0c41..42b2d2b -- server.js \| wc -l` → `0`. |
| M2 | `server.test.js` additive only — 0 deletions, 0 modifications, 0 reorderings | Met | `--numstat` → `61 0 server.test.js`; `git diff … -- server.test.js \| grep -c '^-[^-]'` → `0`. See §3. |
| M3 | Existing test names unchanged (incl. the four `blank` ones) | Met | Pure insertion; no `-` lines at all. |
| M4 | `LIMIT_VARIABLES`, `INVALID_VALUES`, task-5 tables, `readPositiveInteger` signature, `integerRule` wording, `rateLimit`, `limits` members, `host`, `baseURL`, `apiKey`, `proxyToken`, `unconfigured`, `readSeconds`, both timeout constants | Met | `config.js` diff is 0 lines; `server.test.js` insertion is after the last existing test in the block. |
| M5 | Credential regime preserved | Met | `config.js` untouched; suite green at 78. |
| M6 | `package.json`, dependencies | Met | `git diff … -- package.json \| wc -l` → `0`. No `dependencies` field. |
| D | Count sweep clean at the new total across living docs | Met | See §6. |
| D | Mutations run in both directions, each recorded | Met | Re-derived independently; see §2. |

Nothing unmet, nothing partial.

## 2. Test quality — the core question

**Would these tests fail if the blank check were removed? Yes. I re-ran three of the five
mutations myself** (throwaway copy, `node --test --test-name-pattern 'whitespace-only starts'`):

```
# hasQueueSize trim removed
  const hasQueueSize = Boolean(rawQueueSize);
    ok 1 - PROXY_MAX_QUEUE_SIZE and PROXY_QUEUE_TIMEOUT_SECONDS whitespace-only starts and serves /health, where 0 is fatal
    not ok 2 - PROXY_MAX_CONCURRENT_REQUESTS whitespace-only starts and serves /health
    ok 3 - PROXY_SAFETY_MARGIN_PCT whitespace-only starts and serves /health
# pass 2   # fail 1

# hasConcurrency trim removed
  const hasConcurrency = Boolean(rawConcurrency);
    ok 1 - …PROXY_MAX_QUEUE_SIZE and PROXY_QUEUE_TIMEOUT_SECONDS whitespace-only starts…
    not ok 2 - PROXY_MAX_CONCURRENT_REQUESTS whitespace-only starts and serves /health
    ok 3 - PROXY_SAFETY_MARGIN_PCT whitespace-only starts and serves /health
# pass 2   # fail 1

# hasMargin trim removed
  const hasMargin = Boolean(rawMargin);
    ok 1 / ok 2 / not ok 3 - PROXY_SAFETY_MARGIN_PCT whitespace-only starts and serves /health
# pass 2   # fail 1
```

Full suite under the `hasQueueSize` mutation: `ℹ tests 78 / ℹ pass 76 / ℹ fail 2` — the new
queue test plus the pre-existing four-variable `blank start and serve /health` at `:1009`.
The implementer's claims reproduce exactly: **one test red per single-variable mutation, always
the one naming the mutated variable, and no decorative test.**

Mechanism, confirmed by reading `config.js:265-267`: `readPositiveInteger` does
`const trimmed = raw.trim()` and gates on `/^[0-9]+$/`, so `""` fails the regex and exits 1 —
`Number("  ")` coercion never decides anything. Removing a blank check therefore produces a
false-fatal crash, not a silent 0. The tests pin exactly that.

**The decorative-test question.** The comment at `server.test.js:1136-1146` states the limit
honestly and correctly: for `PROXY_MAX_CONCURRENT_REQUESTS` and `PROXY_SAFETY_MARGIN_PCT`,
"starts" cannot separate absent from 0, because the config object is invisible across the
child-process IPC boundary. I checked that this is not a cop-out:

- For the concurrency ceiling the distinction is also behaviourally inert —
  `config.js:103` maps both `null` and `0` to `maxConcurrentRequests: null`, so "absent" and
  "0 disables" are the same stored state.
- For the margin, absent → `5` and a hypothetical whitespace-as-0 → `0` do differ in the stored
  config, but nothing reads `safetyMarginPct` yet (story §16: "validated and stored only"), so no
  observable behaviour differs today.

So the gap the brief named is real, is correctly declared unobservable through this harness, and
is routed to task 7's ADR obligation (`e04s01-tasks.yaml:99-116`, which already requires the ADR
to record "the coverage gap task 4 left open … reviewed by eye and not by test"). Covering the
two where `0` is fatal genuinely closes what can be closed. Requirement 3 is satisfied without
overclaiming.

Test placement: insertion at the tail of `describe("operational limit config")` rather than at
end-of-file. The brief's "append" is honoured in the sense that matters (no existing test moved),
and it keeps the whitespace coverage adjacent to the zero and boundary tests it is argued against.
I agree with the choice over end-of-file.

## 3. Additive-only

```
$ git diff --numstat dfe0c41..42b2d2b
44AGENTS.md   11CONVENTIONS.md   22README.md   610server.test.js
11specs/README.md   3500…-t06-report.md   1640…-t06.md
11specs/product/VISION_LATEST.yaml   33…/TEST_PLAN_LATEST.md   11…/tech-stack.md
$ git diff dfe0c41..42b2d2b -- server.test.js | grep -c '^-[^-]'
0
```

`server.test.js` is `61 0` — one hunk, `@@ -1127,6 +1127,67 @@`, context-only above and below,
with the new tests between the last existing test's closing `});` and the block's own `});`.
Reading the hunk: no existing identifier, table, test name, or assertion is altered. **Zero
deletions, zero modifications, zero reorderings — confirmed by reading, not by the stat.**

## 4. `server.js` untouched

```
$ git diff dfe0c41..42b2d2b -- server.js | wc -l
0
```
`--numstat` shows no entry for `server.js`, `config.js`, or `package.json` at all.

## 5. No `config.js` change was needed — independently confirmed

Read every reader in `config.js`. Every path that touches an operator value checks blankness
first:

- `config.js:8` `if (!rawBase?.trim())` — before `new URL`.
- `config.js:34` `rawHost?.trim() ? rawHost : "0.0.0.0"`.
- `config.js:58-59` `hasRpm` / `hasTpm` = `Boolean(rawX?.trim())`, checked at `:60` and `:67`
  before `readPositiveInteger` at `:69-70`.
- `config.js:90-94` `hasConcurrency`, `hasQueueSize`, `hasQueueTimeout`, `hasMargin`,
  `hasMaxBodyBytes` — all `Boolean(rawX?.trim())`, and each guards its `readPositiveInteger`
  call at `:96`, `:105`, `:108`, `:113`, `:119`.
- `config.js:136` `if (!raw?.trim()) return null;` — before `JSON.parse`.
- `config.js:291` `if (!val?.trim()) return fallback;` in `readSeconds`, before `Number(val)`.
- `config.js:265-267` `readPositiveInteger` itself trims and gates on `/^[0-9]+$/`, so even a
  whitespace value that reached it is fatal, never adopted as `0`.
- `config.js:43` `unconfigured` uses `?.trim()`.

**No path lets a whitespace-only value reach a numeric guard. No P0.** The "no change needed"
finding is correct, and refusing to manufacture a `config.js` diff was the right call.

Out of scope, pre-existing, noted only so it is not rediscovered as task-6 debt:
`server.js:10` `Number(process.env.PORT || 10000)` coerces a whitespace-only `PORT` to `0`
(random port). `PORT` is not one of the story's operational variables and predates this work.

## 6. Test-count sync

Derived, not trusted:

```
$ env -u PROXY_RPM -u PROXY_TPM -u PROXY_MAX_CONCURRENT_REQUESTS -u PROXY_MAX_QUEUE_SIZE \
  -u PROXY_QUEUE_TIMEOUT_SECONDS -u PROXY_SAFETY_MARGIN_PCT -u PROXY_MAX_BUFFERED_BODY_BYTES \
  -u PROXY_MODEL_LIMITS_JSON -u PROXY_HOST npm test
ℹ tests 78
ℹ suites 6
ℹ pass 78
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ duration_ms 69490.212525
```

**78 is the real total.** Every living-doc count site says 78:

```
$ grep -rnE 'tests(-| )?[0-9]{2,4}|[0-9]{2,4}[ -]?tests?' --include='*.md' --include='*.yaml' . \
    | grep -vE '^\./(plans/|docs/research/|LOG\.md|specs/epics/)' \
    | grep -vE 'tests(-| )?78|[^0-9]78[ -]?tests?|78-test'
(empty)
```

Sweep hits (11) plus the `AGENTS.md` parenthetical the pattern cannot match
(`AGENTS.md:106`, "currently 78") — all 12 count strings agree. `AGENTS.md` by hand:
`AGENTS.md:89` "78 tests" in the `npm test` bullet; `AGENTS.md:106` "(currently 78)";
`AGENTS.md:107` badge string `tests-78%20passing`. Stale-number sweep for 74–77 across living
docs returns exactly one hit, `README.md:29`, an SVG `y="75"` coordinate inside the architecture
diagram — not a count. `AGENTS.md:85` line count updated 1492 → 1553; `wc -l server.test.js` →
`1553`. Exact.

## 7. Does the verify gate?

```
$ out=$(node --test --test-reporter=tap --test-name-pattern 'whitespace' server.test.js 2>&1); rc=$?; …
no new security findings in affected paths: blank values cannot disable a budget
VERIFY EXIT: 0
matching ok lines = 3
```

Exits 0. On vacuity, as the brief anticipated:

- **The static half is vacuous.** `node -e` greps `config.js` for `/trim\(\)/` — present at 15
  sites in the untouched file, and the grep is not scoped to the operational readers, so it would
  pass even with all five operational blank checks deleted. It proves only "the string `trim()`
  exists", nothing about ordering. The brief's mutation requirement is what makes the gate real,
  and that half is not automatable in this story.
- **The dynamic half is not vacuous.** `rc -eq 0` means every `whitespace`-matching test passed,
  and `t >= 1` would be satisfied by a single pre-existing rate-pair test if the three new ones
  were deleted and the suite were otherwise unchanged. So the gate does *not* enforce "all four
  variables are covered" — it enforces "at least one passing whitespace test names a task-4
  variable". This is the task's own stated gate and it matches the brief's text; the four-variable
  requirement was satisfied by inspection (§1, requirement 1) and by the mutation runs (§2), not
  by the gate. Worth stating plainly rather than leaving implied.

## 8. Style and conventions

- ESM throughout; the new tests use only `withProxy`, `proxiedFetch`, and `assert` already
  imported at the top of `server.test.js`. No new imports.
- Zero dependencies. `package.json` untouched. `node:` built-ins only.
- Comments explain a non-obvious constraint (harness blindness, which variable's `0` is fatal,
  why the boundary test is untouched). They do not narrate the edit. No "Note that", no
  step-by-step, no emoji, no AI-slop phrasing. Length is at the high end of house style but every
  line carries information the next reader needs — in particular `:1143-1146`, which forbids the
  over-claim a future editor would be tempted to make.
- `t.after` cleanups registered per iteration, matching the existing blank test at `:1058`.
- Commit message states the finding, the mutations, the count move, and that `server.js` is
  byte-identical, with evidence. Good.

---

## Findings

### P2 — `AGENTS.md:107` "Sites as of 2026-09-30" is a day stale after a 2026-10-01 edit

This commit rewrote that line (count strings) but left the date at `2026-09-30`; the commit is
authored `Thu Oct 1 20:14:05 2026`. The line is a dated inventory that this commit materially
edited, so the date now understates its own currency. One-word fix: `2026-10-01`. Not blocking —
the line already carries "grep, never trust this list or its line numbers".

### P2 — `CONVENTIONS.md:33-34` line counts left at `~294` / `~705` while `AGENTS.md:85` was updated

`AGENTS.md:85` was corrected to `server.test.js (~1553 lines)` in this commit, but
`CONVENTIONS.md:34` still reads `server.test.js — Test suite (~705 lines)`. Both numbers are
stale and `~705` predates several prior tasks, so this is inherited debt rather than a
regression — but this commit touched `CONVENTIONS.md:17` and the sibling file it now contradicts
is the one it refreshed in `AGENTS.md`. Lowest priority: nothing greps for line counts.

### P2 — the report and commit message both say "eleven sites"; there are twelve

`e04s01-t06-report.md:23` and `42b2d2b`'s body say "eleven living-doc count edits" / "all eleven
sites", and the report then enumerates twelve (`AGENTS.md:89`, `:106`, `:107`, `CONVENTIONS.md:17`,
`README.md:9`, `README.md:86`, `specs/README.md:19`, `VISION_LATEST.yaml:20`,
`TEST_PLAN_LATEST.md:44,294,351`, `tech-stack.md:129`). Eleven is what the grep returns; twelve is
what was edited, because the `AGENTS.md:106` parenthetical is invisible to the pattern. The brief
asks that every quoted number be one observed in output — the enumeration is right and the summary
word is one short. Fix the word, not the list.

### P2 — report deviation 2 is self-contradictory about `AGENTS.md:107` line numbers

`e04s01-t06-report.md:317-324` argues the 61-line insertion "invalidates the 'Sites as of
2026-09-30' line-number references in `AGENTS.md:107`", then concludes "no line number in that
list shifted in a doc I edited, so I corrected the count strings and left the line numbers alone."
The second statement is the correct one — `AGENTS.md:107` inventories *doc* line numbers
(`README.md:9`, `CONVENTIONS.md:17`, …), and all edits were in-place single-line replacements, so
no line number moved. I re-derived every one; they all still point at the right lines. The first
sentence is a false alarm about the reader's own change. Harmless, but it is the kind of claim
that makes a later reader distrust a correct inventory.

### P2 — report §"Verify" quotes an incomplete TAP block

`e04s01-t06-report.md:122-133` presents seven… six `ok … whitespace` lines as "The TAP lines the
verify greps". My identical run emits seven, the extra being the pre-existing
`server.test.js:549` `empty or whitespace timeout env vars fall back to defaults`. No line is
fabricated and the `grep -cE` result of `3` is correct either way, but a quoted command output
should be complete.

### P1 (forward-looking, not this task's defect) — task 12's count gate will fail on the story file

Confirmed as flagged. `specs/epics/e04-rate-limiting/e04s01-config-owner-and-bind-host.md:336`
still reads:

```
- Refactor regression in working code → detected by the unchanged existing suite (56 tests)
```

`e04s01-tasks.yaml:195` (task 12) excludes `plans/`, `docs/research/`, `LOG.md`,
`specs/epics/*/briefs/`, and `specs/epics/*-tasks.yaml` — but **not** the story `.md`. Simulated
with `n=78`, the negative grep returns that line and nothing else:

```
$ grep -rnE 'tests(-| )?[0-9]{2,4}|[0-9]{2,4}[ -]?tests?' --include='*.md' --include='*.yaml' . \
    | grep -vE '^\./(plans/|docs/research/|LOG\.md|specs/epics/.*/briefs/|specs/epics/.*-tasks\.yaml)' \
    | grep -vE 'tests(-| )?78|[^0-9]78[ -]?tests?'
./specs/epics/e04-rate-limiting/e04s01-config-owner-and-bind-host.md:336:- Refactor regression … (56 tests)
```

(`grep -q "tests-78%20passing" README.md` passes, so the badge half of the gate is fine.)

This is **not** task 6's to fix — `specs/epics/` is excluded from this task's sweep, the story's
`56` is a historical "the suite as it stood in task 1" figure rather than a claim about the suite
today, and rewriting story prose to satisfy a later task's grep is the wrong direction. Action for
the story-level owner before task 12 runs: either drop the parenthetical at `:336` (it is already
hedged by the surrounding prose) or extend task 12's exclusion to the story file. Left as-is, task
12 fails on a line task 6 was right not to touch.

## What I verified by running

| Command | Decisive output |
| --- | --- |
| `git diff --numstat dfe0c41..42b2d2b` | `610server.test.js`; every other file count-only |
| `git diff dfe0c41..42b2d2b -- server.test.js \| grep -c '^-[^-]'` | `0` |
| `git diff dfe0c41..42b2d2b -- server.js \| wc -l` | `0` |
| `git diff dfe0c41..42b2d2b -- config.js package.json \| wc -l` | `0` |
| `git diff dfe0c41..42b2d2b -- server.test.js` (read in full) | one hunk `@@ -1127,6 +1127,67 @@`, insertion only, context-only above/below |
| `npm test` (9 `PROXY_*` vars unset, ~70 s) | `ℹ tests 78 / ℹ pass 78 / ℹ fail 0` |
| task-6 verify, verbatim from the brief | `VERIFY EXIT: 0`, `matching ok lines = 3` |
| same verify under `hasQueueSize` `.trim()` removed | `not ok 1 - PROXY_MAX_QUEUE_SIZE and PROXY_QUEUE_TIMEOUT_SECONDS whitespace-only …`, `Error: proxy exited 1`; full suite `pass 76 / fail 2` |
| same, `hasConcurrency` `.trim()` removed | `# pass 2 / # fail 1`, the red one is the `PROXY_MAX_CONCURRENT_REQUESTS` test |
| same, `hasMargin` `.trim()` removed | `# pass 2 / # fail 1`, the red one is the `PROXY_SAFETY_MARGIN_PCT` test |
| scratch `config.js` restored, `diff` vs worktree | `[ok] Files are identical` |
| count sweep + negative filter | negative filter empty; 11 grep hits, all 78 |
| stale sweep `\b(74\|75\|76\|77)\b`, living docs | one hit, `README.md:29`, an SVG `y="75"` coordinate |
| `wc -l server.test.js config.js server.js` | `1553 / 303 / 249` — matches `AGENTS.md:85` |
| task-12 negative grep simulated with `n=78` | hits `e04s01-config-owner-and-bind-host.md:336` only |
| `grep -n '56 tests'` on the story | line `336` |
| read `config.js` end to end; read `server.test.js:98-190`, `:944-1200` | no path from a whitespace-only value to a numeric guard |

Not run, and therefore not verified:

- **The implementer's mutations 2 (inversion) and 4 (`hasQueueTimeout`).** The brief requires both
  directions and the report describes both; I re-ran three of five and they reproduce the stated
  one-red-per-mutation property exactly, which is the property the brief's item 2 turns on. The
  inversion's wider blast radius (child crashes on `undefined.trim()`, so all three new tests plus
  the existing zero test go red) is plausible from reading `config.js:60-70` and is not disputed,
  but I did not observe it.
- **The report's exact `duration_ms` (84310 ms) and its `env | grep '^PROXY_'` observation.** My run
  measured 69490 ms; timings are machine- and load-dependent and not a claim worth re-deriving.
  I did confirm no `PROXY_*` variable is exported in this shell — only an ambient
  `NVIDIA_API_KEY`, which `withProxy` overrides with `"sk"` anyway.
- **The ambient-env hazard in report deviation 4** (an exported `PROXY_RPM=5` collapsing the count
  to 11). Not reproduced; the brief assigns it to task 11 and the mitigation (hermetic
  `runProxyOnce` / `startProxyServer` env) is out of scope here. I read both helpers and confirm
  they do spread `...process.env`, so the hazard is real.
- **`README.md:29` SVG coordinate `y="75"` judged not-a-count** by reading the line. Confident, but
  it is a judgement, not a measurement.
