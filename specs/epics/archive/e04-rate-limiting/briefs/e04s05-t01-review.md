# Review — e04s05 task 1: the estimator returns the model ID

**Verdict: PASS**

- Reviewed range: `444ccff..d7f175c`
- Implementer commits: `1c09f6b` (budget.js), `c05882b` (server.test.js + task-1 ledger row), `d7f175c` (report)
- Brief: `specs/epics/e04-rate-limiting/briefs/e04s05-t01.md`
- Report under review: `specs/epics/e04-rate-limiting/briefs/e04s05-t01-report.md`

## Must-fix

None. No requirement in the brief's Requirements, Tests to add, Implementation notes, or
Verification contract sections is unmet, and no blocking defect was found in `budget.js` or the six
new tests.

## Should-fix

Not blocking acceptance. All three are comments or report wording, not behavior.

1. **`budget.js:45-46`** — the surviving fallback comment still lists "bodies with no or an
   unknown model" among the bodies the estimator cannot inspect:

   ```
   // Fallback cost model for bodies the estimator cannot inspect: gzip and other
   // encodings, malformed JSON, non-JSON, and bodies with no or an unknown
   // model.
   ```

   With the model now carried through the estimate and no longer deciding anything, a body naming
   an unknown model (with `messages`) is priced structurally, not by the byte fallback — which
   contradicts the new comment at `budget.js:151-152` ("prices every model the same way"). This
   text is pre-existing (unchanged at `444ccff:budget.js:44-46`), so it is not an implementer
   defect; it is the remaining half of a contradiction whose other half the task correctly
   removed. Minimal fix: drop the "and bodies with no or an unknown model" clause.

2. **`budget.js:150`** — "so the caller can resolve it against the operator's per-model budget".
   Accurate today (the estimator carries the name so a caller *can* resolve it), but after task 2
   the resolution happens inside `budget.js` itself (`reserve` looks `cost.model` up in the model
   windows); `estimateCost`'s caller in `server.js:271` only forwards `cost`. The wording was
   suggested by the brief (`e04s05-t01.md` Implementation notes), so the implementer followed it;
   task 2 should reword "the caller" → "the budget".

3. **`e04s05-t01-report.md:42-44`** — "Each test also asserts the estimator's other fields on the
   path it exercises — `fallback` is `false` on the structured path and `true` on the fallback
   path, `requestCharge` stays `1`, and `totalTokens` stays `inputTokens + outputTokens`". Only
   tests 1 and 5 assert `requestCharge` and `totalTokens`; tests 2, 3, 4 and 6 assert `fallback`
   only. The brief required "at least one test", so the code satisfies the requirement — the
   report sentence overstates what was done.

## Orchestrator decisions

**D1 — the model survives a fallback estimate: implemented as decided, and the decision is right.**
`budget.js:72` extracts the model before `parseRequestMetadata` is consulted and passes it into
the fallback (`budget.js:74` → `budget.js:102` → `budget.js:112`), so `{"model":"nemotron"}`
with no `messages`/`tools` returns `model: "nemotron"` with `fallback: true`. The brief's own
rationale holds: a model-naming but structurally unestimable body would otherwise escape its
per-model cap. The decision also matches the story spec, which is the real source of truth:
`e04s05-apply-per-model-budgets-atomically.md:112-113` ("`json.model` when it is a non-empty
string, `null` otherwise") and §Requirements (`:43-44`, "when the body is parseable and names
one") condition the model on parseability, not on structural estimability. I agree with D1.

**D2 — the ledger's verify gate was vacuous and is now strengthened: implemented as decided, and
the gate is real.** `e04s05-tasks.yaml:21` now requires a matching test name
(`grep -cE '^[[:space:]]*ok [0-9]+ - .*estimateCost returns the model'; test "$n" -ge 1`). The
implementer applied only task 1's row; tasks 2-5 keep their `verify` strings and
`status: failing`, and the story-level `status: failing` is unchanged. I reproduced the vacuity
claim and the fix independently (below).

**D3 — a direct `import { estimateCost } from "./budget.js"` in `server.test.js` is acceptable and
adds no test seam: implemented as decided, and the reasoning holds.** `budget.js` has zero
imports, reads no environment (`grep -nE 'process\.env' budget.js` → no hit; the only clock use
is `Date.now()` inside `reserve`, `budget.js:255`), and starts no timer. The module is imported
once at `server.test.js:6`; the new block calls the already-exported, already-pure function
directly (`server.test.js:4296-4356`). `childEnv()` strips the *child's* environment, and this
import touches no environment at all, so hermeticity is untouched. The estimator's return shape
is genuinely unobservable through the black-box HTTP harness (the proxy never surfaces the model
ID), so a unit-level import is the only way to assert the story's requirement. I agree with D3.

**The reported deviation (comment moved): acceptable.** The stale comment was removed from inside
`parseRequestMetadata` and the rewritten text now sits directly above the new `modelFromJson`
helper (`budget.js:148-156`), the code that implements the rule. The rewritten text is accurate
today (it describes what the estimator does and why it does not price models differently) and
stays accurate after task 2 apart from the "the caller" wording in should-fix 2. The move is
justified: `parseRequestMetadata` returns `null` for a body with neither `messages` nor `tools`
(`budget.js:124`), so the model-only body D1 protects cannot be handled there without changing
that contract. No duplicate or contradictory copy of the model rule remains in `budget.js` — the
only other model-related comments are the `estimateCost` output-shape comment
(`budget.js:66-70`, updated to list the new field) and the fallback clause flagged in should-fix
1.

## Behavior correctness (independent read of `budget.js`)

- **No path returns a model other than the body's own `model` string.** `modelFromJson`
  (`budget.js:156-162`) returns `json.model` only when it is a string with `length > 0`, and
  `null` otherwise — no trimming, no case-folding, no default. `json` is the object
  `JSON.parse` produced (`server.js:108-118`), so the value is byte-identical to what the body
  names. Non-object JSON roots (string/number/boolean/null) and arrays return `null`
  (`budget.js:159` rejects non-objects; an array has no own `model` property).
- **Output shape is uniform.** Structured path (`budget.js:86-93`) and fallback path
  (`budget.js:104-113`) both return exactly `{inputTokens, outputTokens, requestCharge,
  totalTokens, fallback, model}` — identical key sets, `model` last in both.
- **The new import creates no environment coupling and no child-process coupling.** `budget.js`
  imports nothing and reads no environment; the import is inert at module load.
- **`budget.js` still reads no environment and starts no timers** — no `process.env`, no
  `setTimeout`/`setInterval` anywhere in the file.
- `reserve()` (`budget.js:251+`) is unaffected: it consumes only `requestCharge` and
  `totalTokens`.

## Test quality

All six tests exist with the exact names required by the brief, in the new
`describe("e04s05 per-model budgets")` block (`server.test.js:4295-4356`). Names are behavior
sentences in repo style. Names 1 (`server.test.js:4296`) and 5 (`server.test.js:4332`) contain
the gate substring `estimateCost returns the model`; names 2, 3, 4 and 6 do not (the gate
counted exactly 2 matching lines).

Coverage of the required cases: empty-string model (`server.test.js:4325`), non-string model
(`server.test.js:4318`), body naming no model (`server.test.js:4311` structured and
`server.test.js:4348` fallback), model-only body on the fallback path (`server.test.js:4332`),
unparseable body (`server.test.js:4348`).

**Falsifiability of the tests (not just the gate):** running the current `server.test.js` against
the pre-task `budget.js` in a temp directory makes **all six** fail:

```
    not ok 1 - estimateCost returns the model named in the body
    not ok 2 - estimateCost returns null when the body names no model
    not ok 3 - estimateCost returns null when the body names a non-string model
    not ok 4 - estimateCost returns null when the body names an empty model
    not ok 5 - estimateCost returns the model on the fallback path when the body names one
    not ok 6 - estimateCost returns null model on the fallback path when the body names none
# tests 6
# pass 0
# fail 6
```

No test is a tautology or a restatement of the implementation: each asserts an outcome value.
The `null` assertions bite because `server.test.js:3` imports `node:assert/strict`, so
`assert.equal` is `strictEqual` and `undefined !== null`.

## Independent verification runs

**Strengthened task-1 gate on the current tree** (`e04s05-tasks.yaml:21`, run verbatim):

```
n=2
gate_rc=0
ok 1 - e04s05 per-model budgets
# tests 2
# pass 2
# fail 0
```

**Falsifiability proof — same gate against the pre-task tree** (`git show 444ccff:budget.js`,
`git show 444ccff:server.test.js`, plus `config.js`/`server.js`/`admission.js`/`package.json`
from the same commit, copied into `$HOME/tmp/e04s05-falsify.*`; the working tree was not
touched):

```
runner_rc=0 matching_ok_lines=0
ok 1 - server.test.js
# tests 1
# pass 1
# fail 0
gate_rc=1
```

The strengthened gate is red (exit 1) on the pre-task tree. The old ledger gate on the very same
tree still exits 0 — `old_gate_rc=0` — confirming the vacuity D2 describes. The pre-task
`node --test` output contains only the file-level line `ok 1 - server.test.js`, which the old
grep accepted.

**`npm test` (full suite, my own run):**

```
ℹ tests 147
ℹ suites 15
ℹ pass 147
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 169654.140769
```

**`npm run check`:** clean — ESLint (4 files), `tsc -p tsconfig.json`, and Prettier `--check` all
pass with no findings.

## Scope and hygiene

- `git diff --name-only 444ccff..HEAD` → `budget.js`, `server.test.js`,
  `specs/epics/e04-rate-limiting/briefs/e04s05-t01-report.md`,
  `specs/epics/e04-rate-limiting/briefs/e04s05-t01.md`,
  `specs/epics/e04-rate-limiting/e04s05-tasks.yaml`, `specs/state.yaml`. The brief and
  `specs/state.yaml` are the orchestrator's (`8833617`), not the implementer's.
- Per-commit: `1c09f6b` → `budget.js` only; `c05882b` → `server.test.js` +
  `e04s05-tasks.yaml` only; `d7f175c` → the report only. Nothing else changed.
- `config.js`, `server.js`, `admission.js`, `package.json` untouched
  (`git diff --name-only 444ccff..HEAD -- package.json config.js server.js admission.js` → empty).
- No runtime dependency added: `package.json` has no `dependencies` key; `budget.js` imports
  nothing. `npm test` is still plain `node --test`.
- `node_modules` was not committed: `git ls-files | grep -c node_modules` → `0`.
- Living-doc test counts correctly left at 141 (`README.md:9`, `README.md:111`,
  `AGENTS.md:89,113`, `CONVENTIONS.md:17`, `specs/README.md:19`,
  `specs/tech-architecture/tech-stack.md:172`, `specs/tech-architecture/TEST_PLAN_LATEST.md:44,294,351`,
  `specs/product/VISION_LATEST.yaml:20`, `specs/epics/e04-rate-limiting/e04s01-config-owner-and-bind-host.md:345`).
  Count sync is task 5's job; `CONVENTIONS.md:17` still says "runs all 141 tests" and was
  correctly not touched.
- The ledger's other rows are untouched: the diff on `e04s05-tasks.yaml` is 2 changed lines
  (task 1's `verify` and task 1's `status`).

## Report accuracy

Every substantive claim in `e04s05-t01-report.md` checks out against the code and my own runs:
the commit table and per-commit file lists, base commit `8833617`, 141 → 147 tests, 14 → 15
suites (`grep -c '^describe('` on `444ccff:server.test.js` → 14, on the current file → 15),
the six test names, the substring split (gate counted exactly 2), the gate output, `n = 2`, the
quoted new comment text (byte-identical to `budget.js:148-156`), the D1/D2/D3 applications, the
falsifiability output (I reproduced `runner_rc=0`, `matching_ok_lines=0`, `gate_rc=1`,
`old_gate_rc=0`), and the notes: `budget.js` contains no `process.env`; `parseJsonBody` never
decodes a gzip body (`server.js:110-117`), so an encoded body reaches the estimator with
`json === null` and `model === null`; a whitespace-only model is carried verbatim (non-empty
string) and matches no config key; `fallbackCostFromBuffer` is module-private, so its new
parameter breaks no caller. The one inaccuracy is the "each test also asserts" sentence quoted
in should-fix 3. The report's claim that the `status` flip happened *after* the gate exited 0 is
not falsifiable from the tree (both landed in `c05882b`), but the resulting state is consistent.

## Note for task 2 (out of scope here)

The story spec contradicts itself on when model windows are created: `e04s05-apply-per-model-budgets-atomically.md:51-52`
says "created lazily on first reservation for that model", while the same file's §5 step 2
(`:115-116`) and §6 (`:137-140`) and ledger task 2 (`e04s05-tasks.yaml:33-35`) all say the
windows are built at construction time. Task 2's brief should settle which one is normative
before an implementer picks one. Not a task 1 defect; task 1 changes nothing about window
creation.
