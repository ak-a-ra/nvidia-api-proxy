# Review — e04s05 task 2: per-model rolling windows in `createBudget`

**Verdict: PASS**

- Reviewed range: `9c0a500..822c3f0` (base `9c0a500`, head `822c3f0`)
- Implementer commits: `535187d` (budget.js), `891f1a5` (server.test.js + task-2 ledger row),
  `822c3f0` (report)
- Brief: `specs/epics/e04-rate-limiting/briefs/e04s05-t02.md`
- Report under review: `specs/epics/e04-rate-limiting/briefs/e04s05-t02-report.md`
- House standard: `specs/epics/e04-rate-limiting/briefs/e04s05-t01-review.md`
- Reviewer runs: Node v26.4.0, `npm test` ×3 (≈250–325 s each), `npm run check`, the strengthened
  task-2 gate on HEAD and on the pre-task tree, the six new tests against the pre-task `budget.js`,
  and a pre/post differential harness for the global gate. The working tree was not modified;
  every pre-task artifact was materialised under `$HOME/tmp/`.

## Must-fix

None. Every requirement in the brief's Requirements (1–7), Tests to add, Implementation notes, and
Verification contract sections is met; the six orchestrator decisions D4–D9 are implemented as
decided; the global gate's observable behavior is unchanged; the null-prototype hazard is closed;
and the strengthened gate is green on HEAD and red on the pre-task tree.

## Should-fix

Not blocking acceptance. All five are comments, report wording, or test-seam observations — none
changes an accepted or rejected value.

1. **`e04s05-t02-report.md:271`** — "The failure is a real assertion failure, not an error" is not
   true for all five failures. Tests 1, 3, 4 and 5 fail with assertion failures, but test 2 fails
   with a thrown `TypeError` because the pre-task `budget.js` has no `modelEffective` at all:

   ```
   not ok 2 - per-model windows are built with the same safety margin as the global windows
     error: "Cannot read properties of undefined (reading 'nemotron')"
   ```

   (reproduced from my own run of the current `server.test.js` against `git show 9c0a500:budget.js`).
   The claim should read "the failures are real assertion failures (test 2 throws a `TypeError`
   because `modelEffective` does not exist)". Nothing about the implementation changes; the falsifiability
   conclusion still holds.

2. **`server.test.js:4417-4426`** — test 5 (`close refuses model reservations`) cannot distinguish the
   *global* window's closed flag from the *model* windows' closed flags: after `budget.close()` the
   global window refuses first, so the assertion would hold even if `close()` never touched the
   model windows. The requirement "close() closes all model windows" (brief requirement 5, story
   §11.8) is therefore verified by code reading (`budget.js:357-362`) and not by an observable
   assertion. The implementer's added `assert.ok(budget.modelEffective, ...)` is what makes the test
   fail against the pre-task `budget.js` at all, and it is a legitimate arrange-step assertion, not a
   behavior pin. Not fixable inside this task: with D7 the model windows are never consulted, so no
   observable seam exists yet. Task 3 should be aware that the model-window close stays unobservable
   even after `reserve()` consults the model windows (the global window refuses first on a closed
   budget) — if a pin is wanted, the budget needs to expose the model windows or a
   `closed`/`modelClosed` signal.

3. **`budget.js:292`** — the factory comment the implementer moved still reads "wait() never
   blocks":

   ```
   // builds a disabled gate: reserve() fails open, wait() never blocks, close()
   ```

   `budget.js` has no `wait()` function and never had one. The text is carried over verbatim from the
   pre-task comment (`9c0a500:budget.js:206-208`), so this is a pre-existing inaccuracy the
   implementer reproduced rather than introduced — but since the block was rewritten and re-placed,
   dropping the `wait()` clause is a one-word fix.

4. **`specs/epics/e04-rate-limiting/e04s05-tasks.yaml:42`** (task 2's `verify`) — the strengthened
   gate counts `≥ 2` lines matching `per-model windows are built|close refuses model` and therefore
   matches **4** of the 6 new tests (test 3's name contains the substring, see the brief-defect note
   below). The gate is genuinely non-vacuous (red on the pre-task tree, verified below), so it does
   its job, but it cannot pin *which* tests ran: deleting tests 1 and 2 while keeping 3 and 5 would
   still satisfy `n ≥ 2`. This is the exact command D8 mandated, so the implementer applied it
   correctly; the looseness is the brief's, and it is worth tightening in a later pass.

5. **Flaky e04s03 test observed during review (not an implementer defect)** — `shutdown rejects
   late arrivals and keeps health responsive` (`server.test.js:3809`) failed in **2 of my 3** full
   `npm test` runs on HEAD with an unhandled `TypeError: fetch failed` /
   `ECONNRESET`, and passed in the third. The same test fails on the **pre-task** tree in isolated
   runs (1/12 in one batch; across all my isolated batches: HEAD 1/26, pre-task 1/32 — comparable
   rates). The failure is a harness race, not a budget bug: `proxiedFetch`
   (`server.test.js:309`) uses undici's pooled global dispatcher, `late`/`health` are fired 50 ms after
   `SIGTERM`, and the `health` promise has no handler attached until after `await late`, so a
   connection reset during that window surfaces as an unhandled rejection. There is no causal path
   from this task: `server.js:20` still calls `createBudget(config.rateLimit, config.limits)` with two
   arguments, so `modelLimits` is `undefined`, no model window is ever built, and the only runtime
   delta on the shutdown path is `budget.close()` now setting a flag on the window object instead of
   on the budget object (plus an `Object.keys` over an empty map). The repo already flags this
   class of timing sensitivity (`specs/verifications/e04s02-verify.yaml:114`, "raise to 500ms if
   flakes observed"). Worth a follow-up issue; not a blocker for this task.

### Brief defect (not an implementation defect)

The brief's test table names test 3 `per-model windows are built only when the global budget is
enabled`, while the paragraph under the table says "Names 3, 4 and 6 must not accidentally contain
either substring". The implementer followed the table (`server.test.js:4389`) and the trailing rule
for names 4 and 6 (neither contains either substring — verified). **The gate's meaning is not
affected**: the gate counts `≥ 2` matching lines and needs at least two of tests 1, 2, 5 to exist
and pass; with test 3 renamed it would still count 3, and on the pre-task tree it counts 0 either
way (verified below). No fix required; a rename is optional.

## Orchestrator decisions D4–D9

**D4 — model windows are built at construction time: implemented as decided; the reasoning holds.**
`createBudget` builds every model window inside the factory call
(`budget.js:329-339`), inside `for (const [model, entry] of Object.entries(modelLimits))`. Nothing
in `budget.js` creates a window at request time — `grep -n "createWindow" budget.js` returns exactly
two call sites (`budget.js:216` the definition, `budget.js:316` the global window, `budget.js:332`
the model windows). The story's own text agrees with D4: `e04s05-apply-per-model-budgets-atomically.md:50-52`
now reads "created at construction time rather than on first use", matching §5 step 2, §6 and the
ledger. I agree with D4.

**D5 — null-prototype maps: implemented as decided; the hazard is genuinely closed.**
`budget.js:326-327` create both maps with `Object.create(null)`; the inner entry objects
(`budget.js:335-337`) are plain because their key set is fixed at `rpm`/`tpm`. Verified
behaviourally, not just by reading:

```
Object.getPrototypeOf(budget.modelEffective) === null        → true
hasOwnProperty("__proto__") on modelEffective                → true
modelEffective["__proto__"]                                   → { rpm: 5 }   (not swallowed)
Object.getOwnPropertyDescriptor(modelEffective, "__proto__")  → { value: {rpm:5}, writable:true, enumerable:true, configurable:true }
modelEffective["constructor"] / ["toString"]                  → own entries, not Object.prototype
Object.prototype untouched (no pollution)                     → true
```

The hazard D5 cites is real and the fix closes it: on a **plain** object the same assignment
(`plain["__proto__"] = { rpm: 5 }`) leaves `Object.keys(plain) === ["normal"]` — the entry is
swallowed by the prototype setter, exactly as `config.js:149-152` warns. The budget layer is also
safe when handed a plain (non-null-prototype) map, e.g. a `JSON.parse`d document:
`JSON.parse('{"__proto__":{"rpm":5}}')` → `Object.entries` yields `[["__proto__",{rpm:5}]]` → the
entry lands intact in the null-prototype `modelEffective` and `Object.prototype` is untouched.
I agree with D5.

**D6 — uniform returned shape: implemented as decided.**
`modelEffective` is present on the returned object in both gates — `budget.js:301` (`modelEffective: null`
on the disabled path) and `budget.js:341`/`budget.js:368` on the enabled path. Verified: `"modelEffective" in budget`
is `true` for the disabled gate and for the enabled gate. `modelEffective` is `null` in exactly the
three cases the brief names: no `modelLimits`, an empty map, and a disabled global budget
(`budget.js:341` collapses an empty map to `null`; `budget.js:295` returns the disabled gate before
any window is built). Otherwise it is the null-prototype map. I agree with D6.

**D7 — `reserve()` does not change in this task: implemented as decided.**
`budget.js:345-347` is `function reserve(cost) { return globalWindow.reserve(cost); }` — the global
window only. A request naming a configured model is still admitted by the global budget. No test
pins that intermediate admission, as D7 requires. I agree with D7 — and I note the implementer's
"check/charge split" concern for task 3 (below) is exactly right: `createWindow.reserve()`
(`budget.js:252-279`) checks *and* charges in one call, so task 3 cannot simply call the global
window first.

**D8 — the strengthened verify gate: implemented as decided; the gate is real.**
Task 2's `verify` in `specs/epics/e04-rate-limiting/e04s05-tasks.yaml:42` is byte-identical to the
D8 form in the brief, and `status: passing` was flipped on that row only
(`e04s05-tasks.yaml:46`). The diff on the file is exactly two lines. The ledger still parses:
story `status: failing`; tasks `1 passing, 2 passing, 3 failing, 4 failing, 5 failing`. The story
level status and the other rows are untouched. I agree with D8.

**D9 — one window implementation shared by the global gate and the model windows: implemented as
decided; the drift risk is gone.**
`createWindow(rpmLimit, tpmLimit)` (`budget.js:216-288`) holds the event histories, `prune`,
`totals`, `oldestTokenEvent`, `retryAfterSeconds`, `reserve` and `close`. The global window is one
instance (`budget.js:316`) and every model window is another (`budget.js:332`). There is no second
copy of the window logic in the file. The shared horizon is `WINDOW_MILLIS` (`budget.js:47`) and the
shared effective-limit arithmetic is `effectiveLimit` (`budget.js:66-69`), applied to the global
pair (`budget.js:311-314`) and to every model entry (`budget.js:330-332`) from the one margin
`limits?.safetyMarginPct ?? 5` (`budget.js:310`). A dimension with no window is skipped by
`rpmLimit != null` / `tpmLimit != null` guards (`budget.js:259`, `266`, `274`, `275`), so a
model entry with only `rpm` is uncapped on tokens. I agree with D9.

## The refactor's risk — the global gate is unchanged (independent differential)

I imported the pre-task `budget.js` (`git show 9c0a500:budget.js`) and the current one side by side
and ran the same scenarios through both factories (rpm overflow, tpm overflow, margin, closed
budget, disabled budget), comparing `enabled`, `effective`, and the full `reserve()` outcome
sequence (admitted / reason / retry-after presence / cost echo):

```
scenario rpm-over:  identical=true
scenario tpm-over:  identical=true
scenario margin:    identical=true
scenario closed:    identical=true
scenario disabled:  identical=true
ALL GLOBAL SCENARIOS IDENTICAL: true
```

Independently checked against the e04s04 contract (`e04s04-enforce-global-rpm-tpm-budgets.md:74-75`,
`:208`, `:273` — "Retry-After derived from the window's own oldest live reservation", "always
positive"):

- effective limits: `effectiveLimit(60, 5) = 57` for the global pair and `57` for a model entry with
  `rpm: 60` — one margin source (`budget.js:310`), so they cannot disagree; floor-at-one holds
  (`rpm: 1` with a 50 % margin → `1`).
- 60-second horizon: with a fake clock, a reservation at `t` is still charged at `t + 59 999 ms` and
  has expired at `t + 60 000 ms` (the `now - events[0].at >= WINDOW_MILLIS` prune, `budget.js:225-229`).
- rejection reasons: `rpm` and `tpm`, unchanged (`budget.js:262`, `269`).
- `Retry-After`: derived from the window's own oldest live reservation — 60 s on a fresh window,
  1 s at the 59.999 s boundary (`retryAfterSeconds`, `budget.js:244-247`).
- `close()`: synchronous and idempotent — the first post-close `reserve()` returns
  `{admitted:false, reason:"closed", retryAfter:1}` and so does the second (`budget.js:281-286`,
  `357-362`).
- disabled gate: `enabled:false`, `effective:null`, `reserve()` returns `{admitted:true, cost:null}`,
  `close()` is a no-op (`budget.js:295-308`).

The e04s04 block itself is green on HEAD: 8/8 pass, including
`per-model limits are accepted and do not change global behavior` (`server.test.js:4274`) — correct
for this task, since the proxy still passes no model map (that is task 4's job). The only
observable shape change on the global path is the added `modelEffective` key on the returned object,
which D6 mandates.

## Test quality

The six tests live in the existing `describe("e04s05 per-model budgets")` block
(`server.test.js:4295-4437`); `createBudget` was added to the existing import at `server.test.js:6`.
Every name is a behavior sentence, and each test asserts an outcome value rather than restating the
implementation:

| # | Test | Line | Asserts |
|---|---|---|---|
| 1 | `per-model windows are built for every configured model` | 4360 | `deepStrictEqual` against a null-prototype expected map (prototype-sensitive, so it also pins the null prototype) + one entry per model |
| 2 | `per-model windows are built with the same safety margin as the global windows` | 4377 | global `rpm` 57 and the model `rpm` equal to it and equal to `floor(60*0.95)` |
| 3 | `per-model windows are built only when the global budget is enabled` | 4389 | disabled global → `null`; no model limits → `null` |
| 4 | `a model entry with only rpm leaves its token budget uncapped` | 4397 | rpm-only entry has **no** `tpm` key and vice versa (both directions) |
| 5 | `close refuses model reservations` | 4417 | after `close()`, `reserve()` of a model-naming cost → `{admitted:false, reason:"closed"}` |
| 6 | `the global budget is unchanged when model limits are configured` | 4427 | with a model map of `rpm:1,tpm:1` present, the global `rpm:2` still admits two and rejects the third with `reason:"rpm"` — not a model reason |

Brief coverage: effective limits with a margin ✓ (test 2), partial entry in both directions ✓
(test 4), no model limits ✓ and disabled global budget ✓ (test 3), `close()` ✓ (test 5), the global
gate unchanged with model limits configured ✓ (test 6). Test 1's map also contains a partial entry
(`llama: {rpm: 30}`), which is a useful cross-check.

**Falsifiability (not a restatement of the implementation).** The current `server.test.js` against
the pre-task `budget.js`, in a temp directory:

```
not ok 1 - per-model windows are built for every configured model
not ok 2 - per-model windows are built with the same safety margin as the global windows
not ok 3 - per-model windows are built only when the global budget is enabled
not ok 4 - a model entry with only rpm leaves its token budget uncapped
not ok 5 - close refuses model reservations
ok 6 - the global budget is unchanged when model limits are configured
# tests 6 / # pass 1 / # fail 5
```

The implementer's "5 of 6 fail, test 6 passes by design" claim is **honest and correct**, and test 6
is a meaningful pin rather than filler: it is the only test in the block that asserts the *global*
decision while model limits are configured — the exact behavior D7 and D9 require to stay put. It
would catch a regression that made the model window (or a mis-wired global limit) leak into the
global path, and it is the control that proves the refactor is behavior-preserving. It cannot fail
on the pre-task tree by construction, which is precisely why it is a control and not a tautology.

## Gate falsifiability (independently verified)

The strengthened task-2 verify string, extracted from `e04s05-tasks.yaml:42` and run verbatim:

- **On HEAD:** `gate_rc=0`, `n=4` (tests 1, 2, 3 and 5), `rc=0`.
- **On the pre-task tree** (`9c0a500` files copied into `$HOME/tmp/rev-t02/pre`; the working tree
  was not touched): the pre-task run prints only the file-level line `ok 1 - server.test.js`,
  `n=0`, and the strengthened gate **exits 1**. The *old* (vacuous) ledger gate on the very same
  tree exits **0** — the vacuity D8 describes, reproduced.

```
PRE-TASK strengthened gate_rc=1 n=0 node_rc=0
old_gate_rc=0
```

## Independent test run

**`npm test`** — three full runs on HEAD (each ≈250–325 s):

| run | tests | pass | fail | failing test |
|---|---|---|---|---|
| 1 | 153 | 152 | 1 | `shutdown rejects late arrivals and keeps health responsive` (e04s03, flaky — see should-fix 5) |
| 2 | 153 | 152 | 1 | same |
| 3 | 153 | **153** | **0** | — |

`ℹ suites 15`, `ℹ cancelled 0`, `ℹ skipped 0` in every run. The suite size matches the brief's
expectation (147 + 6 = 153). The single failure is the pre-existing e04s03 harness race described in
should-fix 5: it also reproduces on the pre-task tree in isolated runs, there is no causal path from
this change (the proxy still calls `createBudget` with two arguments, so no model window is ever
built), and the third full run is clean.

**`npm run check`** — clean: ESLint over `server.js config.js budget.js server.test.js`,
`tsc -p tsconfig.json`, and Prettier `--check` over the five formatted files
("All matched files use Prettier code style!"). No findings.

## Scope and hygiene

- `git diff --name-only 9c0a500..HEAD` → `budget.js`, `server.test.js`,
  `specs/epics/e04-rate-limiting/e04s05-tasks.yaml`,
  `specs/epics/e04-rate-limiting/briefs/e04s05-t02-report.md`. Exactly the four expected paths.
- Per commit: `535187d` → `budget.js` only; `891f1a5` → `server.test.js` +
  `e04s05-tasks.yaml` only; `822c3f0` → the report only.
- `git diff --name-only 9c0a500..HEAD -- package.json config.js server.js admission.js README.md
  AGENTS.md CONVENTIONS.md specs/state.yaml` → empty. Nothing out of scope was touched.
- No runtime dependency: `package.json` has no `dependencies` key; `budget.js` imports nothing
  (`grep -n "^import" budget.js` → no hit); `npm test` is still plain `node --test`.
- `node_modules` was not committed: `git ls-files | grep -c node_modules` → `0`. (It is a symlink to
  the main checkout's `node_modules`, and it is untracked.)
- Living-doc test counts correctly left alone (count sync is task 5's job): `AGENTS.md:89`,
  `AGENTS.md:113`, `CONVENTIONS.md:17`, `README.md:9` (`tests-141%20passing`), `README.md:111`,
  `specs/README.md:19`, `specs/tech-architecture/tech-stack.md:172`,
  `specs/tech-architecture/TEST_PLAN_LATEST.md:44,294,351`, `specs/product/VISION_LATEST.yaml:20`,
  `specs/epics/e04-rate-limiting/e04s01-config-owner-and-bind-host.md:345` all still say 141.
  No 153 was written into any living doc.
- The ledger's other rows are untouched: the diff on `e04s05-tasks.yaml` is 2 changed lines, both in
  task 2's row; the story-level `status: failing` is unchanged.

## Report accuracy

Every substantive claim in `e04s05-t02-report.md` checks out against the code and my own runs:
the commit table and per-commit file lists; the base commit `9c0a500`; 147 → 153 tests and 15
suites (the pre-task full suite I ran reports `ℹ tests 147 / ℹ suites 15 / ℹ pass 147 / ℹ fail 0`);
the six test names; `server.test.js:6` for the import; `server.test.js:4360-4436` for the new block;
the D5 code block (byte-identical to `budget.js:326-339`); the D8 gate output (`n=4`, `rc=0`) and
the extracted-from-yaml run (`gate_rc=0`); the yaml parse (story `failing`; tasks `1 passing,
2 passing, 3 failing, 4 failing, 5 failing`); the "exactly two changed lines" diff quote; the
falsifiability outputs (`runner_rc=0 matching_ok_lines=0`, `old_gate_rc=0`, `gate_rc=1 n=0`) and the
"5 fail / 1 pass" tally — both reproduced verbatim; `npm run check` clean; the `__proto__` claim
(verified above); the "`modelEffective` is null for no model limits / an empty map / a disabled
global budget" claim (verified); the "the global path is byte-for-byte the old behavior" claim
(verified by the differential harness); `server.js:20` being the wiring site; and "budget.js still
reads no environment, starts no timer, and imports nothing".

Two claims are not supported as written:

1. **`e04s05-t02-report.md:271`** — "The failure is a real assertion failure, not an error" is false
   for test 2 (it throws a `TypeError`). See should-fix 1.
2. **`e04s05-t02-report.md:74-84`** — "`npm test` — expect `tests 153`, `pass 153`, `fail 0`" is what
   the implementer measured, and it is achievable (my third run is exactly that), but it is not
   reliable on this machine: the e04s03 shutdown test is flaky (2 of my 3 runs). The report is not
   wrong about what it measured; the orchestrator should know the suite is one flake away from red
   regardless of this task.

Everything else in the report — including the two disclosed deviations (test 3's name, the extra
assertion in test 5) and the "concerns" section — is accurate and appropriately disclosed.

## What task 3 must know about the code it will build on

- **`createWindow.reserve()` is check-and-charge in one call** (`budget.js:252-279`). Task 3's
  atomicity rule ("the global check passes tentatively, then the model window is consulted, and only
  if both pass are both charged") cannot be implemented by calling the global window first: it
  charges on admission. The factory has to split into a decision half (`check(cost)` returning the
  decision plus the pruned snapshot) and a charge half (`charge(cost)` writing the events). The
  implementer's report says exactly this and is right. Keep it inside `createWindow` so the global
  and model windows still cannot drift (D9).
- **The model-window map is module-private** (`budget.js:326`) — `createWindow` returns only
  `{ reserve, close }` (`budget.js:287`). Task 3 needs a decision+charge surface on the model
  windows too; keep the null prototype.
- **Reason strings**: a window's own reason is `rpm`/`tpm`; the budget level must map a model
  rejection to `model_rpm`/`model_tpm` (story §2/§8) while the global window keeps `rpm`/`tpm` —
  the e04s04 tests and the new test 6 (`server.test.js:4427`) pin the global spelling. The
  `Retry-After` for a model rejection comes from the model window's own oldest live reservation,
  which the shared `retryAfterSeconds()` already computes.
- **Lookup rules**: the model ID is the map key exactly as `config.js` stored it (`config.js:155-156`
  — never trimmed, lowercased, or normalized). `cost.model === null` or a model that is not in the
  map matches no window and falls through to the global budget alone (story §2 "Unknown models fall
  through to global only", §11.4). The map is null-prototype, so a `__proto__` key is an ordinary
  own property and is found by a plain lookup; `constructor`/`toString` likewise.
- **`modelEffective` is part of the returned contract** (story §8) and must stay: it is `null` or a
  null-prototype map of `{ [model]: { rpm?, tpm? } }` with *effective* (margin-applied) limits, a
  missing dimension absent rather than `null`-valued. Task 3 must not turn it into a plain object.
- **The global path must stay byte-identical** in behavior: same effective limits, same 60 s horizon,
  same `rpm`/`tpm` reasons, same `Retry-After` derivation, same idempotent `close()`. The e04s04
  block plus the new test 6 are the proof.
- **Wiring (task 4)**: `server.js:20` becomes `createBudget(config.rateLimit, config.limits,
  config.modelLimits)`. `config.modelLimits` is already the null-prototype map `budget.js` expects,
  and `createBudget` runs once at module load, so the model windows are built at startup (D4).
- **A model window's closed flag is unobservable** even after task 3: the global window refuses
  first on a closed budget. If story §11.8 (`close()` closes all model windows) is to be pinned by a
  test rather than by reading, `budget.js` needs a seam for it.
