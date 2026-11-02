# Task report — e04s01 / task 5: the buffered-body ceiling and the per-model limits map

Branch `epic-14-config-owner`. Commits, oldest first:

| SHA | Subject |
| --- | --- |
| `21279f2` | `test(config): the buffered-body ceiling and per-model limits, pinned before they exist` |
| `2199159` | `feat(config): the buffered-body ceiling and the per-model limits map` |
| `b954b32` | `docs: the living test count moves to 72 across every doc that states one` |
| `7f94959` | `docs: task 5 report` |
| `068fcd8` | `docs: task 5 review — SHIP WITH FIXES, no P0 or P1` |
| `ea40402` | `docs: correct the task 5 brief and widen task 7's ADR obligation` |
| `4d69152` | `test(config): four additions that fail against the unfixed fatal path` |
| `ef718b5` | `fix(config): the fatal message can no longer crash or flood, and a control character in a model key is fatal` |
| `76908c7` | `test(config): the pathological-value test also pins the primitive-text bound` |
| `56a12c7` | `docs: the living test count moves to 75 across every doc that states one` |

Nothing pushed. `server.js` untouched by this task:

```
$ git diff 83fc7bc..HEAD -- server.js | wc -l
0
```

(`83fc7bc` is the pre-task HEAD. Against the branch merge-base `4cc7fc6` the diff is 89 lines, all of it task 1's config extraction.)

> **2026-10-01 — this report is now in its second revision.** The review round
> (`068fcd8`) found three P2 and nine P3 findings. The code fixes landed in
> `4d69152`/`ef718b5`/`76908c7`, the count sync in `56a12c7`, and the corrections
> to *this document* are in the **Review round 2** section at the end, with a
> dated note at each place below that was wrong. Round 1's own record is left
> standing: nothing from `7f94959` is deleted, and its mutation table is kept
> verbatim next to the round-2 table re-run against the current code. Where a
> round-1 sentence is now known to be wrong it is marked in place, with the
> correction beside it. The current state in one line: **75 tests, 75 pass, 0
> fail; the task verify exits 0; one accepted fail-open (a duplicate top-level
> model key) and one live story-file count that task 12's verify will fail on.**

## The config shape this task adds

`parseConfig`'s return, quoted from `config.js`:

```js
  return {
    baseURL: rawBase,
    host: rawHost?.trim() ? rawHost : "0.0.0.0",
    rateLimit: readRateLimit(env),
    limits: readLimits(env),
    // Its own field, parallel to rateLimit: limits holds scalar ceilings, this
    // holds a map of budgets. A caller must not be able to read a per-model
    // budget map beside a half-configured global rate pair.
    modelLimits: readModelLimits(env),
    apiKey: env.NVIDIA_API_KEY,
    proxyToken: env.PROXY_AUTH_TOKEN,
    unconfigured: !env.NVIDIA_API_KEY?.trim() || !env.PROXY_AUTH_TOKEN?.trim(),
  };
```

`limits` gains one member, the ceiling:

```js
    // 8 MiB, the plain positive-integer rule like every other ceiling here.
    // 0 is fatal, not a disable: a zero-byte buffer rejects every request body,
    // a limit that appears to exist and does not.
    maxBufferedBodyBytes: hasMaxBodyBytes
      ? readPositiveInteger("PROXY_MAX_BUFFERED_BODY_BYTES", rawMaxBodyBytes)
      : 8388608,
```

`modelLimits` is `null` when the variable is absent or blank, and otherwise a
null-prototype map of model key → `{ rpm?, tpm? }`, keys stored byte for byte:

```js
  const limits = Object.create(null);
  …
    budget[field] = readPositiveInteger(`PROXY_MODEL_LIMITS_JSON["${model}"].${field}`, String(value));
    …
    limits[model] = budget;
  return limits;
```

Stored shape, read back from a scratch probe that imported `parseConfig` directly
(nothing committed, no second test seam added):

```
absent           {"limits":{…,"maxBufferedBodyBytes":8388608},"modelLimits":null}
blank            {"limits":{…,"maxBufferedBodyBytes":8388608},"modelLimits":null}
ceiling 4096     {"limits":{…,"maxBufferedBodyBytes":4096},"modelLimits":null}
proto key        {"limits":{…},"modelLimits":{"__proto__":{"rpm":5}}}
```

**2026-10-01 — re-measured against the fixed `config.js`, not carried forward.**
The probe was re-run; all four lines still hold and one more was added:

```
absent         {"maxBufferedBodyBytes":8388608,"modelLimits":null}
blank          {"maxBufferedBodyBytes":8388608,"modelLimits":null}
ceiling 4096   {"maxBufferedBodyBytes":4096,"modelLimits":null}
proto key      {"maxBufferedBodyBytes":8388608,"modelLimits":{"__proto__":{"rpm":5}}}
both fields    {"maxBufferedBodyBytes":8388608,"modelLimits":{"gpt":{"rpm":5,"tpm":9}}}
```

The `__proto__` row is the one that matters: `JSON.stringify` lists the key, so
it is an own enumerable property of the stored map, which is what
`Object.create(null)` buys. Mutation P2 below is that same claim stated as a
mutation, and it is green — see the coverage holes.

## Tests added

One new `describe("buffered body ceiling and per-model limits")` block, appended
after `operational limit config`.

**2026-10-01 (review round 2).** Round 1 recorded sixteen tests. The block now
holds **nineteen**: `4d69152` and `76908c7` together made four additions — the
padding row became a test of its own, two new tests arrived (the control
character in a model key, and the pathological budget value), and the
never-partially-applied test gained its mirrored row. Round 1's list is
preserved verbatim below as the record of what `7f94959` claimed; the current
nineteen follow it.

Round 1 — the sixteen names as they stood at `7f94959`, verbatim:

```
✔ PROXY_MAX_BUFFERED_BODY_BYTES and PROXY_MODEL_LIMITS_JSON absent start and serve /health
✔ PROXY_MAX_BUFFERED_BODY_BYTES and PROXY_MODEL_LIMITS_JSON blank start and serve /health
✔ PROXY_MAX_BUFFERED_BODY_BYTES at its boundary values starts and serves /health
✔ PROXY_MAX_BUFFERED_BODY_BYTES rejects a non-blank invalid value, names itself and states its rule
✔ PROXY_MAX_BUFFERED_BODY_BYTES=1 still proxies normally (values validated, not applied)
✔ PROXY_MODEL_LIMITS_JSON with well-formed budgets starts and serve /health
✔ PROXY_MODEL_LIMITS_JSON with well-formed budgets still proxies normally (values validated, not applied)
✔ PROXY_MODEL_LIMITS_JSON with bad JSON exits 1 naming the variable
✔ PROXY_MODEL_LIMITS_JSON with a non-object root exits 1 naming the variable
✔ PROXY_MODEL_LIMITS_JSON with a blank model key exits 1 naming the variable
✔ PROXY_MODEL_LIMITS_JSON with a non-object entry exits 1 naming the variable and the model key
✔ PROXY_MODEL_LIMITS_JSON with an invalid rpm or tpm exits 1 naming the model key and the field
✔ PROXY_MODEL_LIMITS_JSON with an entry that supplies no budget exits 1 naming the model key
✔ PROXY_MODEL_LIMITS_JSON with one valid and one invalid entry exits 1 (never partially applied)
✔ PROXY_MODEL_LIMITS_JSON model keys are case-sensitive and unnormalized
✔ PROXY_MODEL_LIMITS_JSON with a model key that has surrounding spaces exits 1 naming the variable
```

Round 2 — the nineteen names at `56a12c7`, verbatim from the passing run
(the three that are new in this round are marked, in the order the runner prints
them):

```
✔ PROXY_MAX_BUFFERED_BODY_BYTES and PROXY_MODEL_LIMITS_JSON absent start and serve /health
✔ PROXY_MAX_BUFFERED_BODY_BYTES and PROXY_MODEL_LIMITS_JSON blank start and serve /health
✔ PROXY_MAX_BUFFERED_BODY_BYTES at its boundary values starts and serves /health
✔ PROXY_MAX_BUFFERED_BODY_BYTES with surrounding spaces starts and serves /health          ← new
✔ PROXY_MAX_BUFFERED_BODY_BYTES rejects a non-blank invalid value, names itself and states its rule
✔ PROXY_MAX_BUFFERED_BODY_BYTES=1 still proxies normally (values validated, not applied)
✔ PROXY_MODEL_LIMITS_JSON with well-formed budgets starts and serve /health
✔ PROXY_MODEL_LIMITS_JSON with well-formed budgets still proxies normally (values validated, not applied)
✔ PROXY_MODEL_LIMITS_JSON with bad JSON exits 1 naming the variable
✔ PROXY_MODEL_LIMITS_JSON with a non-object root exits 1 naming the variable
✔ PROXY_MODEL_LIMITS_JSON with a blank model key exits 1 naming the variable
✔ PROXY_MODEL_LIMITS_JSON with a non-object entry exits 1 naming the variable and the model key
✔ PROXY_MODEL_LIMITS_JSON with an invalid rpm or tpm exits 1 naming the model key and the field
✔ PROXY_MODEL_LIMITS_JSON with an entry that supplies no budget exits 1 naming the model key
✔ PROXY_MODEL_LIMITS_JSON with one valid and one invalid entry exits 1 (never partially applied)  ← now two orderings
✔ PROXY_MODEL_LIMITS_JSON with a control character in a model key exits 1 naming the byte, not the raw byte  ← new
✔ PROXY_MODEL_LIMITS_JSON with a pathological budget value exits 1 with a bounded one-line message, not a crash  ← new
✔ PROXY_MODEL_LIMITS_JSON model keys are case-sensitive and unnormalized
✔ PROXY_MODEL_LIMITS_JSON with a model key that has surrounding spaces exits 1 naming the variable
```

Where each of the three landed, and why (review P2 2.1, P3 3.6, P3 3.8):

- **`…with a pathological budget value…` (`server.test.js:1446`)** — the crash and
  the flood. Three rows: 2,000-deep nesting, 7,000-deep nesting, and a
  5,000-character string value. It asserts the interpolated field path, the
  reported type, the absence of `RangeError` / `Maximum call stack size exceeded`
  / `at JSON.stringify` / the literal `${model}`, one line, and under 300 bytes.
  The last two rows were added by `76908c7` after the review: the brief's
  correction fixes the object branch, and nothing then pinned the primitive
  branch, so a mutation dropping the 60-character cap was green (mutation M6 in
  the round-2 table is red only because of that row).
- **`…with a control character in a model key…` (`server.test.js:1411`)** — review
  P3 3.6, now closed. Three code points (`U+0001`, `U+001B`, `U+007F`). The
  document carries the byte as a `\uXXXX` escape so `JSON.parse` really hands the
  key the raw character; the assertions are that the message names the code
  point, does **not** contain the raw byte, and stays on one line.
- **`…never partially applied…` (`server.test.js:1394`)** — review P3 3.8, the
  mirrored row. The table now holds both orderings at
  `server.test.js:1396-1397`; the assertion is the same for each, so a refactor
  that collected the valid entries before validating them fails whichever the
  parser hands over first.
- **`PROXY_MAX_BUFFERED_BODY_BYTES with surrounding spaces…`
  (`server.test.js:1239`)** — review P3 3.5, resolved by splitting. The row
  `" 4096 "` is a padding case, not a boundary, and the boundary test's name did
  not claim it. It is now a test named for padding, with a second row
  `" 8388608\t"`, and the boundary test keeps only `1`, `8388608` and
  `9007199254740991`.

Against the ten required test areas: 1 → test 1; 2 → test 2; 3 → tests 3 and 5;
4 → test 4 (its own table; task 4's `INVALID_VALUES` is untouched, `0` folded in
with a comment saying why); 5 → test 4 (`zero` row, asserting the whole
`PROXY_MAX_BUFFERED_BODY_BYTES must be a positive integer` text plus the echoed
value); 6 → tests 6 and 7; 7 → tests 8–13 and 16; 8 → test 14; 9 → tests 15 and
16; 10 → `git diff 83fc7bc..HEAD --numstat -- server.test.js` = `278 0`, purely
additive.

**2026-10-01.** The numstat is now `362 0` — the three tests the review round
added (the padding row split out into a test of its own, the control character,
the pathological value), still zero deletions:

```
$ git diff 83fc7bc..HEAD --numstat -- server.test.js server.js config.js
362	0	server.test.js
137	0	config.js
$ git diff 83fc7bc..HEAD -- server.js | wc -l
0
```

The `whitespace` gate, re-measured rather than asserted:

```
$ grep -in 'whitespace' server.test.js
549:  test("empty or whitespace timeout env vars fall back to defaults", async (t) => {
722:  // Default-path regression guard: unset, empty, and whitespace-only all keep
724:  test("PROXY_HOST unset, empty, or whitespace-only binds 0.0.0.0", async (t) => {
806:  // Number("  ") is 0, so a whitespace-only value that reaches numeric parsing
809:  test("PROXY_RPM and PROXY_TPM blank (empty or whitespace-only) start with rate limiting disabled", async (t) => {
869:  test("PROXY_TPM set with PROXY_RPM whitespace-only exits 1 naming both variables", async () => {
```

Six hits: four test names (549, 724, 809, 869) and two comments (722, 806), all
at or before line 869, so all pre-date this task's block, which starts at 1139.
The new block contributes zero, so task 6's gate is still falsifiable. Every test
that means "absent" passes `undefined`, never omits the key.

### The tests failed first, for the right reason

Before the implementation (`21279f2`):

```
raw rc=1
  ok 1 - PROXY_MAX_BUFFERED_BODY_BYTES and PROXY_MODEL_LIMITS_JSON absent start and serve /health
  ok 2 - PROXY_MAX_BUFFERED_BODY_BYTES and PROXY_MODEL_LIMITS_JSON blank start and serve /health
  ok 3 - PROXY_MAX_BUFFERED_BODY_BYTES at its boundary values starts and serves /health
  not ok 4 - PROXY_MAX_BUFFERED_BODY_BYTES rejects a non-blank invalid value, names itself and states its rule
  ok 5 - PROXY_MAX_BUFFERED_BODY_BYTES=1 still proxies normally (values validated, not applied)
  ok 6 - PROXY_MODEL_LIMITS_JSON with well-formed budgets starts and serve /health
  ok 7 - PROXY_MODEL_LIMITS_JSON with well-formed budgets still proxies normally (values validated, not applied)
  not ok 8 - PROXY_MODEL_LIMITS_JSON with bad JSON exits 1 naming the variable
  not ok 9 - PROXY_MODEL_LIMITS_JSON with a non-object root exits 1 naming the variable
  not ok 10 - PROXY_MODEL_LIMITS_JSON with a blank model key exits 1 naming the variable
  not ok 11 - PROXY_MODEL_LIMITS_JSON with a non-object entry exits 1 naming the variable and the model key
  not ok 12 - PROXY_MODEL_LIMITS_JSON with an invalid rpm or tpm exits 1 naming the model key and the field
  not ok 13 - PROXY_MODEL_LIMITS_JSON with an entry that supplies no budget exits 1 naming the model key
  not ok 14 - PROXY_MODEL_LIMITS_JSON with one valid and one invalid entry exits 1 (never partially applied)
  ok 15 - PROXY_MODEL_LIMITS_JSON model keys are case-sensitive and unnormalized
  not ok 16 - PROXY_MODEL_LIMITS_JSON with a model key that has surrounding spaces exits 1 naming the variable
# tests 16
# pass 7
# fail 9
```

Every failure was `error: 'proxy process did not exit'` — the proxy *started*
where it should have died, so the behavior was missing, not the assertion. The
seven passing ones are the "must start" cases, which a build that ignores the
variables passes trivially.

The nine fatal tests were all still failing after the first implementation pass,
and test 8 exposed a real gap. With `JSON.parse` left uncaught, the child did
exit 1 — but stderr was Node's crash dump and never named the variable:

```
stderr should name PROXY_MODEL_LIMITS_JSON: <anonymous_script>:1
{not json
 ^
SyntaxError: Expected property name or '}' in JSON at position 1 (line 1 column 2)
    at JSON.parse (<anonymous>)
    at readModelLimits (…/config.js:141:23)
```

That is requirement 8 unmet, so the implementation now catches the parse failure
only to name the variable (see deviation D1).

### Round 2 — the new tests failed first, and I re-proved it

`4d69152` added two new tests and corrected two existing ones, all of which the
shipped code did not yet satisfy. The commit message claims the new tests fail
against the unfixed fatal path. I checked that claim rather than repeating it:
`git checkout 4d69152 -- config.js` puts the pre-fix `config.js` back
(`md5 80b59ad9a4eb49ece572580b0b62f62a`; the fixed file is
`md5 a80bf97980c405550ef580ae892ee9bd`), the single test is run, and
`git checkout HEAD -- config.js` restores byte-identically.

```
$ git checkout 4d69152 -- config.js
$ node --test --test-reporter=tap --test-name-pattern 'pathological budget value' server.test.js
    not ok 1 - PROXY_MODEL_LIMITS_JSON with a pathological budget value exits 1 with a bounded one-line message, not a crash
      error: 'stderr should report an object for 2,000 levels of nesting: "PROXY_MODEL_LIMITS_JSON[\\"gpt\\"].rpm must be a positive integer, got: {\\"a\\":{\\"a\\":…'
      code: 'ERR_ASSERTION'
      stack: TestContext.<anonymous> (…/server.test.js:1459:14)
# tests 1
# pass 0
# fail 1
$ git checkout HEAD -- config.js
```

**The assertion that discriminates is `server.test.js:1459` — the type-reporting
one**, `assert.ok(stderr.includes(shown))` with `shown === "an object"`. The
assertion *before* it, at `server.test.js:1456`, is the interpolated field path,
and it **passes** against the unfixed code on that row. That is the review's
point made exact: a crash dump quotes the source line, so an assertion of the
form `stderr.includes("PROXY_MODEL_LIMITS_JSON")` cannot fail against a crash.
The test does not rely on it alone, and it is not the only discriminator.

To see every assertion against every row rather than the one the loop trips over
first, a scratch probe (nothing committed) ran each row on its own:

| Row | unfixed stderr | field path (`:1456`) | type (`:1459`) | no crash markers | one line | <300 B |
| --- | --- | --- | --- | --- | --- | --- |
| 2,000 deep (env 12,017 B) | 12,070 B, one line | pass | **fail** | pass | pass | **fail** |
| 7,000 deep (env 42,017 B) | 1,053 B, 4 lines, Node dump | **fail** | **fail** | **fail** | **fail** | **fail** |
| 5,000-char string (env 5,018 B) | 5,071 B, one line | pass | **fail** | pass | pass | **fail** |

Two things follow, and both are load-bearing:

- **The crash is caught by the field-path assertion, and by the `${model}`
  marker.** On the 7,000-deep row the unfixed stderr begins
  `file:///…/config.js:190` and quotes the source, so the dump contains the
  literal `${model}` where the message should contain `PROXY_MODEL_LIMITS_JSON["gpt"].rpm`.
  That is why row two fails *both* assertions and row one fails neither of the
  crash markers: at 2,000 levels there is no crash, only the flood. The two
  symptoms the review filed as P2 2.1 are therefore pinned by two different
  assertions, not by one.
- **The same first row is also the reason the flood is caught at all.** Against
  the fixed code the three rows exit 1 with 78, 78 and 130 bytes of stderr, one
  line each, and all eight checks pass.

Against the fixed code:

```
2,000 levels of nesting :: exit 1 :: stderr 78 bytes
  "PROXY_MODEL_LIMITS_JSON[\"gpt\"].rpm must be a positive integer, got: an object\n"
7,000 levels of nesting :: exit 1 :: stderr 78 bytes
  "PROXY_MODEL_LIMITS_JSON[\"gpt\"].rpm must be a positive integer, got: an object\n"
a 5,000-character string :: exit 1 :: stderr 130 bytes
  "PROXY_MODEL_LIMITS_JSON[\"gpt\"].rpm must be a positive integer, got: \"xxx…x…\"\n"
```

The third line is 59 `x` characters and one `U+2026` between the quotes: the cap
is 60 characters of the **JSON-stringified** value, so the opening quote is
inside it and the ellipsis lands after the 59th `x`.

**Both symptoms are closed.** The `RangeError: Maximum call stack size
exceeded` at ~7,000 levels is gone — 78 bytes and a named field instead of a
stack dump — and the ~36 KB single-line flood is gone with it: the three messages
above are 78, 78 and 130 bytes where the unfixed file produced 12,070, 1,053 and
5,071, and in general the echo is bounded by the key length plus 61 characters
rather than by the size of the document. The unfixed file's echo of the whole
offending value is replaced by its type, and a primitive is echoed with a cap and
an ellipsis. `config.js` was restored and `git status --short` is empty after
every probe in this report.

## Verify

The brief's command, verbatim, from the repo root:

```
$ sh ~/scratch/verify.sh
no new security findings in affected paths: model limits fail closed
verify rc=0
```

`~/scratch/verify.sh` holds the command byte for byte as the brief prints it.

> **2026-10-01 — correction (review P3 3.1).** Round 1 wrote that the count of
> matching `ok` lines in that run is 16. It is an undercount of four, and the
> number is not a count of tests at all: the run prints **20**, which is the
> block's **nineteen tests plus the TAP suite line** for the `describe` block
> itself, unindented, and therefore also matching `^[[:space:]]*ok [0-9]+ - `:

```
$ out=$(node --test --test-reporter=tap --test-name-pattern 'PROXY_MODEL_LIMITS_JSON|PROXY_MAX_BUFFERED_BODY_BYTES' server.test.js 2>&1); rc=$?
$ printf '%s\n' "$out" | grep -cE '^[[:space:]]*ok [0-9]+ - '
20
$ printf '%s\n' "$out" | grep -E '^[[:space:]]*ok [0-9]+ - ' | tail -2
    ok 19 - PROXY_MODEL_LIMITS_JSON with a model key that has surrounding spaces exits 1 naming the variable
ok 1 - buffered body ceiling and per-model limits
```

`test $rc -eq 0` passes, the `t -ge 1` gate passes twenty times over, and the
`node -e` half prints its line. So: **verify rc=0**, with 20 matching `ok` lines
(19 tests + 1 suite line). Round 1's "16" is left above in place as the record of
what the report then claimed; the review's own re-run at 72 printed 17 for the
same reason (16 tests + 1 suite line), so the count grew with the block.

Before the implementation, the same command exited 1 (empty output — the `&&`
chain stops at `test $rc -eq 0`).

## Full suite

Round 1 (`7f94959`, 2026-09-30):

```
$ npm test
ℹ tests 72
ℹ suites 6
ℹ pass 72
ℹ fail 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 87235.206685
```

56 before this task, 72 after: 16 new tests, 0 existing tests touched. The suite
takes about 90 s on this machine, up from about 78 s, because each new test
spawns fresh child processes.

**2026-10-01 — current, after the review round:**

```
$ npm test
ℹ tests 75
ℹ suites 6
ℹ pass 75
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 70600.287577
```

56 before this task, **75** after: **19 new tests, 0 existing tests touched**
(`362 0` against `83fc7bc`). About 71 s on this machine.

### Ambient-environment fragility — re-measured at 75, inherited not introduced

`withProxy` and `runProxyOnce` merge `proxyEnv` over `process.env`, so an
invalid ambient operational variable kills every test that spawns a proxy. This
is a harness property that predates the task, and the round-2 numbers are
recorded so nobody re-derives them:

| Ambient value in the shell | `npm test` result |
| --- | --- |
| `PROXY_SAFETY_MARGIN_PCT=51` (task 4's variable) | 75 tests, **14 pass / 61 fail** |
| `PROXY_RPM=5` (task 3's variable) | 75 tests, **11 pass / 64 fail** |

Both are inherited: the failing assertions are `PROXY_SAFETY_MARGIN_PCT must be
an integer between 0 and 50, got: 51` and `PROXY_RPM and PROXY_TPM must be set
together: PROXY_TPM is missing` — task 4's and task 3's guards firing in this
task's tests, because an ambient value is not absence. The new tests pass
`undefined` for "absent" and Node's `spawn` drops `undefined`-valued env keys, so
the absent and blank tests are genuinely absent even with the variables set;
what breaks is every test that supplies *other* variables and relies on the
operational namespace being empty. Task 5's two variables behave exactly like the
two before them. This is a story-wide question for the epic to decide once (the
review filed it as P3 3.10), not a task-5 defect.

## Mutation check

Each mutation was applied to `config.js`, the verify command was run verbatim,
then the filtered tap run was inspected for the catching test, then `config.js`
was restored (`cmp` confirmed the restore, `git status` clean at the end).

| # | Mutation | verify rc | Caught by |
| --- | --- | --- | --- |
| M1 | `if (fields.length === 0) { fatal(…) }` → `continue` (an entry with no budget is silently skipped, i.e. partial application) | 1 | `PROXY_MODEL_LIMITS_JSON with an entry that supplies no budget exits 1 naming the model key` |
| M2 | `if (field !== "rpm" && field !== "tpm")` → `if (field !== "rpm")` (a **valid** `tpm`-only map becomes fatal) | 1 | `…with well-formed budgets starts and serve /health`, `…with well-formed budgets still proxies normally…`, `…with an invalid rpm or tpm exits 1…` |
| M3 | `maxBufferedBodyBytes: hasMaxBodyBytes ? readPositiveInteger(…) : 8388608` → `maxBufferedBodyBytes: 8388608` (the ceiling stops being validated at all) | 1 | `PROXY_MAX_BUFFERED_BODY_BYTES rejects a non-blank invalid value, names itself and states its rule` |
| M4 | the `typeof value !== "number"` fatal → `budget[field] = 0` (an invalid budget is stored instead of being fatal) | 1 | `PROXY_MODEL_LIMITS_JSON with an invalid rpm or tpm exits 1 naming the model key and the field` |

Both directions the brief asked for are covered: M1 and M4 turn a fatal
model-limits case non-fatal, M2 turns a valid map fatal, M3 turns the ceiling
non-fatal. After the last restore:

```
$ sh ~/scratch/verify.sh
no new security findings in affected paths: model limits fail closed
verify rc=0 (post-restore)
```

**Round 1's four rows, as run on the 72-test code, are kept above.** The code has
changed since (`ef718b5` rewrote the fatal message and added the control-character
key check; `76908c7` added a third row to the pathological test), so they were
**re-run** rather than carried forward, and eight mutations aimed at the new code
were added. All fifteen, same procedure —
apply to `config.js`, run the brief's verify verbatim, run the filtered TAP run
for attribution, restore, `cmp` the restore — run as one batch against
`56a12c7`:

| # | Mutation | verify rc | Caught by |
| --- | --- | --- | --- |
| M1 | `if (fields.length === 0) { fatal(…) }` → `continue` (an entry with no budget is silently skipped, i.e. partial application) | 1 | `PROXY_MODEL_LIMITS_JSON with an entry that supplies no budget exits 1 naming the model key` |
| M2 | `if (field !== "rpm" && field !== "tpm")` → `if (field !== "rpm")` (a **valid** `tpm`-only map becomes fatal) | 1 | `…with well-formed budgets starts and serve /health`, `…with well-formed budgets still proxies normally…`, `…with an invalid rpm or tpm exits 1…` |
| M3 | `maxBufferedBodyBytes: hasMaxBodyBytes ? readPositiveInteger(…) : 8388608` → `maxBufferedBodyBytes: 8388608` (the ceiling stops being validated at all) | 1 | `PROXY_MAX_BUFFERED_BODY_BYTES rejects a non-blank invalid value, names itself and states its rule` |
| M4 | the `typeof value !== "number"` guard removed, so an invalid budget is stored | 1 | `…with an invalid rpm or tpm exits 1…` **and** `…with a pathological budget value…` (new: `String({…})` is `[object Object]`, which is not the reported type) |
| M5 | `got: ${describeValue(value)}` → `got: ${JSON.stringify(value)}` — the P2 2.1 regression: the crash and the flood both return | 1 | `…with a pathological budget value exits 1 with a bounded one-line message, not a crash` |
| M6 | `return text.length > 60 ? \`${text.slice(0, 60)}…\` : text` → `return text` (the primitive-text cap dropped, so a 5,000-character value echoes in full) | 1 | `…with a pathological budget value…` |
| M7 | the control-character key check removed, so a key carrying C0/DEL is accepted and stored | 1 | `…with a control character in a model key exits 1 naming the byte, not the raw byte` |
| M8 | `describeKey` stops escaping, so a raw control byte reaches stderr | 1 | `…with a control character in a model key…` |
| M9 | the root guard's `\|\| Array.isArray(parsed)` removed, so a `[]` root is accepted | 1 | `…with a non-object root exits 1 naming the variable` |
| M10 | the entry guard's `\|\| Array.isArray(entry)` removed, so an array entry falls through to the field loop | **0** | none — a wording-only hole, measured below |
| M11 | the parse catch returns `{}` instead of calling `fatal` — requirement 5's "no catch that swallows and continues" | 1 | `…with bad JSON exits 1 naming the variable` |
| M12 | `!model.trim()` → `model === ""` (a whitespace-only key is no longer caught by the blank check) | **0** | none — behaviour preserved, measured below |
| P1 | `: 8388608` → `: 4194304` (the 8 MiB default silently becomes 4 MiB) | 0 | none |
| P2 | `const limits = Object.create(null)` → `const limits = {}` (a model key named `__proto__` would be swallowed by the prototype setter) | 0 | none |
| P3 | `budget[field] = …` → `budget[field === "rpm" ? "tpm" : "rpm"] = …` (the stored budget is filed under the wrong key) | 0 | none |

Ten red, five green. `config.js` was restored byte-identically after every row
(the batch asserts the byte-for-byte match itself) and `git status --short` is
empty at the end:

```
RESTORE byte-identical for every mutation
FINAL git status: ''
```

Both directions the brief asked for are still covered after the fix round: M1,
M4, M5, M7, M8, M9 and M11 turn a fatal model-limits case non-fatal, M2 turns a
valid map fatal, M3 turns the ceiling non-fatal, and M5 is the review's P2 2.1
coming back — the crash **and** the flood, caught by the one test written for it.

### Mutations nothing caught — coverage holes

> **2026-10-01 — correction (review P3 3.2).** Round 1 wrote that **two**
> mutations of this task's own code leave the verify at 0, and presented the pair
> as the set. That was wrong twice: the set is larger, and it is **open, not
> enumerated**. Re-running against the current code with eight more mutations
> aimed at the new code found **five** greens, in three different classes. Round
> 1's sentence and table are left above as the record of what was then claimed;
> this is the current state, and no claim is made that the list is complete.

| # | Mutation | verify rc | Class |
| --- | --- | --- | --- |
| P1 | `: 8388608` → `: 4194304` (the 8 MiB default silently becomes 4 MiB) | 0 | stored default, invisible to the harness |
| P2 | `const limits = Object.create(null)` → `const limits = {}` (a model key named `__proto__` would be swallowed by the prototype setter and vanish from the map) | 0 | stored container, invisible to the harness |
| P3 | `budget[field] = …` → `budget[field === "rpm" ? "tpm" : "rpm"] = …` (the stored budget is filed under the wrong key) | 0 | stored value, invisible to the harness |
| M10 | the entry guard's `\|\| Array.isArray(entry)` removed | 0 | message contract, not behaviour |
| M12 | `!model.trim()` → `model === ""` | 0 | message contract, not behaviour |

P3 is the review's third instance of the stored-object class; I re-ran it myself
and it is green, as the review said it would be. P1, P2 and P3 are the same hole
three times over: the black-box child-process harness cannot read the stored
config object, and the story forbids a second seam, so nothing in this file can
catch a mutation of it.

M10 and M12 are a different class, and I measured both rather than reasoning
about them. Neither weakens any guarantee — both documents are still rejected,
still with exit 1 — but the *message* changes and no test pins that message:

| Document | shipped | under M10 | under M12 |
| --- | --- | --- | --- |
| `{"gpt":[]}` | `…["gpt"] must be a JSON object, got: an array` | `…["gpt"] must supply rpm or tpm, got: an empty object` | unchanged |
| `{"   ":…}` | `PROXY_MODEL_LIMITS_JSON has a blank model key` | unchanged | `PROXY_MODEL_LIMITS_JSON model key "   " has surrounding spaces` |
| `{"\t":…}` | `has a blank model key` | unchanged | `model key "\t" has surrounding spaces` |
| `[{"rpm":5}]` (root) | `must be a JSON object, got: an array` | unchanged (root guard intact) | unchanged |

So M10 says: the entry-level `Array.isArray` is a **message-quality** guard, not
a fail-closed guard, because an array entry has no own keys and is caught by the
empty-entry check a line later (`{"gpt":[5]}` is caught as unknown field `0`).
M12 is the review's M6, and the overlap it noticed is real robustness: the two
key checks are redundant for the whitespace-only family, so narrowing one
preserves behavior. The honest summary is that **`has a blank model key` and
`must be a JSON object, got: an array` are unpinned message text** — the tests
assert exit 1 and the model key, not the wording. Fixing that would mean pinning
exact text for those two shapes, which is a test-only change if the story wants
it; it is not a behavior gap and it is not in this task's brief.

None of the five is papered over. P1, P2 and P3 belong to the same class of gap
LOG.md already records for `rateLimit` and `limits`: **task 7's ADR 0002 has to
record that the 8 MiB default, the `null` modelLimits default, and the
null-prototype map are reviewed by eye and not by test** — the task 7 ledger row
now names the duplicate-key gap beside them. P2 is the reason the map is built
with `Object.create(null)`: with a plain `{}`, `{"__proto__":{"rpm":5}}` assigns
through the prototype setter and the stored map comes back with no own keys — an
entry that silently disappears, the exact failure class this story exists to
prevent. M10 and M12 are wording, and are named here so a later slice does not
read this table as "the message text is pinned".

## Count sweep

Before (11 hits, all reading 56):

```
$ grep -rnE 'tests(-| )?[0-9]{2,4}|[0-9]{2,4}[ -]?tests?' --include='*.md' --include='*.yaml' . \
    | grep -vE '^\./(plans/|docs/research/|LOG\.md|specs/epics/)'
./AGENTS.md:89
./AGENTS.md:107
./CONVENTIONS.md:17
./README.md:9
./README.md:86
./specs/README.md:19
./specs/product/VISION_LATEST.yaml:20
./specs/tech-architecture/TEST_PLAN_LATEST.md:44
./specs/tech-architecture/TEST_PLAN_LATEST.md:294
./specs/tech-architecture/TEST_PLAN_LATEST.md:351
./specs/tech-architecture/tech-stack.md:129
```

After (the same 11 lines, all reading 72; line numbers unchanged except in
`AGENTS.md`, whose 89 and 106 are its own count sites):

```
./AGENTS.md:89:- `npm test` — full suite (72 tests, Node built-in `node --test` runner, no deps to install)
./AGENTS.md:107:  Sites as of 2026-09-30: `README.md:9` badge `tests-72%20passing`, …
./CONVENTIONS.md:17:- `npm test` — runs all 72 tests
./README.md:9:[![Tests](https://img.shields.io/badge/tests-72%20passing-blue?style=flat-square)](server.test.js)
./README.md:86:> Run the test suite (72 tests, no deps needed):
./specs/README.md:19:- 72 tests in server.test.js
./specs/product/VISION_LATEST.yaml:20:  - 72 tests covering all major scenarios
./specs/tech-architecture/TEST_PLAN_LATEST.md:44:- 72 tests covering all major scenarios
./specs/tech-architecture/TEST_PLAN_LATEST.md:294:- All 72 tests must pass
./specs/tech-architecture/TEST_PLAN_LATEST.md:351:… The 72-test suite provides good coverage …
./specs/tech-architecture/tech-stack.md:129:- **Test Count**: 72 tests
```

`AGENTS.md` by hand, which the sweep pattern cannot match:

- `AGENTS.md:89` — 56 → 72.
- `AGENTS.md:106` — "(currently 56)" → "(currently 72)".
- `AGENTS.md:107` — badge in the sites inventory `tests-56%20passing` → `tests-72%20passing`.
- `AGENTS.md:84` — Repository knowledge's line inventory: `config.js` (~52 lines) → (~265 lines), `server.test.js` (~705 lines) → (~1408 lines). `wc -l` at the time: `265 config.js`, `249 server.js`, `1408 server.test.js`.

### 2026-10-01 — the sweep re-run at 75, and the three places it cannot reach

Same pattern, same exclusions, after `56a12c7`: **11 hits, every one reading 75**,
the same eleven files as before.

```
$ grep -rnE 'tests(-| )?[0-9]{2,4}|[0-9]{2,4}[ -]?tests?' --include='*.md' --include='*.yaml' . \
    | grep -vE '^\./(plans/|docs/research/|LOG\.md|specs/epics/)'
./AGENTS.md:89:- `npm test` — full suite (75 tests, Node built-in `node --test` runner, no deps to install)
./AGENTS.md:107:  Sites as of 2026-09-30: `README.md:9` badge `tests-75%20passing`, …
./CONVENTIONS.md:17:- `npm test` — runs all 75 tests
./README.md:9:[![Tests](https://img.shields.io/badge/tests-75%20passing-blue?style=flat-square)](server.test.js)
./README.md:86:> Run the test suite (75 tests, no deps needed):
./specs/README.md:19:- 75 tests in server.test.js
./specs/product/VISION_LATEST.yaml:20:  - 75 tests covering all major scenarios
./specs/tech-architecture/TEST_PLAN_LATEST.md:44:- 75 tests covering all major scenarios
./specs/tech-architecture/TEST_PLAN_LATEST.md:294:- All 75 tests must pass
./specs/tech-architecture/TEST_PLAN_LATEST.md:351:… The 75-test suite provides good coverage …
./specs/tech-architecture/tech-stack.md:129:- **Test Count**: 75 tests
```

The three sites the pattern cannot match, checked by hand — **all three are true,
so nothing needed fixing here**:

- `AGENTS.md:106` reads "(currently 75)".
- `AGENTS.md:85` — the line inventory reads `server.js` (~249 lines),
  `config.js` (~303 lines), `server.test.js` (~1492 lines). `wc -l` returns
  exactly `249 server.js`, `303 config.js`, `1492 server.test.js`. Round 1
  cited this bullet as `AGENTS.md:84`; it was `85` then as well
  (`git show 7f94959:AGENTS.md | grep -n 'Zero-dependency'`), so that was an
  off-by-one in round 1's prose, not a line that moved. The content is the
  part that was right, and round 2's edit to it is the only change.
- `AGENTS.md:107` — the site inventory still names the same eleven files, and
  every line number in it still points at the line it names. The story-file
  entry is correctly listed there as a site that still needs a count.

### Task 12's verify fails today, and that is not this task's file to fix

> **2026-10-01 — correction (review P2 2.3).** Round 1 wrote:
> *"`specs/epics/` is an excluded path for this sweep, task 5 does not own the
> story file."* **That reason was wrong, and it was wrong in the direction that
> hides a broken gate.** It is true of **task 5's** sweep — the brief's own
> exclusion list does drop `specs/epics/` wholesale. It is false of the gate that
> will actually catch this, which is **task 12's** verify, and that is the only
> thing that matters to whoever runs the story's verification. Task 12's filter
> excludes *only* `specs/epics/.*/briefs/` and `specs/epics/.*-tasks\.yaml`.
> Run against the current tree, it has exactly one surviving hit and it is the
> story file:
>
> ```
> $ grep -rnE 'tests(-| )?[0-9]{2,4}|[0-9]{2,4}[ -]?tests?' --include='*.md' --include='*.yaml' . \
>     | grep -vE '^\./(plans/|docs/research/|LOG\.md|specs/epics/.*/briefs/|specs/epics/.*-tasks\.yaml)' \
>     | grep -vE 'tests(-| )?75|[^0-9]75[ -]?tests?'
> ./specs/epics/e04-rate-limiting/e04s01-config-owner-and-bind-host.md:336:- Refactor regression in working code → detected by the unchanged existing suite (56 tests)
> ```
>
> **`e04s01-config-owner-and-bind-host.md:336` still reads 56, and task 12's
> verify fails on it right now.** The edit is one number — `56` → `75`, not the
> `56` → `72` the review suggested, since the total has moved on twice since —
> and it belongs to **task 12**, which owns the story file's count. Task 5 does
> not edit it. Task 2 set the precedent by correcting that file's stale "34
> tests". The corrected scope call is therefore: *right file, wrong task, and a
> live gate that fails until it is done* — not "excluded, nobody will see it".

### `CONVENTIONS.md:33-34` is stale and this task made it staler — routed, not fixed

> **2026-10-01 (review P3 3.4).** Round 1 did not flag this. `CONVENTIONS.md`
> carries a second, parallel line inventory:
>
> ```
> - `server.js` — Main reverse proxy logic (~294 lines)
> - `server.test.js` — Test suite (~705 lines)
> ```
>
> Actual: 249 and **1492**. Both were already wrong before this task (the review
> measured 249 and 1408 before the fix round), and this task added 84 more lines
> to `server.test.js` — but the inconsistency that matters is that the brief
> instructed this task to take ownership of the *parallel* inventory at
> `AGENTS.md:85`, which it did and which is now true. Two inventories of the same
> three files, one refreshed and one not, in a single doc pass. **Task 9 owns
> `CONVENTIONS.md`** and the fix is one line; task 5 does not edit it.

## Deviations

**D1 — requirement 5 (no try/catch on this path) vs requirement 8 (bad JSON must
name the variable).** The brief requires both. They cannot both hold literally:
the uncaught `SyntaxError` reaches stderr without naming `PROXY_MODEL_LIMITS_JSON`
(observed output above), so requirement 8 is unimplementable without a catch. I
took requirement 8, since it is the operator-facing half and requirement 5's
stated purpose is "a `JSON.parse` failure must be fatal" and "no `catch` that
swallows and continues" — neither of which this does:

```js
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    fatal("PROXY_MODEL_LIMITS_JSON", `is not valid JSON: ${error.message}`);
  }
```

The catch is non-empty (so the verify's own `/catch\s*\{\s*\}/` regex passes) and
the `process.exit(1)` inside `fatal` is unconditional. The parser's own message
carries the position, and the document is never echoed. This is the same
non-empty-catch shape `parseConfig` already uses for `NVIDIA_BASE_URL`.

**D2 — requirement 6 ("keys stored byte for byte") implemented on
`Object.create(null)` rather than `{}`.** A plain object would silently drop a
model key named `__proto__` through the prototype setter, and would also let a
later slice's `modelLimits["toString"]` lookup return an `Object.prototype`
member for an unconfigured model. Keys are still stored exactly as written —
nothing is trimmed, lowercased, or rejected for its name — so the requirement is
met; the container choice is an addition, not a normalization. Justified by
requirement 3's "never partially applied" and by probe P2.

**D3 — arrays are rejected with `Array.isArray` checks, not bare
`typeof … !== "object"`.** Needed for the same reason: `typeof []` is `"object"`,
so without it the array rows of requirement 3's table (`[]` root, `{"gpt":[]}`)
would have been accepted. `typeName` names the shape (`an array`, `null`, `a number`,
`a string`, `a boolean`) so an array does not print as `a object`.

> **2026-10-01 — this sentence overstates the case, and I am correcting my own
> report rather than the review's.** The claim that *both* array rows "would have
> been accepted" is only true of the **root**. Mutation M10 removed the
> *entry-level* `Array.isArray` and the verify stayed green, because an array
> entry has no own keys: `{"gpt":[]}` is then rejected by the empty-entry check
> (`must supply rpm or tpm, got: an empty object`) and `{"gpt":[5]}` as an
> unknown field `0`. So the root guard is fail-closed and load-bearing (M9 is
> red — a `[]` root really is accepted without it) and the entry guard is a
> **message-quality** guard. The review repeated this same overstatement in its
> Axis 1, D3 note; both of us were reasoning from the shape of the code instead
> of running it. `typeName` still needs the `Array.isArray` branch, for the
> message's sake only.

**D4 — a new `fatal(name, problem)` helper.** Eight new rejection messages share
it. `readPositiveInteger`'s signature is unchanged, `integerRule`'s wording is
unchanged, and no existing message text changed — the existing suite's exact-text
assertions (including task 4's) pass untouched.

> **2026-10-01 (review P3 3.7).** Two corrections to the record. The count is now
> **nine** call sites, not eight: the fix round added the control-character key
> check. And the **partial adoption is deliberate, not an oversight** — `fatal()`
> is used by one of the four places in the file that could use it. `parseConfig`
> (three sites), `readRateLimit` and `readPositiveInteger` still open-code
> `console.error(…)` + `process.exit(1)`. Adopting it in `readPositiveInteger`
> would not change any message text, so requirement 10 would still hold, but it
> would mean editing lines the brief listed under "must not change", on a task
> whose scope is the two new variables. Surgical patch wins: the helper is
> adopted only where the new code needed it, and the file's mixed shape is the
> honest consequence.


**D5 — message wording for the seven rejection shapes** (all contain
`PROXY_MODEL_LIMITS_JSON`; the entry-level ones also contain the model key):

| Shape | Message |
| --- | --- |
| bad JSON | `PROXY_MODEL_LIMITS_JSON is not valid JSON: <parser message>` |
| non-object root | `PROXY_MODEL_LIMITS_JSON must be a JSON object, got: an array` |
| blank key | `PROXY_MODEL_LIMITS_JSON has a blank model key` |
| padded key | `PROXY_MODEL_LIMITS_JSON model key " gpt-4o-mini " has surrounding spaces` |
| non-object entry | `PROXY_MODEL_LIMITS_JSON["gpt"] must be a JSON object, got: a number` |
| entry with no budget | `PROXY_MODEL_LIMITS_JSON["gpt"] must supply rpm or tpm, got: an empty object` |
| unknown field | `PROXY_MODEL_LIMITS_JSON["gpt"] has an unknown field: rps (only rpm and tpm are read)` |
| invalid budget | `PROXY_MODEL_LIMITS_JSON["gpt-4o-mini"].rpm must be a positive integer, got: 1.5` |

The last line's text is produced by the *existing* `readPositiveInteger` +
`integerRule` pair, unchanged. The brief requires the whole
`must be a positive integer` text for the ceiling's `0` case; test 4 asserts it.

> **2026-10-01 — correction (review P3 3.3) and the current table.** Round 1's
> D5 presented that last row as if the expression were bounded. It was not, for
> object and array values: `JSON.stringify(value)` recursed without limit. The
> table as it stands at `56a12c7`, every row quoted from stderr I captured, has
> **nine shapes across ten rows** — the invalid-budget shape renders two ways,
> and the control-character shape is the one new shape this round added:
>
> | Shape | Message |
> | --- | --- |
> | bad JSON | `PROXY_MODEL_LIMITS_JSON is not valid JSON: <parser message>` |
> | non-object root | `PROXY_MODEL_LIMITS_JSON must be a JSON object, got: an array` |
> | blank key | `PROXY_MODEL_LIMITS_JSON has a blank model key` |
> | padded key | `PROXY_MODEL_LIMITS_JSON model key " gpt-4o-mini " has surrounding spaces` |
> | control character in a key *(new)* | `PROXY_MODEL_LIMITS_JSON model key "gpt\u001b[31mred\u001b[0m" contains a control character: U+001B` |
> | non-object entry | `PROXY_MODEL_LIMITS_JSON["gpt"] must be a JSON object, got: a number` |
> | entry with no budget | `PROXY_MODEL_LIMITS_JSON["gpt"] must supply rpm or tpm, got: an empty object` |
> | unknown field | `PROXY_MODEL_LIMITS_JSON["gpt"] has an unknown field: rps (only rpm and tpm are read)` |
> | invalid budget, primitive | `PROXY_MODEL_LIMITS_JSON["gpt-4o-mini"].rpm must be a positive integer, got: 1.5` |
> | invalid budget, object or array | `PROXY_MODEL_LIMITS_JSON["gpt-4o-mini"].rpm must be a positive integer, got: an object` |
>
> The bound is the whole of what changed for the fatal path: an object or array
> reports its type and never its text, and a primitive's text is echoed with a
> 60-character cap and an ellipsis (`got: "xxxx…"` for a 5,000-character string
> value — 130 bytes of stderr, not 5,071). The largest message the fatal path
> can now emit is bounded by the key length plus 61 characters, and the key
> itself is escaped, so stderr is one line and carries nothing a terminal would
> interpret.

**D6 — the message bounds, and they are an addition, not a reading of the brief.**
`describeValue(value)`, `describeKey(key)`, and `CONTROL_CHAR` are new helpers
(`config.js:219-241`). Two of the three behaviours go beyond what the brief asked
for and are declared here so the ADR sees them:

- The brief's dated correction said *use `typeName` for objects and arrays, and
  echo text only for primitives*. It set no bound on the primitive echo, and the
  review's suggested fix kept `JSON.stringify` unbounded for strings. I capped
  it at 60 characters, because a primitive can be a 5,000-character string in a
  5 KB env var and requirement 8's rule is a robustness rule, not a size rule —
  the same reason the object branch was fixed. The review's smallest fix would
  have left that row flooding. Mutation M6 (round-2 table) is the test that pins
  it; without the third row of the pathological test the cap would be untested.
- `describeKey` escapes C0 **and DEL**, because `JSON.stringify` leaves `0x7f`
  raw while it escapes the rest. Only the padded-key message and the
  control-character message use it, and both want a key that can be located in the
  document without carrying a byte a terminal would act on.

**D7 — a model key carrying a C0 control character or DEL is now fatal.** The
review filed this as log hygiene (P3 3.6) and `specs/state.yaml` closed it in the
same round that accepted the duplicate-key gap: the code already rejects a padded
key for the reason that it *can never match a model ID*, and a control character
cannot match one either, so accepting it applied two standards to one rule. The
message names the code point (`U+0001`, `U+001B`, `U+007F`) instead of echoing
the byte. This is a new fatal shape the story did not enumerate — the same
category as the empty entry and the unknown field, both of which the state
decision already accepted on the story's own principle — and it is pinned by
`server.test.js:1411`. Task 7's ADR row must name it beside the others.

## Constraints inherited, and how they were honored

- `server.js` byte-identical: `git diff 83fc7bc..HEAD -- server.js | wc -l` → 0.
- `server.test.js` additive only: `278` insertions, `0` deletions, block appended
  after `operational limit config`, no existing test edited, reordered, or skipped,
  and no existing stub changed. Task 4's `LIMIT_VARIABLES` / `INVALID_VALUES` are
  untouched — the new block declares its own tables.
- Credential regime: untouched. `unconfigured` and the 503 path are unchanged, and
  task 1's credential tests pass in the 72.
- `readSeconds`, `CONNECT_TIMEOUT_SECONDS`, `IDLE_TIMEOUT_SECONDS`: untouched.
- No dependency, no `package.json` change, no `/tmp` use (scratch went to
  `~/scratch`, which holds the verify wrapper, the mutation wrapper, and the tap
  logs; nothing there is committed).
- `whitespace` appears in no new test name.
- Fresh-child runs only: every new test goes through `runProxyOnce` or
  `withProxy`; no new seam, no import of `config.js` from the test file.

**2026-10-01 — re-checked after the fix round.** `server.js` is still
byte-identical (0 diff lines). `server.test.js` is `362 0` against `83fc7bc`,
still one contiguous append: the new code went into `config.js` (`137 0`) and
into the tail of the block, and no pre-existing line was edited. The credential
regime is untouched and task 1's credential tests pass inside the 75. The
scratch directory still holds everything uncommitted — the verify wrapper, the
mutation batch, the crash probe, the ambient-env logs. **No dependency, no
`package.json` change, ESM only, no lint or typecheck config invented.**

**Unicode: model keys are stored byte for byte and are not normalized, and that
is a decision, not an oversight** (review P3 3.9). `é` as U+00E9 and `e` +
U+0301 are two distinct models; `ﬀ` and `ff` stay distinct; Cyrillic `а` and
Latin `a` stay distinct. Requirement 6 demands exactly this — "exact
case-sensitive model ID", stored as written — and the case-sensitivity test at
`server.test.js:1475` pins the case half of it. The reason it is written down
here is downstream: a later slice that looks a budget up by a model ID taken
from a request body must not assume NFC, because nothing above it normalized
anything. Normalizing now would silently change which budgets apply, and would
do it to the one map whose contents are invisible to the test harness.

## Not done, and why

> **2026-10-01 — every bullet below is rewritten.** Round 1's first bullet gave a
> reason that was wrong about the gate that would catch the stale count (review
> P2 2.3), and round 1's list did not mention the accepted fail-open at all
> (P2 2.2). Round 1's two bullets are preserved immediately below for the
> record; these are the current ones.

- **The story file's `(56 tests)` at
  `specs/epics/e04-rate-limiting/e04s01-config-owner-and-bind-host.md:336` is
  still stale, and task 12's verify fails on it today.** Not because it is
  excluded — it is excluded from *task 5's* sweep and caught by *task 12's*.
  The edit is one number (`56` → `75`) and task 12 owns it. Task 5 does not edit
  it. **This is the one thing in this report that is a live failing gate, not a
  note.**
- **A duplicate top-level model key is accepted, last-wins, and one of the two
  budgets the operator wrote disappears silently.** This is an **accepted gap,
  not a covered case.** `{"gpt":{"rpm":1},"gpt":{"tpm":2}}` starts normally with
  `modelLimits = {"gpt":{"tpm":2}}` — no `rpm`, no message. `JSON.parse` exposes
  no duplicate-key hook, so closing it needs a reviver with per-holder
  bookkeeping that cannot know its own path, and a regex over the raw text
  false-positives on nested keys; `specs/state.yaml` settled it as accepted on
  2026-09-30 and the task 7 ledger row now names it as a fail-open that the ADR
  must record as accepted, "not as an oversight". Task 5 does not implement
  duplicate-key detection.
- **"Never partially applied" is satisfied for the enumerated shapes, and the
  duplicate top-level key is the one accepted fail-open outside them.** Read that
  sentence as bounded. It is proven for every shape requirement 3 enumerates,
  for the two shapes the story's principle adds (the empty entry, the unknown
  field), and for the new control-character key — and the observable half (the
  process does not come up) is pinned in **both** orderings at
  `server.test.js:1394-1403`, so a refactor that collected valid entries before
  validating them fails whichever the parser hands over first. What it is *not*
  is a claim about arbitrary malformed input: a duplicate key is the case where
  the document is well-formed, the process starts, and one budget is gone. That
  case is recorded, not covered, and the round-1 report's unqualified
  "never partially applied" is the sentence that has to be qualified.
- **The 8 MiB default, the `null` modelLimits default, the null-prototype map,
  and the key a stored budget is filed under are unpinned by tests** (probes P1,
  P2, P3). They belong in task 7's ADR 0002 as reviewed-by-eye, alongside the
  `rateLimit` and `limits` shapes already recorded there.
- **`has a blank model key` and `must be a JSON object, got: an array` are
  unpinned message text** (M10, M12): both documents are still rejected with
  exit 1 under those mutations, so this is wording, not behavior.
- **`CONVENTIONS.md:33-34`'s line inventory is stale** (249/1492 actual, ~294/~705
  written) and this task's doc pass made that inconsistency visible by updating
  the parallel inventory in `AGENTS.md`. **Task 9 owns the file**; one line, not
  this task's.
- **The suite is not hermetic against ambient operational variables** (14/75 and
  11/75 pass with one invalid ambient variable set). Inherited from the harness
  `withProxy`/`runProxyOnce` share, identical for task 3's and task 4's
  variables, and a story-level decision rather than a task-5 one.

Round 1's list, preserved:

- The epic spec's `(56 tests)` on line 336 is stale (see the count sweep) — excluded
  path, not this task's file.
- The 8 MiB default, the `null` modelLimits default, and the null-prototype map are
  unpinned by tests (probes P1 and P2). They need to go into task 7's ADR 0002 as
  reviewed-by-eye, alongside the `rateLimit` and `limits` shapes already recorded
  there.

## Review round 2 — findings register, corrections, and routing (2026-10-01)

The review (`068fcd8`, range `83fc7bc..7f94959`) returned **SHIP WITH FIXES**: no
P0, no P1, three P2 and nine P3. The code fixes are `4d69152` (two new tests
and two corrections to existing ones, written to fail), `ef718b5` (config),
`76908c7` (the third row, for the primitive bound), `56a12c7` (count sync to
75); `ea40402` corrected the brief and widened task 7's ADR obligation. Every
finding, and what this report now says about it:

| # | Finding | Status | Where the evidence is | Routed to |
| --- | --- | --- | --- | --- |
| P2 2.1 | the fatal message could `RangeError` inside the fatal path on a ~42 KB nested value, and echoed up to ~36 KB of the document on one line below the crash threshold | **fixed** — `describeValue` reports an object or array by type, echoes primitive text capped at 60 characters; the largest message the path can now emit in these cases is 130 bytes | `server.test.js:1446`; discrimination proof in "The tests failed first"; mutations M5 and M6, both red | — (closed in code) |
| P2 2.2 | a duplicate top-level model key is silently accepted, last-wins | **accepted gap, recorded, not implemented.** "Never partially applied" holds for the enumerated shapes; this is the one accepted fail-open | "Not done, and why"; `specs/state.yaml` decision of 2026-09-30; task 7's ledger row already names it | task 7 (ADR must call it accepted, not an oversight) |
| P2 2.3 | round 1's reason for leaving the story file's "56 tests" was wrong about the gate — task 12's verify excludes only `briefs/` and `*-tasks.yaml`, so it **fails today** | **reason corrected; the file is still not this task's** | "Task 12's verify fails today" | task 12 (one number: `56` → `75`) |
| P3 3.1 | the `ok`-line count was 16; the command prints 20 | **corrected** — 19 tests + the TAP suite line | "Verify" | — |
| P3 3.2 | "two mutations leave the verify at 0" undercounted the class and read as a closed set | **corrected** — five greens in three classes, stated as an open set; P3 re-run by me and green | "Mutations nothing caught — coverage holes" | task 7 (P1/P2/P3 as reviewed-by-eye) |
| P3 3.3 | the D5 table presented unbounded stderr output as intended | **corrected** — the table is rebuilt from captured stderr, and the bound is stated | D5's 2026-10-01 note | — |
| P3 3.4 | `CONVENTIONS.md:33-34` line inventory stale (~294 / ~705 vs 249 / 1492) and this task updated the parallel inventory in `AGENTS.md` without touching this one | **flagged, not fixed** | "`CONVENTIONS.md:33-34` is stale" | **task 9** |
| P3 3.5 | the "boundary values" test carried a padding row its name did not claim | **resolved** — split into its own test with a second padded row | `server.test.js:1239` | — |
| P3 3.6 | a control character in a model key was accepted, stored, and echoed raw | **fixed** — fatal, byte named `U+XXXX`, key escaped, stderr one line | `server.test.js:1411`; mutations M7, M8 red | **task 7** (new fatal shape; ADR must name it) |
| P3 3.7 | `fatal()` adopted by one of four call sites | **decision, recorded** — surgical patch; the brief listed the others under "must not change" | D4's 2026-10-01 note | — |
| P3 3.8 | "never partially applied" pinned for one ordering only | **fixed** — both orderings, `server.test.js:1394-1403` | "Tests added" | — |
| P3 3.9 | no Unicode normalization on model keys | **decision, recorded** — required by requirement 6; the trap is downstream, for a later slice's lookup | "Constraints inherited" | — |
| P3 3.10 | the suite is not hermetic against ambient operational variables | **inherited, re-measured** — 14/75 and 11/75 pass; identical for task 3's and task 4's variables; not a task-5 defect | "Ambient-environment fragility" | the epic, once, at story level |

### What this round had to change in the report, item by item

- **P2 2.1** — the report now states what the fix was (`describeValue`, plus the
  `RangeError` and the flood both closed) and shows the crash-proof rather than
  claiming it. Round 1 did not have a single sentence on the message's
  robustness, which is the review's actual complaint.
- **P2 2.2** — the phrase "never partially applied" now appears with its scope
  attached: satisfied for the enumerated shapes, with the duplicate top-level key
  named as the one accepted fail-open. Round 1's unqualified version was the
  thing the review called unacceptable, and it was unacceptable because it read as
  coverage. It is not.
- **P2 2.3** — the wrong reason is replaced with the right one, in two places
  (the count sweep and "Not done, and why"), in bold, with the task 12 filter
  quoted and its single surviving hit shown.
- **P3 3.1 / 3.2 / 3.3** — the number, the size of the hole set, and the D5 table
  are corrected in place with dated notes; round 1's text stays above each
  correction as the record of what was claimed.
- **P3 3.4 / 3.5 / 3.6** — routed or fixed, each with its own dated note.
- **P3 3.7 / 3.9 / 3.10** — the three deliberate no-changes, each with the reason
  it is a decision, so the file's mixed shape does not read as drift.

### Where the review and I disagree

1. **Review Axis 1, D3, and this report's own D3: "without `Array.isArray` two
   rows of the brief's table would have been accepted."** Only the **root** row
   would have been. Mutation M10 removed the entry-level guard and left the
   verify green: `{"gpt":[]}` is caught by the empty-entry check and
   `{"gpt":[5]}` as an unknown field. Both the review and round 1's report
   asserted this from the shape of the code instead of running it. The guard is
   kept — `typeName` needs it for the message — but it is a message-quality guard,
   not a fail-closed one, and the report now says so.
2. **Review P2 2.3's suggested repair value.** The review says the story-file fix
   is "`56` → `72`". By the time this report is written the total is 75, and the
   number in that line has to be 75. Minor, but a report that copies a stale
   count into a to-do is exactly the failure this round is correcting.
3. **Review P2 2.1's suggested fix would have left a flood.** It proposed
   "`typeName(value)` for objects and arrays, and keep `JSON.stringify(value)`
   for `null`/booleans/strings". A JSON string can be 5,000 characters in a 5 KB
   env var, so that fix moves the flood from the object branch to the string
   branch. The shipped `describeValue` caps the primitive echo at 60 characters,
   which is why the pathological test has a third row and why mutation M6 is red.
   This is not a criticism of the review's reasoning — its "smallest fix" was
   explicitly smallest — it is the reason this report declares the cap as an
   addition (D6) instead of a reading of the brief.

### Routing summary for the orchestrator

- **task 7** — ADR 0002 must record, in addition to what its ledger row already
  says: the stored budget's key (P3 in the round-2 table) alongside the 8 MiB
  default, the `null` map and the null-prototype container; the **duplicate
  top-level key as an accepted fail-open, named as accepted** (already in the
  ledger row); the **control-character key as a new fatal shape** (in
  `specs/state.yaml`, not yet in the ledger row); and the standing rule from the
  state decision that a fatal message able to crash its own path must be re-proved
  by test, because inspection is what missed it.
- **task 9** — `CONVENTIONS.md:33-34`, the line inventory: `~294` → 249 and
  `~705` → 1492.
- **task 12** — `e04s01-config-owner-and-bind-host.md:336`, `(56 tests)` → `(75
  tests)`. Until that lands, task 12's verify is red.
- **nobody, deliberately** — duplicate-key detection. It is a settled accepted gap;
  this task does not implement it and this report does not recommend re-opening
  it.

### Final state at `56a12c7`, re-measured for this revision

```
npm test              → tests 75 · suites 6 · pass 75 · fail 0 · 70600 ms
task verify           → rc=0, 20 matching ok lines (19 tests + 1 TAP suite line)
git diff 83fc7bc..HEAD --numstat -- server.test.js   → 362  0
git diff 83fc7bc..HEAD -- server.js | wc -l           → 0
grep -in whitespace server.test.js                    → 6 hits, all at or before 869
mutation table above                                  → 15 rows, 10 red / 5 green
config.js after every probe                           → md5 a80bf97980c405550ef580ae892ee9bd
git status --short                                    → empty
```


