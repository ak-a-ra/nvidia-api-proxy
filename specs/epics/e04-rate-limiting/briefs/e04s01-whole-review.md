# e04s01 — whole-branch review

* Branch: `epic-14-config-owner`
* Worktree: `/data/data/com.termux/files/home/workspace/epic-14-config-owner`
* Merge base with `origin/main`: `4cc7fc6`
* Branch commits ahead: 47 · behind `origin/main`: 13
* Story: `specs/epics/e04-rate-limiting/e04s01-config-owner-and-bind-host.md` (issue #14)
* Reviewed: 2026-10-01 · Node v24.18.0 · `npm test` 82/82 green

## Verdict

**SHIP WITH FIXES.** No P0. The refactor is clean, the config owner is the right shape, the security
story holds, and the suite is genuinely falsifiable on the three behaviors that matter. One P1 is a
merge-time obligation, not a code defect. Everything else is a P2 nit, and four of the six known
open defects are documented accepted gaps whose classification this review agrees with.

---

## Findings

### P1

**F1 — Post-merge test count will be 84, and the merge conflicts with `main` in 7 files.**
`git merge-tree --write-tree origin/main HEAD` reports content conflicts in `AGENTS.md`,
`CONVENTIONS.md`, `README.md`, `specs/README.md`, `specs/product/VISION_LATEST.yaml`,
`specs/tech-architecture/TEST_PLAN_LATEST.md`, `specs/tech-architecture/tech-stack.md`. `main`
added two tests since the merge base (`2b13861`: `unauthenticated request gets 401 (not 503) when
only the proxy token is missing`, `whitespace-only proxy token counts as missing (401 + health
503)`); neither is on this branch (`grep -c` returns 0 for both in `server.test.js`). Every living
count site states 82, and the merged suite is 82 + 2 = 84. Issue #14's acceptance criterion
"every living test-count document is synchronized after the verified suite total" is therefore
satisfied on the branch and broken on merge. It self-heals in one command — re-run task 12's
verify after resolving the conflicts; the gate derives N from `npm test` rather than trusting a
literal. Fix before merge, or as the first step after.

### P2

**F2 — `readPositiveInteger` echoes the offending scalar with no bound.**
`config.js:267` — `` console.error(`${name} must be ${integerRule(...)}, got: ${trimmed}`) ``.
Measured: `PROXY_RPM` set to a 100,000-character digit run produces **100,044 bytes on one stderr
line**; `PROXY_MAX_QUEUE_SIZE` with 2,000 digits produces 2,055 bytes. `describeValue`
(`config.js:228-233`), one function below, bounds a primitive at 60 characters with an ellipsis, and
ADR 0002 §"Standing rule" generalizes the bound to "any future fatal path that formats
operator-supplied data". The scalar path is the current fatal path and does not inherit it. Not a
crash, not a secret leak, exit code still 1 — an inconsistency with the branch's own stated
standard, and a one-line fix (route the scalar through the same bound).

**F3 — Story §11 invariant "Fatal operational values exit 1 with stderr naming the variable" is not
met for `PROXY_HOST`.** Verified: `PROXY_HOST=10.255.255.1` exits 1 with **0 occurrences of the
string `PROXY_HOST` in stderr** and a 16-line Node stack dump (`node:events:487 / throw er; //
Unhandled 'error' event / Error: listen EADDRNOTAVAIL ...`). ADR 0002 §Consequences documents this
honestly as inconsistent with the rest of the file, but nothing reconciles it with §11, and the
closing commit does not list it as a §11 exception. Cheapest fix is a `server.on("error", …)`
handler in `server.js` that names `PROXY_HOST` before `process.exit(1)`. Failing closed today, so
not a blocker.

**F4 — Story file header still says the story is failing.**
`specs/epics/e04-rate-limiting/e04s01-config-owner-and-bind-host.md:6` reads `* Status: failing`
while `e04s01-tasks.yaml:4`, `epic.yaml:15`, and `specs/execution-status.yaml` all read `passing`.
Sibling capsules (`e01s01`, `e02s01`, `e03s01`) say `todo` and their ledgers say `todo`, so the
header field is not maintained by convention — but this branch rewrote the same file's count for
exactly this class of drift, so the asymmetry is its own.

**F5 — `server.test.js:1569` claims case sensitivity it cannot observe.** The test's comment says
"two that differ only in case are two distinct models and both survive, so no lowercasing happens";
its only assertion is `res.status === 200`. Proved by mutation: lowercasing every model key in
`readModelLimits` leaves the test green (`ok 1 - PROXY_MODEL_LIMITS_JSON model keys are
case-sensitive and unnormalized`, `# pass 1 / # fail 0`). ADR 0002 §Compliance lists that test name
under "Pinned by tests" without the reviewed-by-eye caveat, so the ADR inherits the overclaim. The
behavior itself is correct — the code stores keys byte for byte.

**F6 — `CONFIG_ENV_VARS` completeness is documentation only.** The test at `server.test.js:1682`,
"childEnv strips the variables the proxy reads and inherits the rest", iterates the same
`CONFIG_ENV_VARS` list `childEnv` consumes, so it cannot detect a variable added to `config.js` and
not to the list. Proved both directions: deleting the strip loop fails the test (falsifiable against
`childEnv` itself), while adding `PROXY_FUTURE_CEILING` to `config.js` and setting it ambient
leaves all four isolation tests green. ADR 0002 §Consequences and `AGENTS.md` both state the rule
in prose; nothing enforces it. Accepted as documented.

**F7 — `specs/execution-status.yaml` records `e01s01: todo` and `e02s01: todo`** although both
shipped on `main` (`1bc34cd` CI workflow, `2b13861` token-side config guards). The merge does not
touch this file, so the inconsistency survives the merge.

**F8 — `specs/release-plan.yaml` bugs block is factually wrong.** It reads "All 11 closed issues
#2-#8, #11 were closed by direct fix". `gh issue list --state all` returns 10 closed issues:
#2, #3, #4, #5, #6, #7, #8, #10, #11, #12. The enumerated range omits #10 and #12 and the count is
off by one.

**F9 — "`server.js` is byte-identical to pre-story main" is a false literal claim.**
`specs/state.yaml` handoff note and the `LOG.md` task-11 entry both use it. `server.js` is 8
insertions / 53 deletions against the merge base (config extraction, the `readSeconds` move, the
`export` re-shape, and `server.listen(PORT, "0.0.0.0")` → `server.listen(PORT, config.host)`). The
HTTP handler body is untouched, which is what matters — "byte-equivalent in effect" is the true
statement.

**F10 — Line inventory stale in two places.** `CONVENTIONS.md:35` and `AGENTS.md:85` both say
`server.test.js` ~1553 lines; actual is 1697. `server.js` (~249) and `config.js` (~303) are
correct. Tasks 11 and 12 added tests after task 9 wrote the inventory.

**F11 — Story §19 names `perf-bench.js` as a caller of `server.js`.** The file does not exist in
the repository, in the branch or on `main`. Introduced by the branch's own capsule commit `e801016`.

**F12 — `specs/state.yaml` `vcs.commit: cbf4f8f`** is a mid-branch commit (task 3's doc follow-up),
not `HEAD` `a6e2c94`. The session pointer is stale in the file whose whole job is to say where the
work stopped.

**F13 — `specs/state.yaml:11` `vcs.worktree: ../epic-14-config-owner`** is a relative path that
resolves to a sibling of the repo root, not to the worktree from any directory inside the repo.
Cosmetic; ignore or make it absolute.

**F14 — Story §4 precondition still reads "Suite green at 34/34"** while §21 reads "82 tests". The
task-12 gate cannot see `34/34` (its regex needs `tests` adjacent to the digits), so this is
defensible as a record of the precondition at authoring time. Low weight, and arguably correct —
noted only because the same file's count *was* edited for the same class of drift.

---

## Story coverage

### §17 Gherkin scenarios — all nine verified

| Scenario | Result | Evidence |
| --- | --- | --- |
| Default host preserves current behavior | PASS | `server.test.js:757` asserts `server.address().address === "0.0.0.0"` for unset, `""`, and `"   "`; full suite green |
| Loopback-only binding works | PASS | `server.test.js:745` asserts the bound address is `127.0.0.1`; `server.test.js:770` asserts gzipped body byte-identical, `content-encoding: gzip` forwarded, `Bearer pt-secret` → `Bearer sk-test`, `/v1/chat/completions?stream=true` verbatim, `/health` 200 `{status:"ok"}` |
| Rate limiting disabled when both absent | PASS | `server.test.js:832`, `:842` (blank/empty/whitespace-only) |
| Exactly one rate variable is fatal | PASS | `server.test.js:886`, `:893`, `:902` — exit 1, stderr names both variables |
| Malformed operational values are fatal | PASS | `server.test.js:1101` (`"abc"` on each of the four), `:1128` (margin 51) |
| Malformed model limits are fatal | PASS | `server.test.js:1412` (`"{not json}"`) |
| Blank operational value is absent, not zero | PASS | `server.test.js:842` (`PROXY_RPM=" "`, `PROXY_TPM=" "`) |
| Credential degradation is unchanged | PASS | pre-existing `server.test.js:310`, `:331`, `:320` (401 before 503) still green |
| No new test seam | PASS | `server.js` exports `default`, `CONNECT_TIMEOUT_SECONDS`, `IDLE_TIMEOUT_SECONDS` only; `server.test.js` never imports `config.js` (two comment-only mentions) |

### §2 delta requirements

* `MODIFIED: single internal owner` — PASS. `parseConfig(env)` in `config.js`; `server.js` keeps no
  parsing. Shape `baseURL`/`apiKey`/`proxyToken`/`unconfigured` preserved verbatim.
* `MODIFIED: configurable bind address` — PASS. `config.host` from `PROXY_HOST`, default `0.0.0.0`,
  consumed at `server.js:237`.
* `MODIFIED: strict numeric parsing` — PASS. `readSeconds` leniency preserved byte-for-byte for the
  two timeout variables; all nine new variables go through `readPositiveInteger`.
* `ADDED: mandatory rate pair` — PASS.
* `ADDED: operational limit variables` — PASS; defaults `32` / `30` / `5` / `8388608` present in
  code, eye-reviewed only.
* `ADDED: per-model limits rejected whole` — PASS, and stronger than the story's enumerated list
  (padded keys, control characters, empty entries, unknown fields also fatal).
* `ADDED: six domain terms in `CONTEXT.md`** — PASS, all six, plus a note that they name limits the
  proxy does not yet enforce.

### Other numbered sections

* §4 Preconditions — the "34/34" claim was true at authoring; see F14.
* §6 Constraints — PASS on all four: zero deps, ADR 0001 credential regime untouched, no limiter
  internals exported, `0.0.0.0` default load-bearing. The CONVENTIONS.md/AGENTS.md contradiction is
  resolved as the story requires.
* §7 Glossary — PASS.
* §8 Interfaces — the 9-row table matches `config.js` for every default and every invalid rule.
  The `PROXY_HOST` row's "fatal on malformed value" holds in effect (exit 1) but not in message
  discipline (F3). `config.js` exports three symbols, not "one entry point" — the two extra are
  pre-existing exports that moved from `server.js`, which §19 explicitly requires to survive.
* §9 Configuration — PASS. Read once at import; `.trim()` truthiness gates every group before any
  numeric or JSON parse.
* §10 Data and state — PASS. No counters, no queue state.
* §11 Invariants — 4 of 5 hold. The failure is "Fatal operational values exit 1 with stderr naming
  the variable" for `PROXY_HOST` (F3). "Every pre-existing test passes unchanged" holds.
* §12 Failure modes — all four closed and, importantly, three of them falsifiable (see mutations).
* §13 Security — PASS on all four. `PROXY_HOST` changes nothing but the listener (diff-proven);
  model-limits input is fatal-or-accepted whole; no config value reaches a response body
  (`server.js` writes only static JSON bodies); credential degrade and 401-before-503 preserved.
* §14 Observability — PASS. `/health` shape unchanged; the startup log line still omits the host.
* §17 §18 §19 §20 §21 — no out-of-scope behavior implemented; no dependency introduced.

### Could not test

* **The stored values themselves.** The stored defaults `32` / `30` / `5` / `8388608`, the `null`
  that disables the concurrency ceiling, the `null` that means "no per-model budgets", the
  null-prototype map, and the `rateLimit` / `limits` shapes are unreachable through the
  black-box harness by design. ADR 0002 §Coverage states this accurately; this review confirms the
  statement is honest, not that the values are right. They were read by eye.
* **Model-limits documents beyond the env arg limit.** My 70,000-deep and 5 MB probes failed with
  `Error: spawn E2BIG` before reaching the parser. The suite's own 2,000-deep, 7,000-deep, and
  5,000-character cases pass, which covers the `RangeError` regression ADR 0002 documents.
* **The dead `integerRule` branch** (`"a non-negative integer"`) — no caller, so nothing to observe.
  Confirmed by reading every `readPositiveInteger` call site.
* **Post-merge state** — not merged, per instructions.

---

## What I verified by running

**Full suite, clean:** `ℹ tests 82 / ℹ pass 82 / ℹ fail 0`.

**Full suite under a hostile ambient environment** (`PROXY_SAFETY_MARGIN_PCT=51 PROXY_RPM=5
PROXY_TPM=5 PROXY_MAX_QUEUE_SIZE=0 PROXY_MAX_BUFFERED_BODY_BYTES=0 PROXY_MODEL_LIMITS_JSON={'
PROXY_HOST=10.255.255.1 PROXY_AUTH_TOKEN=ambient NVIDIA_BASE_URL=https://evil.invalid/v1`):
`ℹ tests 82 / ℹ pass 82 / ℹ fail 0`. Task 11's hermeticity claim is genuine, not asserted.

**All twelve task verify commands re-run from `e04s01-tasks.yaml`:** T1 PASS, T2 PASS, T3 PASS,
T4 PASS (`ok count=13`), T5 PASS (`ok count=20`), T6 PASS (`matching=3`), T7 PASS, T8 PASS,
T9 PASS, T10 PASS, T12 `derived N=82` / `badge ok` / `count ok: 82 across the living docs`. T11
smoke: `SMOKE OK: loopback bind, health, and pass-through all reachable`, exit 0.

**Mutation experiments** (throwaway copy outside the worktree, since deleted; worktree
`git status --porcelain` empty afterward):

| # | Mutation | Target test | Result |
| --- | --- | --- | --- |
| M1 | drop `/^[0-9]+$/` from `readPositiveInteger` | `reject 1e3 and 0x10 while accepting the same values in decimal` | **`not ok 1`** — falsifiable |
| M2 | `hasQueueSize`/`hasQueueTimeout` test `!== undefined` instead of `.trim()` truthiness | `PROXY_MAX_QUEUE_SIZE and PROXY_QUEUE_TIMEOUT_SECONDS whitespace-only starts and serves /health, where 0 is fatal` | **`not ok 1`** — falsifiable |
| M3 | invalid model-limits entry silently `continue`d (fail-open, partial apply) | `with one valid and one invalid entry exits 1 (never partially applied)` | **`not ok 1`** — falsifiable |
| M4 | lowercase every model key | `model keys are case-sensitive and unnormalized` | `ok 1` — **not falsifiable**, F5 |
| M5 | remove the `delete env[name]` loop from `childEnv` | `childEnv strips the variables the proxy reads…` | `not ok 1` — falsifiable against itself |
| M6 | add `PROXY_FUTURE_CEILING` to `config.js`, not to `CONFIG_ENV_VARS`, set ambient | all four `harness environment isolation` tests | `ok 1..4` — **not falsifiable for completeness**, F6 |

**`PROXY_HOST` failure modes, run directly:**
```
PROXY_HOST=" 127.0.0.1 "    → Error: getaddrinfo ENOTFOUND  127.0.0.1        exit=1
PROXY_HOST="10.255.255.1"   → Error: listen EADDRNOTAVAIL: address not available 10.255.255.1  exit=1
PROXY_HOST="::1"            → binds;  "localhost" → binds
```
stderr for the unbindable case: 16 lines, 0 occurrences of `PROXY_HOST`.

**Fatal-message bounds:** 100k-digit `PROXY_RPM` → `stderr_bytes=100044 lines=1`; 2k-digit
`PROXY_MAX_QUEUE_SIZE` → `stderr_bytes=2055 lines=1`. F2.

**Prototype pollution:** `PROXY_MODEL_LIMITS_JSON='{"__proto__":{"rpm":5},"constructor":{"rpm":6}}'`
starts; `Object.keys(modelLimits)` is `['__proto__','constructor']`,
`Object.getPrototypeOf(modelLimits) === null`, and `({}).rpm === undefined`. The null-prototype map
holds both keys as own properties and pollutes nothing.

**Regressions / additive-only discipline:** `git diff 4cc7fc6..HEAD -- server.test.js | grep '^-'`
returns exactly three lines, all harness plumbing (`{ ...process.env, ...extraEnv }` →
`childEnv(extraEnv)`, the IPC `address` field, `runProxyOnce`'s env). `server.js` is a pure
extraction plus one changed line (`server.listen(PORT, "0.0.0.0")` → `server.listen(PORT,
config.host)`); the request handler body is untouched. One harmless ordering change: the two
timeout constants now compute during `config.js` module evaluation rather than after
`validateConfig`, with no observable effect (both paths exit 1 on a bad base URL, and `readSeconds`
is side-effect-free).

**Hygiene:** all 47 commit subjects match Conventional Commits; `package.json` has no
`dependencies`; `.gitignore` unchanged; `git status --porcelain --ignored` empty (no stray files);
no `TODO`/`FIXME`/`XXX`/`HACK` outside README's intentional `FIXME` placeholders; ESM only.

**Doc count consistency:** the AGENTS.md sweep
`grep -rnE 'tests(-| )?[0-9]{2,4}|[0-9]{2,4}[ -]?tests?' --include='*.md' --include='*.yaml' .`
minus the documented exclusions, minus lines matching 82, returns **empty**. Stale-number sweep for
34/36 in living docs returns only `"36 KB"` prose in ADR 0002 and `state.yaml`, and `34/34`
preconditions in four epic capsules — none of which the gate treats as a suite-count statement.

---

## Claims I could not verify

* Whether the implementers actually ran each verify command at the time. I re-ran all twelve
  myself and all pass, so the ledger's `status: passing` values are corroborated regardless.
* Node 20 and 22. `.github/workflows/ci.yml` is **not on this branch** (`git ls-tree HEAD .github`
  is empty); only `origin/main` has it. Everything above ran on Node v24.18.0. The code uses no
  APIs newer than Node 18.14 (`Object.entries`, `Object.create(null)`, `padStart`, `?.`,
  `Object.hasOwn` unused), so the risk is low, but the 20/22 matrix has not run against this code.
* The engineering judgment behind the four accepted gaps ADR 0002 records. I verified each is real
  and correctly classified; whether the trade is worth it is a maintainer call.
* Whether the earlier per-task reviews (`e04s01-t04-review.md`, `t05-review.md`, `t06-review.md`)
  were honest about the state at their time. Out of scope for a whole-branch pass.

---

## Severity call on the six known open defects

1. **`PROXY_HOST` padded whitespace dies on `getaddrinfo ENOTFOUND  127.0.0.1 ` — P2.** Real and
   reproduced. Every other variable trims padding, so `" 127.0.0.1 "` failing where `"127.0.0.1"`
   works is a genuine inconsistency. It is fail-closed (exit 1, never a silent bind to the wrong
   interface), loud, and ADR 0002 §Consequences names it as a consequence. Cost of fixing is one
   `.trim()` on `config.js:33`, and doing so costs nothing the ADR argues for — the "no silent
   rewrite" rationale is about not rewriting a *valid* address, and trimming surrounding
   whitespace is what the other eight variables already do. Worth a follow-up, not a blocker.

2. **Unbindable `PROXY_HOST` surfaces as an unhandled `'error'` with a Node stack dump — P2.**
   Real and reproduced, and stronger than a bare nit because it makes story §11's "stderr naming
   the variable" false for one of the nine variables (F3). Still fail-closed, no secret in the
   dump, no crash-loop risk beyond a normal restart-on-failure. Documented as accepted. P2, with the
   §11 deviation called out as the part that should have been surfaced in the story closure.

3. **`server.test.js:1533`'s case-sensitivity test claims more than it observes — P2.** Real and
   proved by mutation (M4: lowercasing keys leaves it green). The underlying behavior is correct.
   The test is not decorative in the sense of asserting nothing — it does prove the document is
   *accepted* and the process starts — but the comment's "so no lowercasing happens" is unbacked.
   Cheapest honest fix: reword the comment to what the assertion proves, or move the claim under
   ADR 0002's reviewed-by-eye list, where it belongs.

4. **`integerRule`'s `"a non-negative integer"` branch has no caller — P2 nit.** Confirmed by
   enumerating all eight `readPositiveInteger` call sites. Dead code in a defensive branch that
   `integerRule`'s own comment explains. ADR 0002 §Consequences already flags it. Harmless.

5. **`CONFIG_ENV_VARS` completeness is documentation only — P2.** Real and proved (M6). AGENTS.md
   states the rule, ADR 0002 states the consequence, and the named test proves the *helper* works.
   Nothing proves the *list* is complete, and the story forbids a second seam that would. The
   three-way fallback (prose in two places plus a review obligation) is the right trade for a
   harness-only slice. Not a blocker.

6. **Story line 336 changed from `(56 tests)` to 82 rather than excluded — the right call.**
   The gate's exclusion list names three categories, each with a stated reason: task ledgers
   (e01s01 carries a deliberately wrong count as a CI fixture), briefs, and LOG.md (append-only dated
   records). A story spec is none of those — it states requirements a later reader is still
   expected to check, its §21 line named the suite size as the detector for refactor regression in
   tasks 1 and 12, and AGENTS.md already listed that exact line among the sites to keep current.
   Excluding it would have silenced the gate for every future story spec, which is the drift the
   gate exists to catch. The number moved, the verify pattern did not, and the gate is green rather
   than relaxed. The trade is that the file must be re-edited on every future branch that adds
   tests — the same tax every other living count site already carries, and one command to pay.

---

## Recommendation before merge

1. Resolve the 7 merge conflicts with `origin/main`, then re-run task 12's verify and take the
   derived N (expected 84) into the living docs. (F1)
2. Optionally, in the same pass: bound the scalar echo in `readPositiveInteger` (F2), and reword
   the case-sensitivity test comment or move the claim to ADR 0002's reviewed-by-eye list (F5).
3. Fix the four bookkeeping facts that are cheap and wrong: the story header `Status: failing`
   (F4), `release-plan.yaml`'s closed-issue set (F8), `execution-status.yaml`'s `e01s01`/`e02s01`
   (F7), and `state.yaml`'s `vcs.commit` (F12).

Nothing in items 1–3 blocks a merge. Item 1 is required for the issue's own count-sync acceptance
criterion to survive the merge.