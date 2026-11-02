# Review — e04s05 task 3: atomic reservation across the global and per-model budgets

**Verdict: PASS**

- Reviewed range: `ccae309..d587e74` (base `ccae309`, head `d587e74`)
- Implementer commits under review: `d57dc76` (`budget.js`, `server.test.js`, task-3 ledger row),
  `d587e74` (the report)
- Brief: `specs/epics/e04-rate-limiting/briefs/e04s05-t03.md`
- Report under review: `specs/epics/e04-rate-limiting/briefs/e04s05-t03-report.md` (a claim, not
  evidence)
- House standard: `specs/epics/e04-rate-limiting/briefs/e04s05-t01-review.md`,
  `specs/epics/e04-rate-limiting/briefs/e04s05-t02-review.md`
- Reviewer runs: Node v26.4.0; `npm test` ×1 (201.7 s); `npm run check`; the strengthened task-3
  verify command on HEAD and on the pre-task tree (`68af45b`, materialized under `$HOME/tmp/t03/`);
  the seven new tests against the pre-task `budget.js`; a seven-scenario pre/post differential
  harness for the global path; a four-configuration fuzz of the admission decision against an
  independent reference model (80 000 reservations). The working tree was not modified by any of
  it; the only file written is this review.

## Must-fix

None. Every requirement in the brief's Requirements (1–5), Tests to add, Implementation notes, and
Verification contract sections is met by the code; D10–D15 are implemented as decided; the global
gate's observable behavior is unchanged (verified differentially, not by assertion); and the
strengthened gate is green on HEAD and red on the pre-task tree.

## Should-fix

Not blocking acceptance. All three are report wording or test-coverage gaps; none changes an
accepted or rejected value, and none is a code defect.

1. **`e04s05-t03-report.md:516-520` — the "task 4 must know" note about the e04s04 test is false in
   two ways.** The report says:

   > "The proxy's test bodies (`CHAT_BODY` in `server.test.js`) name **no** model, so `cost.model` is
   > `null` and those requests stay global-only even after the wiring. The e04s04 test
   > `per-model limits are accepted and do not change global behavior` (`server.test.js:4274`) still
   > passes today and still passes after the wiring unless its body is changed to name a model"

   The truth, from the code:

   - `CHAT_BODY` **does** name a model — `server.test.js:4036-4039`:

     ```js
     const CHAT_BODY = JSON.stringify({
       model: "nemotron",
       messages: [{ role: "user", content: "x".repeat(40) }],
     });
     ```

     So `cost.model === "nemotron"`, not `null`.
   - That e04s04 test therefore **does not** still pass after task 4's wiring. It configures
     `PROXY_MODEL_LIMITS_JSON: {"nemotron":{"rpm":1,"tpm":1}}` (`server.test.js:4277`) and posts
     `CHAT_BODY`, whose estimated cost is `totalTokens: 1034` (input 10 + default output 1024).
     I simulated the task-4 wiring (`createBudget({rpm:60,tpm:100000},{safetyMarginPct:5}, {nemotron:{rpm:1,tpm:1}})`):

     ```
     effective global: {"rpm":57,"tpm":95000}
     effective models: {"nemotron":{"rpm":1,"tpm":1}}
     first  : {"admitted":false,"reason":"model_tpm","retryAfter":1}
     => the e04s04 test's first assertion (status 200) would FAIL (429 model_tpm)
     ```

     The **first** request is rejected (not the second), because the model's `tpm: 1` is below the
     body's 1034-token cost. Task 4 must therefore change that test's **model-limit fixture** (drop
     `tpm`, or raise it above the body cost), not only its assertions — the ledger row for task 4
     (`e04s05-tasks.yaml:83`) asks for "two requests for a configured model with rpm 1 should
     result in the second being rejected 429", which is only reachable with an rpm-only model entry
     or a cheaper body. With `nemotron: {rpm: 1}` and a 10-token cost the sequence is
     `admitted → {admitted:false, reason:"model_rpm", retryAfter:60}` (verified).

   Corrected wording for the report: *"the e04s04 test's `CHAT_BODY` already names `nemotron` and
   the test configures `nemotron: {rpm:1,tpm:1}`, so once the wiring lands the **first** request is
   rejected with `model_tpm` (the body costs 1034 tokens). Task 4 must rewrite that test's model
   fixture as well as its assertions."* Nothing else in the report depends on the wrong claim; the
   task-4 wiring instruction (`server.js:20` becomes a three-argument `createBudget`) is correct.
   **Fix the report before task 4 starts** — a task-4 implementer who trusts the current sentence
   will believe the e04s04 test still passes and will be surprised by a red suite.

2. **`server.test.js:4470-4554` — tests 3–7 assert the rejection reason but not the
   `retryAfter` positivity.** The brief's trailing sentence asks for it wherever a rejection is
   expected: *"Also assert, where a rejection is expected, that the returned object carries the
   reason and a `retryAfter` that is a positive integer"*. Tests 1 (`:4446`) and 2 (`:4459`) do
   (`Number.isInteger(...)` + `> 0`); tests 3 (`atomic reservation`), 4
   (`unknown model falls through to global only`), 5 (`partial model entry`), 6 (`a model rejection
   does not charge the global token window`) and 7 (`a model named __proto__ ...`) assert the reason
   only. The implementation is not at fault — every rejection does carry a positive integer
   `retryAfter` (fuzz-verified over 80 000 rejections, see below) — so this is a test-coverage gap
   against the brief's sentence, not a behavior gap. The brief's per-test table does not list
   `retryAfter` for tests 3–7, which is why the implementer stopped there.

3. **`budget.js:302-308` — the "charged exactly once even if `charge` is called twice" invariant is
   enforced but not observable.** `handle.charged` (`budget.js:303-304`) is the only guard, and the
   handle never leaves `reserve()` (`createWindow` is module-private; `budget.js:317` exposes only
   `{check, charge, close}` to the factory, and the factory returns only `reserve`/`release`/`close`
   to the caller). The invariant therefore holds by construction — the public API cannot call
   `charge` twice — but no test can pin it, and no reader can see it from the outside. The same
   shape as the D13 closed-flag observation: code-reading invariant, not a covered path. If a later
   story wants it observable, the budget needs a seam (for example a `charge` counter or an exported
   window factory).

## Orchestrator decisions D10–D15

**D10 — a check and its charge are separable, and the charge uses the check's snapshot: implemented
as decided; the reasoning holds.**

- `createWindow` now exposes `{ check, charge, close }` (`budget.js:317`); `reserve()` no longer
  exists on the window. The pre-task `reserve()` was check-and-charge in one call, so the atomic
  rule could not have been implemented by calling the global window first — the t02 review flagged
  exactly this, and the split is the fix.
- The check captures one clock reading (`budget.js:268 const now = Date.now()`), prunes the event
  history against it (`totals(now)`), and puts that same `now` into the handle
  (`budget.js:290-294`). The charge writes the events with `handle.at`
  (`budget.js:305,307`) — the time the decision read the window, not a later reading. The handle
  also carries `requestCharge` and `tokens` as read at check time (`budget.js:292-293`), so a charge
  cannot bill a different cost than the one that was checked.
- A rejected window has no handle: `check` returns `{admitted:false, reason, retryAfter}` and no
  handle field (`budget.js:266-283`), so there is nothing to charge.
- A passed window is charged once: `charge` consumes `handle.charged` (`budget.js:302-305`).
- **No `await`, no promise, no timer, no callback sits between a check and its charge.** The whole
  decision is one synchronous function body (`budget.js:390-412`): `globalWindow.check` (`:391`),
  `modelWindow.check` (`:397`), `globalWindow.charge` (`:409`), `modelWindow.charge` (`:410`). Node
  runs it to completion before any other task observes the budget. The whole module has no
  `async`/`await`, no `Promise`, and no timer — `grep -n "async\|await\|Promise\|setTimeout" budget.js`
  returns no hit.
- The global gate's observable behavior did not change — see "The global gate is unchanged" below
  (differential harness) and the e04s04 block (8/8 green in the full run).

I agree with D10.

**D11 — the reason is mapped at the budget level: implemented as decided.**

- The window keeps its own `rpm` / `tpm` / `closed` (`budget.js:266, 274, 281`); the budget level
  maps only the **model** window's rejection through `modelReason()` (`budget.js:325-329`), and the
  global window's rejection is returned untouched (`budget.js:391-392` — the check's own object).
- The global spelling `rpm` / `tpm` is unchanged and still pinned by
  `the global budget is unchanged when model limits are configured` (`server.test.js:4427`,
  `reason === "rpm"`), by the e04s04 block, and by the new
  `unknown model falls through to global only` (`server.test.js:4486`, `reason === "rpm"`).
- Within one window the request dimension is checked before the token dimension — the same order
  the pre-task global window used (`budget.js:270` before `budget.js:277`), for both the global and
  the model window (same implementation, D9 from task 2).
- The `Retry-After` on a model rejection is the model window's **own** oldest live reservation
  (`budget.js:275` for rpm, `budget.js:282` for tpm, both from the model's own event arrays). On a
  model window with no live reservation yet (the first rejection) the value is the floor `1`
  (`retryAfterSeconds(null, now)`), the same floor the global window uses for an empty window.

I agree with D11.

**D12 — the HTTP response is untouched and the reason never reaches the client: implemented as
decided.**

- `server.js` is not in the diff (`git diff --name-only ccae309..HEAD` → `budget.js`,
  `server.test.js`, `specs/.../e04s05-tasks.yaml`, `specs/.../e04s05-t03-report.md`).
- The reason is read in exactly one place, `server.js:138-140`:

  ```js
  async function admitWithBudget(cost) {
    const outcome = budget.reserve(cost);
    if (outcome.admitted) return outcome;
    return { admitted: false, reason: outcome.reason, retryAfterSeconds: outcome.retryAfter };
  }
  ```

  and the 429 arm serializes only the fixed body and the header (`server.js:286-287`):

  ```js
  { error: "Too many requests" },
  { "retry-after": String(reservation.retryAfterSeconds) }
  ```

  The reason never reaches the client and does not change the response shape. `budget.js` logs
  nothing (`grep -n "console\." budget.js` → no hit). The existing
  `429 body is the fixed string and leaks no model, path, queue depth, budget, or upstream host`
  (`server.test.js:3302`) still passes.

I agree with D12.

**D13 — the per-model closed flag stays, and its unobservability is recorded: implemented as
decided.**

- `close()` still closes the global window and every model window (`budget.js:432-439`); the
  per-window `closed` flag still exists inside the one shared window implementation
  (`budget.js:311-314`, checked at `budget.js:265`).
- The flag is **not independently observable through the public API**, and the report says so
  explicitly (report §D13). I verified it: after `budget.close()` the global window refuses first
  (`budget.js:391`), so a reservation is refused with `reason: "closed"` without ever reaching a
  model window. The existing test `close refuses model reservations` (`server.test.js:4417`) proves
  the **global** refusal, exactly as the t02 review already recorded.
- Nothing was contorted to make the flag observable and nothing was deleted. The global window's use
  of the same flag is observable and tested (`close()` → `reason:"closed"`, `retryAfter:1`, verified
  identical to the pre-task implementation in the differential harness).

I agree with D13. The report's disclosure is accurate.

**D14 — the model lookup is an exact own-property lookup and `__proto__` is an ordinary key:
implemented as decided.**

```js
  function modelWindowFor(cost) {
    if (typeof cost.model !== "string") return null;
    if (!Object.hasOwn(modelWindows, cost.model)) return null;
    return modelWindows[cost.model];
  }
```
(`budget.js:419-422`)

- `cost.model === null` (or absent, or not a string) → no lookup at all, global only
  (`budget.js:420`). A non-string model never reaches the map.
- No trimming, no case-folding, no normalization: the ID travels as the body wrote it, the same
  rule the estimator applies (`budget.js:165-171`) and the same rule `config.js` applies when it
  stores the keys (`config.js:153` stores into a null-prototype map; `config.js:160-163` rejects a
  space-padded key).
- `modelWindows` is null-prototype (`budget.js:367`), so `modelWindows["__proto__"] = window`
  (`budget.js:373`) creates an ordinary own property and `Object.hasOwn` finds it. Pinned by the new
  test `a model named __proto__ is enforced, not swallowed` (`server.test.js:4534`): the map's
  prototype is still `null`, `Object.hasOwn(map, "__proto__")` is `true`, the effective map holds it
  as an own key, the second reservation is rejected with `model_rpm`, and `Object.prototype.rpm` is
  `undefined`. The fuzz also exercised `"__proto__"` as a cost model 20 000 times per configuration
  with no divergence from the reference model.
- A model ID that is not in the map is governed by the global budget alone
  (`unknown model falls through to global only`, `server.test.js:4486`).

I agree with D14.

**D15 — the ledger's verify gate was vacuous and is now strengthened: implemented as decided, and
the gate is real.**

- Task 3's `verify` string in `specs/epics/e04-rate-limiting/e04s05-tasks.yaml:66` is byte-identical
  to the D15 form in the brief, and `status: failing` → `passing` on that row only (`:69`). The diff
  on the file is exactly two changed lines, both in task 3's row; the story-level `status: failing`
  (`:3`) and tasks 1, 2, 4, 5 are untouched. The ledger still parses.
- Verified independently (see "Gate falsifiability"): green on HEAD, red on the pre-task tree, and
  red when one required test is renamed away — while the old form stays green in that last case.
  The claim that the old form "could be satisfied by renaming tests away" is **true** and I
  reproduced it.

I agree with D15.

## The atomicity claim — independent verdict

**I could not break it.** No case was found where a cost is charged twice, charged to the wrong
window, or charged after a rejection.

Evidence, in increasing strength:

1. **By reading** (`budget.js:390-412`): the global check (`:391`) returns immediately on rejection
   (`:392`) — the model window is never consulted and the global is never charged; the model check
   (`:397`) returns immediately on rejection (`:398-403`) — before either charge, so a model
   rejection leaves the global counter untouched; the two charges (`:409-410`) run only after both
   checks admitted. Each window's `charge` writes to its own closure-captured event arrays, so a
   handle can never be charged to the other window.
2. **By the new unit tests**: `atomic reservation` (`server.test.js:4470`) and
   `a model rejection does not charge the global token window` (`server.test.js:4520`) observe the
   global counter directly on both dimensions (request count and token count).
3. **By a differential fuzz against an independent reference model.** I wrote a reference model of
   the documented semantics from scratch (decide-then-charge, global first, model only for a
   configured model) and compared it against the real implementation step by step over four
   configurations and 80 000 reservations, checking the admission decision, the reason, and that
   every rejection carried an integer `retryAfter > 0`:

   ```
   global loose / model tight: mismatches=0 mix={"admitted":7980,"model_tpm":2664,"model_rpm":2759,"tpm":6597}
   global tight / model loose: mismatches=0 mix={"admitted":4,"rpm":19996}
   global and model tight:    mismatches=0 mix={"admitted":3,"rpm":19997}
   no models configured:      mismatches=0 mix={"admitted":4,"rpm":19996}
   MULTI-FUZZ: NO MISMATCH
   ```

   A double charge, a charge to the wrong window, or a charge after a rejection would all show up
   as a divergence from the reference on a later reservation (the reference charges only on a fully
   admitted decision). None did. 5 423 of those 80 000 reservations were rejected by a **model**
   window, so the model path was heavily exercised.
4. **Attempted attacks that all fail**, with the reason:
   - *Rejection after a global charge.* Impossible: the only `globalWindow.charge` call
     (`budget.js:409`) is after the model check's early return.
   - *Model charge when the global rejected.* Impossible: the global's early return (`:392`) precedes
     `modelWindowFor` (`:395`).
   - *Charge twice.* `handle.charged` (`:303-304`) makes a second `charge` a no-op, and the handle
     is never exposed outside `reserve()`, so the public API cannot even attempt it (should-fix 3).
   - *Charge to the wrong window.* Each window's `charge` closes over its own `requestEvents` /
     `tokenEvents`; the handle's `at`, `requestCharge` and `tokens` are the charging window's own
     check-time values.
   - *Interleaving between a check and its charge.* The whole decision is synchronous; the module
     contains no `async`, `await`, `Promise` or timer, and `reserve` is not awaited by anyone
     inside `budget.js`.
   - *A stale snapshot.* The charge writes `handle.at`, the check's own `now` (`:268` → `:288` →
     `:306`), not a fresh reading. Consequence worth naming: the global event is timestamped a few
     microseconds **earlier** than the real push (the model check sits between the two), so the
     global event expires a few microseconds earlier than a naive push would. This is exactly what
     D10 mandates and is far below any observable threshold.

One consequence of the design worth naming for later stories: because a model rejection never
charges the global window, a client can hammer a model-limited endpoint and the global budget will
not see it. That is the intended semantic ("a request rejected by the model budget is never charged
against the global window"), but it means the global budget cannot be used as a proxy for total
request volume while per-model limits exist.

## The global gate is unchanged — independent differential

I imported the pre-task `budget.js` (`git show 68af45b:budget.js`, sha256 `41e8ca84…`, byte-identical
to `ccae309:budget.js`) and the current one side by side and ran the same scenarios through both
factories, comparing `enabled`, `effective`, `modelEffective`, and the full `reserve()` outcome
(`admitted`, `reason`, `retryAfter`, the echoed `cost`, and the result object's own key set):

```
scenario rpm-over: identical=true
scenario tpm-over: identical=true
scenario margin: identical=true
scenario closed: identical=true
scenario disabled: identical=true
scenario global-with-generous-model-window: identical=true
scenario global-no-model-name: identical=true
ALL GLOBAL SCENARIOS IDENTICAL: true
```

Point by point:

- **Rejection reasons** — unchanged: `rpm`, `tpm` and `closed` (`budget.js:266, 271, 278`); the
  global rejection object is returned as-is (`budget.js:391-392`), so the client's view of the
  reason is byte-identical to the pre-task object.
- **`Retry-After` derivation** — unchanged: `retryAfterSeconds` over the window's own oldest live
  reservation (`budget.js:249-252`), computed against the same `now` as the check. The differential
  compares the derived values, not just their presence.
- **"RPM counted once per admitted request"** — unchanged: exactly one `requestEvents.push` per
  admitted request (`budget.js:305`), gated by `handle.requestCharge > 0` exactly as the pre-task
  push was gated. The e04s04 test `RPM is counted once per admitted request inside the window`
  (`server.test.js:4109`) is green.
- **Safety margin** — unchanged: one source (`limits?.safetyMarginPct ?? 5`,
  `budget.js:351`) and one `effectiveLimit` (`budget.js:71-74`); the `margin` scenario compares
  `effective` exactly.
- **`close()` semantics** — unchanged: synchronous, idempotent, refuses before the model window is
  ever consulted; the `closed` scenario compares the outcome objects exactly.
- **Disabled gate** — unchanged: `enabled:false`, `effective:null`, `modelEffective:null`,
  `reserve()` → `{admitted:true, cost:null}`, `close()` a no-op (`budget.js:336-349`). The
  `disabled` scenario compares all of it.
- **The only observable delta on the global path** is the extra `modelEffective` key on the returned
  object, which task 2 introduced (D6) and which this task does not touch.

The e04s04 block (`server.test.js:4032-4289`, 8 tests) is green unchanged in the full run.

## The disclosed fixture change

`the global budget is unchanged when model limits are configured` (`server.test.js:4427-4440`): the
model entry moved from `{rpm:1, tpm:1}` to `{rpm:100, tpm:100000}`; the test's name and all four
assertions are unchanged.

- **Necessary?** Yes, and provably. Under the new semantics the model window is consulted: with
  `{rpm:1, tpm:1}` and the test's cost of 10 tokens, the *first* reservation is rejected with
  `model_tpm` (10 tokens > a 1-token model budget) and the test's first assertion
  (`admitted === true`) would fail. I confirmed this with the pre-task fixture against the new
  `budget.js`. The change is disclosed in the report (Deviations §1) and in the test's own comment
  (`server.test.js:4428-4432`).
- **Does it still pin what its name claims?** Yes. The name claims the *global* budget is unchanged
  when model limits are configured. With `nemotron: {rpm:100, tpm:100000}` the model's window still
  exists and is still consulted — it simply does not decide the request — and the test still proves
  that the global rpm of 2 admits two requests and rejects the third with the **global** reason
  `"rpm"`, not a model reason. The model's rpm of 100 is above the 3 requests the test makes, so
  the model window cannot be what rejects the third.
- **Still a meaningful control, not a weakened one?** Yes. No assertion was relaxed, no test was
  deleted, no `skip`/`only` was added (CONVENTIONS.md:75-78 permits extending a fixture, forbids
  relaxing an assertion). The test is not vacuous either: it is the control that catches a model
  reason leaking into the global path, and it would fail if the model's window were consulted for a
  decision it must not make. A cheaper model entry (e.g. `rpm: 5`) would be marginally tighter, but
  100 is harmless: the point of the entry is "generous enough not to decide".
- The new test `unknown model falls through to global only` (`server.test.js:4486`) pins the same
  property from the other side (an unconfigured model is governed by the global budget alone).

## Test quality

All seven tests are in the existing `describe("e04s05 per-model budgets")` block
(`server.test.js:4446-4554`); `createBudget` was already imported at `server.test.js:6` (no import
change needed). Every name is a behavior sentence, and the names match the brief's table exactly.

| # | Test (line) | Asserts | Brief's required case |
|---|---|---|---|
| 1 | `model RPM limit enforced` (`:4446`) | model `rpm: 2`: first two admitted, third `admitted:false` + `reason:"model_rpm"` + integer `retryAfter` > 0 | model RPM ✓ |
| 2 | `model TPM limit enforced` (`:4459`) | model `tpm: 100`, generous global TPM, cost 200 tokens → `admitted:false` + `reason:"model_tpm"` + integer `retryAfter` > 0 | model TPM ✓ |
| 3 | `atomic reservation` (`:4470`) | global `rpm:2`, model `nemotron` `rpm:1`: first admitted, second `model_rpm`, then an **unconfigured** model's request is **admitted** — only possible if the rejection never reached the global counter | atomicity, request dimension ✓ |
| 4 | `unknown model falls through to global only` (`:4486`) | an unconfigured model is admitted twice by the global budget and the third is rejected with `reason:"rpm"` — **not** `model_rpm` | unknown model ✓ |
| 5 | `partial model entry` (`:4505`) | model `rpm: 2` only: a 50 000-token request is admitted (tokens uncapped), the third request is rejected with `model_rpm` | partial entry ✓ |
| 6 | `a model rejection does not charge the global token window` (`:4520`) | global `tpm: 200` (one request), model `tpm: 100`: the 200-token request is `model_tpm`-rejected and a later 200-token request for an unconfigured model is admitted | atomicity, token dimension ✓ |
| 7 | `a model named __proto__ is enforced, not swallowed` (`:4534`) | null-prototype map, key `"__proto__"`, `rpm: 1`: first admitted, second `model_rpm`, `Object.prototype.rpm` still `undefined` | `__proto__` ✓ |

Coverage of the brief's list: model RPM ✓, model TPM ✓, atomicity on the request dimension ✓,
atomicity on the token dimension ✓, unknown model falling through to global only ✓, partial entry ✓,
`__proto__` ✓. Every rejection the brief's table names carries a reason, and tests 1–2 also carry a
positive-integer `retryAfter` (see should-fix 2 for the rest).

**Falsifiability of the new tests** — the current `server.test.js` against the pre-task `budget.js`
(`git show 68af45b:budget.js`), materialized in `$HOME/tmp/t03/newtests`:

```
not ok 1 - model RPM limit enforced
not ok 2 - model TPM limit enforced
not ok 3 - atomic reservation
ok 4 - unknown model falls through to global only
not ok 5 - partial model entry
not ok 6 - a model rejection does not charge the global token window
not ok 7 - a model named __proto__ is enforced, not swallowed
# tests 7 / # pass 1 / # fail 6
```

Six of the seven fail, every failure with `failureType: 'testCodeFailure'` (a real assertion
failure, not a thrown error) — the report's claim on this point is accurate. Test 4 passes on the
pre-task tree **by design**: it is the control that pins the global-only fall-through and must keep
passing across the change; it is not a tautology, because it fails loudly if the model check ever
leaks into an unconfigured model's path (the reason would become `model_rpm` instead of `rpm`).

## Gate falsifiability (independently verified)

The strengthened task-3 verify command, run verbatim from the working tree:

```
CURRENT strengthened: rc=0 n=4 old_count=5
    ok 1 - model RPM limit enforced
    ok 2 - atomic reservation
    ok 3 - unknown model falls through to global only
    ok 4 - partial model entry
ok 1 - e04s05 per-model budgets
strengthened_gate_rc=0
```

Four matching `ok` lines, exit 0. ✓

**Red on the pre-task tree.** The pre-task tree (`git archive 68af45b` → `$HOME/tmp/t03/pre`, the
working tree untouched) prints only the file-level line:

```
PRE-TASK: node_rc=0 strengthened_n=0 old_count=1
ok 1 - server.test.js
# tests 1 / # pass 1 / # fail 0
strengthened_gate_rc=1
old_gate_rc=1
```

The strengthened gate exits **1** on the pre-task tree. ✓ (The old form also exits 1 there,
because with the name pattern applied the file-level line is the only `ok` line it can see.)

**Can the gate be satisfied by renaming tests away? No — and the old form could.** I copied HEAD's
files into `$HOME/tmp/t03/rename`, renamed `partial model entry` →
`a partial entry caps the request count only`, and ran both forms:

```
RENAMED-AWAY: node_rc=0 strengthened_n=3 old_count=4
    ok 1 - model RPM limit enforced
    ok 2 - atomic reservation
    ok 3 - unknown model falls through to global only
ok 1 - e04s05 per-model budgets
strengthened_gate_rc=1
old_gate_rc=0
```

The old form exits **0** with one of the four required tests missing (it counts `ok` lines and
cannot tell which tests ran); the strengthened form exits **1**. The implementer's vacuity claim is
true and the fix is real.

## Independent test run

**`npm test`** — one full run on HEAD:

```
ℹ tests 160
ℹ suites 15
ℹ pass 160
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ duration_ms 201705
```

Exit 0, 201.7 s. The known pre-existing e04s03 flake (`shutdown rejects late arrivals and keeps
health responsive`, `server.test.js:3809`) did **not** fire in this run. (The implementer's report
claims 175 s; mine took 201.7 s on this machine — machine-dependent, not a defect.)

**`npm run check`** — clean: ESLint over `server.js config.js budget.js server.test.js`,
`tsc -p tsconfig.json`, and Prettier `--check` over the five formatted files
("All matched files use Prettier code style!"). Exit 0, no findings, no rule silenced.

## Scope and hygiene

- `git diff --name-only ccae309..HEAD` → `budget.js`, `server.test.js`,
  `specs/epics/e04-rate-limiting/e04s05-tasks.yaml`,
  `specs/epics/e04-rate-limiting/briefs/e04s05-t03-report.md`. Exactly the four expected paths.
- Per commit: `d57dc76` → `budget.js`, `server.test.js`, `e04s05-tasks.yaml` (3 files);
  `d587e74` → the report only (1 file).
- Nothing out of scope was touched: `config.js`, `server.js`, `admission.js`, `package.json`,
  `README.md`, `AGENTS.md`, `CONVENTIONS.md`, `specs/state.yaml`, the story spec and every other
  spec doc are byte-identical to the base.
- **No runtime dependency**: `package.json` has no `dependencies` key; `budget.js` imports nothing
  (`grep -n "^import" budget.js` → no hit); `npm test` is still plain `node --test`.
- **`node_modules` was not committed**: `git ls-files | grep -c node_modules` → `0`.
- **Living-doc test counts correctly left alone** (count sync is task 5's job): `AGENTS.md:89`,
  `AGENTS.md:113`, `CONVENTIONS.md:17` ("runs all 141 tests"), `README.md:9`
  (`tests-141%20passing` badge), `specs/README.md:19` still say 141; no 153 or 160 was written
  into any living doc. Note for the orchestrator: `CONVENTIONS.md:83-90` says to sync the count
  "when a change adds or removes tests", so between now and task 5 the living docs are stale by
  design (the brief forbids touching them in task 3).
- **The ledger's other rows are untouched**: the diff on `e04s05-tasks.yaml` is exactly two changed
  lines, both in task 3's row; the story-level `status: failing` is unchanged; tasks 1, 2, 4 and 5
  keep their status.

## Report accuracy

Most of the report checks out against the code and my own runs: the commit table and per-commit file
lists; the base commit `ccae309`; the pre-task tree `68af45b` and its byte-identity with `ccae309`
(sha256 `41e8ca84…` / `69714882…`, verified); 153 → 160 tests and 15 suites (the pre-task file has
exactly 153 `test(` calls; my full run reports 160/15); the seven test names and their line numbers
(`4446, 4459, 4470, 4486, 4505, 4520, 4534` — all exact); the `server.test.js:6` import claim; the
D10 / D11 / D14 code blocks (byte-identical to `budget.js`); the gate output `rc=0 n=4` and the
matching `ok` lines (reproduced exactly); the yaml diff quote (exact); the ledger parse (story
`failing`; tasks 1–3 `passing`, 4–5 `failing`); the falsifiability outputs (pre-task `n=0`,
`gate_rc=1`, `old_gate_rc=1 count=1`, the rename-away demonstration `old_gate_rc=0 / strengthened
gate_rc=1`, and the 6-fail/1-pass tally — all reproduced verbatim in my own runs); the differential
global-path comparison; the `model_tpm` retryAfter of 1 on an empty model window; `npm run check`
clean; the `__proto__` claim; `server.js:20` being the wiring site; `server.js:138-140` being the
only reader of the reason; the "six of seven fail, test 4 is the control" statement; the fixture
disclosure; and "budget.js still reads no environment, starts no timer, and imports nothing".

**One claim is false** — should-fix 1: "the proxy's test bodies name **no** model … the e04s04
test … still passes after the wiring". `CHAT_BODY` names `nemotron`
(`server.test.js:4036-4039`), and the e04s04 test would fail on its **first** assertion after the
wiring (model `tpm: 1` vs a 1034-token body → `model_tpm` → 429). This is the only false statement
I found; it is a forward-looking note, not a claim about the implemented behavior, and it does not
affect any conclusion the report draws about task 3.

**One claim is imprecise**: the report's "One full run, 175 s" — mine took 201.7 s. Machine speed,
not a defect.

## What tasks 4 and 5 must know

- **Task 4 must change the e04s04 test's model fixture, not only its assertions.**
  `per-model limits are accepted and do not change global behavior` (`server.test.js:4274-4289`)
  configures `PROXY_MODEL_LIMITS_JSON: {"nemotron":{"rpm":1,"tpm":1}}` and posts `CHAT_BODY`
  (`server.test.js:4036`), which names `nemotron` and costs 1034 tokens. Once
  `server.js:20` becomes `createBudget(config.rateLimit, config.limits, config.modelLimits)`, the
  **first** request is rejected with `model_tpm` (verified by simulation: the e04s04 test's
  `assert.equal(res.status, 200)` fails). The ledger's task-4 wording ("two requests for a
  configured model with rpm 1 should result in the second being rejected 429") is only reachable
  with an rpm-only model entry or a cheaper body — `nemotron: {rpm: 1}` with a 10-token cost gives
  `admitted → {admitted:false, reason:"model_rpm", retryAfter:60}`. The report's contrary claim
  ("proxy bodies name none") is wrong; see should-fix 1.
- **The wiring itself is one line**: `server.js:20`
  `createBudget(config.rateLimit, config.limits)` → `createBudget(config.rateLimit, config.limits,
  config.modelLimits)`. `config.modelLimits` is already the null-prototype map `budget.js` expects
  (`config.js:153`), `createBudget` runs once at module load, and the model windows are built there
  (D4 from task 2).
- **The reason must stay internal** (D12): `server.js:140` copies `outcome.reason` into an internal
  object; the 429 body is the fixed `{ "error": "Too many requests" }` and the `Retry-After` header
  is the number the budget derived (`server.js:286-287`). The new reasons `model_rpm` / `model_tpm`
  are not logged and not serialized.
- **The disabled gate stays inert**: with no global rate pair, `createBudget` returns the disabled
  gate and no model window is ever built (`budget.js:336-349`) — "model limits without global pair
  has no effect" already holds; task 4 only needs to keep it true.
- **The model windows' `closed` flag stays unobservable** (D13, and should-fix 3): the global
  window refuses first, so a pin would need a seam on the returned budget.
- **Task 5 (count sync)**: the new total is **160**. The count sites are unchanged by task 3 and
  still say 141 (verified by grep, not by the AGENTS.md list, whose line numbers are stale):
  `AGENTS.md:89`, `AGENTS.md:113`, `CONVENTIONS.md:17`, `README.md:9` (badge
  `tests-141%20passing`), `README.md:111` (tip "Run the test suite (141 tests, no deps needed):"),
  `specs/README.md:19`, `specs/tech-architecture/tech-stack.md:172`,
  `specs/tech-architecture/TEST_PLAN_LATEST.md:44,294,351`, `specs/product/VISION_LATEST.yaml:20`,
  and `specs/epics/e04-rate-limiting/e04s01-config-owner-and-bind-host.md:345`.
  Two extra hits task 5 must not miss: `specs/epics/e04-rate-limiting/e04s04-tasks.yaml:79` greps
  for the literal strings `tests-141%20passing` / `all 141 tests` / `141 tests` / `(currently 141)`,
  and `specs/verifications/e04s04-verify.yaml:40,51,120` records the 141 count (a dated
  verification record — decide deliberately whether it is history or a living site).
  `AGENTS.md:115`'s own site list is stale on three points: it names `README.md:86` (actual 111),
  `specs/tech-architecture/tech-stack.md:168` (actual 172), and `specs/state.yaml` (which states no
  count at all). `plans/*.md` and `docs/research/config-invariant-guard-tests.md` stay untouched.
  The story-level ledger `status` stays `failing` until task 5.
- **Task 5 (ADR)**: `docs/adr/0002-config-operational-fail-fast.md` is the file the story's ADR
  amendment touches; nothing in task 3 changed a failure mode (the global gate's behavior is
  byte-identical, verified differentially), so the amendment records the model windows' semantics
  only.
- **The known e04s03 flake** (`shutdown rejects late arrivals and keeps health responsive`,
  `server.test.js:3809`, ~1 run in 26, reproduces on the pre-task tree) did not fire in my run but
  is still one flake away from red for the suite regardless of this task.
