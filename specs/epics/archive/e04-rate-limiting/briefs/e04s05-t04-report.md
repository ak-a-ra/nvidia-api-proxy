# e04s05 Task 4 Report: Wire the per-model budget into the request path

## Status

`passing`.

`server.js` now hands `config.modelLimits` to `createBudget`, so the per-model windows that
`budget.js` already builds are consulted on the request path, in the same atomic decision as the
global windows. A request whose model is capped is refused with the same generic 429 a global
rejection produces, and the reason never leaves the proxy. The `admitWithBudget` comment now
describes what the code does: an over-budget request is answered, never waited out, and no wait
primitive exists to call.

Base commit: `4f41f96` (tasks 1–3, their reviews, the task-4 brief, and the orchestrator's
decisions D16–D19). The pre-task tree used for every falsifiability proof below is `4f41f96`
itself, materialized under `$HOME/tmp/t04/` with `git archive 4f41f96 | tar -x`. The working
tree was not modified by any of the proof runs.

## Commits

| Commit | Subject | Files |
|---|---|---|
| `8ced235` | `feat(server): enforce the per-model budget on the request path` | `server.js`, `server.test.js`, `specs/epics/e04-rate-limiting/e04s05-tasks.yaml` |
| (this report) | `docs(e04s05): add the task 4 report` | this file |

`git diff --name-only 4f41f96..HEAD` → `server.js`, `server.test.js`,
`specs/epics/e04-rate-limiting/e04s05-tasks.yaml`, this report. `config.js`, `budget.js`,
`admission.js`, `package.json`, `README.md`, `AGENTS.md`, `CONVENTIONS.md`, `specs/state.yaml`,
the story spec and every other spec doc are untouched. No runtime dependency was added
(`package.json` still has no `dependencies` key; `server.js` imports only `node:` built-ins and
the local modules). `npm test` is still plain `node --test`. `node_modules` was not staged: the
three paths were staged by name.

## Test summary

| | count |
|---|---|
| before this task | 160 tests, 160 pass, 0 fail (15 suites) |
| after this task | 161 tests, 161 pass, 0 fail (15 suites) |

The "before" number is measured, not inherited: the pre-task tree at `4f41f96` was run in
`$HOME/tmp/t04/preorig` — `tests 160 / pass 160 / fail 0`, 15 suites, 241.3 s. The "after" number
is the full run on this branch (see below). The structural count agrees: 160 `test(` declarations
in the pre-task `server.test.js`, 161 in the current one.

The two tests, both in the existing `describe("e04s04 global RPM/TPM budgets")` block:

1. `per-model limits are enforced` (`server.test.js:4274`) — replaces
   `per-model limits are accepted and do not change global behavior`
2. `model limits without global pair has no effect` (`server.test.js:4307`) — new

Neither name contains the other's substring. Name 1 carries the exact substring the D19 gate
matches, and name 2 carries the other one.

### The strengthened task-4 verify command (D19), run verbatim

```bash
out=$(node --test --test-reporter=tap --test-name-pattern 'per-model limits are enforced|model limits without global pair' server.test.js 2>&1); rc=$?; test "$rc" -eq 0 || { printf '%s\n' "$out"; exit "$rc"; }; n=$(printf '%s\n' "$out" | grep -cE '^[[:space:]]*ok [0-9]+ - .*(per-model limits are enforced|model limits without global pair)'); test "$n" -ge 2
```

```
gate rc=0 n=2
    ok 1 - per-model limits are enforced
    ok 2 - model limits without global pair has no effect
ok 1 - e04s04 global RPM/TPM budgets
# tests 2
# pass 2
# fail 0
```

Exit 0, two matching `ok` lines, `n = 2 ≥ 2`.

### `npm test`

```
ℹ tests 161
ℹ suites 15
ℹ pass 161
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 198122.278623
```

Exit 0, 198.1 s. The known e04s03 flake (`shutdown rejects late arrivals and keeps health
responsive`) did **not** fire in this run.

The two new tests in that run:

```
▶ e04s04 global RPM/TPM budgets
  ✔ per-model limits are enforced (732.479843ms)
  ✔ model limits without global pair has no effect (976.707968ms)
```

### `npm run check`

```
> node ./node_modules/eslint/bin/eslint.js server.js config.js budget.js server.test.js
> node ./node_modules/typescript/bin/tsc -p tsconfig.json
> node ./node_modules/prettier/bin/prettier.cjs --check server.js config.js budget.js server.test.js eslint.config.js
Checking formatting...
All matched files use Prettier code style!
```

Exit 0, no findings, no rule silenced, no unrelated line reformatted.

## How D16–D19 were applied

### D16 — the client still learns nothing about which budget bit

Applied as decided. A model rejection is the same 429 a global rejection is: the fixed generic
body `{"error":"Too many requests"}` and a positive `Retry-After` header. The reason
(`model_rpm` / `model_tpm`) stays inside the proxy — `server.js:147` is the only place it is read,
it is not part of the response, and it is not logged (`budget.js` has no `console.` call at all;
the one request-log line in `server.js:159` carries only `ts` / `method` / `path` / `status` /
`ms`). The model ID from the request body is not logged either. Nothing about the 429 arm changed
in this task: the wiring happens above it, at the budget construction.

Observed for a model rejection (see "The observed 429 shape" below): status `429`, body
`{"error":"Too many requests"}`, `Retry-After: 60`, upstream arrival count unchanged by the
rejected request.

### D17 — the e04s04 test is renamed and its model entry becomes rpm-only

Applied as decided. The test is now `per-model limits are enforced`, and its model entry is
`{ "nemotron": { "rpm": 1 } }`.

The old entry was `{ rpm: 1, tpm: 1 }`, and the reason it had to change is the one the task-3
review recorded: `CHAT_BODY` names `nemotron` and costs 1034 tokens (10 input + the 1024-token
requested-output default), so a `tpm: 1` entry would have rejected the **first** request with
`model_tpm` instead of the second with `model_rpm`. An rpm-only entry leaves the model's token
dimension uncapped, which is the story's "partial model entry" scenario, and the effective model
rpm is `max(1, floor(1 * 0.95)) = 1` — the margin floors it at one, as it floors the global
limits.

### D18 — the `admitWithBudget` comment drops two false claims

Applied as decided. The block no longer says the wait "is implemented in budget.wait()" (there is
no such function — `grep -n "wait" budget.js` finds only the prose that says the wait is
deliberately absent) and no longer forward-references e04s05. The block's reasoning — why an
immediate 429 beats a wait — is kept verbatim, and the reason's staying internal is now stated.

The exact new text of the comment block (`server.js:123-146`):

```js
// Reserve budget. Returns the reservation on success, or a rejection carrying
// retryAfterSeconds for the 429 arm.
//
// Over budget is answered, not waited out: a rolling 60-second window frees
// only when its oldest reservation ages out, so a wait would hold the caller —
// and its concurrency slot — for most of a minute to reach a state the clock,
// not this module, controls. The answer is the immediate 429 with a
// Retry-After rooted in the window's own history (budget.js derives it from
// the oldest live reservation), which is the bounded wait the issue asks for
// without a held slot and without polling.
//
// The rejection names the constraint that bit — the global window's rpm or
// tpm, or a model's own — and the name stays inside the proxy: the client is
// told to come back, never which budget said so.
//
// There is no wait to call. budget.js exposes no waiting primitive, and the
// per-model windows are decided in the same synchronous pass as the global
// ones, so a request over its own model's budget is answered, not parked.
// Budget waiting proper — the bounded, abort-armed wait that answers an
// in-window-tight request the moment an earlier reservation is released early —
// is deferred to a later story.
```

### D19 — the ledger's verify command is vacuous; strengthened

Applied as decided. Task 4's `verify` string in `specs/epics/e04-rate-limiting/e04s05-tasks.yaml`
is now the name-counting form from the brief, byte for byte, and the row's `status` was flipped
from `failing` to `passing` **after** the command exited 0. The diff on the ledger file is exactly
two changed lines, both in task 4's row:

```diff
-      out=$(node --test --test-reporter=tap --test-name-pattern 'per-model limits are enforced|model limits without global pair' server.test.js 2>&1); rc=$?; test "$rc" -eq 0 || { printf '%s\n' "$out"; exit "$rc"; }; count=$(printf '%s\n' "$out" | grep -cE '^[[:space:]]*ok [0-9]+ - '); test "$count" -ge 2
+      out=$(node --test --test-reporter=tap --test-name-pattern 'per-model limits are enforced|model limits without global pair' server.test.js 2>&1); rc=$?; test "$rc" -eq 0 || { printf '%s\n' "$out"; exit "$rc"; }; n=$(printf '%s\n' "$out" | grep -cE '^[[:space:]]*ok [0-9]+ - .*(per-model limits are enforced|model limits without global pair)'); test "$n" -ge 2
```

```diff
-    status: failing
+    status: passing
```

The other rows are untouched: the story-level `status: failing` stands, and tasks 1, 2 and 3 keep
`passing` while task 5 keeps `failing`. The file still parses and still carries all five task ids.

## The wiring diff

One argument, plus the comment above it:

```diff
 // The budget gate is built once from the same validated config: a null rate
 // pair yields a disabled gate that fails open, so a deployment without
-// PROXY_RPM/PROXY_TPM never allocates a window or buffers a body.
-const budget = createBudget(config.rateLimit, config.limits);
+// PROXY_RPM/PROXY_TPM never allocates a window or buffers a body. The
+// per-model map rides along with it, and stays inert without the global pair:
+// a model's own windows exist only next to the global ones they are checked
+// against.
+const budget = createBudget(config.rateLimit, config.limits, config.modelLimits);
```

Nothing else on the request path changed. `estimateCost` already receives the parsed body
(`server.js:278`), so the `model` field flows into the reservation with no change there; the
budget block, the 429 arm and the forwarding path are as they were.

### Proof that a deployment without `PROXY_MODEL_LIMITS_JSON` is unchanged

`config.modelLimits` is `null` when the variable is unset, and `budget.js` builds no model
windows for a `null` map, so `modelWindowFor()` never finds one and the global decision is
byte-identical. That is asserted by reading; it is also measured, differentially.

The differential harness (`$HOME/tmp/t04/diff.mjs`, outside the worktree) starts the proxy from a
given tree with `PROXY_RPM=3`, `PROXY_TPM=100000`, `PROXY_SAFETY_MARGIN_PCT=0` and **no**
`PROXY_MODEL_LIMITS_JSON`, then records status, `Retry-After` and body for four requests naming
`nemotron` and one 9 MiB body. Run against the pre-task tree and against this branch:

```
pre rc=0
post rc=0
IDENTICAL: no PROXY_MODEL_LIMITS_JSON behavior unchanged
```

```
[
  { "case": "rpm-0",  "status": 200, "retryAfter": null, "body": "{}" },
  { "case": "rpm-1",  "status": 200, "retryAfter": null, "body": "{}" },
  { "case": "rpm-2",  "status": 200, "retryAfter": null, "body": "{}" },
  { "case": "rpm-3",  "status": 429, "retryAfter": "60", "body": "{\"error\":\"Too many requests\"}" },
  { "case": "big-body", "status": 413, "retryAfter": null, "body": "{\"error\":\"Request too large\"}" }
]
```

(The 9 MiB body answers 413 in this scenario because the global pair is present, so the gate is
on and the body is buffered — the point of the case is that the pre-task and post-task trees
answer it the same way.)

The 160 pre-existing tests are the second half of the proof: every one of them passes unchanged on
this branch.

## The observed 429 shape for a model rejection

Measured with `$HOME/tmp/t04/observe.mjs` against this branch, with
`PROXY_RPM=60`, `PROXY_TPM=100000` and `PROXY_MODEL_LIMITS_JSON={"nemotron":{"rpm":1}}`:

```json
[
  { "request": "first nemotron",  "status": 200, "body": "{}", "retryAfter": null, "upstreamArrivalsSoFar": 1 },
  { "request": "second nemotron", "status": 429, "body": "{\"error\":\"Too many requests\"}", "retryAfter": "60", "upstreamArrivalsSoFar": 1 },
  { "request": "llama",           "status": 200, "body": "{}", "retryAfter": null, "upstreamArrivalsSoFar": 2 }
]
```

- **status**: `429`
- **body**: exactly `{"error":"Too many requests"}` — the same fixed generic body a global
  rejection returns, with no model name, no reason and no budget detail in it
- **Retry-After**: `60` — a positive integer, taken from the model window's own oldest live
  reservation (`budget.js` derives it from the model's own event array, not the global one). The
  exact value is timing-dependent (59 or 60 within the first second of the window); the test
  asserts only that it is a positive integer, the way the global rejection's is asserted.
- **upstream arrival count**: 1 before the rejected request, still 1 after it — the rejected
  request never reached the upstream. The third request, naming a model the operator did not cap,
  was admitted and brought the count to 2

## Falsifiability

### 1. The strengthened gate is red on the pre-task tree

The pre-task tree (`4f41f96`) was materialized into `$HOME/tmp/t04/pre` and the D19 gate was run
there verbatim, from a script file so the exit code is the gate's own:

```
$ cd $HOME/tmp/t04/pre && sh gate.sh; echo "PRE-TASK strengthened gate exit=$?"
PRE-TASK strengthened gate exit=1
```

The run it wraps prints only the file-level line, because the pre-task tree has no test with
either name:

```
PRE-TASK gate: rc=0 n=0
ok 1 - server.test.js
# tests 1
# pass 1
# fail 0
```

`n = 0`, so the gate's `test "$n" -ge 2` fails and the gate exits 1. The old form counted
`^[[:space:]]*ok [0-9]+ - ` and would have counted the file-level `ok 1 - server.test.js` line —
which is exactly the vacuity D19 describes.

### 2. The rewritten test is not a tautology

The current `server.test.js` was run against the pre-task `server.js` and `budget.js` (the tree
in `$HOME/tmp/t04/pre`, with the current test file copied over it):

```
not ok 1 - per-model limits are enforced
      name: 'AssertionError'
      expected: 429
      actual: 200
ok 2 - model limits without global pair has no effect
not ok 1 - e04s04 global RPM/TPM budgets
# tests 2
# pass 1
# fail 1
```

The rewritten test fails on the pre-task tree: without the wiring, the second request for the
capped model is admitted (200) instead of refused (429), so the assertion is load-bearing.

### 3. The new test is a control on the pre-task tree, and it is shown to have teeth by mutation

`model limits without global pair has no effect` **passes** on the pre-task tree, and that is the
honest result: its claim is that the per-model limits have *no effect* without the global pair,
and the wiring cannot change that — with no global pair the gate is disabled
(`budget.js:336-349`), no model window is built, and the request path never enters the budget
block at all. A test that failed there would mean the gate started enforcing model limits
without the global pair, which is the opposite of the invariant. It is a control, in the same
sense as the task-3 test `unknown model falls through to global only`, which the task-3 review
accepted for the same reason.

To show the new test is not vacuous, it was run against two mutants of the current tree
(`$HOME/tmp/t04/mut1`, `$HOME/tmp/t04/mut2`), each a copy of HEAD with one change in `budget.js`:

- **mut1** — the disabled gate claims `enabled: true`, so the request path buffers the body it
  used to stream. The 9 MiB body is then capped, and the test fails:

  ```
  not ok 1 - model limits without global pair has no effect
        expected: 200
        actual: 413
  # tests 1 / # pass 0 / # fail 1
  ```

- **mut2** — the disabled gate enforces the per-model windows on its own. The second request for
  the capped model is then refused, and the test fails:

  ```
  not ok 1 - model limits without global pair has no effect
        expected: 200
        actual: 429
  # tests 1 / # pass 0 / # fail 1
  ```

So both halves of the new test are load-bearing: mut1 kills the "streams through without
buffering" assertion, mut2 kills the "per-model limits have no effect" assertion.

## Deviations from the brief

One, and it is a strengthening rather than a change of meaning.

1. **The new test sends two requests for the capped model, not one.** The brief's table says
   "a request naming the configured model is admitted (200) and reaches the upstream". A single
   request cannot show that the model's `rpm: 1` is inert — the first request fits a model budget
   of one, so it would be admitted even if the limit *were* enforced. The test therefore sends
   two, and asserts both are admitted (200) and that both reached the upstream. This is the
   reading the test's name promises, and it is what makes mut2 above fail. The 9 MiB body and
   its "no 413" assertion are exactly as the brief describes.

No decision (D16–D19) was deviated from, and no requirement of the brief's Scope, Requirements,
Tests, Implementation notes, or Verification contract was left out.

## Concerns, and what task 5 must know

### The living docs that still say "validated and stored, not enforced"

`PROXY_MODEL_LIMITS_JSON` is now enforced, and these sites still say it is not. Task 5 owns all of
them; none was touched here.

| Site | What it says now |
|---|---|
| `CONVENTIONS.md:27` | Rate limit bullet: "`PROXY_MODEL_LIMITS_JSON` stays validated and stored, not enforced — issues #18–#22" |
| `README.md:150-152` | The IMPORTANT note: "Every other `PROXY_*` row above is **validated and stored, not enforced** — the proxy parses them at startup and does not consult them while serving a request" — this claim is now wrong for the global budgets too, and the note names no individual variable, so the fix has to introduce the name |
| `README.md:180` | Copy-paste block: `PROXY_MODEL_LIMITS_JSON` … "per-model budgets (validated and stored, not enforced yet)" |
| `README.md:143` | The env-table row for `PROXY_MODEL_LIMITS_JSON` describes the map but does not say it is enforced — it should now say so |
| `specs/tech-architecture/tech-stack.md:76-80` | Startup paragraph: "The other five rate-limiting limits above … are **validated and stored, not enforced**" |
| `specs/tech-architecture/tech-stack.md:164` | Gray Areas bullet: "`PROXY_MODEL_LIMITS_JSON` is still validated and stored only — per-model budgets are #18" |
| `specs/product/SCOPE_LATEST.yaml:36` | Accepted tradeoffs: "the five budgets stay stored, so the current build buffers nothing" |
| `docs/adr/0002-config-operational-fail-fast.md:422-431` | Consequences: "The remaining five — `PROXY_RPM`, `PROXY_TPM`, `PROXY_SAFETY_MARGIN_PCT`, `PROXY_MAX_BUFFERED_BODY_BYTES`, `PROXY_MODEL_LIMITS_JSON` — stay invisible until #17–#22 … the only honest reading for those is 'validated and stored'" |
| `CONTEXT.md:47-50` | "Rate budget, Per-model budget, and Safety margin name limits this proxy validates and stores but does not enforce … `PROXY_MODEL_LIMITS_JSON` are parsed once at startup and no enforcement path reads them" |

Two other wording sites worth a look while task 5 is in the file: `docs/adr/0002-…:428` says
"the only honest reading for those is 'validated and stored'", and ADR 0002 §1.6 ("The global
budget pair is enforced; waiting is not implemented in this land") is the decision section that
the per-model enforcement decision belongs next to.

### The ADR 0002 amendment the story asks for

The story (§22) says ADR 0002 "may need an amendment recording the per-model enforcement
decision", and task 5's ledger row names it explicitly. What task 4 changed about the regime:
none of the failure modes. `PROXY_MODEL_LIMITS_JSON` was already fatal-on-invalid (e04s01), and
this task changed no parsing and no startup behavior — it turned a stored map into a consulted
one. So the amendment is a wording amendment, not a new decision: the "five budgets stay
validated and stored" claim in Consequences and the "1.4/1.6" decision text now have one fewer
stored budget and one more enforced one, and the amendment should record that the per-model
budget is enforced atomically with the global one (a model rejection is not charged against the
global window) and that per-model limits are inert without the global pair.

### Test count

The new total is **161**. The living docs still say 141 (`README.md:9` badge
`tests-141%20passing`, `README.md:111` tip, `AGENTS.md:89` and `AGENTS.md:113`,
`CONVENTIONS.md:17`, `specs/README.md:19`, `specs/tech-architecture/tech-stack.md:172`,
`specs/tech-architecture/TEST_PLAN_LATEST.md:44,294,351`,
`specs/product/VISION_LATEST.yaml:20`,
`specs/epics/e04-rate-limiting/e04s01-config-owner-and-bind-host.md:345`). Two extra sites the
task-3 review found and that are still there: `specs/epics/e04-rate-limiting/e04s04-tasks.yaml:79`
greps for the literal `141` strings, and `specs/verifications/e04s04-verify.yaml:40,51,120`
records the count (a dated verification record — decide deliberately whether it is history or a
living site). `plans/*.md` and `docs/research/config-invariant-guard-tests.md` stay untouched.
This task changed no count in any document.

### Other notes for the next task

- The model windows' `closed` flag stays unobservable through the public API (task-3 review,
  should-fix 3): the global window refuses first, so pinning it would need a seam on the returned
  budget.
- A model rejection never charges the global window. That is the intended semantic, but it means
  the global budget is no longer a proxy for total request volume while per-model limits exist.
- Budget waiting remains unimplemented (`budget.js` has no wait primitive, and the request path
  has no wait to call). The comment in `server.js` now says so instead of pointing at a function
  that does not exist.
