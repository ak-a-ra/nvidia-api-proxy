# Task report — e04s05 / task 1: the estimator returns the model ID

- **Status:** passing
- **Branch:** `e04s05-per-model-budgets` (worktree `/data/data/com.termux/files/home/workspace/e04s05-per-model-budgets`)
- **Base commit:** `8833617` (orchestrator: brief + decisions)

## Commits

| SHA | Subject | Files |
|---|---|---|
| `1c09f6b` | `feat(budget): return the model ID with the cost estimate` | `budget.js` |
| `c05882b` | `test(e04s05): cover the estimator model field and strengthen the task 1 gate` | `server.test.js`, `specs/epics/e04-rate-limiting/e04s05-tasks.yaml` |

The report itself is committed separately as `docs(e04s05): add the task 1 report`.

## Why: passing

The task's requirements are implemented (the estimator returns `model` on both paths, the
forward-reference comment is rewritten, the six tests exist and pass), the strengthened task-1
verify command exits 0, the whole suite is green at 147/147, and `npm run check` is clean.

## Test summary

| | Before | After |
|---|---|---|
| Suite size | 141 | 147 |
| Pass / fail | 141 / 0 | 147 / 0 |
| Suites | 14 | 15 |

The six new tests, all in the new `describe("e04s05 per-model budgets")` block in `server.test.js`
(unit level, no HTTP):

1. `estimateCost returns the model named in the body`
2. `estimateCost returns null when the body names no model`
3. `estimateCost returns null when the body names a non-string model`
4. `estimateCost returns null when the body names an empty model`
5. `estimateCost returns the model on the fallback path when the body names one`
6. `estimateCost returns null model on the fallback path when the body names none`

Tests 1 and 5 contain the exact substring `estimateCost returns the model` (the verify gate's
pattern); tests 2, 3, 4 and 6 do not. Every test asserts the `fallback` flag on the path it
exercises — `false` on the structured path, `true` on the fallback path — and tests 1 and 5 also
assert that the estimator's other fields are unchanged (`requestCharge` stays `1`, `totalTokens`
stays `inputTokens + outputTokens`), so the new field cannot be mistaken for a changed cost shape.

### Strengthened task-1 verify (decision D2), as it now stands in `e04s05-tasks.yaml`

```bash
out=$(node --test --test-reporter=tap --test-name-pattern 'estimateCost returns the model' server.test.js 2>&1); rc=$?; test "$rc" -eq 0 || { printf '%s\n' "$out"; exit "$rc"; }; n=$(printf '%s\n' "$out" | grep -cE '^[[:space:]]*ok [0-9]+ - .*estimateCost returns the model'); test "$n" -ge 1
```

Output (gate exit code 0, `n` = 2):

```text
TAP version 13
# Subtest: e04s05 per-model budgets
    # Subtest: estimateCost returns the model named in the body
    ok 1 - estimateCost returns the model named in the body
      ---
      duration_ms: 3.36224
      type: 'test'
      ...
    # Subtest: estimateCost returns the model on the fallback path when the body names one
    ok 2 - estimateCost returns the model on the fallback path when the body names one
      ---
      duration_ms: 0.676927
      type: 'test'
      ...
    1..2
ok 1 - e04s05 per-model budgets
  ---
  duration_ms: 8.148021
  type: 'suite'
  ...
1..1
# tests 2
# suites 1
# pass 2
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 521.476875
```

### `npm test` (full suite)

```text
▶ e04s05 per-model budgets
  ✔ estimateCost returns the model named in the body (3.106823ms)
  ✔ estimateCost returns null when the body names no model (0.665156ms)
  ✔ estimateCost returns null when the body names a non-string model (1.228802ms)
  ✔ estimateCost returns null when the body names an empty model (0.924584ms)
  ✔ estimateCost returns the model on the fallback path when the body names one (0.733021ms)
  ✔ estimateCost returns null model on the fallback path when the body names none (0.565416ms)
✔ e04s05 per-model budgets (8.638906ms)
ℹ tests 147
ℹ suites 15
ℹ pass 147
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 158345.884575
```

### `npm run check`

```text
> nvidia-api-proxy@1.0.0 check
> npm run lint && npm run typecheck && npm run format:check

> nvidia-api-proxy@1.0.0 lint
> node ./node_modules/eslint/bin/eslint.js server.js config.js budget.js server.test.js

> nvidia-api-proxy@1.0.0 typecheck
> node ./node_modules/typescript/bin/tsc -p tsconfig.json

> nvidia-api-proxy@1.0.0 format:check
> node ./node_modules/prettier/bin/prettier.cjs --check server.js config.js budget.js server.test.js eslint.config.js

Checking formatting...
All matched files use Prettier code style!
```

No findings: lint clean, typecheck clean, format clean.

## The new comment text in `budget.js`

The stale forward-reference (the old lines 130-133, inside `parseRequestMetadata`, ending "so
per-model distinctions are e04s05's job, not a special case bolted on here") is gone. The
rewritten comment now sits directly above the new `modelFromJson` helper, which is where the
model is actually extracted:

```js
// Models are named by the request; their pricing is not this module's
// business. The estimator carries the name the body used through with the
// cost, so the caller can resolve it against the operator's per-model
// budget, and prices every model the same way: a per-model budget governs
// how much of a model may be asked for, never what the request costs. The
// name travels exactly as the body wrote it, with no trimming and no
// case-folding, so a client matches a config key only the way the operator
// wrote it.
function modelFromJson(json) {
  // A body that names no model, or names one that is not a string, names
  // none: the caller then governs the request by the global budget alone.
  if (!json || typeof json !== "object") return null;
  const model = json.model;
  return typeof model === "string" && model.length > 0 ? model : null;
}
```

Two smaller comment changes in the same file, both required by the code change:

* The `estimateCost` doc comment now lists the new field in the output shape ("Input cost,
  requested output, the one-request charge, the model the request names, and the fallback flag
  for observability"), so the shape description stays complete.
* The `fallbackCostFromBuffer` comment gained one clause: "The model the request names still
  travels with the cost, however its size was measured."

## How D1, D2 and D3 were applied

### D1 — the model survives a fallback estimate: applied as written

The model is extracted once in `estimateCost`, before `parseRequestMetadata` is consulted:

```js
export function estimateCost(json, buffer) {
  const model = modelFromJson(json);
  const parsed = parseRequestMetadata(json);
  if (!parsed) return fallbackCostFromBuffer(buffer, model);
  ...
```

So the model is a property of the parsed body, not of the estimator's structural success:
`{"model":"nemotron"}` (no `messages`, no `tools`) parses, names a model, and is estimated on the
fallback path — the result carries `model: "nemotron"` together with `fallback: true`. A body that
names no model, or that is not JSON at all (`json` is `null`), carries `model: null` on that same
path. Test 5 pins this behavior; test 6 pins its counterpart.

No disagreement with D1: the reasoning (a model-naming but structurally unestimable body must not
escape its per-model cap) is the same one the story's §11 invariant 4 and the `specs/state.yaml`
decision rely on.

### D2 — the ledger's verify command was vacuous: applied as written

Task 1's `verify` string in `specs/epics/e04-rate-limiting/e04s05-tasks.yaml` was replaced with
the strengthened form quoted above, and task 1's `status` was flipped to `passing` **after** that
command exited 0. No other task's `verify` or `status` was touched; the story-level `status:
failing` at the top of the ledger is unchanged, and tasks 2-5 keep `status: failing`.

### D3 — `server.test.js` imports `budget.js` directly: applied as written

`import { estimateCost } from "./budget.js";` was added to `server.test.js` next to the Node
built-in imports. `budget.js` exports `estimateCost` already, the function is pure, and the
module header states "No environment read, no timer, no default of its own" — confirmed by
grep: `budget.js` contains no `process.env` reference at all. The import therefore adds no test
seam, no new export and no injection point, and cannot affect the harness's hermeticity: the
`childEnv()` strip applies to spawned children, and this import reads no environment. The
estimator's return shape is unobservable through the black-box HTTP harness (the proxy never
surfaces the model ID), so a unit-level import is the only way to assert it.

## Deviations

One deviation from the brief's letter, none from its intent:

* **The rewritten comment moved.** The brief asked for the comment at `budget.js` lines 130-134
  to be rewritten "in place". That comment sat inside `parseRequestMetadata`, but D1 forbids the
  extraction from living there: `parseRequestMetadata` returns `null` for a body with neither
  `messages` nor `tools`, which is exactly the model-only body D1 requires to survive the
  fallback. The stale comment was therefore removed from inside `parseRequestMetadata`, and the
  rewritten text now sits directly above the new `modelFromJson` helper a few lines below it —
  attached to the code that implements the rule it describes. The comment's content is the
  rewritten content the brief asked for (estimator responsibility, stays true after task 2).

Everything else in the brief was implemented as written: the same six test names, the same
assertions, the same gate, the same file scope.

## Falsifiability proof

Pre-change files taken out of git into a temporary directory, together with the unchanged runtime
files so the file could load standalone. The working tree was never touched. The pre-task tree is
`444ccff` — the parent of the orchestrator's commit `8833617`, which is what `HEAD^` pointed at
when the proof was run; the SHA is spelled out below so the proof stays reproducible after the
implementation commits landed.

```bash
TMP=$(mktemp -d "$HOME/e04s05-falsify.XXXXXX")
git show 444ccff:budget.js      > "$TMP/budget.js"
git show 444ccff:server.test.js > "$TMP/server.test.js"
cp server.js config.js admission.js package.json "$TMP/"
cd "$TMP"
out=$(node --test --test-reporter=tap --test-name-pattern 'estimateCost returns the model' server.test.js 2>&1); rc=$?; n=$(printf '%s\n' "$out" | grep -cE '^[[:space:]]*ok [0-9]+ - .*estimateCost returns the model')
```

Output (run twice: once against `git show HEAD^:` while `HEAD` was the orchestrator's commit
`8833617`, and once against the explicit `444ccff` above — identical results):

```text
runner_rc=0  matching_ok_lines=0
TAP version 13
1..0
# Subtest: server.test.js
ok 1 - server.test.js
  ---
  duration_ms: 494.412969
  type: 'test'
  ...
1..1
# tests 1
# suites 0
# pass 1
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 521.186353
=== strengthened gate exit code ===
gate_rc=1
```

The strengthened gate counts **0** matching `ok` lines against the pre-change tree and exits 1:
it is not vacuously green. For contrast, the old ledger gate on the very same pre-change tree
still goes green, because its grep accepts the file-level line:

```text
=== OLD (ledger) gate against the same pre-change tree ===
old_gate_rc=0 (0 = vacuously green on the pre-change tree)
ok 1 - server.test.js
```

That is the vacuity decision D2 describes, reproduced.

## Concerns and notes for the later tasks in this story

1. **`cost.model` is the only model source from now on.** Tasks 2 and 3 must not re-derive the
   model from the body: `reserve(cost)` sees `cost.model`, and it is `null` exactly when the body
   named no model (no key, non-string, empty string, or unparseable body). The per-model window
   map is keyed by the operator's `PROXY_MODEL_LIMITS_JSON` keys, and the lookup is exact — no
   trimming, no case-folding, on either side.
2. **A whitespace-only model is still a model.** `"  "` is a non-empty string, so it is carried
   verbatim and will not match any config key; the request then falls through to the global
   budget only. This is the safe direction the brief asked for, but it is worth knowing that
   `cost.model` is `""`-free yet not whitespace-free.
3. **Encoded bodies carry no model.** `server.js`'s `parseJsonBody` deliberately never decodes a
   gzip body, so a compressed request reaches the estimator with `json === null` and
   `cost.model === null` — it is governed by the global budget alone, never by a model window.
   Same for a non-JSON body. Task 4's integration test should not expect a model window to apply
   to an encoded body.
4. **The fallback path now carries a model.** A body that names a model but cannot be priced
   structurally is charged to that model's window in tasks 2/3. That is D1's intent, and it means
   the model windows see more requests than the structured path would suggest.
5. **`fallbackCostFromBuffer` has a new parameter.** It is a module-private function, so no
   external caller breaks, but any later in-file change to its signature must keep passing the
   model through.
6. **Test-count sync is untouched.** The living docs still say 141 (README badge and tip,
   `AGENTS.md`, `CONVENTIONS.md`, and the `specs/` docs listed in `AGENTS.md`). Task 5 owns that
   sweep to 147; task 1 deliberately left every count alone.
7. **No runtime dependency, no new export.** `budget.js` still imports nothing; `dependencies`
   stays absent from `package.json`; `npm test` is still plain `node --test`.
