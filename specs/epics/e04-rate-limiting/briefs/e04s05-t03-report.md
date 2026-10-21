# e04s05 Task 3 Report: Atomic reservation across the global and per-model budgets

## Status

`passing`.

`budget.reserve(cost)` now decides against the global windows **and**, when the request names a
model the operator capped, that model's own windows — and charges both only after both admit the
cost. A request the model budget rejects is never charged against the global window; a request the
global budget rejects never reaches the model's window. The window implementation was split into a
check and a charge so the two windows can be consulted before either is charged, and the global
gate's observable behavior did not move.

Base commit: `ccae309` (tasks 1 and 2, their reviews, the task-3 brief, and the orchestrator's
decisions). The pre-task tree used for every falsifiability proof below is `68af45b` — the same
`budget.js` and `server.test.js` bytes as `ccae309`
(`sha256 41e8ca84…` / `69714882…` for both commits).

## Commits

| Commit | Subject | Files |
|---|---|---|
| `d57dc76` | `feat(budget): reserve the global and per-model budgets atomically` | `budget.js`, `server.test.js`, `specs/epics/e04-rate-limiting/e04s05-tasks.yaml` |
| (this report) | `docs(e04s05): add the task 3 report` | this file |

`git diff --name-only ccae309..HEAD` → `budget.js`, `server.test.js`,
`specs/epics/e04-rate-limiting/e04s05-tasks.yaml`, this report. `config.js`, `server.js`,
`admission.js`, `package.json`, `README.md`, `AGENTS.md`, `CONVENTIONS.md`, `specs/state.yaml`,
the story spec and every other spec doc are untouched. No runtime dependency was added
(`package.json` still has no `dependencies` key; `budget.js` imports nothing — `grep -n "^import"
budget.js` → no hit). `npm test` is still plain `node --test`.

## Test summary

| | count |
|---|---|
| before this task | 153 tests, 153 pass, 0 fail (15 suites) |
| after this task | 160 tests, 160 pass, 0 fail (15 suites) |

The seven new tests, all in the existing `describe("e04s05 per-model budgets")` block
(`server.test.js:4446-4554`):

1. `model RPM limit enforced` (`server.test.js:4446`)
2. `model TPM limit enforced` (`server.test.js:4459`)
3. `atomic reservation` (`server.test.js:4470`)
4. `unknown model falls through to global only` (`server.test.js:4486`)
5. `partial model entry` (`server.test.js:4505`)
6. `a model rejection does not charge the global token window` (`server.test.js:4520`)
7. `a model named __proto__ is enforced, not swallowed` (`server.test.js:4534`)

`createBudget` was already imported by task 2 — `import { createBudget, estimateCost } from
"./budget.js";` (`server.test.js:6`) — so the import line did not change.

Names 1, 3, 4 and 5 carry the exact substrings the verify gate matches; names 2, 6 and 7 carry
none of them (`model TPM limit enforced`, `a model rejection does not charge the global token
window`, `a model named __proto__ is enforced, not swallowed`).

### The strengthened task-3 verify command (D15), run verbatim

```bash
out=$(node --test --test-reporter=tap --test-name-pattern 'model RPM limit enforced|atomic reservation|unknown model falls through|partial model entry' server.test.js 2>&1); rc=$?; test "$rc" -eq 0 || { printf '%s\n' "$out"; exit "$rc"; }; n=$(printf '%s\n' "$out" | grep -cE '^[[:space:]]*ok [0-9]+ - .*(model RPM limit enforced|atomic reservation|unknown model falls through|partial model entry)'); test "$n" -ge 4
```

```
rc=0 n=4
gate_rc=0
```

The matching `ok` lines:

```
    ok 1 - model RPM limit enforced
    ok 2 - atomic reservation
    ok 3 - unknown model falls through to global only
    ok 4 - partial model entry
ok 1 - e04s05 per-model budgets
```

The command was also extracted from the updated ledger row with `js-yaml` and run from a shell
script, so the string in `e04s05-tasks.yaml` is the string that was executed:
`yaml_verify_rc=0`.

### `npm test`

```
ℹ tests 160
ℹ suites 15
ℹ pass 160
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

One full run, 175 s, no flake: the known e04s03 shutdown flake
(`shutdown rejects late arrivals and keeps health responsive`) did not fire. The e04s04 block
(`describe("e04s04 global RPM/TPM budgets")`, 8 tests) is green unchanged.

### `npm run check`

Clean: ESLint over `server.js config.js budget.js server.test.js`, `tsc -p tsconfig.json`, and
Prettier `--check` over the five formatted files ("All matched files use Prettier code style!").
No findings, no rule silenced, no unrelated line reformatted.

## How D10–D15 were applied

### D10 — a check and its charge are separable, and the charge uses the check's snapshot

Applied. `createWindow` no longer has a `reserve()`; it has a `check()` that decides and a
`charge()` that consumes the decision's handle. The window is module-private (`createWindow` is
not exported), so this is not a public API change — but it is the shape the next reader will see.

```js
  function check(cost) {
    if (closed) {
      return { admitted: false, reason: "closed", retryAfter: 1 };
    }
    const now = Date.now();
    const used = totals(now);

    if (rpmLimit != null && cost.requestCharge > 0 && used.requests >= rpmLimit) {
      return {
        admitted: false,
        reason: "rpm",
        retryAfter: retryAfterSeconds(requestEvents[0].at, now),
      };
    }
    if (tpmLimit != null && cost.totalTokens > 0 && used.tokens + cost.totalTokens > tpmLimit) {
      return {
        admitted: false,
        reason: "tpm",
        retryAfter: retryAfterSeconds(oldestTokenEvent(tokenEvents), now),
      };
    }

    return {
      admitted: true,
      cost,
      retryAfter: null,
      handle: {
        at: now,
        requestCharge: cost.requestCharge,
        tokens: cost.totalTokens,
        charged: false,
      },
    };
  }

  // The charge, against the snapshot the decision read. The handle is
  // consumed with it: a window that passed its check is charged exactly once,
  // and a window that failed its check has no handle to charge.
  function charge(handle) {
    if (handle.charged) return;
    handle.charged = true;
    if (rpmLimit != null && handle.requestCharge > 0) requestEvents.push({ at: handle.at });
    if (tpmLimit != null && handle.tokens > 0) {
      tokenEvents.push({ at: handle.at, tokens: handle.tokens });
    }
  }

  function close() { /* unchanged: closed = true */ }

  return { check, charge, close };
```

How a check and its charge stay tied to one snapshot:

- **One clock reading.** The check captures `now = Date.now()` once, prunes the event history
  against it, and puts that same `now` in the handle. The charge writes the events with
  `handle.at` — the time the decision read the window, not a later reading. The pre-task code
  pushed with the `now` it had captured at the start of its own single call, so the event history
  is written exactly as before.
- **The numbers are snapshotted too.** The handle carries `requestCharge` and `tokens` as read at
  check time, so a charge cannot bill a different cost than the one that was checked.
- **A rejected window has no handle.** A rejection returns `{ admitted: false, reason, retryAfter }`
  and no handle, so there is nothing to charge: a window that failed its check is charged never.
- **A passed window is charged once.** The handle carries a `charged` flag and `charge()` consumes
  it, so a window that passed its check is charged exactly once even if the caller tried again.
- **No await, no promise, no timer, no callback** sits between a check and its charge. The whole
  decision — global check, model check, global charge, model charge — is one synchronous function
  call, so nothing can interleave between "the model window rejected" and "the global window is
  not charged".

The global gate's observable behavior did not change; see "Falsifiability" below for the
differential proof and the e04s04 block for the regression suite.

### D11 — the reason is mapped at the budget level

Applied. The window keeps its own `rpm` / `tpm` (and `closed`); the budget level maps a model
window's rejection to `model_rpm` / `model_tpm` and leaves the global window's rejection as it was.

```js
// A model window keeps its own "rpm" / "tpm"; the budget level names the
// constraint the caller sees, because a request rejected by a model's own
// limit is a different answer from one rejected by the shared budget. The
// global window's reasons stay "rpm" and "tpm": they are the spelling the
// request path already knows.
function modelReason(reason) {
  if (reason === "rpm") return "model_rpm";
  if (reason === "tpm") return "model_tpm";
  return reason;
}
```

The global spelling is still pinned by `the global budget is unchanged when model limits are
configured` (`server.test.js:4427`, reason `"rpm"`), by the e04s04 block, and by the new test 4
(`unknown model falls through to global only`, reason `"rpm"` and not `model_rpm`).

Within one window the request dimension is checked before the token dimension — the order the
global window already used, unchanged in `check()`.

### D12 — the HTTP response is not touched, and the reason never reaches the client

Applied. `server.js` is untouched. The reason is an internal value of the budget; the 429 body
stays the fixed generic `{ "error": "Too many requests" }` with a positive `Retry-After`.

The only place the reason is read today is `server.js:138-140`, which copies it into an internal
rejection object:

```js
async function admitWithBudget(cost) {
  const outcome = budget.reserve(cost);
  if (outcome.admitted) return outcome;
  return { admitted: false, reason: outcome.reason, retryAfterSeconds: outcome.retryAfter };
}
```

Nothing in the response path serializes that field — the existing test `429 body is the fixed
string and leaks no model, path, queue depth, budget, or upstream host`
(`server.test.js:3302`) covers the response shape. Task 4 wires `server.js` and covers the HTTP
end to end; task 3 does not touch it. `budget.js` itself logs nothing.

### D13 — the model windows' closed flag is defense in depth, and stays

Applied: `close()` still closes the global window and every model window, and the per-window
`closed` flag still exists inside the one shared window implementation.

**This flag is not independently observable through the public API.** `close()` closes the global
gate first, and the global gate refuses first, so a reservation after `close()` is refused with
`reason: "closed"` without ever reaching a model window. The existing test `close refuses model
reservations` (`server.test.js:4417`) therefore proves the *global* refusal, not the model
windows' — the same observation the task-2 review recorded. Nothing was contorted to make the
model flag observable, and nothing was deleted: the global window's use of the same flag is
observable and tested. A reader must not mistake the model windows' `closed` flag for a covered
path. If a future story wants it pinned, `budget.js` needs a seam for it (for example a
`modelClosed` signal on the returned budget).

### D14 — the model lookup is exact and never consults a prototype

Applied.

```js
  // The model's own window, when the request names a model the operator
  // capped. The lookup is exact — the model ID travels as the body wrote it,
  // with no trimming and no case-folding — and the map is null-prototype, so
  // a model ID like "__proto__" is an ordinary entry that is found and
  // enforced, never a prototype.
  function modelWindowFor(cost) {
    if (typeof cost.model !== "string") return null;
    if (!Object.hasOwn(modelWindows, cost.model)) return null;
    return modelWindows[cost.model];
  }
```

- `cost.model === null` (or absent, or not a string) → **no lookup at all**, global only.
- A model ID that is not in the map → global only.
- No trimming, no case-folding, no normalization — the same rule the estimator applies (task 1)
  and the same rule `config.js` applies when it stores the keys.
- `Object.hasOwn` on the null-prototype map is an exact own-property lookup: a model ID of
  `"__proto__"`, `"constructor"` or `"toString"` is an ordinary key that is found and enforced, and
  nothing on `Object.prototype` is consulted or written. Pinned by the new test
  `a model named __proto__ is enforced, not swallowed`.

### D15 — the ledger's verify command is vacuous; strengthened as tasks 1 and 2 did

Applied. Task 3's `verify` string in `specs/epics/e04-rate-limiting/e04s05-tasks.yaml` now is the
name-counting form from the brief (the old form counted the file-level `ok 1 - server.test.js`
line, so it could not say which tests ran). `status` was flipped to `passing` only after that
command exited 0. The diff on the file is exactly two changed lines, both in task 3's row:

```
-      out=$(node --test --test-reporter=tap --test-name-pattern 'model RPM limit enforced|atomic reservation|unknown model falls through|partial model entry' server.test.js 2>&1); rc=$?; test "$rc" -eq 0 || { printf '%s\n' "$out"; exit "$rc"; }; count=$(printf '%s\n' "$out" | grep -cE '^[[:space:]]*ok [0-9]+ - '); test "$count" -ge 4
+      out=$(node --test --test-reporter=tap --test-name-pattern 'model RPM limit enforced|atomic reservation|unknown model falls through|partial model entry' server.test.js 2>&1); rc=$?; test "$rc" -eq 0 || { printf '%s\n' "$out"; exit "$rc"; }; n=$(printf '%s\n' "$out" | grep -cE '^[[:space:]]*ok [0-9]+ - .*(model RPM limit enforced|atomic reservation|unknown model falls through|partial model entry)'); test "$n" -ge 4
-    status: failing
+    status: passing
```

The ledger file still parses (checked with `js-yaml`): story `status: failing`, tasks
`1 passing, 2 passing, 3 passing, 4 failing, 5 failing`. The other four task rows and the
story-level status are untouched.

## The order of the checks and the reason mapping

```js
  // The admission decision, atomic across the global window and the model's
  // own. Both must admit the cost before either is charged: a request the
  // model budget rejects never consumes global budget, and a request the
  // global budget rejects never reaches the model's window. The whole
  // decision is synchronous, so nothing can interleave between the two
  // checks and the charges that follow them.
  function reserve(cost) {
    const global = globalWindow.check(cost);
    if (!global.admitted) return global;

    const modelWindow = modelWindowFor(cost);
    let model = null;
    if (modelWindow) {
      model = modelWindow.check(cost);
      if (!model.admitted) {
        return {
          admitted: false,
          reason: modelReason(model.reason),
          retryAfter: model.retryAfter,
        };
      }
    }

    // Both admit the cost, so both are charged — in the order they were
    // checked, against the snapshots their checks read.
    globalWindow.charge(global.handle);
    if (model) modelWindow.charge(model.handle);
    return { admitted: true, cost, retryAfter: null };
  }
```

The order is fixed and matches the story's §5 step 3:

1. **Global check first.** A global rejection returns immediately with the global reason
   (`rpm` / `tpm` / `closed`) and the global `Retry-After`; the model's window is never consulted.
2. **Model check second**, only when `cost.model` names a configured model. A model rejection
   returns immediately with `model_rpm` / `model_tpm` and the **model window's own** `Retry-After`
   (derived from the model window's oldest live reservation, by the shared `retryAfterSeconds()`).
   The global window is not charged.
3. **Both charges** only when both checks admitted, in the order the windows were checked
   (global, then model), each against its own check's snapshot.

The returned shapes are unchanged for the global path (`{ admitted: true, cost, retryAfter: null }`
on admission, `{ admitted: false, reason, retryAfter }` on rejection) and the disabled gate is
untouched (`{ admitted: true, cost: null }`).

## How the atomicity claim is proven

The proof is in the unit tests, where the global counter is observed directly rather than
inferred from a 429.

**Request dimension** — `atomic reservation` (`server.test.js:4470`): global `rpm: 2`, model
`nemotron` `rpm: 1`.

1. `reserve({model: "nemotron", …})` → admitted (global charged 1, model charged 1).
2. `reserve({model: "nemotron", …})` → **rejected**, `reason: "model_rpm"`.
3. `reserve({model: "llama", …})` (unconfigured model → global only) → **admitted**.

Step 3 is only possible if step 2 never reached the global counter: the global rpm is 2, one
request sits on it, and a second would have been refused with `reason: "rpm"`. Observed counter
after the model rejection: **1**, not 2.

**Token dimension** — `a model rejection does not charge the global token window`
(`server.test.js:4520`): global `tpm: 200` (exactly one request of 200 tokens), model `nemotron`
`tpm: 100`.

1. `reserve({model: "nemotron", totalTokens: 200})` → **rejected**, `reason: "model_tpm"`.
2. `reserve({model: "llama", totalTokens: 200})` → **admitted**.

Step 2 is only possible if step 1 never reached the global token window: 200 + 200 > 200 would
have been refused with `reason: "tpm"`. Observed global token counter after the model rejection:
**0**.

The same two facts are visible in the differential harness output (below): the new budget
rejects the second "nemotron" request with `model_rpm` while a following request for an
uncapped model is still admitted.

## Falsifiability

Everything below ran in `$HOME/tmp/e04s05-t03/` (the pre-task files were materialized with
`git show 68af45b:<path>`). **The working tree was not modified by any of it.**

### 1. The strengthened gate is red on the pre-task tree

```
PRE-TASK strengthened gate: node_rc=0 n=0
PRE-TASK gate_rc=1  (expect 1 = gate fails on the pre-task tree)
--- ok lines present in the pre-task run ---
ok 1 - server.test.js
```

The pre-task run prints only the file-level line `ok 1 - server.test.js`, so the strengthened gate
counts **0** matching `ok` lines and exits 1.

### 2. The strengthened gate is not vacuous either

The old ledger gate on the same pre-task tree: `old_gate_rc=1 count=1` — it also fails there,
because with the name pattern applied the file-level line is the only `ok` line it can see.

The sharper demonstration of the vacuity D15 describes: take the current tree and rename one of
the four required tests away (`partial model entry` → `a partial entry caps the request count
only`), so the run is green but one required test is missing:

```
one required test renamed away -> node_rc=0 strengthened_n=3 strengthened_gate_rc=1 (expect 1) old_count=4 old_gate_rc=0 (expect 0 = vacuous)
--- ok lines ---
    ok 1 - model RPM limit enforced
    ok 2 - atomic reservation
    ok 3 - unknown model falls through to global only
ok 1 - e04s05 per-model budgets
```

The old gate exits 0 — it cannot tell which tests ran, it only counts `ok` lines — while the
strengthened gate exits 1. That is the vacuity the D15 form removes.

### 3. The new tests are not tautologies

The current `server.test.js` (with the seven new tests) against the pre-task `budget.js`
(`git show 68af45b:budget.js`) in `$HOME/tmp/e04s05-t03/newtests`:

```
node_rc=1
    not ok 1 - model RPM limit enforced
    not ok 2 - model TPM limit enforced
    not ok 3 - atomic reservation
    ok 4 - unknown model falls through to global only
    not ok 5 - partial model entry
    not ok 6 - a model rejection does not charge the global token window
    not ok 7 - a model named __proto__ is enforced, not swallowed
not ok 1 - e04s05 per-model budgets
# tests 7
# pass 1
# fail 6
```

Six of the seven fail, and every failure is a real assertion failure (not an error):

```
    not ok 1 - model RPM limit enforced
      error: |-
      expected: false
      actual: true
      operator: 'strictEqual'
```

(the same `expected: false / actual: true` shape for tests 2, 3, 5, 6 and 7).

**Test 4 passes on the pre-task tree by design.** It is the control: it pins the global-only
fall-through, and the pre-task implementation never consults a model window at all, so it already
satisfies that assertion. It is not a tautology — it is the assertion that must *keep* passing
after the change, and it fails loudly if the model check ever leaks into an unconfigured model's
path (the rejection reason would become `model_rpm` instead of `rpm`).

### 4. The global gate still behaves identically

Differential harness (`$HOME/tmp/e04s05-t03/diff/global-diff.mjs`) importing the pre-task
`budget.js` and the new one side by side and running the same scenarios through both: rpm over,
tpm over, margin, `close()` refusal, disabled gate, and the global path with a generous model
window configured. Compared: `enabled`, `effective`, and the whole `reserve()` outcome sequence
(`admitted`, `reason`, `retryAfter`, the echoed `cost`, and the result object's own key set).

```
scenario rpm-over: identical=true
scenario tpm-over: identical=true
scenario margin: identical=true
scenario closed: identical=true
scenario disabled: identical=true
scenario global-with-generous-model-window: identical=true
ALL GLOBAL SCENARIOS IDENTICAL: true
```

The intended divergence, from the same harness (`feature-diff.mjs`):

```
pre  #1: {"admitted":true,...}
now  #1: {"admitted":true,...}
pre  #2: {"admitted":true,...}
now  #2: {"admitted":false,"reason":"model_rpm","retryAfter":60}
now  #3 (uncapped model): {"admitted":true,...}
pre  tokens: {"admitted":true,...}
now  tokens: {"admitted":false,"reason":"model_tpm","retryAfter":1}
now  tokens after (uncapped model, 200 tokens against a 200 tpm): {"admitted":true,...}
```

A `model_tpm` rejection on an empty model window carries `retryAfter: 1` — the model window has no
live reservation yet, so `retryAfterSeconds(null, now)` returns 1, the same floor the global
window uses for an empty window.

## Deviations from the brief

1. **One existing test's fixture changed: `the global budget is unchanged when model limits are
   configured` (`server.test.js:4427`).** Task 2 wrote it against D7 (the model window is built
   but never consulted), with the model entry `{ rpm: 1, tpm: 1 }` and a cost of 10 tokens. Under
   this task's semantics that entry bites first — the *first* request would be rejected with
   `model_tpm` (10 tokens > a 1-token model budget) and the test's first assertion would fail.
   The model entry is now `{ rpm: 100, tpm: 100000 }`: the model's window still exists and is
   still consulted, it simply does not decide this request. **The test's name and every one of its
   four assertions are unchanged**, and it still proves what it was written to prove: the global
   rpm of 2 admits two requests and rejects the third with the global reason `"rpm"`, not a model
   reason. No assertion was relaxed, no test was deleted, no `skip`/`only` was added. The same
   shape is what the new test `unknown model falls through to global only` pins from the other
   side.
2. **The window's `reserve()` is gone, replaced by `check()` / `charge()`.** D15's D10 explicitly
   leaves the shape to the implementer. `createWindow` is module-private and not exported, so no
   public API changed; `budget.reserve(cost)` keeps its signature and its result shapes.
3. **The charges happen global-first, then model** — the order the windows were checked. The
   brief fixes the *check* order and says only that both must be charged; a charge cannot fail,
   so the order of the two charges is not observable either way. It is recorded here so the next
   reader does not have to guess.
4. **Nothing else.** The seven test names, the assertions, the six decisions, the file scope and
   the commit structure follow the brief.

## Concerns, and what tasks 4 and 5 must know

**Task 4 — the wiring is one line, but the request body has to name a model.** `server.js:20` is
`createBudget(config.rateLimit, config.limits)`; it becomes
`createBudget(config.rateLimit, config.limits, config.modelLimits)`. `config.modelLimits` is
already the null-prototype map `budget.js` expects, and `createBudget` runs once at module load,
so the model windows are built at startup.

Two things task 4 must know:

- The proxy's test bodies (`CHAT_BODY` in `server.test.js`) name **no** model, so `cost.model` is
  `null` and those requests stay global-only even after the wiring. The e04s04 test
  `per-model limits are accepted and do not change global behavior` (`server.test.js:4274`) still
  passes today and still passes after the wiring unless its body is changed to name a model —
  which is exactly what that test is for once task 4 rewrites it.
- The reason must stay internal. `server.js:138-140` copies `outcome.reason` into an internal
  rejection object; the 429 body is the fixed generic string and the `Retry-After` header is the
  positive number the budget derived. The reason is not logged and does not change the response
  shape (D12).

**Task 5 — the living-doc counts.** 160 now, from 141. The count-sync sites are unchanged by this
task, as instructed: `CONVENTIONS.md:17` still says "runs all 141 tests", `README.md:9` still
carries the `tests-141%20passing` badge, and `AGENTS.md`, `specs/README.md:19`,
`specs/tech-architecture/tech-stack.md`, `specs/tech-architecture/TEST_PLAN_LATEST.md`,
`specs/product/VISION_LATEST.yaml:20` and
`specs/epics/e04-rate-limiting/e04s01-config-owner-and-bind-host.md:345` still say 141. The
task-5 sweep is unchanged in shape; the new total is **160**.

**The model windows' closed flag stays unobservable** (D13, above). If a later story wants
story §11.8 pinned by a test rather than by reading, `budget.js` needs a seam — for example a
`modelClosed` signal on the returned budget.

**One flaky test in the suite, not from this task.** The e04s03 test `shutdown rejects late
arrivals and keeps health responsive` (`server.test.js:3809`) fails in roughly one run in 26 and
reproduces on the pre-task tree. It did not fire in this task's single full run. The orchestrator
should know the suite is one flake away from red regardless of this task.

**Nothing else outstanding.** `budget.js` still reads no environment, starts no timer, and imports
nothing; the module is still the only owner of the numbers.
