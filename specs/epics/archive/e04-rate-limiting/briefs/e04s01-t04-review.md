# Task review — e04s01 / task 4: the operational limit variables

- **Reviewed range:** `7dc1f4d..eac6f7e` (`ae9292c` code, `11a5e55` LOG.md, `eac6f7e` report)
- **Branch / worktree:** `epic-14-config-owner` · `../epic-14-config-owner`
- **Reviewer verdict:** see the end of this file. **No P0 and no P1 findings.**

Everything below was verified by running it, not by reading the implementer's report. The
mutation battery restored both source files byte-identically; `git diff --exit-code` and
`git status --porcelain` are clean at the end, and `config.js` / `server.js` hash to
`3e4ea754…` / `24337f16…`, identical to `git show ae9292c:…`.

---

## Axis 1 — Spec compliance

Checked requirement by requirement against the brief, then confirmed by an **independent**
oracle: a matrix probe (25 values × 4 variables) that imports `config.js` directly in a child
process and prints the resulting `limits` object, so behavior is observed without going through
the test suite at all.

| Requirement | Verdict | Evidence |
| --- | --- | --- |
| 1. `config.js` owns all four reads, `server.js` parses none | PASS | `git diff 7dc1f4d..HEAD -- server.js` is empty |
| 2. Exactly one new field `limits`; existing keys unchanged | PASS | diff adds only `config.js:36`; keys are `baseURL, host, rateLimit, limits, apiKey, proxyToken, unconfigured` |
| 3. Decimal-digits-only, safe integer, guard reused not duplicated, no `Number()` coercion | PASS | all four route through the single `readPositiveInteger`; `1e3`, `0x10`, `+5`, `.5`, `1_000`, 30-digit run, `2^53`, `2^53+1` all exit 1 for all four variables |
| 4. Margin capped at 50; `0` valid, `51` fatal | PASS | `0`→0, `50`→50, `51`/`64`/`100`→exit 1 `must be an integer between 0 and 50` |
| 5. Blank check precedes numeric parsing | PASS | `Boolean(raw?.trim())` is computed at `config.js:84-87` before any `readPositiveInteger` call; `""`, `"   "`, `" \t "` all yield the documented defaults |
| 6. `0` fatal for queue size and queue timeout | PASS | both exit 1; `"00"` also exits 1 (regex passes, `Number` is 0, `0 < 1`) |
| 7. `readSeconds` untouched, no lenient treatment for `PROXY_QUEUE_TIMEOUT_SECONDS` | PASS | diff leaves `readSeconds` and the two existing timeout variables alone |
| 8. No other variable added | PASS | no `env.` read added other than the four |

Independent probe results, all four variables:

- absent / `""` / `"   "` / `" \t "` → `{"maxConcurrentRequests":null,"maxQueueSize":32,"queueTimeoutSeconds":30,"safetyMarginPct":5}`
- `PROXY_MAX_CONCURRENT_REQUESTS=0` → `null`; `=1` → `1`; `=00` → `null`; `" 5 "` → `5`; `"5\n"` → `5`
- `PROXY_MAX_QUEUE_SIZE=0` → exit 1; `=00` → exit 1
- `PROXY_QUEUE_TIMEOUT_SECONDS=0` → exit 1; `=00` → exit 1
- `PROXY_SAFETY_MARGIN_PCT=0` → `0`; `=50` → `50`; `=51`/`=100` → exit 1
- defaults 32 / 30 / 5 confirmed as **stored** values, not just as "starts successfully"
- every fatal message names its own variable, verified per variable (e.g. `PROXY_SAFETY_MARGIN_PCT must be an integer between 0 and 50, got: 1e3`)

The test suite was **not** the source of truth for any of the above; it was checked separately
and agreed with the probe in every case.

### The brief's self-contradiction about `0` for the margin

The implementer's resolution (follow requirement 4, not requirement 6) is **correct**, and this
is the right call for four independent reasons:

1. The story — the authoritative spec — states it twice: the §8 table row is
   `PROXY_SAFETY_MARGIN_PCT | 5 | fatal outside integer 0–50`, and the §17 Gherkin scenario
   "Malformed operational values are fatal" names `51` as the fatal input. Both put `0` inside
   the range.
2. `specs/state.yaml` records the decision as pinned *before* dispatch: "PROXY_SAFETY_MARGIN_PCT
   is an integer 0-50 inclusive, because the Gherkin scenario names 51 as the fatal case and 0
   as valid." The brief instructs the implementer to implement those pinned decisions and not
   re-open them.
3. The brief's own test areas contradict requirement 6 in the same document: area 3 requires
   `PROXY_SAFETY_MARGIN_PCT=0` to start, and area 7 names `51` as the out-of-range case. A
   literal reading of requirement 6 would make the brief's own required tests unpassable.
4. The rationale the brief gives for requirement 6 — a zero queue size or zero-second wait
   "silently turns queueing into immediate rejection" — does not transfer to a percentage. A
   `0` safety margin means "reserve no headroom", which is a coherent, meaningful value, not a
   limit that fails open.

Requirement 6 is the single outlier and is almost certainly a drafting slip. The deviation was
declared in the report, recorded in `LOG.md`'s `decided` section, and is a one-bound change if
the orchestrator disagrees. No finding.

---

## Axis 2 — Invariant contract

- **`server.js` unchanged.** `git diff 7dc1f4d..HEAD -- server.js` produces no output;
  `sha256(server.js)` equals `git show ae9292c:server.js`. Story §11's "the server entry
  exports nothing new" holds: the only exports are the pre-existing
  `export { CONNECT_TIMEOUT_SECONDS, IDLE_TIMEOUT_SECONDS }` and `export default server`.
- **`server.test.js` additive only.** `git diff --numstat` reports `171  0` — 171 insertions,
  **0 deletions**, in a single hunk `@@ -938,3 +938,174 @@`, i.e. one contiguous append after
  the last existing line. No existing line deleted, reordered, weakened, or re-indented. No
  `test.only` / `.skip` / `.todo` anywhere in the file. No stub or helper touched; the diff adds
  no top-level `function` / `const` declaration, so no second seam was introduced — only
  `runProxyOnce` and `withProxy` are used, as required.
- **No dependency added.** `git diff 7dc1f4d..HEAD -- package.json` is empty; `package.json` is
  not in the changed-file list; the only added file in the range is the report itself.
- **Failure regimes preserved.** `NVIDIA_BASE_URL` still fatal at startup, missing credentials
  still `unconfigured` → 503. The probe set both credentials in every case and no case produced
  an unrelated exit.

---

## Axis 3 — Is the verify a real gate?

The ledger command for task 4, extracted from `specs/epics/e04-rate-limiting/e04s01-tasks.yaml`
and run verbatim from the worktree root:

```
out=$(node --test --test-reporter=tap --test-name-pattern 'PROXY_MAX_CONCURRENT|PROXY_MAX_QUEUE|PROXY_QUEUE_TIMEOUT|PROXY_SAFETY_MARGIN' server.test.js 2>&1); rc=$?; test $rc -eq 0 && t=$(printf '%s\n' "$out" | grep -cE '^[[:space:]]*ok [0-9]+ - ') && test "$t" -ge 1 && node -e "..."
```

- **Unmutated: `VERIFY_RC=0`**, 10 `ok` lines (9 new tests + the `operational limit config`
  suite line), final line `no new security findings in affected paths: limits validated, not
  applied`.
- **Mutated: `MUTATED_VERIFY_RC=1`.** The mutation removed the `PROXY_SAFETY_MARGIN_PCT` read
  entirely from `config.js` (so the variable stops being read *and* its name leaves the file,
  which also falsifies the third conjunct). The whole chain exited 1 on the first conjunct, as
  expected for an `A && B && C` chain.

So the gate is not vacuous: a variable that stops being read makes it fail. Both source files
were restored byte-identically afterwards; `git diff --exit-code` returned 0 and
`git status --porcelain` was empty.

---

## Axis 4 — Test suite and count sync

- `npm test` → `tests 56 · pass 56 · fail 0 · skipped 0 · todo 0`. Green.
- The brief's sweep, run from the worktree root, returns **12 hits, every one reading 56**:
  `AGENTS.md:89`, `AGENTS.md:107`, `CONVENTIONS.md:17`, `README.md:9`, `README.md:86`,
  `specs/README.md:19`, `specs/product/VISION_LATEST.yaml:20`,
  `specs/tech-architecture/TEST_PLAN_LATEST.md:44,294,351`,
  `specs/tech-architecture/tech-stack.md:129`,
  `specs/epics/e04-rate-limiting/e04s01-config-owner-and-bind-host.md:336`.
  I re-derived this list myself rather than trusting the report's; the report's site list is
  correct except that it also lists `AGENTS.md:106`, which the sweep does **not** match (its
  parenthetical reads `(currently 56)`) — see finding 3.1.
- Task 12's stronger form also passes: the `tests-56%20passing` badge grep is satisfied and the
  mismatch filter returns empty (`count ok: 56 across the living docs`).
- The count sync landed in `ae9292c`, the same commit as the tests, as the brief requires. The
  ledger flip `failing → passing` is also in `ae9292c`; `LOG.md` gained exactly 3 insertions and
  0 deletions in `11a5e55`; `specs/execution-status.yaml` still reads `e04s01: failing`.
- Forbidden files untouched: `plans/*.md`, `docs/research/config-invariant-guard-tests.md`, all
  briefs, and the rest of the ledger.

---

## Axis 5 — Report accuracy

**`whitespace` claim: confirmed true.** All 9 new test names match the ledger's name pattern,
and none contains `whitespace`. The four test names in the file that do contain it are at lines
549, 724, 809 and 869 — all pre-existing (two of them from task 3). Task 6's gate is therefore
still unfalsifiable-by-task-4, exactly as intended.

**Mutation spot-checks.** I re-ran six of the report's ten mutations myself with subtest-level
attribution. All were caught; every attribution the report gives is correct except one undercount:

| Report claim | My re-run | Result |
| --- | --- | --- |
| #1 queue size given `{ min: 0 }` | same | caught by exactly `PROXY_MAX_QUEUE_SIZE and PROXY_QUEUE_TIMEOUT_SECONDS reject 0` — attribution exact |
| #2 margin cap raised to 100 | same | caught by exactly `PROXY_SAFETY_MARGIN_PCT outside 0-50 exits 1 …` — attribution exact |
| #4 digits regex replaced by `Number.isFinite` | same | caught by exactly `each of the four … rejects a non-blank invalid value and names itself` — attribution exact |
| #5 queue-size blankness decided by presence | same | one subtest fails, the blank test — attribution consistent |
| #7 queue timeout given the lenient `readSeconds` treatment | same | caught by **two** tests (invalid-values *and* reject-0) — the report explicitly calls this out, and it is correct |
| #8 ceiling back to `min: 1` | same | one subtest fails, the `=0` test — attribution consistent |
| #10 enforcement sneaks into `server.js` | same | caught by **two** tests, not the one the report lists — see finding 3.3 |

"Ten mutations, ten catches" is therefore accurate. "Eight of the nine new tests were observed
failing under a mutation" is also consistent with what I saw (tests 3, 6, 7, 8 and 9 all failed
under some mutation; test 1 is the no-regression guard and is green by design, as claimed).

---

## Axis 6 — Code quality

Read `config.js` end to end. The widened guard holds up:

- **The default path is byte-equivalent to the original positive-integer rule.** For a safe
  integer, `value < 1` and `value <= 0` are the same predicate, and the comparison is only ever
  reached after `Number.isSafeInteger(value)` has already passed (`||` short-circuits). The
  error text for the rate pair is unchanged: `integerRule(1, Number.MAX_SAFE_INTEGER)` returns
  `"a positive integer"`, giving `PROXY_RPM must be a positive integer, got: -1` — the original
  string. Task 3's ten rate-pair tests still pass inside the 56.
- **The `value > Number.MAX_SAFE_INTEGER` bound is dead code** on the default path (an integer
  that is already a safe integer cannot exceed `MAX_SAFE_INTEGER`). It is harmless and it is
  what makes the `max` option self-describing, so I am not treating it as a finding, but it is
  the kind of clause a future reader will puzzle over.
- **The widening is proportionate, not over-built.** Requirement 3 forbids a *second* digits
  guard, not a widened one; this keeps exactly one `/^[0-9]+$/` in the file, adds two signature
  options and a five-line message helper, and is the minimum needed to express "0 disables" and
  "0–50 inclusive" without duplicating the parse. The deviation was declared. This is a
  reasonable resolution of a real tension in the brief, not scope creep.
- **No comment overstates test coverage.** The one comment that could have — the `limits` shape
  itself — is not a test claim, and the report's concern 2 says plainly that the shape is
  reviewed by eye. That is honest.

---

## Findings

### P0 — none

Every requirement in the brief is met, the invariant contract holds byte-for-byte, the verify is
a real gate, and the suite is green. I found nothing that breaks a stated requirement.

### P1 — none

I looked specifically for a test that asserts less than its name claims *and* where that gap
hides a real defect. Every behavior-bearing claim I could attack is backed by an assertion that
fails when the behavior is removed: the six mutations in Axis 5 each broke exactly the test the
report named. The two name-vs-assertion gaps I did find are real but are documentation-level,
and I have filed them as P2 rather than inflating them.

### P2

**2.1 — Two test names claim more than any assertion in the file can reach.**
`server.test.js:983` and `server.test.js:1039`.
`"… all absent start and serve /health"` passes `{}` as `proxyEnv`, but `withProxy` spreads
`{ ...process.env, ...extraEnv }`, so the test cannot guarantee the four are absent — only that
the test author's shell does not set them. And `"PROXY_MAX_CONCURRENT_REQUESTS blank (spaces or
tab) starts, the same disable path as 0"` asserts a 200 for three blanks; the "same disable
path" is an internal fact the child-process harness cannot see. Both claims are in fact true —
the code funnels blank and `0` to the identical `null` — but nothing in the suite proves either,
and the brief forbids the seam that would. *Why it matters:* a later slice could take a
different internal route for blank and leave both tests green. *Mitigating:* the failure mode
here is loud, not silent (an ambient `PROXY_MAX_QUEUE_SIZE=0` breaks the absent test outright),
and the report declares the harness inheritance in its concern 5. Cheap fix: soften the two
names, or have the absent test set all four to `undefined`-equivalent explicitly.

**2.2 — Nothing pins the stored defaults 32 / 30 / 5, or `null` for a disabled ceiling.**
`config.js:95-105`, no corresponding test.
Every test in the new block proves startup *behavior*; none observes the `limits` object, so
changing the queue-size default from 32 to 64, the timeout from 30 to 60, or the margin from 5
to 10 breaks no test. I confirmed the current values are correct by direct import, but nothing
holds them. *Why it matters:* slices #16+ will read these fields, and the defaults are exactly
the values an operator relies on when the variable is unset. The brief forbids a second seam, so
this cannot be fixed inside task 4; it must be pinned by a task that can see the object, or at
minimum recorded in task 7's ADR. The report's concern 2 and `LOG.md`'s `next` line both already
route it there — this is a declared, tracked gap, not a hidden one.

**2.3 — `README.md`'s configuration table has no row for any of the four variables, and no
ledger task owns that table.**
`README.md:95-102` (table) and `README.md:105-115` (the copy-paste block). The table stops at
`PROXY_HOST` and the two upstream timeouts; `PROXY_RPM` / `PROXY_TPM` from task 3 are also
missing. I checked every remaining ledger task: task 7 owns `docs/adr/0002`, task 8 owns
`CONTEXT.md` and `specs/tech-architecture/tech-stack.md`, tasks 9–11 own `CONVENTIONS.md`,
`SCOPE_LATEST.yaml` and the smoke script, task 12 owns the count sweep. **No task owns the README
env-var table.** *Why it matters:* `README.md` is the only operator-facing document in the repo,
and task 4's whole point is that these four variables are validated, so an operator who cannot
discover them cannot set them — and four silently-ignored variables is precisely the "a limit
that appears to exist and does not" failure the story is about. The report's concern 3 flags it
correctly and declines it to follow task 3's precedent; the gap is real and currently unowned.
Suggest folding the rows into task 8, which is already the documentation task.

### P3

**3.1 — Report quotes a `badge ok: 56` line that task 12's verify never emits.**
`specs/epics/e04-rate-limiting/briefs/e04s01-t04-report.md:104-105`. Task 12's verify runs
`grep -q "tests-${n}%20passing" README.md` (silent on success) and then `echo "count ok: ${n}
across the living docs"`. There is no `badge ok` string in that command, and `grep -rn 'badge
ok'` across the repo matches only this report line. The claim underneath the quote is true — I
ran the badge grep and the mismatch filter myself and both pass — but the quoted output is
fabricated. Small, because nothing downstream consumes it.

**3.2 — Report says the sweep finds 13 hits; it finds 12.**
`…-t04-report.md:102`. The 13th is `AGENTS.md:106`'s `(currently 56)`, which the brief's pattern
`tests(-| )?[0-9]{2}|[0-9]{2}[ -]tests?` does not match — the report says as much in the
paragraph below, so the "13" is counting the site it just excluded. Both counts describe the
same correct end state; the number is simply wrong. The site is real and was correctly updated
from 47.

**3.3 — The mutation table undercounts for mutation 10.**
`…-t04-report.md:127`. "enforcement sneaks in: `server.js` exits 1 when
`config.limits.maxConcurrentRequests` is set" is credited to one test. I re-ran it: **two**
tests fail — the `=1` "validated, not applied" test the report names, and also the
"at their boundary values" test, which sets `PROXY_MAX_CONCURRENT_REQUESTS=1` and therefore also
trips the mutant. "Ten mutations, ten catches" is unaffected.

**3.4 — The concurrency ceiling's stderr is looser than the rule it enforces.**
`config.js:90` + `config.js:132-135`. `integerRule(0, MAX_SAFE_INTEGER)` yields "a non-negative
integer", so `PROXY_MAX_CONCURRENT_REQUESTS=-1` reports *"must be a non-negative integer"*. The
story's rule is "positive safe integer, `0` disables" — an operator reading only the message
cannot tell that a positive value is what a live ceiling needs, or that `0` is not "a ceiling
of zero" but a disable. No wrong behavior; a wording improvement.

**3.5 — A test comment understates what `0` means for the margin.**
`server.test.js:968-969`: "`0` is absent here because it is fatal for only two of the four — see
the zero test below". For the margin `0` is not merely "excluded from this list"; it is a
**legal value**, and it is pinned as such in the boundary test. A reader could conclude the
margin's `0` is unhandled. The coverage is right; the comment is misleading about why.

**3.6 — `readPositiveInteger` now also accepts `0`, so the name understates it.**
`config.js:120`. With `min: 0` the guard is a bounded-integer guard, not a positive-integer one.
Keeping the name preserves the connection to task 3's guard and to `LOG.md`'s decision, so
renaming would cost more than it buys; noting it only so a future reader is not surprised by
`integerRule`'s "non-negative" branch.

---

## Verdict

**SHIP.**

No P0 and no P1 findings. Spec compliance is complete against all eight brief requirements, the
invariant contract holds byte-for-byte (`server.js` unchanged, `server.test.js` `171 0` in one
contiguous append, no dependency, no new export, no second seam), the ledger verify is a real
gate (`0` unmutated, `1` with a variable unread), `npm test` is 56/56, and every living doc
states 56 under both the brief's sweep and task 12's stronger form. The implementer's resolution
of the brief's own `0`-for-the-margin contradiction is the correct one and was properly declared.
The `whitespace` constraint task 6 depends on holds. Nothing must be fixed before shipping.

**Findings that must be fixed before shipping: none.**

Recommended follow-ups, none blocking: file 2.3 under task 8 so the README env-var table is
actually owned; file 2.2 into task 7's ADR 0002 (already routed via `LOG.md`'s `next` line);
soften the two test names in 2.1; correct the two miscounts in 3.1 and 3.2 so the record is
accurate for whoever reads it next.
