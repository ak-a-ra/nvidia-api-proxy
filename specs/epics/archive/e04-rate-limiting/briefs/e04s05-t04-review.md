# Review — e04s05 task 4: wire the per-model budget into the request path

**Verdict: PASS**

- Reviewed range: `4f41f96..ea7dd47` (base `4f41f96`, head `ea7dd47`)
- Implementer commits under review: `8ced235` (`server.js`, `server.test.js`, task-4 ledger row),
  `ea7dd47` (the task-4 report)
- Brief: `specs/epics/e04-rate-limiting/briefs/e04s05-t04.md`
- Report under review: `specs/epics/e04-rate-limiting/briefs/e04s05-t04-report.md` (a claim, not
  evidence)
- House standard: `specs/epics/e04-rate-limiting/briefs/e04s05-t0{1,2,3}-review.md`
- Reviewer runs: Node v26.4.0; `npm test` ×1 on HEAD (170.7 s) and ×1 on the pre-task tree
  (202.7 s); `npm run check`; the strengthened task-4 verify command on the working tree, on an
  exported copy of HEAD, and on an exported copy of the pre-task tree; the two task-4 tests against
  the pre-task `server.js`/`budget.js`; a pre/post differential harness over real HTTP (no model
  limits, with model limits + global pair, model limits without a global pair); three mutants of
  `budget.js` built in `$HOME/tmp/rev-t04/`. The working tree was not modified by any of it; the
  only file written is this review.

## Must-fix

None. Every requirement in the brief's Requirements (1–5), Tests, Implementation notes, Scope, and
Hard constraints is met by the code; D16–D19 are implemented as decided; the strengthened gate is
green on HEAD and red on the pre-task tree; a deployment without `PROXY_MODEL_LIMITS_JSON` is
byte-for-byte unchanged (verified differentially over real HTTP, not by assertion).

One brief requirement is provably unsatisfiable as written and was deviated from with a sound
argument — the Verification contract item 5 ("show that they fail" for **both** new tests). The
deviation is recorded under "Report accuracy" below, and I verified the substitute argument
(mutants) myself. It is not a defect.

## Should-fix

Not blocking acceptance. All four are report-accuracy or test-title items; none changes an
accepted or rejected value, and none is a behavior defect.

1. **`server.test.js:1610` — a test title that now states the opposite of the regime, and that
   ADR 0002 says the enforcing slice must change deliberately.**

   ```js
   test("PROXY_MODEL_LIMITS_JSON with well-formed budgets still proxies normally (values validated, not applied)", async (t) => {
   ```

   The assertions still hold — that test sets `PROXY_MODEL_LIMITS_JSON` with **no** global pair, so
   the gate is off and the value still changes no traffic (verified: `budget.js:336-349` returns the
   disabled gate, and `server.js:256`/`server.js:277` both skip the budget block). But the title is
   now false as a statement about the variable: `PROXY_MODEL_LIMITS_JSON` **is** applied whenever a
   global pair is present. ADR 0002 states the rule in as many words
   (`docs/adr/0002-config-operational-fail-fast.md:296-301`):

   > "A test name that says 'validated, not applied' is doing something specific: it pins that a
   > configuration extreme does not *change* traffic, so a later slice that starts enforcing has to
   > change that test deliberately rather than discover the change in production. That has now
   > happened once: e04s02 renamed the concurrency variant … and left the three budget variants
   > (rate pair, body-buffer cap, per-model map) untouched, because those limits are still stored
   > only."

   The per-model variant is the third one this task makes "not stored only", and the e04s02
   precedent renamed in the **enforcing** slice, not in the following doc-sync slice (`LOG.md:87`).
   The ADR's Compliance list quotes the old title verbatim
   (`docs/adr/0002-config-operational-fail-fast.md:571-573`), so a rename also needs that list
   updated — task 5 owns the ADR amendment, so either task 4 renames it now and task 5 fixes the
   Compliance list, or the orchestrator adds the rename to task 5's row explicitly. **Today the item
   is assigned to nobody**: task 4's brief scopes `server.test.js` to two specific test edits, and
   task 5's ledger row (`specs/epics/e04-rate-limiting/e04s05-tasks.yaml:97-107`) is documentation
   and count sync only and never mentions this title. The task-4 report's "task 5 must know" table
   does not list it either.

2. **`e04s05-t04-report.md:380` — a wrong line number.** The report puts the `PROXY_MODEL_LIMITS_JSON`
   env-table row at `README.md:143`; it is at **`README.md:142`** (`grep -n PROXY_MODEL_LIMITS_JSON
   README.md` → `142`, `180`, `194`).

3. **`e04s05-t04-report.md:145` — a wrong line range.** The report quotes the new comment block as
   `server.js:123-146`; the block runs `server.js:123-143` and `admitWithBudget` starts at
   `server.js:144`.

4. **`e04s05-t04-report.md:365-366` — a blanket claim that is false as written.** "no requirement of
   the brief's Scope, Requirements, Tests, Implementation notes, or Verification contract was left
   out" contradicts the report's own Falsifiability §3 (`:313-317`), which states that the new test
   **passes** on the pre-task tree. The brief's Verification contract item 5 asks for both new tests
   to fail there; item 5 was not met for `model limits without global pair has no effect`, and the
   report's own argument (a control plus two killed mutants) is the right substitute. The sentence
   should say "the Verification contract's item 5 is met for the rewritten test and satisfied in
   spirit for the new one, which cannot fail on a tree that lacks the feature."

## Orchestrator decisions D16–D19

**D16 — the client learns nothing about which budget bit: implemented as decided; the reasoning
holds.**

- The 429 arm is unchanged by this task (`git diff 4f41f96..HEAD -- server.js` touches only the
  `createBudget` call and two comment blocks). `server.js:289-295` still answers
  `sendJson(req, res, 429, { error: "Too many requests" }, { "retry-after": String(reservation.retryAfterSeconds) })`.
- The reason is carried but never used: `grep -n reason server.js` → `server.js:147` is the only
  read of `outcome.reason` (`return { admitted: false, reason: outcome.reason, retryAfterSeconds:
  outcome.retryAfter };`); the other three hits are `ticket.reason` from the admission layer, a
  different object. The reason never reaches a response, a header, or a log line.
- The model ID from the request body is not logged either. With `PROXY_LOG_REQUESTS=1` I captured
  the child's stdout during a model rejection; the four lines are exactly
  `{"ts":…,"method":"POST","path":"/v1/chat/completions","status":429,"ms":3}` — no model name, no
  reason. `budget.js` has no `console.` call at all (`grep -n "console\." budget.js` → no hit).
- Measured over real HTTP against HEAD (`PROXY_RPM=60`, `PROXY_TPM=100000`,
  `PROXY_MODEL_LIMITS_JSON={"nemotron":{"rpm":1}}`): first `nemotron` → `200`, second `nemotron` →
  `429` with body exactly `{"error":"Too many requests"}` and `Retry-After: 60`; upstream arrival
  count stayed at 1 across the rejection and rose to 2 only for the uncapped `llama` request that
  followed. The rejected request never reached the upstream.

I agree with D16.

**D17 — the test is renamed and its model entry becomes rpm-only: implemented as decided; the
reasoning holds and is empirically confirmed.**

- The test is named exactly `per-model limits are enforced` (`server.test.js:4274`) and the model
  entry is `{ "nemotron": { "rpm": 1 } }` (`server.test.js:4281`).
- D17's reason for the fixture change is correct, and I confirmed it over HTTP rather than by
  reading: with the **old** fixture `{"nemotron":{"rpm":1,"tpm":1}}` and a global pair, the **first**
  request is rejected — `429`, `Retry-After: 1` (a model window with no live token reservation) —
  i.e. `model_tpm`, exactly as D17 predicts, because `CHAT_BODY` costs 1034 tokens (10 input + the
  1024-token requested-output default) against an effective `tpm` of 1. With the rpm-only entry the
  first request is admitted and the second is refused with `Retry-After: 60` (the model window's
  own oldest live reservation, one second into the 60 s window).
- The names do not contain each other's substring, and the D19 pattern matches exactly the two
  intended tests (TAP output: `ok 1 - per-model limits are enforced`, `ok 2 - model limits without
  global pair has no effect`, `# tests 2`).

I agree with D17.

**D18 — the `admitWithBudget` comment drops both false claims: implemented as decided; the new
text is accurate.**

- The false claim "is implemented in budget.wait()" is gone, and it was false: `grep -n wait
  budget.js` returns only prose (`budget.js:42-47`, "Deliberately absent is a budget wait") — there
  is no `wait` function, and the module has no `async`/`await`, no promise, and no timer.
- The e04s05 forward reference is gone. The remaining claim ("Budget waiting proper … is deferred
  to a later story") matches the story.
- The kept reasoning is still true: a rolling 60 s window (`budget.js:53 WINDOW_MILLIS = 60_000`)
  frees only when its oldest reservation ages out, so a wait would hold the caller and its
  concurrency slot for most of a minute; the answer is an immediate 429 whose `Retry-After` comes
  from the window's own history (`budget.js:249-252`, `retryAfterSeconds` over the window's own
  event arrays — the model's own arrays for a model rejection).
- The new sentences are accurate too: "the rejection names the constraint that bit … the name stays
  inside the proxy" (verified above), and "the per-model windows are decided in the same
  synchronous pass as the global ones" (`budget.js:390-413`, `reserve()` is one synchronous function
  body — no `await` between the checks and the charges).
- The comment above `createBudget` (`server.js:16-23`) is accurate as well: "the per-model map rides
  along with it, and stays inert without the global pair" is exactly `budget.js:336-349`.

I agree with D18.

**D19 — the ledger's verify command is strengthened as decided: implemented exactly, and the
strengthening is real.**

- The yaml string is byte-identical to the brief's D19 command (358 chars, compared
  programmatically: `True`). The diff on `e04s05-tasks.yaml` is exactly two changed lines, both in
  task 4's row: the `verify` string and `status: failing` → `status: passing`.
- The ledger still parses; the story-level `status: failing` is unchanged; tasks 1–3 stay
  `passing` and task 5 stays `failing`.

I agree with D19.

## The wiring

- `server.js:23` — `const budget = createBudget(config.rateLimit, config.limits, config.modelLimits);`
  is the only functional change. The comment above it was rewritten to describe the per-model map's
  inertness without a global pair.
- **Without `PROXY_MODEL_LIMITS_JSON` — unchanged.** I ran the proxy from an exported copy of the
  pre-task tree (`4f41f96`) and from an exported copy of HEAD over real HTTP with
  `PROXY_RPM=3`, `PROXY_TPM=100000`, `PROXY_SAFETY_MARGIN_PCT=0` and no model limits: five
  `nemotron` requests and one 9 MiB body. Both trees returned `200, 200, 200, 429 (Retry-After 60,
  {"error":"Too many requests"}), 429`, and `413 {"error":"Request too large"}` for the oversized
  body; upstream arrival counts identical at every step. The two JSON records diff clean. The
  reason is structural as well: `config.modelLimits` is `null` when the variable is unset
  (`config.js:40`), and `budget.js` builds no model window for a `null` map.
- **With the variable and a global pair — enforced end to end.** See D16 above: the second request
  for the capped model is refused with the generic 429 and a positive integer `Retry-After`, never
  reaches the upstream, and an uncapped model is still admitted.
- **With the variable and no global pair — not enforced, and the body is not buffered.** Measured
  against HEAD with only `PROXY_MODEL_LIMITS_JSON={"nemotron":{"rpm":1}}`: both `nemotron` requests
  → `200`, `llama` → `200`, and the 9 MiB body → `200` with **9 437 246 bytes** arriving at the
  upstream (no `413`). The pre-task tree produces the identical record. The exported HEAD tree has
  no `node_modules` at all (`git archive` excludes it) and the proxy served every request — an
  incidental but real proof that the proxy still runs with zero install.

## The rewritten and new tests

Read both at `server.test.js:4274-4305` and `:4307-4339`.

`per-model limits are enforced` asserts the real outcomes: the admitted request is `200` with one
upstream arrival (`:4285-4287`); the second is `429` with the exact body
`{ "error": "Too many requests" }` via `assert.deepEqual` (`:4290`), a `Retry-After` that is a whole
number and `> 0` (`:4291-4293`), and the upstream count still at 1 — "the rejected request never
reached the upstream" (`:4294`); the request naming an uncapped model is `200` and does reach the
upstream (`:4298-4305`). Nothing is asserted from the reason, which is correct: the reason is
invisible at the HTTP level by design (D16).

`model limits without global pair has no effect` asserts that two requests for the capped model are
both admitted and both reach the upstream (`:4315-4320`), and that a body above the 8 MiB cap is
forwarded verbatim — `receivedRequests[2].rawBody` deep-equals the sent bytes (`:4322-4338`) — which
is only reachable when the gate is off and the body was never buffered. I confirmed the byte count
independently (9 437 246 bytes at the upstream).

### Is the "no global pair" test meaningful? Yes — with one nuance the report does not state

The implementer says it passes on the pre-task tree "by construction" and argues its teeth with two
mutants. **That argument is sound, and I reproduced it independently** (mutants built in
`$HOME/tmp/rev-t04/`, each a copy of HEAD with one change in `budget.js`):

| Mutant | Change | Result of `model limits without global pair has no effect` |
|---|---|---|
| mut1 | the disabled gate claims `enabled: true` | **fails** — `expected: 200, actual: 413` (the 9 MiB body is capped) |
| mut2 | the gate opens without a global pair **and** enforces the per-model windows | **fails** — `expected: 200, actual: 429` (the second request is refused) |

So the test pins two real properties, and both are load-bearing: it catches a gate that turns on
without a global pair (mut1, via the streaming/413 assertion) and a gate that enforces model limits
without a global pair (mut2, via the no-effect assertion).

The nuance: the report describes mut2 as "the disabled gate enforces the per-model windows on its
own … one change in `budget.js`" (`e04s05-t04-report.md:328`, `:340`). Taken literally — `enabled`
left at `false` — that mutant is **unreachable**: `server.js:256` and `server.js:277` both guard on
`budget.enabled`, so `budget.reserve()` is never called when the gate is disabled. I built exactly
that variant (mut2b: the disabled gate's `reserve()` enforces the model windows, `enabled` still
`false`) and the test **survives** it — but so would every black-box test, because the mutated
branch is dead code. The reachable form of mut2 (which also flips `enabled` to `true`, and therefore
also turns on buffering) is killed, as the table shows. The verdict is unaffected; the report's
mutant description should say that the reachable mutant must flip `enabled` as well.

A test that asserts a *negative* ("no effect") must pass on a tree that lacks the feature, so
passing on the pre-task tree is the expected result, not a tautology. The brief's Verification
contract item 5 asked for both new tests to fail pre-task; that is satisfiable only for the
rewritten test (it does fail there: `not ok 1 - per-model limits are enforced`, `expected: 429,
actual: 200`), and the substitute evidence — two killed reachable mutants — is stronger than the
brief asked for.

## Gate falsifiability (independently verified)

**Green on HEAD.** The D19 command, run verbatim in the working tree and in an exported copy of
HEAD:

```
    ok 1 - per-model limits are enforced
    ok 2 - model limits without global pair has no effect
ok 1 - e04s04 global RPM/TPM budgets
# tests 2 / # pass 2 / # fail 0
```

Exit 0 in both places; the name-counting form matches exactly two `ok` lines.

**Red on the pre-task tree.** `git archive 4f41f96` into `$HOME/tmp/rev-t04/pre`, same command,
working tree untouched:

```
$ cd $HOME/tmp/rev-t04/pre && sh gate.sh; echo "PRE-TASK gate exit=$?"
PRE-TASK gate exit=1
```

The pre-task tree prints only the file-level line (`ok 1 - server.test.js`, `# tests 1`, `# pass 1`),
so the name-matching count is `n = 0` and `test "$n" -ge 2` fails. The old vacuous form would have
counted that file-level line and exited 0 — the vacuity D19 describes is real, and the fix is real.

## Independent test run

**`npm test`** — one full run on HEAD:

```
ℹ tests 161
ℹ suites 15
ℹ pass 161
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 170701.937382
```

Exit 0, 170.7 s. The known pre-existing e04s03 flake (`shutdown rejects late arrivals and keeps
health responsive`) did **not** fire in this run; per the brief it is the known flake (≈1 run in 26,
reproduces on the pre-task tree) and not a defect of this task.

**Pre-task tree, same command** — `tests 160 / suites 15 / pass 160 / fail 0`, 202.7 s. This
confirms the report's "before" number and the structural count (160 `test(` declarations in the
pre-task `server.test.js`, 161 in the current one).

**`npm run check`** — clean: ESLint over `server.js config.js budget.js server.test.js`,
`tsc -p tsconfig.json`, and Prettier `--check` over the five formatted files ("All matched files
use Prettier code style!"). Exit 0, no findings, no rule silenced.

## Scope and hygiene

- `git diff --name-only 4f41f96..HEAD` → `server.js`, `server.test.js`,
  `specs/epics/e04-rate-limiting/e04s05-tasks.yaml`,
  `specs/epics/e04-rate-limiting/briefs/e04s05-t04-report.md`. Exactly the four expected paths.
- Per commit: `8ced235` → `server.js`, `server.test.js`, `e04s05-tasks.yaml` (3 files, +71/−14);
  `ea7dd47` → the report only (1 file).
- The `server.js` diff is 19 lines: the `createBudget` call, the comment above it, and the
  `admitWithBudget` comment block. No production logic was restructured; the request path, the
  budget block, the 429 arm, and the forwarding path are untouched.
- `config.js`, `budget.js`, `admission.js`, `package.json`, `README.md`, `AGENTS.md`,
  `CONVENTIONS.md`, `CONTEXT.md`, `specs/state.yaml`, the story spec, and every other spec doc are
  byte-identical to the base.
- **No runtime dependency**: `package.json` still has no `dependencies` key; `npm test` is still
  plain `node --test`.
- **`node_modules` was not committed**: `git ls-files | grep -c node_modules` → `0`.
- **Living-doc test counts and the "validated and stored, not enforced" wording were left alone**
  (task 5's job): `AGENTS.md:89`, `AGENTS.md:113`, `CONVENTIONS.md:17`, `README.md:9` (badge
  `tests-141%20passing`), `README.md:111`, `specs/README.md:19`,
  `specs/tech-architecture/tech-stack.md:172`,
  `specs/tech-architecture/TEST_PLAN_LATEST.md:44,294,351`, `specs/product/VISION_LATEST.yaml:20`,
  `specs/epics/e04-rate-limiting/e04s01-config-owner-and-bind-host.md:345` all still say 141; no
  160 or 161 was written into any living document.
- **The ledger's other rows are untouched**: the diff on `e04s05-tasks.yaml` is exactly two changed
  lines, both in task 4's row; the story-level `status: failing` is unchanged; tasks 1–3 keep
  `passing` and task 5 keeps `failing`.

## Report accuracy

Checked claim by claim against the code and my own runs. **Verified true**: the commit table and
per-commit file lists; the base commit `4f41f96`; the "before" count (160/160/0, 15 suites —
reproduced); the "after" count (161/161/0, 15 suites — reproduced); the structural `test(` counts
(160 → 161); the two test names and their line numbers (`4274`, `4307` — exact); the D19 gate
output and its byte-identity with the brief's command; the yaml diff quote (exact, two lines); the
ledger status list (story `failing`; tasks 1–4 `passing`, task 5 `failing`); the wiring diff
(exact); the "no `PROXY_MODEL_LIMITS_JSON` ⇒ unchanged" claim (reproduced differentially — my
record matches the report's case table); the observed 429 shape (`429`, body
`{"error":"Too many requests"}`, `Retry-After: 60`, upstream count 1 → 2 only after the uncapped
model's request); the falsifiability outputs (pre-task `n = 0`, gate exit 1; the rewritten test
failing pre-task with `expected: 429, actual: 200`; both mutants killed); the D17 fixture
rationale (confirmed over HTTP); the claim that `budget.js` has no `console.` call and no `wait`
function; `server.js:147` being the only reader of the reason; `server.js:278` being the
`estimateCost` call; `budget.js:336-349` being the disabled gate; the ADR §1.6 title
(`docs/adr/0002-...:96`); the count sites listed for task 5 (all confirmed at the stated line
numbers, including `specs/epics/e04-rate-limiting/e04s04-tasks.yaml:79` and
`specs/verifications/e04s04-verify.yaml:40,51,120`); `npm run check` clean.

**False or unsupported** — all minor, none behavioral:

- `e04s05-t04-report.md:380` — `README.md:143` should be `README.md:142` (should-fix 2).
- `e04s05-t04-report.md:145` — the comment block is `server.js:123-143`, not `123-146`
  (should-fix 3).
- `e04s05-t04-report.md:365-366` — "no requirement of the brief's … Verification contract was left
  out" is false as written; Verification contract item 5 is met for the rewritten test only
  (should-fix 4).
- `e04s05-t04-report.md:328`/`:340` — the mut2 description omits that a reachable mutant must also
  flip `enabled` (should-fix, discussed above).
- The report's "the living docs that still say 'validated and stored, not enforced'" table is
  accurate for the nine sites it lists but **incomplete**: ADR 0002's Decision §1.4, the e04s04
  story spec, and the stale test title are missing (listed in full below).
- Immaterial: the report's `duration_ms 198122` for `npm test` vs my 170.7 s — machine speed.

## What task 5 needs: every site that still describes `PROXY_MODEL_LIMITS_JSON` as stored and not enforced

Living docs (task 5 owns the wording):

1. `CONVENTIONS.md:27` — "`PROXY_MODEL_LIMITS_JSON` stays validated and stored, not enforced — issues
   #18–#22".
2. `README.md:142` — the env-table row describes the map but never says it is enforced.
3. `README.md:150-152` — the IMPORTANT note: "Every other `PROXY_*` row above is **validated and
   stored, not enforced** … the proxy parses them at startup and does not consult them while serving
   a request". False for the global budgets too since e04s04, and false for the per-model map now;
   the note names no individual variable, so the fix has to introduce the name.
4. `README.md:180` — the copy-paste block: "per-model budgets (validated and stored, not enforced
   yet)".
5. `specs/tech-architecture/tech-stack.md:76-80` — startup paragraph: "The other five
   rate-limiting limits above (…, `PROXY_MODEL_LIMITS_JSON`) are **validated and stored, not
   enforced**".
6. `specs/tech-architecture/tech-stack.md:164` — Gray Areas bullet: "`PROXY_MODEL_LIMITS_JSON` is
   still validated and stored only — per-model budgets are #18".
7. `specs/product/SCOPE_LATEST.yaml:36` — accepted tradeoffs: "… the five budgets stay stored, so
   the current build buffers nothing".
8. `docs/adr/0002-config-operational-fail-fast.md:77-87` — Decision §1.4: "the other five
   rate-limiting limits stay validated and stored" and "The one stored field is `config.modelLimits`
   — `PROXY_MODEL_LIMITS_JSON` — which becomes live in #18–#22". **(Not in the report's table.)**
9. `docs/adr/0002-config-operational-fail-fast.md:422-431` — Consequences: "The remaining five …
   stay invisible until #17–#22 … the only honest reading for those is 'validated and stored'".
10. `docs/adr/0002-config-operational-fail-fast.md:296-301` and `:571-573` — the standing rule about
    "validated, not applied" test names, and the Compliance list quoting the now-stale test title
    `PROXY_MODEL_LIMITS_JSON with well-formed budgets still proxies normally (values validated, not
    applied)`. **(Not in the report's table; the Compliance list must be updated if the title is
    renamed.)**
11. `CONTEXT.md:47-50` — "Rate budget, Per-model budget, and Safety margin name limits this proxy
    validates and stores but does not enforce … no enforcement path reads them".
12. `specs/epics/e04-rate-limiting/e04s04-enforce-global-rpm-tpm-budgets.md:150-151` — "No
    per-model enforcement. `PROXY_MODEL_LIMITS_JSON` is still validated and stored only (e04s05)."
    **(Not in the report's table.)**

Code / tests:

13. `server.test.js:1610` — the test title "(values validated, not applied)". **(Not in the report's
    table; currently unassigned — see should-fix 1.)**

Historical — leave alone, do not rewrite:

- `docs/adr/0002-config-operational-fail-fast.md:9-11` — the dated 2026-10-16 amendment line ("four
  of the five remaining rate-limiting limits are now read at request time and one still stays
  stored"). The fix is a **new** amendment line, not a rewrite of this one.
- `LOG.md`, `plans/*.md`, `docs/research/config-invariant-guard-tests.md` — dated history.
- `specs/epics/e04-rate-limiting/e04s05-apply-per-model-budgets-atomically.md:188` — the story's own
  Before/After table (the spec of this change; the story spec is explicitly out of scope).
- `specs/epics/e04-rate-limiting/e04s05-tasks.yaml:103` — task 5's own instruction, not a stale
  claim.

Test-count sites (task 5's job; all verified still at 141): `AGENTS.md:89`, `AGENTS.md:113`,
`CONVENTIONS.md:17`, `README.md:9`, `README.md:111`, `specs/README.md:19`,
`specs/tech-architecture/tech-stack.md:172`,
`specs/tech-architecture/TEST_PLAN_LATEST.md:44,294,351`, `specs/product/VISION_LATEST.yaml:20`,
`specs/epics/e04-rate-limiting/e04s01-config-owner-and-bind-host.md:345`,
`specs/epics/e04-rate-limiting/e04s04-tasks.yaml:79`,
`specs/verifications/e04s04-verify.yaml:40,51,120`. The new total is **161**.

## Notes for the next task

- The model windows' `closed` flag stays unobservable through the public API (task-3 review,
  should-fix 3): the global window refuses first, so pinning it would need a seam on the returned
  budget. Task 4 did not change that.
- A model rejection never charges the global window (intended semantics, pinned by task 3's unit
  test), which means the global budget is no longer a proxy for total request volume while
  per-model limits exist.
- Budget waiting remains unimplemented (`budget.js` has no wait primitive; the request path has no
  wait to call). `server.js` now says so instead of pointing at a function that does not exist.
- The ADR 0002 amendment this task needs is a wording amendment, not a new failure-mode decision:
  nothing about parsing or startup changed; what changed is that a stored map became a consulted
  one. It should record that the per-model budget is enforced atomically with the global one (a
  model rejection never consumes global budget) and that per-model limits are inert without the
  global pair.

## Reviewer's note on the working tree

`git status --short` was empty before and after this review; every proof ran against copies under
`$HOME/tmp/rev-t04/` (`git archive` exports plus copies of the current test file). The only file
written by this review is this one.
