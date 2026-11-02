# e04s05 Task 2 Report: Per-model rolling windows in `createBudget`

## Status

`passing`.

`createBudget` now takes the per-model map as a third argument and builds one window pair per
configured model when the budget is built. The effective model limits are exposed as
`modelEffective` in both gates, `close()` closes the model windows alongside the global ones, and
`reserve()` decides exactly what it decided after task 1 — the global windows only.

Base commit: `9c0a500` (task 1, its review, the task-2 brief, and the orchestrator's decisions).

## Commits

| Commit | Subject | Files |
|---|---|---|
| `535187d` | `feat(budget): build the per-model windows from the configured model limits` | `budget.js` |
| `891f1a5` | `test(e04s05): cover the per-model windows and strengthen the task 2 gate` | `server.test.js`, `specs/epics/e04-rate-limiting/e04s05-tasks.yaml` |
| (this report) | `docs(e04s05): add the task 2 report` | this file |

`git diff --name-only 9c0a500..HEAD` → `budget.js`, `server.test.js`,
`specs/epics/e04-rate-limiting/e04s05-tasks.yaml`, this report. `config.js`, `server.js`,
`admission.js`, `package.json`, and every other spec doc are untouched. No runtime dependency was
added (`package.json` still has no `dependencies` key; `budget.js` imports nothing).

## Test summary

| | count |
|---|---|
| before this task | 147 tests, 147 pass, 0 fail (15 suites) |
| after this task | 153 tests, 153 pass, 0 fail (15 suites) |

The six new tests, all in the existing `describe("e04s05 per-model budgets")` block
(`server.test.js:4360-4436`):

1. `per-model windows are built for every configured model`
2. `per-model windows are built with the same safety margin as the global windows`
3. `per-model windows are built only when the global budget is enabled`
4. `a model entry with only rpm leaves its token budget uncapped`
5. `close refuses model reservations`
6. `the global budget is unchanged when model limits are configured`

`createBudget` was added to the existing import: `import { createBudget, estimateCost } from
"./budget.js";` (`server.test.js:6`).

### The strengthened task-2 verify command (D8), run verbatim

```bash
out=$(node --test --test-reporter=tap --test-name-pattern 'per-model windows are built|close refuses model' server.test.js 2>&1); rc=$?; test "$rc" -eq 0 || { printf '%s\n' "$out"; exit "$rc"; }; n=$(printf '%s\n' "$out" | grep -cE '^[[:space:]]*ok [0-9]+ - .*(per-model windows are built|close refuses model)'); test "$n" -ge 2
```

```
n=4 rc=0
gate_rc=0
```

The matching `ok` lines:

```
    ok 1 - per-model windows are built for every configured model
    ok 2 - per-model windows are built with the same safety margin as the global windows
    ok 3 - per-model windows are built only when the global budget is enabled
    ok 4 - close refuses model reservations
ok 1 - e04s05 per-model budgets
# tests 4
# pass 4
# fail 0
```

The command was also extracted from the updated ledger row and run from a shell script, so the
string in `e04s05-tasks.yaml` is the string that was executed: `yaml_verify_rc=0`.

### `npm test`

```
ℹ tests 153
ℹ suites 15
ℹ pass 153
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

The e04s04 block (`describe("e04s04 global RPM/TPM budgets")`) is green unchanged — the global
gate's observable behavior did not move.

### `npm run check`

Clean: ESLint over `server.js config.js budget.js server.test.js`, `tsc -p tsconfig.json`, and
Prettier `--check` over the five formatted files. No findings, no rule silenced, no unrelated
line reformatted (the only Prettier fix was the line-wrap of one new assertion in `server.test.js`).

## How D4–D9 were applied

### D4 — model windows are built at construction time

Applied. `createBudget` builds every model window inside the factory call, in the
`for (const [model, entry] of Object.entries(modelLimits))` loop. No window is created later, and
nothing in `budget.js` creates a window at request time. The map is bounded by the operator's own
config, so the up-front cost is bounded too.

### D5 — null-prototype maps

Applied. Both the internal model-window map and `modelEffective` are created with
`Object.create(null)`. The inner entry objects are plain objects, because their key set is fixed
at `rpm` and `tpm` — no operator text ever becomes a key there.

```js
  const modelWindows = Object.create(null);
  const modelEffectiveMap = Object.create(null);
  if (modelLimits) {
    for (const [model, entry] of Object.entries(modelLimits)) {
      const rpm = entry.rpm != null ? effectiveLimit(entry.rpm, margin) : null;
      const tpm = entry.tpm != null ? effectiveLimit(entry.tpm, margin) : null;
      modelWindows[model] = createWindow(rpm, tpm);
      // The entry's key set is fixed at rpm and tpm, so no operator text ever
      // becomes a key here and a plain object is safe.
      const modelEntry = {};
      if (rpm != null) modelEntry.rpm = rpm;
      if (tpm != null) modelEntry.tpm = tpm;
      modelEffectiveMap[model] = modelEntry;
    }
  }
  const modelEffective = Object.keys(modelEffectiveMap).length > 0 ? modelEffectiveMap : null;
```

A model ID of `__proto__` therefore lands as an own property of a null-prototype map, exactly as
`config.js` stored it, and its budget cannot silently disappear.

### D6 — uniform returned shape

Applied. `modelEffective` is present on the returned object in both gates:

- disabled gate (`rateLimit` null): `modelEffective: null`
- enabled gate: `modelEffective` is the null-prototype map, or `null` when no model window exists
  (no `modelLimits`, an empty map, or a global budget that is off)

A caller reads `budget.modelEffective` without knowing which gate it got. The effective values are
the **effective** limits (after the Safety margin), not the configured numbers, and a dimension
with no window is absent from the entry — not `null`, not `undefined`-valued.

### D7 — `reserve()` does not change

Applied. `reserve(cost)` consults the global windows only; the model windows are built and closed
but nothing reads them yet. A request naming a configured model is still admitted by the global
budget in this task, exactly as before. No test pins that intermediate admission behavior (test 3
changes it); the new test 6 pins the global behavior instead — the global windows still charge the
same way, and the request over the global RPM is still rejected with `reason: "rpm"`, not a model
reason.

### D8 — the strengthened verify gate

Applied. Task 2's `verify` string in `specs/epics/e04-rate-limiting/e04s05-tasks.yaml` now is the
name-counting form from the brief (the old form counted the file-level `ok 1 - server.test.js`
line, so a pattern matching no test still exited 0). `status` was flipped to `passing` only after
that command exited 0. The other four task rows and the story-level `status: failing` are
untouched — the diff on the file is exactly two changed lines:

```
-      out=$(node --test --test-reporter=tap --test-name-pattern 'per-model windows are built|close refuses model' server.test.js 2>&1); rc=$?; test "$rc" -eq 0 || { printf '%s\n' "$out"; exit "$rc"; }; printf '%s\n' "$out" | grep -qE '^[[:space:]]*ok [0-9]+ -'
+      out=$(node --test --test-reporter=tap --test-name-pattern 'per-model windows are built|close refuses model' server.test.js 2>&1); rc=$?; test "$rc" -eq 0 || { printf '%s\n' "$out"; exit "$rc"; }; n=$(printf '%s\n' "$out" | grep -cE '^[[:space:]]*ok [0-9]+ - .*(per-model windows are built|close refuses model)'); test "$n" -ge 2
-    status: failing
+    status: passing
```

The ledger file still parses (checked with `js-yaml`): story `status: failing`, tasks `1 passing`,
`2 passing`, `3 failing`, `4 failing`, `5 failing`.

### D9 — one window implementation, shared

Applied, and shared: the global gate and every model window are the same `createWindow(rpm, tpm)`
factory. There is no duplicated window logic in the file.

```js
function createWindow(rpmLimit, tpmLimit) {
  // Event histories: costs are pushed with the time they were reserved, and
  // pruned on read. ...
  const requestEvents = [];
  const tokenEvents = [];
  let closed = false;
  // prune(), totals(), oldestTokenEvent(), retryAfterSeconds() ...
  function reserve(cost) { /* the whole admission decision */ }
  function close() { closed = true; }
  return { reserve, close };
}
```

The global gate is one instance of it, created with the global effective limits:

```js
  const globalWindow = createWindow(effective.rpm, effective.tpm);
  ...
  function reserve(cost) {
    return globalWindow.reserve(cost);
  }
```

A dimension that was not capped has no window at all: the window factory skips both the check and
the event history for a `null` limit, which is how a model entry that supplies only `rpm` leaves
its token budget uncapped. The global window always has both limits, so the global path is
byte-for-byte the old behavior: same limits, same `rpm`/`tpm` reasons, same `retryAfter: 1` on a
closed budget, same charge.

## The shape of `modelEffective` and of the internal model-window map

- `modelEffective`: `null`, or a **null-prototype** map `{ [model]: { rpm?, tpm? } }` whose inner
  objects are plain. `rpm`/`tpm` hold the **effective** limits (margin applied, floored at one).
  A dimension with no window has no key at all in the entry.
- the internal model-window map: a **null-prototype** map `{ [model]: { reserve, close } }`, one
  independent window per configured model — its own event history, its own effective limits, its
  own closed flag. Nothing about one model can be read or spent through another.

Example (`safetyMarginPct: 0`, models `nemotron {rpm: 60, tpm: 100000}` and `llama {rpm: 30}`):

```js
budget.modelEffective
// [Object: null prototype] { nemotron: { rpm: 60, tpm: 100000 }, llama: { rpm: 30 } }
```

With `safetyMarginPct: 5` and a model entry of `rpm: 60`: `floor(60 * 0.95) = 57`, the same value
the global `rpm: 60` gets — the margin comes from the one source the global windows use
(`limits?.safetyMarginPct ?? 5`), so the two cannot disagree.

## Falsifiability

### The strengthened gate is red on the pre-task tree

Pre-task tree = commit `9294927` (the parent of the task-1 merge point), copied into
`$HOME/tmp/e04s05-t02-falsify/gate` with `git show 9294927:<path>`. The working tree was not
touched.

```
runner_rc=0 matching_ok_lines=0
old_gate_rc=0
gate_rc=1 n=0
```

The pre-task run prints only the file-level line:

```
# Subtest: server.test.js
ok 1 - server.test.js
# tests 1
# pass 1
# fail 0
```

`old_gate_rc=0` is the old ledger gate run on the same tree: it accepts the file-level line and
exits 0 — the vacuity D8 describes. `gate_rc=1` is the strengthened gate on the same tree: it
counts 0 matching `ok` lines and exits 1.

### The new tests are not tautologies

The current `server.test.js` (with the six new tests) against the pre-task `budget.js`
(`git show 9294927:budget.js`) in `$HOME/tmp/e04s05-t02-falsify/tests`:

```
    not ok 1 - per-model windows are built for every configured model
    not ok 2 - per-model windows are built with the same safety margin as the global windows
    not ok 3 - per-model windows are built only when the global budget is enabled
    not ok 4 - a model entry with only rpm leaves its token budget uncapped
    not ok 5 - close refuses model reservations
    ok 6 - the global budget is unchanged when model limits are configured
# tests 6
# pass 1
# fail 5
```

The failures are real assertion failures, not errors, except for test 2, which fails with a
`TypeError` because the pre-task `createBudget` returns no `modelEffective` at all and the
assertion reads a property of `undefined`:

```
      error: |-
        Expected values to be strictly deep-equal:
        + actual - expected

        + undefined
        - [Object: null prototype] {
        -   llama: {
```

```
      error: 'the model windows exist before the close'
      expected: true
      operator: '=='
```

Test 6 passes on the pre-task tree **by design**: it is the control that pins D7 — the global
decision must be identical before and after this task, so it cannot fail on the pre-task tree. The
other five fail.

## Deviations from the brief

1. **The brief contradicts itself about test 3's name.** The table in "Tests to add" names test 3
   `per-model windows are built only when the global budget is enabled`, but the paragraph under
   the table says "Names 3, 4 and 6 must not accidentally contain either substring" — and the
   table's name contains `per-model windows are built`. I followed the table (the explicit test
   list) and the trailing constraint for the *other* two names (4 and 6 contain neither
   substring). The gate is unaffected: it needs ≥ 2 matching `ok` lines and counts 4. If the
   orchestrator prefers the trailing constraint, renaming test 3 to e.g. `model windows exist only
   when the global budget is enabled` is a one-line change that leaves the count at 3.
2. **One extra assertion in test 5** (`assert.ok(budget.modelEffective, "the model windows exist
   before the close")`). It states the arrange step the brief's assertion implies — a model window
   has to exist for "close refuses model reservations" to mean anything — and it is what makes
   test 5 fail against the pre-task `budget.js` instead of passing vacuously. It does not pin any
   behavior task 3 changes: `modelEffective` is part of the returned object in the story's §8
   interface and stays the same in task 3.
3. Nothing else. The six test names, the assertions, the six decisions, the file scope, and the
   commit structure follow the brief.

## Concerns and notes for the next tasks

**Task 3 — the window implementation needs a check/charge split.** This is the important one.
`createWindow.reserve(cost)` today *checks and charges* in one step: on admission it pushes the
events. Task 3's atomicity rule is "the global check passes tentatively, then the model window is
consulted, and only if both pass are both charged" — the global window must not be charged when
the model window rejects. With the current API, calling `globalWindow.reserve()` first charges
the global window before the model window has been asked, which breaks atomicity. Task 3 should
split the factory into a decision half and a charge half (e.g. `check(cost)` returning the
decision and the pruned snapshot, and `charge(cost)` writing the events), then:

```
check global → reject with the global reason, or
check model  → reject with the model reason, or
charge global and charge model
```

The split keeps one implementation for every window, so the two gates still cannot drift.

**Task 3 — the reason strings.** A model window's own rejection reason is `rpm` or `tpm` (the
window does not know what it is). The budget level must map them to `model_rpm` / `model_tpm`, as
the story's §2 and §8 require, while the **global** window's reasons stay `rpm` / `tpm` — the
e04s04 tests and the new test 6 assert the global spelling. A `Retry-After` for a model rejection
comes from the model window's own oldest live reservation, which the shared
`retryAfterSeconds()` already computes.

**Task 3 — lookup rules.** The model ID is the map key exactly as `config.js` stored it: no
trimming, no case-folding. `cost.model` that is `null`, or a model that is not in the map, matches
no window and falls through to the global budget alone. The map is null-prototype, so a
`__proto__` key is an ordinary own property and is found by a plain lookup.

**Task 4 — the wiring is one line.** `server.js:20` is `createBudget(config.rateLimit,
config.limits)`; it becomes `createBudget(config.rateLimit, config.limits, config.modelLimits)`.
`config.modelLimits` is already the null-prototype map `budget.js` expects, and `createBudget` is
called once at module load, so the model windows are built at startup (D4). The existing e04s04
test `per-model limits are accepted and do not change global behavior` still passes today (the
proxy never passes the map yet) and is task 4's to rewrite.

**Task 5 — the living-doc counts.** 153 now, from 141. The test-count sites are unchanged by this
task, as instructed; `CONVENTIONS.md:17` still says "runs all 141 tests" and the README badge
still says `tests-141%20passing`. The task-5 sweep is unchanged in shape.

**Nothing else outstanding.** `budget.js` still reads no environment, starts no timer, and imports
nothing.
