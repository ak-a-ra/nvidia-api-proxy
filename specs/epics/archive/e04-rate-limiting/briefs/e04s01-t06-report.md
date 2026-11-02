# Task report — e04s01 / task 6: a whitespace-only operational value is absent, not a number

Branch `epic-14-config-owner`. This task lands as a single commit, the one that
contains this file:

| Subject | Contents |
| --- | --- |
| `test(config): a whitespace-only operational value is absent, not a number` | 61 added lines in `server.test.js`, the eleven living-doc count edits, and this report |

Its SHA is not quoted here because a commit cannot contain its own hash; the
pre-task HEAD it sits on top of is `dfe0c41`, so `dfe0c41..HEAD` is this
task's whole diff.

Nothing pushed. No PR opened. Not merged to `main`.

`server.js` untouched by this task:

```
$ git diff dfe0c41..HEAD -- server.js | wc -l
0
```

(`dfe0c41` is the pre-task HEAD. Against the branch merge-base `4cc7fc6` the
diff is 89 lines, all of it task 1's config extraction — `git log 4cc7fc6..HEAD
-- server.js` lists only `947c199 refactor(config): extract config parsing into
config.js` and `cafcc41 feat(config): make the bind host configurable via
PROXY_HOST`, both from tasks 1–2. `sha256sum server.js` equals
`git show HEAD:server.js | sha256sum` before this task's commit.)

**One line of state: 78 tests, 78 pass, 0 fail; the task verify exits 0;
`config.js` needed no change and none was made.**

## Did `config.js` need a change? No, and none was made

The brief predicted this and the prediction holds. Every path by which a
whitespace-only value could reach a numeric guard already checks blankness
first. `config.js:90-93`, verbatim:

```js
  const hasConcurrency = Boolean(rawConcurrency?.trim());
  const hasQueueSize = Boolean(rawQueueSize?.trim());
  const hasQueueTimeout = Boolean(rawQueueTimeout?.trim());
  const hasMargin = Boolean(rawMargin?.trim());
```

`readLimits` calls `readPositiveInteger` only when the matching flag is true, so
`"   "` yields `Boolean("".trim())` → `false` → the documented default (32, 30,
5), and `null` for the concurrency ceiling. `readRateLimit` (`config.js:58-59`)
and `readModelLimits` (`config.js:136`) do the same, and `readSeconds`
(`config.js:291`) is lenient by design for the two timeout variables.

I looked for a path where a whitespace-only value slips past a guard and found
none, so there is no failing test that would justify a change and none was
written to manufacture one. The four mutation runs below are the evidence that
the guard is load-bearing rather than decorative.

## The tests added

Three, appended at the end of the existing `describe("operational limit config")`
block in `server.test.js`. Verbatim names:

1. `PROXY_MAX_QUEUE_SIZE and PROXY_QUEUE_TIMEOUT_SECONDS whitespace-only starts and serves /health, where 0 is fatal`
2. `PROXY_MAX_CONCURRENT_REQUESTS whitespace-only starts and serves /health`
3. `PROXY_SAFETY_MARGIN_PCT whitespace-only starts and serves /health`

Each follows the shape task 4 established at `server.test.js:1058`: a `for` loop
over the three blank shapes `["", "   ", " \t "]`, a fresh `withProxy` per
iteration, and an assertion message naming the shape it failed on
(`expected a successful start for ${JSON.stringify(blank)}`). Each test passes
the variable it covers explicitly in `proxyEnv`, so it pins absence rather than
whatever the author's shell happens to hold.

`server.test.js` is additive only:

```
$ git diff --stat -- server.test.js
 server.test.js | 61 ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
 1 file changed, 61 insertions(+)
$ git diff -- server.test.js | grep -c '^-[^-]'
0
```

Zero deletions, zero modifications, zero reorderings. The three tests sit after
the last existing test in the block, so no existing test changed position
relative to any other existing test. `LIMIT_VARIABLES`, `INVALID_VALUES`,
task 5's tables, `readPositiveInteger`'s signature, `integerRule`'s wording, the
`limits` members, `rateLimit`, `host`, `baseURL`, `apiKey`, `proxyToken`,
`unconfigured`, `readSeconds` and both exported timeout constants are all
untouched.

## What the tests do and do not prove

Stated in the comment above the first new test, because the comment is the
assertion a later reader needs:

- A successful start does **not** by itself show which branch was taken. The
  config object is invisible to a child-process test, so a blank concurrency
  ceiling and an explicit `0` are indistinguishable from outside. No test here
  claims otherwise.
- The falsifiable half is the two variables whose `0` is **fatal**,
  `PROXY_MAX_QUEUE_SIZE` and `PROXY_QUEUE_TIMEOUT_SECONDS`. Their existing zero
  test (`PROXY_MAX_QUEUE_SIZE and PROXY_QUEUE_TIMEOUT_SECONDS reject 0`) already
  pins exit 1; if whitespace were parsed as a number it would also exit 1 and
  the new test would fail. That is what "whitespace is absent, not 0" means when
  only a startup is observable.
- For `PROXY_MAX_CONCURRENT_REQUESTS` and `PROXY_SAFETY_MARGIN_PCT`, where `0`
  is legal, "starts" pins only that a whitespace value never reaches the integer
  guard — reaching it would be a rejection, not a silent default. The margin's
  0/50 boundary test and the concurrency zero-disables test are left exactly as
  they were; neither was weakened.
- The genuinely unprovable claim through this harness — whether whitespace and
  `0` reach the same internal state for the concurrency ceiling — belongs in
  task 7's ADR coverage list, alongside the defaults `32 / 30 / 5`.

## Verify

```
$ out=$(node --test --test-reporter=tap --test-name-pattern 'whitespace' server.test.js 2>&1); rc=$?; test $rc -eq 0 && t=$(printf '%s\n' "$out" | grep -E '^[[:space:]]*ok [0-9]+ - .*whitespace' | grep -cE 'PROXY_MAX_CONCURRENT|PROXY_MAX_QUEUE|PROXY_QUEUE_TIMEOUT|PROXY_SAFETY_MARGIN') && test "$t" -ge 1 && node -e "..."; echo "VERIFY EXIT: $?"
matching ok lines = 3
no new security findings in affected paths: blank values cannot disable a budget
VERIFY EXIT: 0
```

The TAP lines the verify greps, from
`node --test --test-reporter=tap --test-name-pattern 'whitespace' server.test.js`:

```
ok 1 - PROXY_HOST unset, empty, or whitespace-only binds 0.0.0.0
ok 1 - PROXY_RPM and PROXY_TPM blank (empty or whitespace-only) start with rate limiting disabled
ok 2 - PROXY_TPM set with PROXY_RPM whitespace-only exits 1 naming both variables
ok 1 - PROXY_MAX_QUEUE_SIZE and PROXY_QUEUE_TIMEOUT_SECONDS whitespace-only starts and serves /health, where 0 is fatal
ok 2 - PROXY_MAX_CONCURRENT_REQUESTS whitespace-only starts and serves /health
ok 3 - PROXY_SAFETY_MARGIN_PCT whitespace-only starts and serves /health
```

The first three are task 2's and task 3's pre-existing whitespace-named tests.
The rate-pair ones do not satisfy requirement 1 on their own, which is why they
are joined by the three above — each of which names one of task 4's four
variables.

`npm test`, in a clean shell (no `PROXY_*` variables exported — `env | grep
'^PROXY_'` was empty):

```
ℹ tests 78
ℹ suites 6
ℹ pass 78
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 84310.045749
```

New total: **78**, up from 75. The three added tests are the whole difference.

## Mutations — the gate is a gate

Five runs, all against the real verify or the real test binary, all reverted.
`config.js` was backed up with `cp` and restored by `cp` after each one; the
post-run `git diff --stat -- config.js` was empty every time, and the restored
file's four blank checks read back as `Boolean(rawX?.trim())`.

### Mutation 1 — brief-required: `PROXY_MAX_QUEUE_SIZE`'s blank check removed

`config.js:91`, `Boolean(rawQueueSize?.trim())` → `Boolean(rawQueueSize)`.

```
node --test rc under mutation 1 = 1
VERIFY EXIT under mutation 1 = 1
```

Test that caught it:

```
not ok 1 - PROXY_MAX_QUEUE_SIZE and PROXY_QUEUE_TIMEOUT_SECONDS whitespace-only starts and serves /health, where 0 is fatal
  error: 'proxy exited 1'
```

The `""` iteration still starts — `Boolean("")` is `false` either way — and the
`"   "` iteration is where it dies. The mutated child says:

```
PROXY_MAX_QUEUE_SIZE must be a positive integer, got: 
```

which is precisely the story's §12 failure in miniature: a blank operator value
reaching the numeric guard instead of being treated as unset.

### Mutation 2 — brief-required alternative: the same check inverted

`config.js:91`, `Boolean(rawQueueSize?.trim())` →
`!Boolean(rawQueueSize?.trim())`.

```
node --test rc under mutation 2 = 1
VERIFY EXIT under mutation 2 = 1
not ok 1 - PROXY_MAX_QUEUE_SIZE and PROXY_QUEUE_TIMEOUT_SECONDS whitespace-only starts and serves /health, where 0 is fatal
not ok 2 - PROXY_MAX_CONCURRENT_REQUESTS whitespace-only starts and serves /health
not ok 3 - PROXY_SAFETY_MARGIN_PCT whitespace-only starts and serves /health
```

All three new tests go red, and so does the pre-existing
`PROXY_MAX_QUEUE_SIZE and PROXY_QUEUE_TIMEOUT_SECONDS reject 0` with
`error: 'proxy process did not exit'` — the inversion makes an absent variable
take the parse branch, so the child crashes on `undefined.trim()` and never
exits at all. Worth recording honestly: the inversion's blast radius is wider
than the blank-value defect, so the concurrency and margin tests fail here
because the child cannot boot, not because their own blank value was mishandled.
That is why mutations 3–5 below isolate them.

### Mutations 3–5 — the brief's decorative-test question, per variable

The brief's item 2 asks what happens "if the whitespace tests pass with the blank
check deleted". They do not. To show each of the three remaining checks is a
gate for its own test rather than a passenger, I removed `.trim()` from one flag
at a time and ran only the new tests:

```
=== mutation: hasConcurrency blank check removed -> 90:  const hasConcurrency = Boolean(rawConcurrency); ===
        ok 1 - PROXY_MAX_QUEUE_SIZE and PROXY_QUEUE_TIMEOUT_SECONDS whitespace-only starts and serves /health, where 0 is fatal
        not ok 2 - PROXY_MAX_CONCURRENT_REQUESTS whitespace-only starts and serves /health
        ok 3 - PROXY_SAFETY_MARGIN_PCT whitespace-only starts and serves /health
=== mutation: hasQueueTimeout blank check removed -> 92:  const hasQueueTimeout = Boolean(rawQueueTimeout); ===
        not ok 1 - PROXY_MAX_QUEUE_SIZE and PROXY_QUEUE_TIMEOUT_SECONDS whitespace-only starts and serves /health, where 0 is fatal
        ok 2 - PROXY_MAX_CONCURRENT_REQUESTS whitespace-only starts and serves /health
        ok 3 - PROXY_SAFETY_MARGIN_PCT whitespace-only starts and serves /health
=== mutation: hasMargin blank check removed -> 93:  const hasMargin = Boolean(rawMargin); ===
        ok 1 - PROXY_MAX_QUEUE_SIZE and PROXY_QUEUE_TIMEOUT_SECONDS whitespace-only starts and serves /health, where 0 is fatal
        ok 2 - PROXY_MAX_CONCURRENT_REQUESTS whitespace-only starts and serves /health
        not ok 3 - PROXY_SAFETY_MARGIN_PCT whitespace-only starts and serves /health
```

Exactly one test goes red per mutation, and it is always the one naming the
mutated variable. No coverage hole to report: each of the three new tests is
falsifiable against the guard it covers.

### Restored

```
$ grep -n 'const has\(Concurrency\|QueueSize\|QueueTimeout\|Margin\) =' config.js
90:  const hasConcurrency = Boolean(rawConcurrency?.trim());
91:  const hasQueueSize = Boolean(rawQueueSize?.trim());
92:  const hasQueueTimeout = Boolean(rawQueueTimeout?.trim());
93:  const hasMargin = Boolean(rawMargin?.trim());
matching ok lines = 3
no new security findings in affected paths: blank values cannot disable a budget
VERIFY EXIT (restored) = 0
```

The brief's mutation-2 check — "do not remove or reword the blank checks to make
anything else pass" — was satisfied in the only direction available: the checks
are exactly as shipped, and the temporary backup file was deleted.

## The count sweep

Before (75 everywhere, `AGENTS.md`'s parenthetical listed separately because the
sweep's pattern does not match it):

```
$ grep -rnE 'tests(-| )?[0-9]{2,4}|[0-9]{2,4}[ -]?tests?' --include='*.md' --include='*.yaml' . \
    | grep -vE '^\./(plans/|docs/research/|LOG\.md|specs/epics/)'
./AGENTS.md:89:- `npm test` — full suite (75 tests, ...
./AGENTS.md:107:  Sites as of 2026-09-30: `README.md:9` badge `tests-75%20passing`, ...
./CONVENTIONS.md:17:- `npm test` — runs all 75 tests
./README.md:9:[![Tests](https://img.shields.io/badge/tests-75%20passing-blue?style=flat-square)](server.test.js)
./README.md:86:> Run the test suite (75 tests, no deps needed):
./specs/README.md:19:- 75 tests in server.test.js
./specs/product/VISION_LATEST.yaml:20:  - 75 tests covering all major scenarios
./specs/tech-architecture/TEST_PLAN_LATEST.md:44:- 75 tests covering all major scenarios
./specs/tech-architecture/TEST_PLAN_LATEST.md:294:- All 75 tests must pass
./specs/tech-architecture/TEST_PLAN_LATEST.md:351:... The 75-test suite provides good coverage ...
./specs/tech-architecture/tech-stack.md:129:- **Test Count**: 75 tests
$ grep -n 'currently 7' AGENTS.md
106:- Test count synced in **every** living doc that states one (currently 75) — ...
```

After — all eleven sites say 78, and the negative filter finds nothing left:

```
$ grep -rnE 'tests(-| )?[0-9]{2,4}|[0-9]{2,4}[ -]?tests?' --include='*.md' --include='*.yaml' . \
    | grep -vE '^\./(plans/|docs/research/|LOG\.md|specs/epics/)' \
    | grep -vE 'tests(-| )?78|[^0-9]78[ -]?tests?|78-test'
(empty)
$ grep -n 'currently 7' AGENTS.md
106:- Test count synced in **every** living doc that states one (currently 78) — ...
```

Eleven edits: `AGENTS.md:89`, `AGENTS.md:106`, `AGENTS.md:107` (badge string in
the site list), `CONVENTIONS.md:17`, `README.md:9`, `README.md:86`,
`specs/README.md:19`, `specs/product/VISION_LATEST.yaml:20`, and
`TEST_PLAN_LATEST.md:44,294,351`, `tech-stack.md:129`.

Two non-count edits in `AGENTS.md` the brief's line-number warning implies:

- `server.test.js (~1492 lines)` → `(~1553 lines)`, 61 lines added.
- Nothing else. `server.js` (~249 lines) and `config.js` (~303 lines) are
  unchanged by this task.

Stale-number sweep for 74–77 across the living docs returns one hit,
`README.md:29`, which is an SVG coordinate `y="75"` inside the architecture
diagram — not a count, left alone.

## Deviations, and things the brief got wrong or left loose

1. **Mutation numbering (the Verify section's item 2 is not a mutation).** The
   brief says "Two mutations, both required", then item 2 is a conditional
   ("if the whitespace tests pass with the blank check deleted, report that as a
   coverage hole"). I ran item 1 twice — the removal it names, and the inversion
   it offers as an alternative — so "two mutations in both directions" is
   satisfied, and then ran three further single-flag removals to answer the
   conditional per variable rather than globally. Five runs total, each recorded
   above. Nothing was skipped; the count is larger than the brief asked for
   because one global mutation cannot attribute the concurrency and margin tests.
2. **Test placement is an insertion at the end of an existing `describe`, not an
   append to the end of the file.** "Additive only" is honoured in the sense
   that matters — zero deletions, zero modifications, zero reorderings of
   existing tests — but the three tests land inside
   `describe("operational limit config")`, reusing its `BASE_ENV` convention and
   keeping the whitespace coverage next to the boundary and zero tests it is
   argued against. Consequence: the absolute line numbers of every test after
   the insertion point shift by 61, which invalidates the "Sites as of
   2026-09-30" line-number references in `AGENTS.md:107` for the sites after
   this block. Those references were already flagged as unreliable ("grep, never
   trust this list or its line numbers") and no line number in that list shifted
   in a doc I edited, so I corrected the count strings and left the line numbers
   alone. Appending after the file's last `})` instead would avoid the shift but
   would strand the tests in an unrelated describe block, which reads worse.
3. **A stale count in the epic story file, excluded by this task.** `AGENTS.md:107`
   lists `specs/epics/e04-rate-limiting/e04s01-config-owner-and-bind-host.md:336`
   as a count site. That line reads `(56 tests)` and still does. `specs/epics/`
   is excluded from the sweep and from this task's scope, so I did not edit it —
   but the entry in `AGENTS.md` is now provably wrong in two ways, and task 12's
   verify excludes briefs and task ledgers while *not* excluding the story file,
   so it may fail on that line. Flagging for the story-level owner; not fixing it
   here.
4. **Ambient-env hazard: not reproduced, not worked around.** The brief warns
   that an exported `PROXY_SAFETY_MARGIN_PCT=51` or `PROXY_RPM=5` collapses the
   count. This shell had no `PROXY_*` variables exported (`env | grep '^PROXY_'`
   printed `no PROXY_ vars in shell`), the baseline read a clean 75, and both the
   new-total run and every mutation run were done in that same clean
   environment. I did not reproduce the polluted runs, did not add any hermeticity
   guard, and did not touch `withProxy` — that decision belongs to task 11. One
   concrete note for task 11: `runProxyOnce` and `startProxyServer` both spread
   `...process.env`, so an ambient `PROXY_RPM=5` without `PROXY_TPM` makes *every*
   fatal-case child exit 1 for the wrong reason, which is what turns 78 into 11.
5. **No `config.js` defect found, so no defect to report.** Requirement 3's
   "quote the path that reached a numeric guard" has no answer because there is
   none. The mutation table is the substitute evidence, and it is evidence about
   the guard's load-bearing-ness rather than about a bug that shipped.