# Task review — e04s01 / task 5: the buffered-body ceiling and the per-model limits map

- **Reviewed range:** `83fc7bc..7f94959` (code `2199159`, tests `21279f2`, count sync `b954b32`, report `7f94959`)
- **Branch / worktree:** `epic-14-config-owner`
- **Reviewer verdict:** **SHIP WITH FIXES.** No P0, no P1. Three P2, nine P3.
- **Worktree state on exit:** `config.js` restored byte-identically after every mutation (`cmp` against a
  pre-mutation copy, and `md5sum 80b59ad9a4eb49ece572580b0b62f62a`), `git status --porcelain` empty.
  This review file is the only file created or modified.

Everything below was verified by running it. The test suite was **not** used as evidence for any
behavior claim: an independent oracle (`~/scratch/probe.mjs` + `~/scratch/oracle.mjs`, nothing
committed) imports `config.js` directly in a child process and prints the resulting config object for
a 130-case env matrix, and separate bare-child spawns capture exit codes and raw stderr bytes.

---

## Axis 1 — Spec compliance, requirement by requirement

| # | Requirement | Verdict | Independent evidence |
| --- | --- | --- | --- |
| 1 | Ceiling reuses the existing integer guard, default 8388608, blank→default, `0` fatal, stored as `limits.maxBufferedBodyBytes` | PASS | 29-case ceiling matrix. Accept: absent, `""`, `"   "`, `" \t "`, `1`, `8388608`, `9007199254740991`, `007`→7, `" 4096 "`→4096, `"1\n"`→1. Reject (exit 1, `PROXY_MAX_BUFFERED_BODY_BYTES must be a positive integer, got: <value>`): `0`, `-1`, `1.5`, `.5`, `0.0`, `abc`, `9007199254740992`, `9007199254740993`, `1e3`, `1e+3`, `0x10`, `0b101`, `+5`, `1_000`, `1 000`, 30-digit run, Arabic-Indic digits, fullwidth digits. `config.js:118-120` routes through `readPositiveInteger` with default bounds; no second numeric guard was added. |
| 2 | New top-level `modelLimits`, null when absent/blank, not inside `limits` | PASS | `config.js:40`. Oracle: absent / `""` / `"   "` / `" \t "` → `modelLimits: null`, `maxBufferedBodyBytes: 8388608`. `{}` → `modelLimits: {}`. |
| 3 | All five named fatal shapes plus the two the story's principle covers | PASS | Every row of the brief's table reproduced, root and entry, each exit 1 and each naming `PROXY_MODEL_LIMITS_JSON` (or `PROXY_MODEL_LIMITS_JSON["<key>"]`). Also rejected: trailing comma, `NaN`, `undefined`, `0` as a root, `[[]]`, `{"gpt":{"rpm":null}}`, `{"gpt":{"rpm":[1]}}`, `{"gpt":{"rpm":{"a":1}}}`, `{"gpt":{"rpm":5e-324}}`, `{"gpt":{"RPM":5}}`, `{"gpt":{"rpm":5,"tpm":0}}`. Accepted as required: `{}`, `{"gpt":{"rpm":1e3}}`→`{"rpm":1000}`, `{"gpt":{"rpm":1.0}}`→`{"rpm":1}`, `{"gpt":{"rpm":9007199254740991}}`. |
| 4 | One reject, not per-row reporting; no partial acceptance | PASS | No collect-all mode exists. Both orderings exit 1 (see Axis 3). |
| 5 | No `try {} catch {}`; no catch that swallows and continues | PASS | One `catch`, at `config.js:144-146`, non-empty, calling `fatal` → `process.exit(1)`. The verify's own `/catch\s*\{\s*\}/` regex passes. Deviation D1 is declared in the report and is the correct resolution of a genuine contradiction — see Axis 6. |
| 6 | Keys stored byte for byte, never trimmed/lowercased/normalized; non-self-trimmed key fatal | PASS | Oracle stored-map output: `"__proto__"`, `"toString"`, `"constructor"`, `"hasOwnProperty"`, `"a\nb"`, `"a\"b"`, `"a\\b"`, `"\u001b[31mred\u001b[0m"`, `"模型"`, a 1000-char key, `"\u0001"` all stored verbatim. Rejected: `""`, `"   "`, `" gpt "`, `"gpt\t"`. |
| 7 | One integer guard, `typeof` first, no `Number()` on the value, comment explaining the asymmetry | PASS | `config.js:189-192`, in that order. The `"60"` case is the one that depends on the order and it is rejected. The comment at `config.js:183-188` states the asymmetry honestly. |
| 8 | Every fatal message names the variable and the location; **do not echo the whole document** | PARTIAL | Naming and location: PASS for all seven shapes, and each names the model key and/or field. The "do not echo the document" clause is violated on one path — see **P2 2.1**. |
| 9 | Blank beats parsing, in the other groups' order | PASS | `config.js:136` is the first statement after the raw read. Mutation M5 (below) proves a test sees this. |
| 10 | `readPositiveInteger` signature and `integerRule` wording unchanged | PASS | `config.js` is `99` insertions / `0` deletions — nothing existing was edited, so every pre-existing message is byte-identical by construction. Task 3's and task 4's exact-text assertions pass inside the 72. |

No scope creep. The two new helpers (`typeName`, `fatal`) are used only by `readModelLimits`, are
required by requirement 8's message contract, and add no dependency, no export, no seam.

### The settled decisions in `specs/state.yaml:93-113` were implemented, not re-opened

- reject an entry that supplies neither `rpm` nor `tpm` → `config.js:172`, tested
- reject an unknown key inside an entry → `config.js:177`, tested
- reject a key that is not equal to its own trimmed form → `config.js:163`, tested
- accept the empty-object root → tested
- `maxBufferedBodyBytes` in `limits`, not its own group → `config.js:118`, confirmed
- top-level `modelLimits`, separate from `limits` → `config.js:40`, confirmed
- `typeof` before the guard → `config.js:189`, confirmed
- scientific-notation rejection is an env-scalar property only → confirmed: `{"gpt":{"rpm":1e3}}` is
  accepted as 1000, `PROXY_MAX_BUFFERED_BODY_BYTES=1e3` is fatal

### The ten required test areas

1→test 1 · 2→test 2 · 3→tests 3 and 5 · 4→test 4 (own `INVALID_CEILINGS` table; task 4's tables
untouched) · 5→test 4's `zero` row, asserting the whole `must be a positive integer` text plus the
echoed value · 6→tests 6 and 7 · 7→tests 8–13 and 16 · 8→test 14 · 9→tests 15 and 16 · 10→`278 0`
numstat. All ten present.

---

## Axis 2 — Invariant contract

- **`server.js` byte-identical.** `git diff 83fc7bc..HEAD -- server.js | wc -l` → `0`.
- **`server.test.js` additive only.** `git diff 83fc7bc..HEAD --numstat -- server.test.js` →
  `278  0`. Zero deletions. The new block is a single contiguous append at `server.test.js:1131-1408`
  after the last existing line. No existing test edited, reordered, skipped or weakened; no
  `test.only` / `.skip` / `.todo` anywhere in the file; no existing stub or helper touched; no
  top-level declaration added, so no second seam.
- **No pre-existing variable's behavior changed.** `config.js` is `99  0`. `/health`'s shape, the
  auth path, path mapping, header fidelity and the two timeout constants are all unreachable from the
  diff.
- **Credential regime preserved.** Oracle: valid model-limits document with `NVIDIA_API_KEY` removed →
  `unconfigured: true`, process starts. A malformed document is fatal regardless of credentials,
  which is the intended operational fail-fast.
- **No dependency, no `package.json` change, ESM only, no lint/typecheck config invented.**
- **`whitespace` gate intact.** The new block contributes **zero** hits. The four hits in the file are
  at lines 549, 724, 809, 869 — all pre-existing. Task 6's gate is still falsifiable.

---

## Axis 3 — Independent oracle vs. the test suite

130 cases across five matrices. The suite and the oracle **agreed on every case both cover**. The
accept/reject set is right for the ceiling, for all five root shapes, for all entry shapes, for
ordering in both directions, and for the interaction cases. Two things the oracle found that no test
covers are filed as P2 2.1 and P2 2.2.

Ordering, both directions (the brief asked specifically):

```
REJECT  valid THEN invalid    {"good":{"rpm":5},"bad":{"rpm":0}}      → PROXY_MODEL_LIMITS_JSON["bad"].rpm must be a positive integer, got: 0
REJECT  invalid THEN valid    {"bad":{"rpm":0},"good":{"rpm":5}}      → PROXY_MODEL_LIMITS_JSON["bad"].rpm must be a positive integer, got: 0
REJECT  valid, invalid, valid {"a":…,"b":{"rpm":0},"c":…}             → PROXY_MODEL_LIMITS_JSON["b"].rpm must be a positive integer, got: 0
REJECT  valid THEN empty      {"good":…,"bad":{}}                    → PROXY_MODEL_LIMITS_JSON["bad"] must supply rpm or tpm
REJECT  valid THEN padded key {"good":…," bad ":…}                    → model key " bad " has surrounding spaces
```

The "never partially applied" requirement is genuinely honored by the code, and the invalid-after-valid
ordering is pinned by a test. The invalid-before-valid ordering is not in a test — but the code is
order-independent, because the only exit is `process.exit(1)` inside the loop. **P3 3.8**, not a gap.

Interaction:

```
ACCEPT  both valid                                                        ceiling=4096, modelLimits={"gpt":{"rpm":5}}
REJECT  ceiling invalid + limits valid                                    PROXY_MAX_BUFFERED_BODY_BYTES must be a positive integer, got: 0
REJECT  ceiling valid + limits invalid                                    PROXY_MODEL_LIMITS_JSON is not valid JSON: …
REJECT  limits valid + PROXY_RPM set alone                                PROXY_RPM and PROXY_TPM must be set together: PROXY_TPM is missing
REJECT  limits valid + PROXY_SAFETY_MARGIN_PCT=51                          PROXY_SAFETY_MARGIN_PCT must be an integer between 0 and 50, got: 51
ACCEPT  limits valid, no NVIDIA_API_KEY                                    unconfigured=true
```

`limits` is read before `modelLimits`, so when both are bad the ceiling's message wins. Deterministic
and fine.

---

## Axis 4 — Is the verify a real gate?

The brief's command, byte for byte, from the repo root:

```
VERIFY_RC=0
no new security findings in affected paths: model limits fail closed
ok-count = 17
```

Ten mutations applied to `config.js`, each followed by the verify verbatim and by the filtered TAP run
for attribution, then a byte-exact restore (`cmp` confirmed every time).

| # | Mutation | verify rc | Caught by |
| --- | --- | --- | --- |
| M1 | empty entry `fatal` → `continue` (fatal becomes non-fatal) | 1 | `…with an entry that supplies no budget…` |
| M2 | `field !== "rpm" && field !== "tpm"` → `field !== "rpm"` (**valid** tpm-only map becomes fatal) | 1 | `…well-formed budgets starts…`, `…still proxies normally…`, `…invalid rpm or tpm…` |
| M3 | ceiling ternary → constant `8388608` (stops being validated) | 1 | `PROXY_MAX_BUFFERED_BODY_BYTES rejects a non-blank invalid value…` |
| M4 | `typeof value !== "number"` fatal removed (invalid budget stored) | 1 | `…with an invalid rpm or tpm…` |
| M5 | `if (!raw?.trim()) return null` → `if (raw === undefined)` (blank reaches `JSON.parse`) | 1 | `…and PROXY_MODEL_LIMITS_JSON blank start and serve /health` |
| M6 | `!model.trim()` → `model === ""` | **0** | none — but see note |
| M8 | padded-key check narrowed to keys over 40 chars | 1 | `…model key that has surrounding spaces…` |
| M9 | unknown-field check skipped for non-first fields | 1 | `…entry that supplies no budget…` |
| P1 | `: 8388608` → `: 4194304` | **0** | none |
| P2 | `Object.create(null)` → `{}` | **0** | none |
| M7 | stored budget filed under the wrong key | **0** | none |

Both directions the brief required are covered: M1/M4/M5 turn a fatal case non-fatal, M2 turns a
valid map fatal, M3 turns the ceiling non-fatal. **The gate is real.** M1–M4 and P1/P2 reproduce the
report's table exactly, including the three-test attribution for M2.

M6 is a false positive worth recording: narrowing the blank-key check to `model === ""` leaves the
whole key family still rejected, because a whitespace-only key is then caught by the *padded* check
instead. Behavior is preserved, so the green verify is correct, not a hole. That the two key checks
overlap is a genuine robustness property of the implementation.

M7 is a third instance of the class the report already names correctly ("properties of the *stored*
config object, which the black-box child-process harness cannot read") — the substance is right, the
count is not. **P3 3.2.**

---

## Axis 5 — Test suite, count sync, and hermeticity

- `npm test` → `tests 72 · suites 6 · pass 72 · fail 0 · skipped 0 · todo 0`, 88.5 s. Matches the
  report.
- The brief's sweep, run from the repo root: **11 hits, every one reading 72** — `AGENTS.md:89`,
  `AGENTS.md:107`, `CONVENTIONS.md:17`, `README.md:9`, `README.md:86`, `specs/README.md:19`,
  `specs/product/VISION_LATEST.yaml:20`, `specs/tech-architecture/TEST_PLAN_LATEST.md:44,294,351`,
  `specs/tech-architecture/tech-stack.md:129`. Clean at 72; nothing left at 56 outside the
  exclusions.
- `docs/research/config-invariant-guard-tests.md` untouched. `plans/`, `LOG.md`, briefs untouched.
- **The sites the sweep cannot reach, checked by hand, are all true.** `AGENTS.md:106` reads
  "(currently 72)". `AGENTS.md:84`'s line inventory reads `server.js (~249)`, `config.js (~265)`,
  `server.test.js (~1408)`; `wc -l` returns exactly `249 / 265 / 1408`. Every line number in the
  `AGENTS.md:107` site inventory still points at the right line.
- **Ambient-environment hermeticity: measured, and it is an inherited harness property, not a
  task-5 defect.** `withProxy`/`runProxyOnce` merge `proxyEnv` over `process.env`, so an invalid
  ambient operational variable kills every test that spawns a proxy. Controls:

  | Ambient value | Result |
  | --- | --- |
  | `PROXY_SAFETY_MARGIN_PCT=51` (task 4, pre-existing) | 72 tests, **14 pass / 58 fail** |
  | `PROXY_RPM=5` (task 3, pre-existing) | 72 tests, **11 pass / 61 fail** |
  | `PROXY_MAX_BUFFERED_BODY_BYTES=0 PROXY_MODEL_LIMITS_JSON='{bad'` (task 5) | 72 tests, **14 pass / 58 fail** |

  Task 5's block behaves exactly like the two blocks before it. The tests that mean "absent" do pass
  `undefined` explicitly, and I confirmed Node's `spawn` drops `undefined`-valued env keys, so tests 1
  and 2 are genuinely absent even with the variables set. Nothing here is a task-5 finding; it is a
  story-wide harness property the epic should decide about once. **P3 3.10** for the record.

---

## Axis 6 — Report accuracy

Checked every claim that names a number or quotes output.

| Claim | My observation | Verdict |
| --- | --- | --- |
| `git diff 83fc7bc..HEAD -- server.js \| wc -l` → `0` | `0` | true |
| The quoted `parseConfig` return block and the quoted `limits` ceiling block | byte-identical to `config.js:33-45` and `config.js:113-120` | true |
| Stored shape: absent / blank → `8388608` + `null`; `4096` → `4096`; `__proto__` key survives | all four reproduced by the oracle | true |
| 16 new tests, names quoted verbatim | all 16 present, same order, same text | true |
| `278 0` numstat, purely additive | `278  0` | true |
| The "before" TAP block: `ok 1,2,3,5,6,7,15`, `not ok 4,8-14,16`, `# tests 16 / # pass 7 / # fail 9` | reproduced exactly from `21279f2`'s test file against `21279f2`'s `config.js` | true |
| "Every failure was `error: 'proxy process did not exit'`" | 9 occurrences in the before-run, one per failing test | true |
| Mutation table M1–M4, rc=1 each, with attributions | all four reproduced, attributions exact | true |
| P1 and P2 leave the verify at `0` | both reproduced | true |
| Count sweep "11 hits before, the same 11 after" | 11 before, 11 after | true |
| "The count of matching `ok` lines in that run is 16" | **17** — 16 tests plus the TAP suite line `ok 1 - buffered body ceiling and per-model limits` | **P3 3.1** |
| The quoted `SyntaxError` dump citing `config.js:141:23` | in the shipped file `JSON.parse` is at `config.js:143`, and the catch is present; this dump is from an uncommitted working-tree state between `21279f2` and `2199159`. The report labels it as the pre-D1 observation, so it is a dated record, not a fabricated line. | acceptable |
| "Left alone deliberately: …`specs/epics/` is an excluded path for this sweep" | true for *task 5's* sweep; **false for the gate that will catch it** | **P2 2.3** |
| "Two mutations of this task's own code leave the verify at 0" | at least three; M7 is a third | **P3 3.2** |

**Deviations D1–D5, judged:**

- **D1 (catch the parse failure to name the variable).** Correct, and the only possible resolution.
  Requirements 5 and 8 genuinely conflict: an uncaught `SyntaxError` cannot name
  `PROXY_MODEL_LIMITS_JSON`. The brief states requirement 5's *purpose* as "a `JSON.parse` failure
  must be fatal" and "no `catch` that swallows and continues", and the catch does neither. It reuses
  the shape `parseConfig` already uses for `NVIDIA_BASE_URL`. Honestly declared. No finding.
- **D2 (`Object.create(null)`).** Correct and better than the brief asked. Requirement 6 is about
  *normalization*, not container choice, and keys are still stored byte for byte (verified for
  `__proto__`, `toString`, `constructor`, `hasOwnProperty`). P2 mutation confirms the choice is
  load-bearing.
- **D3 (`Array.isArray` rather than bare `typeof`).** Required, not optional: `typeof []` is
  `"object"`. Without it two rows of the brief's own table would have been accepted. `typeName` keeps
  the message honest.
- **D4 (`fatal(name, problem)` helper).** Fine. **P3 3.7** on its partial adoption.
- **D5 (message wording).** All eight messages name the variable; the six entry-level ones name the
  model key. The `1.5` example matches the brief's example text. One wording nit in **P3 3.6**.

No deviation was silently re-opened, and no deviation was reported dishonestly. This is the first
task on this branch whose report I could not find a fabricated line in.

---

## Axis 7 — Security

`PROXY_MODEL_LIMITS_JSON` is the only place operator-supplied JSON is parsed, so I probed it hard.
**I do not believe there is a security finding here.** My reasoning, stated plainly:

- **Prototype pollution through the map: closed.** `JSON.parse` creates `__proto__` as an own data
  property, `Object.entries` sees it, and `limits` has a null prototype, so the assignment is a plain
  own-property create. Oracle confirms the key survives verbatim. The P2 mutation shows that a plain
  `{}` would lose it — the choice is correct and is the reason this class is closed.
- **Deeply nested input: no parse crash, no hang.** `JSON.parse` handled 20,000-deep nesting without a
  `RangeError`; the new code never recurses. The 20,000-deep *array* root is rejected on shape before
  anything walks it. A 360 KB document cannot be passed at all — Linux caps a single `env` argument at
  128 KiB and the spawn fails `E2BIG`. I found no input that makes the proxy accept a document it
  should reject.
- **Terminal confusion from keys and values: real but not a vulnerability.** A model key containing a
  newline, a `"`, or an ESC sequence lands on stderr raw — I have the bytes:
  `PROXY_MODEL_LIMITS_JSON["a\nb"].rpm must be a positive integer, got: 0` is 70 bytes containing a raw
  `0x0a`; an ANSI-colored key produces a raw `0x1b`. The operator supplies the value, on their own
  machine, and reads their own stderr. No privilege boundary is crossed, so this is a log-hygiene
  note, filed as **P3 3.6**, and I am not inflating it.
- **Document leakage into stderr: bounded, and the brief asked for it.** V8's parse message does carry
  a slice of the input (`Unexpected token 'x', "xxxxxxxxxx"... is not valid JSON`), but requirement 8
  explicitly says to "let the parser's own message carry the position", and the slice is capped by V8
  at roughly 10–16 characters. That is the brief's design, not a leak. The genuinely unbounded case is
  the implementer's own `JSON.stringify`, which is **P2 2.1**.
- **Credential regime.** Untouched, and confirmed still degrading rather than exiting.

---

## Findings

### P0 — none

### P1 — none

I attacked this specifically on the axes that produce P1s on a P0-risk prefactor: a fail-open the
suite does not catch, a message contract the code breaks, a test that asserts less than its name
claims, a test that passes for an unrelated reason, a mutation the gate misses, and a number in the
report that no command prints. The one real fail-open I found (P2 2.2) is not a requirement the brief
enumerated and is not asserted by any test, so it is a completeness gap in the report rather than a
defect against a stated contract. The one message-contract break (P2 2.1) still fails closed. I found
no test that passes for an unrelated reason: every fatal case in the new block passes a valid
`NVIDIA_BASE_URL` and both credentials, so an exit 1 can only be the variable under test. I would have
expected a P1 on a task of this size; I did not find one, and I pushed on the deepest-nesting,
duplicate-key, prototype-pollution and 128 KiB-document paths specifically to try to earn it.

### P2

**2.1 — The fatal message for a non-number budget value can crash the error path, and below the
crash threshold it echoes up to ~36 KB of the operator's document onto one stderr line.**
`config.js:190`.

```js
fatal(`PROXY_MODEL_LIMITS_JSON["${model}"].${field}`,
      `must be a positive integer, got: ${JSON.stringify(value)}`);
```

Two symptoms, one cause. `JSON.stringify` recurses into the offending value with no bound.

- **Crash.** `PROXY_MODEL_LIMITS_JSON='{"gpt":{"rpm":' + '{"a":'.repeat(7000) + '1' + '}'.repeat(7000) + '}}'`
  — a 42 KB env var, well under the 128 KiB per-argument cap — produces:

  ```
  file:///…/config.js:190
          fatal(`PROXY_MODEL_LIMITS_JSON["${model}"].${field}`, `… ${JSON.stringify(value)}`);
                                                                                     ^
  RangeError: Maximum call stack size exceeded
      at JSON.stringify (<anonymous>)
      at readModelLimits (file:///…/config.js:190:104)
  ```

  The threshold is between 6,500 and 7,000 levels of object nesting (39–42 KB); nested arrays reach it
  at roughly double the depth. The `try/catch` at `config.js:144-146` covers `JSON.parse` only, so
  this escapes the fatal path entirely: exit 1, but a raw Node stack dump instead of the message that
  names the variable and the offending field. Requirement 8 asks for the opposite.
- **Echo.** Below the threshold the same line emits the value verbatim: depth 2,000 (a 12 KB document)
  puts **12,070 bytes on a single stderr line**; depth 6,500 puts 39 KB. Requirement 8 says plainly
  "**Do not echo the whole document** into stderr", and the `typeName` comment three lines above
  (`config.js:198-201`) states the right rationale for the sibling path — "its type rather than its
  text, because an entry can be an arbitrarily large document" — which this line then contradicts.

*Why it matters:* the code whose job is to explain a rejection is the thing that can crash or flood,
so the operator gets the least useful output in exactly the case where the document is pathological.
The outcome stays fail-closed (exit 1, nothing listens), which is why this is P2 and not P1. It also
means a test asserting only `stderr.includes("PROXY_MODEL_LIMITS_JSON")` would *pass* against the
crash dump, because the dump quotes the source line containing that string.

*Smallest fix:* use the helper that already exists. `typeName(value)` for the type, and echo the text
only for primitives, bounded — e.g. `got: ${typeName(value)}` for objects and arrays, and keep
`JSON.stringify(value)` for `null`/booleans/strings. That closes both symptoms, removes the
contradiction with the comment, and costs three lines. A test asserting a deeply nested value exits 1
*and* names the variable would pin it.

**2.2 — A duplicate top-level model key is silently accepted, last-wins, and a budget the operator
wrote disappears without a word.**
`config.js:155-194`. Oracle:

```
ACCEPT  {"gpt":{"rpm":1},"gpt":{"tpm":2}}   →  modelLimits={"gpt":{"tpm":2}}
```

The operator wrote an `rpm` budget for `gpt`; the stored map has no `rpm`; the proxy starts normally
and says nothing. Duplicate keys in a JSON config are the classic copy-paste-and-merge accident, and
this is the same failure class the same commit makes fatal one branch away: `config.js:177` rejects
`{"gpt":{"rps":5}}` precisely because "a misspelled 'rps' would otherwise vanish and leave the
operator believing the model is capped". A duplicated key vanishes identically. The story states the
rule twice (§2 "a silently dropped model limit is a budget that appears to exist and does not";
§13 "Malformed input must be fatal, never partially applied"), and the code comment at
`config.js:126-129` invokes that rule by name — so the implementation is inconsistent with its own
stated standard here.

*Why it matters:* this is the one variable whose entire reason to exist is fail-closed validation, and
this is a silent partial application of it. `JSON.parse` gives no hook for duplicates, so the gap
cannot be closed by a guard alone.

*Why P2 and not P1:* the brief's requirement-3 table does not list duplicate keys, and
`specs/state.yaml:93-113` derives exactly two shapes from the principle (empty entry, unknown key) and
does not mention this one. The implementer implemented the specified contract. What is not acceptable
is that the report presents "never partially applied" as satisfied and enumerates its own coverage
holes without mentioning this, and the brief's definition of done requires the report to be accurate.
*Smallest fix:* two lines in the report's "Not done, and why" and in the coverage-hole table, routed
to task 7's ADR 0002 alongside P1/P2 — the same class, the same destination. If the orchestrator wants
it closed in code, a top-level key-count check before the loop is the honest fix; I would not accept a
regex over the raw text, which false-positives on nested keys.

**2.3 — The report's reason for leaving the story file's "56 tests" is wrong about the gate that will
catch it, so the orchestrator is being told not to fix it.**
`specs/epics/e04-rate-limiting/briefs/e04s01-t05-report.md:280-285`.

The report says: *"`specs/epics/` is an excluded path for this sweep, task 5 does not own the story
file"*. That is true of **task 5's** sweep and false of the one that matters. Task 12's verify in
`e04s01-tasks.yaml` excludes only `specs/epics/.*/briefs/` and `specs/epics/.*-tasks\.yaml`. I ran
task 12's exact filter against the current tree:

```
$ grep -rnE 'tests(-| )?[0-9]{2,4}|[0-9]{2,4}[ -]?tests?' --include='*.md' --include='*.yaml' . \
    | grep -vE '^\./(plans/|docs/research/|LOG\.md|specs/epics/.*/briefs/|specs/epics/.*-tasks\.yaml)' \
    | grep -vE 'tests(-| )?72|[^0-9]72[ -]?tests?'
./specs/epics/e04-rate-limiting/e04s01-config-owner-and-bind-host.md:336:- Refactor regression in working code → detected by the unchanged existing suite (56 tests)
```

`…e04s01-config-owner-and-bind-host.md:336` is the **sole remaining hit**, so **task 12's verify fails
today** unless that line changes. *Why it matters:* the report does flag the line for routing, which
is good, but hands the orchestrator a reason that reads as "no gate will ever see this". *Smallest
fix:* correct the reason in the report. The edit itself is a one-word change (`56` → `72`) and belongs
to task 12, which owns the story file's count; leaving it is a legitimate scoping call, misdescribing
it is not.

### P3

**3.1 — The report's `ok`-line count is 16; the command prints 17.**
`…-t05-report.md:169-171`. The 17th is the TAP suite line `ok 1 - buffered body ceiling and per-model
limits`. The report's substantive point ("comfortably over the required 1") is unaffected, and no
downstream consumer reads the number. Same class as the miscounts in the task-4 review, and this time
the direction is an undercount of something larger than claimed.

**3.2 — "Two mutations of this task's own code leave the verify at 0" undercounts the class.**
`…-t05-report.md:216-231`. I found a third: filing the stored budget under the wrong key
(`budget[field]` → `budget[field === "rpm" ? "tpm" : "rpm"]`) leaves the verify at 0. The report's
*diagnosis* is exactly right — the stored config object is invisible to the black-box harness, so no
test in this file could catch it — and the correct routing (task 7's ADR 0002) is already named. Only
the enumeration is incomplete, and the sentence is phrased as a closed set. Not a hidden gap.

**3.3 — The report's own D5 table and the code comment present unbounded stderr output as intended.**
`…-t05-report.md:336-340` lists `got: 1.5` under "message wording for the seven rejection shapes"
without noting that the same expression is unbounded for object and array values. This is P2 2.1 seen
from the documentation side; filed so the ADR and the report are fixed together.

**3.4 — `CONVENTIONS.md:33-34` carries a stale line inventory this task made worse.**
It reads `server.js` ~294 lines (actual 249) and `server.test.js` ~705 lines (actual 1408, and 1408
includes the 278 lines this task added). Both were already wrong before this task, and task 9 owns
`CONVENTIONS.md` — but the implementer took ownership of the parallel inventory at `AGENTS.md:84` on
the brief's instruction and updated it, so leaving this one is an inconsistency inside a single task's
doc pass. The report does not flag it. A one-line fix in task 9.

**3.5 — `"PROXY_MAX_BUFFERED_BODY_BYTES at its boundary values starts and serves /health"` includes a
row that is not a boundary.**
`server.test.js:1224-1235`, row `{ PROXY_MAX_BUFFERED_BODY_BYTES: " 4096 " }`. The assertion is
correct — `readPositiveInteger` trims, so `" 4096 "` → `4096`, consistently with every other ceiling —
but the row is a *padding* case, and the name does not mention it, so the padding acceptance is pinned
only by a test that does not claim to test it. The other three rows (`1`, `8388608`,
`9007199254740991`) are genuine boundaries. I would have written the row as a fifth case in the blank
test or split it out; the behavior is right either way, so this is a naming note, not a defect. Task
4's boundary test has the same looseness (`PROXY_MAX_QUEUE_SIZE: "32"` is the default, not a bound),
so this is house style as much as anything.

**3.6 — Control characters in a model key are accepted, stored, and echoed raw into a fatal message.**
`config.js:163`, `config.js:190`. `{"gpt\u0001":{"rpm":0}}` and `{"\u001b[31mred\u001b[0m":{"rpm":0}}`
both produce a fatal message carrying the raw byte (verified: `0x0a`, `0x1b`, `0x01` on stderr). The
implementer rejects padded keys on the grounds that they "can never match a model ID"; the same
argument covers a control-character key, and the standard applied is inconsistent. There is no
security consequence — see Axis 7 — so this is a log-hygiene and consistency note. If it is worth
anything, the cheapest version is to reject a key containing a C0 control character, which also makes
stderr single-line by construction.

**3.7 — `fatal()` is adopted by one of four call sites.**
`config.js:206-209`. `parseConfig` (three places), `readRateLimit` and `readPositiveInteger` all still
open-code `console.error(...)` + `process.exit(1)`. Adopting it in `readPositiveInteger` would not
change any message text, so requirement 10 would hold — but "surgical patch" argues for not touching
lines the brief told the implementer to leave alone, and the partial adoption is the right call here.
Noted only so the file's mixed shape reads as deliberate rather than as an oversight.

**3.8 — "Never partially applied" is pinned for one entry ordering only.**
`server.test.js:1378-1389` uses `{"gpt-4o-mini":…,"gpt":{"rpm":0}}` — the invalid entry last. The
invalid-first ordering is not in a test. The code is order-independent (the only exit is
`process.exit(1)` inside the loop) and I confirmed by oracle that `{"bad":…,"good":…}` exits 1 naming
`bad`, so there is no defect — but the pin is one-sided, and a future refactor that collected valid
entries before validating would pass the existing test. Adding the mirrored row to the same table
costs one line.

**3.9 — No Unicode normalization on model keys.**
`config.js:194`. Keys are stored byte for byte as the brief requires, so `é` as U+00E9 and
`e` + U+0301 are two distinct models, and a lookalike pair (`ﬀ` vs `ff`, Cyrillic `а` vs Latin `a`)
also stays distinct. All correct per the contract and worth knowing before a later slice does a map
lookup against a model ID taken from a request body. Not a defect; recording it because the review
brief asked me to probe lookalikes and the answer is "the code is right and the trap is downstream".

**3.10 — The suite is not hermetic against ambient operational variables, and this is inherited.**
Measured in Axis 5: `PROXY_SAFETY_MARGIN_PCT=51` (task 4) and `PROXY_RPM=5` (task 3) collapse the
suite exactly as hard as task 5's two variables do (58 and 61 failures against 58). The new tests do
what the brief requires — pass `undefined` for "absent" — and I confirmed Node's `spawn` drops
`undefined`-valued env keys, so the absent and blank tests are genuinely absent even with the
variables set in the shell. Not a task-5 finding; recorded because the epic will hit it in CI
(e01) and should decide once, at the story level, whether `npm test` should scrub the operational
namespace before spawning.

---

## Verdict

**SHIP WITH FIXES.**

No P0 and no P1. All ten brief requirements are met in the code, with one bounded exception to
requirement 8's "do not echo the document" clause that is filed as P2 2.1. The two settled
`specs/state.yaml` decisions were implemented as recorded and not re-opened. `server.js` is
byte-identical, `server.test.js` is `278  0` in one contiguous append, no dependency, no second seam,
`server.js`'s `/health`, auth, path-mapping and header behavior are unreachable from the diff, and
the credential regime still degrades. `npm test` is 72/72 green. The brief's verify exits 0 and is a
real gate: it went non-zero under seven of my ten mutations, in both the fatal-becomes-non-fatal and
valid-becomes-fatal directions, and its two known blind spots (the stored default and the
null-prototype container) are correctly identified. The count sweep is clean at 72 across all eleven
living-doc sites, and the three places the sweep cannot reach are all true.

The report is substantially honest — every test name, the `278 0` numstat, the `7 pass / 9 fail`
before-block and its exact per-test ok/not-ok assignment, all four mutation attributions, both
coverage holes, and all sixteen stored-shape lines reproduce. It contains no fabricated output line,
which is not something I can say about the previous task on this branch. Its two defects are a
one-off `ok`-count (P3 3.1) and a misdescribed exclusion that will make task 12 fail if believed
(P2 2.3).

**Must be fixed before the story ships, none blocking this task:**

1. **P2 2.3** — correct the reason in the report. The story file's "56 tests" is caught by task 12's
   verify, not excluded from it. Route the one-word edit to task 12.
2. **P2 2.1** — use `typeName` for object and array values at `config.js:190`, keeping the primitive
   echo bounded. Add one test: a deeply nested value exits 1 *and* names the variable, which also
   stops a future test from being fooled by a stack dump that quotes the source line.
3. **P2 2.2** — add the duplicate-key hole to the report's coverage-hole list and route it to task 7's
   ADR 0002 next to P1 and P2. Optionally close it in code with a top-level key-count check.

**Recommended, not required:** fold P3 3.4 into task 9's `CONVENTIONS.md` pass; soften or re-file the
`" 4096 "` row (3.5); add the mirrored ordering row to the never-partially-applied table (3.8); fix
the `ok`-count in the report (3.1) and widen the coverage-hole sentence to "at least three" (3.2).
Decide the ambient-env question once for the story (3.10).
