# e04s05 Task 5 Report: Sync the living docs, the count, the ADR, and the manifests

## Status

**passing** — the count, the wording, the two test titles, ADR 0002, the manifests and the
verification evidence are all in place; the strengthened count gate is green on the corrected
tree and red on a copy of the tree where one living doc still says 141; `npm test` is 161/161/0
and `npm run check` is clean.

Branch: `e04s05-per-model-budgets` (worktree `/data/data/com.termux/files/home/workspace/e04s05-per-model-budgets`).
Base: `af4e21c`. No push, no merge, no rebase; issue #18 untouched (D21).

## Commits

| hash | subject | files |
|---|---|---|
| `0360018` | `docs(e04s05): sync the living docs, the count, and the ADR for the per-model budget` | 19 files: `AGENTS.md`, `CONTEXT.md`, `CONVENTIONS.md`, `README.md`, `docs/adr/0002-config-operational-fail-fast.md`, `server.test.js`, `specs/README.md`, `specs/execution-status.yaml`, `specs/epics/e04-rate-limiting/e04s01-config-owner-and-bind-host.md`, `specs/epics/e04-rate-limiting/e04s02-admit-and-queue.md`, `specs/epics/e04-rate-limiting/e04s04-enforce-global-rpm-tpm-budgets.md`, `specs/epics/e04-rate-limiting/e04s05-apply-per-model-budgets-atomically.md`, `specs/epics/e04-rate-limiting/e04s05-tasks.yaml`, `specs/epics/e04-rate-limiting/epic.yaml`, `specs/product/SCOPE_LATEST.yaml`, `specs/product/VISION_LATEST.yaml`, `specs/tech-architecture/TEST_PLAN_LATEST.md`, `specs/tech-architecture/tech-stack.md`, `specs/verifications/e04s05-verify.yaml` |
| `<this commit>` | `docs(e04s05): add the task 5 report` | this report |

`node_modules` was never staged (`git diff --cached --name-only | grep -c node_modules` → 0);
every path was staged explicitly. `package.json` is untouched — still no `dependencies` key, and
`npm test` is still plain `node --test`.

## The count gate

Installed verbatim from D20, in `specs/epics/e04-rate-limiting/e04s05-tasks.yaml`, task 5's
`verify` (a YAML literal block, so the four statements stay readable):

```bash
N=$(node --test --test-reporter=tap server.test.js 2>&1 | grep -E '^# tests [0-9]+$' | grep -oE '[0-9]+')
hits=$(grep -rnE '(^|[^A-Za-z0-9])[0-9]{2,4}[ -]tests?\b|tests-[0-9]{2,4}|\(currently [0-9]+\)' --include='*.md' --include='*.yaml' . | grep -v '^\./plans/' | grep -v 'docs/research/config-invariant-guard-tests' | grep -v '/briefs/' | grep -v '^\./LOG.md' | grep -v '/specs/verifications/' | grep -v -- '-tasks.yaml')
bad=$(printf '%s\n' "$hits" | grep -vE "(^|[^A-Za-z0-9])${N}[ -]tests?\b|tests-${N}\b|\(currently ${N})")
printf '%s\n' "$hits"
test -z "$bad"
```

The old gate was broken, and this is why: it counted the TAP `ok` lines and called that the test
count. The TAP reporter emits one `ok` line per test, one per `describe` block and one for the
file, so the count is far above 161; the gate then grepped the docs for that number, found
nothing, and failed on a tree whose counts were all correct. The new gate takes the count from
the `# tests N` summary line and fails on any living doc that states a different number. The
`[^A-Za-z0-9]` class before the digits keeps a story id (`e04s04 tests`) out of the sweep.

### Green — the committed tree, `sh d20-gate.sh` in an export of `0360018`

```
./AGENTS.md:89:- `npm test` — full suite (161 tests, Node built-in `node --test` runner, no deps to install)
./AGENTS.md:113:- Test count synced in **every** living doc that states one (currently 161) — grep, never trust this list or its line numbers: `grep -rnE 'tests(-| )?[0-9]{2,4}|[0-9]{2,4}[ -]?tests?|\(currently [0-9]+\)' --include='*.md' --include='*.yaml' .`
./AGENTS.md:115:  Sites as of 2026-10-22: `README.md:9` badge `tests-161%20passing`, `README.md:111` tip, this bullet (count + `npm test` bullet), `CONVENTIONS.md:17`, `specs/README.md:19`, `specs/tech-architecture/tech-stack.md:172`, `specs/tech-architecture/TEST_PLAN_LATEST.md:44,294,351`, `specs/product/VISION_LATEST.yaml:20`, `specs/state.yaml` handoff note, `specs/epics/e04-rate-limiting/e04s01-config-owner-and-bind-host.md:345`. `plans/*.md` hold historical per-plan numbers — not living docs.
./CONVENTIONS.md:17:- `npm test` — runs all 161 tests
./README.md:9:[![Tests](https://img.shields.io/badge/tests-161%20passing-blue?style=flat-square)](server.test.js)
./README.md:111:> Run the test suite (161 tests, no deps needed):
./specs/README.md:19:- 161 tests in server.test.js
./specs/epics/e04-rate-limiting/e04s01-config-owner-and-bind-host.md:345:- Refactor regression in working code → detected by the unchanged existing suite (161 tests)
./specs/product/VISION_LATEST.yaml:20:  - 161 tests covering all major scenarios
./specs/state.yaml:169:      this tree: that count is 176 while the suite is 161 tests, because the TAP
./specs/tech-architecture/TEST_PLAN_LATEST.md:44:- 161 tests covering all major scenarios
./specs/tech-architecture/TEST_PLAN_LATEST.md:294:- All 161 tests must pass
./specs/tech-architecture/TEST_PLAN_LATEST.md:351:This comprehensive test plan ensures the NVIDIA API Proxy meets all requirements and maintains high quality through thorough testing. The 161-test suite provides good coverage of all major scenarios while maintaining the zero-dependency philosophy.
./specs/tech-architecture/tech-stack.md:172:- **Test Count**: 161 tests
GATE EXIT=0
```

Fourteen living sites, all stating 161, and the gate exits 0. The same command was also run in the
worktree itself, with the same 14 sites and the same exit 0.

### Red — the committed tree with one living doc back at 141

The export `git archive 0360018` was copied to a second directory, and in that copy only
`README.md:111` was set back to `(141 tests, no deps needed)`. The *same* command, run there:

```
./AGENTS.md:89:- `npm test` — full suite (161 tests, Node built-in `node --test` runner, no deps to install)
./AGENTS.md:113:- Test count synced in **every** living doc that states one (currently 161) — grep, never trust this list or its line numbers: `grep -rnE 'tests(-| )?[0-9]{2,4}|[0-9]{2,4}[ -]?tests?|\(currently [0-9]+\)' --include='*.md' --include='*.yaml' .`
./AGENTS.md:115:  Sites as of 2026-10-22: `README.md:9` badge `tests-161%20passing`, `README.md:111` tip, this bullet (count + `npm test` bullet), `CONVENTIONS.md:17`, `specs/README.md:19`, `specs/tech-architecture/tech-stack.md:172`, `specs/tech-architecture/TEST_PLAN_LATEST.md:44,294,351`, `specs/product/VISION_LATEST.yaml:20`, `specs/state.yaml` handoff note, `specs/epics/e04-rate-limiting/e04s01-config-owner-and-bind-host.md:345`. `plans/*.md` hold historical per-plan numbers — not living docs.
./CONVENTIONS.md:17:- `npm test` — runs all 161 tests
./README.md:9:[![Tests](https://img.shields.io/badge/tests-161%20passing-blue?style=flat-square)](server.test.js)
./README.md:111:> Run the test suite (141 tests, no deps needed):
./specs/README.md:19:- 161 tests in server.test.js
./specs/epics/e04-rate-limiting/e04s01-config-owner-and-bind-host.md:345:- Refactor regression in working code → detected by the unchanged existing suite (161 tests)
./specs/product/VISION_LATEST.yaml:20:  - 161 tests covering all major scenarios
./specs/state.yaml:169:      this tree: that count is 176 while the suite is 161 tests, because the TAP
./specs/tech-architecture/TEST_PLAN_LATEST.md:44:- 161 tests covering all major scenarios
./specs/tech-architecture/TEST_PLAN_LATEST.md:294:- All 161 tests must pass
./specs/tech-architecture/TEST_PLAN_LATEST.md:351:This comprehensive test plan ensures the NVIDIA API Proxy meets all requirements and maintains high quality through thorough testing. The 161-test suite provides good coverage of all major scenarios while maintaining the zero-dependency philosophy.
./specs/tech-architecture/tech-stack.md:172:- **Test Count**: 161 tests
GATE EXIT=1
```

The stale doc is reported (`./README.md:111:> Run the test suite (141 tests, no deps needed):`)
and the gate exits 1. A gate that has only ever been seen failing has not been shown to pass, and
one that has only ever passed has not been shown to fail: both directions are above, on the same
tree, with the same command.

The old gate's number, measured here: counting the TAP `ok` lines gives **176** while the
TAP summary line says `# tests 161` — the 15 `describe` blocks and the file line are counted as
if they were tests. That is exactly why the old gate failed on a tree whose counts were all
correct.

## The two renamed test titles

`server.test.js`, in the `describe("buffered body ceiling and per-model limits")` block. The
assertion bodies are byte-identical; only the titles and the comment above each test moved.

| was | now |
|---|---|
| `PROXY_MAX_BUFFERED_BODY_BYTES=1 still proxies normally (values validated, not applied)` | `PROXY_MAX_BUFFERED_BODY_BYTES=1 does not gate traffic without the global pair` |
| `PROXY_MODEL_LIMITS_JSON with well-formed budgets still proxies normally (values validated, not applied)` | `PROXY_MODEL_LIMITS_JSON with well-formed budgets does not gate traffic without the global pair` |

Both still pass, and both now say what is true: the variable alone, without the global pair,
does not gate traffic.

```
$ node --test --test-reporter=tap --test-name-pattern 'does not gate traffic without the global pair' server.test.js
    ok 1 - PROXY_MAX_BUFFERED_BODY_BYTES=1 does not gate traffic without the global pair
    ok 2 - PROXY_MODEL_LIMITS_JSON with well-formed budgets does not gate traffic without the global pair
ok 1 - buffered body ceiling and per-model limits
# tests 2 / # suites 1 / # pass 2 / # fail 0
```

### The ADR entries updated to match

`docs/adr/0002-config-operational-fail-fast.md`, Compliance section:

* `:543` — `PROXY_RPM and PROXY_TPM set to a tiny budget now enforce the effective limit` —
  *renamed by e04s04 from the "validated, not applied" title it carried while the pair was
  stored; the assertions are unchanged, and the rename is this ADR's own standing rule applied;*
  (this title was already renamed in the code by e04s04; the ADR still quoted the old one.)
* `:588` — `PROXY_MAX_BUFFERED_BODY_BYTES=1 does not gate traffic without the global pair` —
  *renamed by e04s05 from the "validated, not applied" title it carried while the cap was
  stored; the assertions are unchanged;*
* `:593` — `PROXY_MODEL_LIMITS_JSON with well-formed budgets does not gate traffic without the
  global pair` — *renamed by e04s05 from the "validated, not applied" title it carried while the
  map was stored; the assertions are unchanged;*

The standing rule itself (Coverage, `:310-323`) now records all three renames in the e04s02
style: e04s02 renamed the concurrency variant and left the three budget variants alone, e04s04
renamed the rate-pair variant, and e04s05 renamed the two that were left.

## The ADR amendment text

Added to the header list, after the 2026-10-16 e04s04 entry (`docs/adr/0002-...md:14-17`):

```
* Amended: 2026-10-22 — e04s05 enforces the per-model budget, so the last of the five remaining
  rate-limiting limits is now read at request time. Decision §1.4, §1.6, and the Coverage section
  are amended. The failure mode does not change: the parsing rules and the fatal regime are
  untouched. See *Decision* §1.4, §1.6, and *Consequences*.
```

The other ADR edits: Decision §1.4 (`:81-91`) — the stored/enforced split is closed; Decision §1.6
(`:100-116`) — the heading now reads "The global budget pair and the per-model budget are
enforced", and a paragraph records that the per-model map is enforced atomically with the global
pair and is inert without it; Consequences (`:441-447`) — "No rate-limiting limit is invisible in
behavior any more"; Decision §1.5 (`:95`) — "Unlike the five stored limits" is gone, because no
rate-limiting limit is stored any more.

## Every living doc touched

| doc | line | what it says now |
|---|---|---|
| `README.md` | 9 | badge `tests-161%20passing` |
| `README.md` | 111 | "Run the test suite (161 tests, no deps needed):" |
| `README.md` | 142 | the `PROXY_MODEL_LIMITS_JSON` row: "**enforced**, and only when the `PROXY_RPM`/`PROXY_TPM` pair is set" |
| `README.md` | 145-157 | the IMPORTANT note: "**The rate limits are enforced at request time.** The live set is `PROXY_HOST`, `PROXY_LOG_REQUESTS`, the concurrency ceiling (…), the global budget pair (`PROXY_RPM` with `PROXY_TPM`), the safety margin (`PROXY_SAFETY_MARGIN_PCT`), the body cap (`PROXY_MAX_BUFFERED_BODY_BYTES`) and the per-model map (`PROXY_MODEL_LIMITS_JSON`)"; the per-model map is "enforced atomically with the global pair and inert without it"; the "every other `PROXY_*` row is validated and stored, not enforced" sentence is gone |
| `README.md` | 182 | the copy-paste comment: "per-model budgets (enforced with the global pair; inert without it)" |
| `AGENTS.md` | 89 | "`npm test` — full suite (161 tests, …)" |
| `AGENTS.md` | 113 | "(currently 161)" |
| `AGENTS.md` | 114 | the stale-number sweep alternation is now `\b(85|99|141)\b` — 141 is the number this sync replaces |
| `AGENTS.md` | 115 | the site list, dated 2026-10-22, with the real line numbers (`README.md:111` tip, `tech-stack.md:172`) and the badge `tests-161%20passing` |
| `AGENTS.md` | 117 | new: the sweep skips four more dated or append-only categories — `specs/epics/*/briefs/`, `LOG.md`, `specs/epics/*/*-tasks.yaml`, `specs/verifications/` — and a story spec is not one of them (D22) |
| `CONVENTIONS.md` | 17 | "`npm test` — runs all 161 tests" |
| `CONVENTIONS.md` | 27 | "`PROXY_MODEL_LIMITS_JSON` is enforced atomically with the global budget through `budget.js` — issue #18 is done; issues #19–#22 remain" |
| `CONVENTIONS.md` | 82 | "the five `specs/` docs" (was "four") |
| `CONTEXT.md` | 44-53 | "Rate budget, Per-model budget, and Safety margin name limits this proxy **reads at request time**"; "The rate budget and the per-model budget are enforced — the rate budget since e04s04, the per-model budget since e04s05 — while the safety margin and the body cap are read at request time since e04s04"; "Enforcement of the remaining budgets arrives in later slices" is gone |
| `specs/README.md` | 19 | "- 161 tests in server.test.js" |
| `specs/product/VISION_LATEST.yaml` | 20 | "- 161 tests covering all major scenarios" |
| `specs/product/SCOPE_LATEST.yaml` | 36 | the accepted trade-off now says the ceiling trio has been read at request time since e04s02, the four global budgets since e04s04 and the per-model map since e04s05, "so the current build buffers in rate-limit mode" |
| `specs/tech-architecture/TEST_PLAN_LATEST.md` | 44, 294, 351 | "161 tests", "All 161 tests must pass", "The 161-test suite" |
| `specs/tech-architecture/tech-stack.md` | 64 | the `PROXY_MODEL_LIMITS_JSON` row: "Read at request time since e04s05: one rolling 60-second window per configured model, applied atomically with the global budget and inert without the global pair" |
| `specs/tech-architecture/tech-stack.md` | 75-81 | "The five rate-limiting limits above (…) are read at request time: the four global ones since e04s04, the per-model map since e04s05. … Nothing of the five is merely stored: an operator who sets a budget today sees a change in traffic." |
| `specs/tech-architecture/tech-stack.md` | 164 | Gray Areas: "Per-model budgets enforced since e04s05 — `PROXY_MODEL_LIMITS_JSON` adds one rolling 60-second window per configured model, applied atomically with the global budget and only when the global pair is present." |
| `specs/tech-architecture/tech-stack.md` | 172 | "- **Test Count**: 161 tests" |
| `specs/epics/e04-rate-limiting/e04s01-config-owner-and-bind-host.md` | 345 | "the unchanged existing suite (161 tests)" |
| `specs/epics/e04-rate-limiting/e04s02-admit-and-queue.md` | 115-119 | e04s02's own boundary kept, plus "*Superseded since*: e04s04 made the rate pair and the body-buffer cap live and e04s05 made the per-model map live, and every slice that made a limit live renamed the test that carried that limit's old title — the rate-pair title by e04s04, the body-cap and per-model titles by e04s05." |
| `specs/epics/e04-rate-limiting/e04s04-enforce-global-rpm-tpm-budgets.md` | 150-152 | e04s04's own boundary kept, plus "*Superseded by e04s05*: the per-model budget is enforced since that slice, atomically with the global one." |
| `specs/epics/e04-rate-limiting/e04s05-apply-per-model-budgets-atomically.md` | 8 | the story spec's own status header: `* Status: failing` → `* Status: passing` (the house convention: a landed story's spec says passing) |
| `docs/adr/0002-config-operational-fail-fast.md` | 14-17, 81-91, 95, 100-116, 310-323, 441-447, 543, 588, 593 | the amendment line, Decision §1.4/§1.5/§1.6, the Coverage standing rule, the Consequences, and the three Compliance titles (above) |
| `server.test.js` | 1574-1579, 1612-1618 | the two renamed titles and the comment above each (the old comment claimed the ceiling was stored and not enforced, which has been false since e04s04) |

## The manifests

| file | change |
|---|---|
| `specs/execution-status.yaml` | `e04s05: failing` → `e04s05: passing`; `e04s06: blocked` → `e04s06: todo` |
| `specs/epics/e04-rate-limiting/epic.yaml` | `e04s05.status: failing` → `passing` (its `bcps: 7`, `spec` and `tasks` were already set); `e04s06.status: blocked` → `todo`, with `spec: null` and `tasks: null` unchanged; the epic's own `status: in_progress` is unchanged |
| `specs/epics/e04-rate-limiting/e04s05-tasks.yaml` | the story-level `status: failing` → `passing`; task 5's `status: failing` → `passing`; task 5's `verify` replaced with the D20 gate (above) |

`specs/state.yaml` was **not** touched — the orchestrator owns it (D21/§In scope). It already
says 161 (`specs/state.yaml:169`), which is why it is green under the new gate.

## The verification evidence file

Written: `specs/verifications/e04s05-verify.yaml`, in the shape of `specs/verifications/e04s04-verify.yaml` —
the eleven phases (branch check, preflight, cold-start smoke, build, typecheck, lint, format,
tests with `count: 161`, task verify, security review, terminal verdict), the eight manual steps
mapped to the story's Gherkin scenarios (§17), ten acceptance criteria with their evidence, the
budget-wait divergence, and the count-sync command with its exclusion set.

## Verification evidence

### `npm test`

```
ℹ tests 161
ℹ suites 15
ℹ pass 161
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 251372.926935
```

Exit 0. The known pre-existing e04s03 flake (`shutdown rejects late arrivals and keeps health
responsive`, ≈1 run in 26) did **not** fire in this run.

### `npm run check`

```
> npm run lint && npm run typecheck && npm run format:check
> node ./node_modules/eslint/bin/eslint.js server.js config.js budget.js server.test.js
> node ./node_modules/typescript/bin/tsc -p tsconfig.json
> node ./node_modules/prettier/bin/prettier.cjs --check server.js config.js budget.js server.test.js eslint.config.js
Checking formatting...
All matched files use Prettier code style!
```

Exit 0. No rule silenced, no file reformatted beyond the two renamed tests.

### My own sweep

```
$ grep -rnE '\b141\b' --include='*.md' --include='*.yaml' . \
    | grep -v '^\./plans/' | grep -v 'docs/research/config-invariant-guard-tests' \
    | grep -v '/briefs/' | grep -v '^\./LOG.md' | grep -v '/specs/verifications/' \
    | grep -v -- '-tasks.yaml'
./AGENTS.md:114:  The `\(currently [0-9]+\)` alternative exists because this bullet states a count that the first two alternatives do not match. Sweep for the stale number afterwards too — `grep -rnE '\b(85|99|141)\b' --include='*.md' --include='*.yaml' .` — since a site can state the count in a form the pattern above misses.
```

One hit, and it is the sweep pattern itself, not a count claim: 141 is the number this sync
replaces, so the bullet's stale-number alternation now names it. No living doc states 141.

```
$ grep -rnE 'validated and stored|stored, not enforced|not enforced yet|stored only|stays stored|still stored|buffers nothing' \
    --include='*.md' --include='*.yaml' . \
    | grep -v '^\./plans/' | grep -v 'docs/research/config-invariant-guard-tests' \
    | grep -v '/briefs/' | grep -v '^\./LOG.md' | grep -v -- '-tasks.yaml'
./docs/adr/0002-config-operational-fail-fast.md:12:  rate-limiting limits are now read at request time and one still stays stored. Decision §1.4,
./docs/adr/0002-config-operational-fail-fast.md:82:   rate-limiting limit stays validated and stored.** Since e04s02,
./docs/adr/0002-config-operational-fail-fast.md:316:  still stored only. e04s04 renamed the rate-pair variant — `PROXY_RPM and PROXY_TPM set to a tiny
./specs/epics/e04-rate-limiting/e04s02-admit-and-queue.md:117:still stored-only. *Superseded since*: e04s04 enforced the rate pair and e04s05 enforced
./specs/epics/e04-rate-limiting/e04s02-admit-and-queue.md:410:- Docs left asserting "stored, not enforced" → detected by task 7.
./specs/epics/e04-rate-limiting/e04s04-enforce-global-rpm-tpm-budgets.md:151:  and stored only (e04s05). *Superseded by e04s05*: the per-model budget is
./specs/epics/e04-rate-limiting/e04s04-enforce-global-rpm-tpm-budgets.md:185:No new variables. The four budget variables change from "validated and stored"
./specs/epics/e04-rate-limiting/e04s05-apply-per-model-budgets-atomically.md:188:| `PROXY_MODEL_LIMITS_JSON` | validated and stored, not enforced | per-model RPM/TPM windows, enforced atomically with global |
./specs/state.yaml:351:      stored, not enforced" legitimately survives in README and tech-stack for the
```

Every hit is accounted for, and none of them is a living claim that the per-model map is stored
and not enforced:

* `adr/0002:12` — the dated 2026-10-16 e04s04 amendment line. History; the fix is the *new*
  amendment line at `:14`, not a rewrite of this one.
* `adr/0002:82` — my new §1.4 text: "**…no rate-limiting limit stays validated and stored.**" —
  a negation, not a claim.
* `adr/0002:316` — the Coverage standing rule's history: e04s02 "left the three budget variants
  … untouched, because those limits were still stored only" (at e04s02's time).
* `e04s02-admit-and-queue.md:117` — e04s02's own boundary, now marked superseded.
* `e04s02-admit-and-queue.md:410` — e04s02's risk row about its own task 7.
* `e04s04-…:151` — e04s04's own boundary, now marked superseded.
* `e04s04-…:185` — e04s04's Before→After table ("change from 'validated and stored' to 'read at
  request time'"). History.
* `e04s05-…:188` — this story's own Before→After table; the "After" column states the current
  truth. Explicitly out of scope.
* `specs/state.yaml:351` — the orchestrator's own decision text. Not mine to edit.

## Deviations from the brief

1. **`specs/execution-status.yaml` also carries `e04s06: todo`** (one line beyond the brief's
   `e04s05: passing`). Rationale: the file's own header says it is a flat store "Synced by hand
   from specs/epics/*/epic.yaml", and the brief puts `e04s06` at `todo` in `epic.yaml`. Leaving
   the mirror at `blocked` would contradict the epic manifest it mirrors. The two files were
   consistent before this task and are consistent after it.
2. **`specs/epics/e04-rate-limiting/e04s02-admit-and-queue.md:115-119` was touched** although the
   brief's table does not list it. Its present-tense "those limits are still stored-only"
   describes the per-model map, and it is now false. It is a closed story's own boundary, so it
   got the brief's own e04s04 treatment: the history stays, one supersession sentence is added
   ("*Superseded since*: e04s04 made the rate pair and the body-buffer cap live and e04s05 made
   the per-model map live, and every slice that made a limit live renamed the test that carried
   that limit's old title — the rate-pair title by e04s04, the body-cap and per-model titles by
   e04s05.").
3. **`AGENTS.md:114` — the stale-number alternation is now `\b(85|99|141)\b`** (was `\b(85|99)\b`).
   141 is the number this sync replaces, so the bullet's own sweep has to name it. Same bullet,
   same purpose, one token.
4. **`AGENTS.md:117` is a new line.** D22 says the bullet names three excluded categories and
   that the fourth (`specs/verifications/`) must be recorded. The bullet actually named only two
   (`plans/`, `docs/research/`); the gate uses six. The new line records the four that were
   missing, so the rule and the gate agree — which is D22's stated goal.
5. **`CONVENTIONS.md:82` — "the four `specs/` docs" → "the five `specs/` docs".** The rule text
   counted the spec docs that state a count; after this sync there are five, not four.
6. **The two comments above the renamed tests in `server.test.js` were rewritten.** The old
   comment above the body-cap test said "This story validates and stores the ceiling; it does not
   enforce it", which is false since e04s04 and would contradict the new title. The assertions
   are byte-identical; only the titles and the comments moved. The new comments follow the e04s02
   precedent ("A comment above the test records why the title moved").
7. **ADR 0002 §1.5 and §1.6 each lost one stale clause** (`:95` "Unlike the five stored limits";
   `:122-125` "It is deferred to #18–#22 with the per-model budget"). Both are the kind of false
   statement this task exists to remove: no rate-limiting limit is stored any more, and issue #18
   has landed without the early-release wait.
8. **The D20 gate was installed verbatim, without hardening.** It takes `N` from the TAP summary
   line; if the suite could not run, `N` would be empty and the filter would degenerate. The
   suite's own health is covered by `npm test` in the verification contract, and the brief
   specified this command, so it was not modified. Flagging it here so the orchestrator can
   decide.

## Concerns

1. **`e04s02` task 7's verify is now red, and it is the only check this task turned red.**
   Baseline on the pre-task tree, for the record: `e04s02` task 6 was **already** red ("the three
   stored-only tests must keep their titles, found 2" — e04s04 renamed the rate-pair title);
   `e04s04` task 4 was **already** red (it greps `README.md` for "all 141 tests", a phrase that
   lives in `CONVENTIONS.md`); `e04s01` task 12 and `e04s02` task 8 were **already** red (they
   sweep with the old, broader pattern and without the `specs/verifications/` exclusion: 18
   offending lines on the pre-task tree, 10 now — 3 story-id false positives of the old pattern
   plus 7 dated `specs/verifications/` lines). `e04s01` tasks 2, 7, 8, 9, 10 are green after this
   change.
   `e04s02` task 7 was **green** before and is **red** now, on one line only:
   `README: could not locate the validated-and-stored note`. Its locator is
   `/validated and stored,[\s\S]{0,700}?Copy-paste/s` — the phrase it anchored on no longer
   exists anywhere, because every `PROXY_*` limit is now enforced, so there is nothing left to
   call "validated and stored". Every substantive assertion the check makes still passes: with
   only the locator's anchor changed to the new note's first words and its window widened, the
   same script prints `all five documents no longer claim the ceiling is inert` and exits 0
   (README must not claim nothing is read, must keep naming `PROXY_HOST` and `PROXY_LOG_REQUESTS`
   as live, and must name the ceiling it enforces; tech-stack must not classify all eight limits
   as unenforced; SCOPE_LATEST must not claim nothing reads the operational variables; CONTEXT
   must keep its glossary). I did **not** edit `e04s02-tasks.yaml`: it is a closed story's dated
   ledger, and D20 treats `*-tasks.yaml` as append-only records. The orchestrator's call.
2. **The count gate re-runs the whole suite.** It is a documentation gate that costs ~4 minutes
   per run, because it takes `N` from the TAP summary of a real run. That is D20's design, and it
   is what makes the gate self-updating: the number it checks the docs against is the number the
   suite actually has.
3. **The old, broader count pattern still catches story ids.** `grep -rnE 'tests(-| )?[0-9]{2,4}|...'`
   matches "e04s01 test" in three story specs and `specs/state.yaml:71`. D20's `[^A-Za-z0-9]`
   guard fixes it; the older gates (e04s01 t12, e04s02 t8) still do not have it, which is part of
   why they are red.
4. **The known e04s03 flake did not fire** in this run (`shutdown rejects late arrivals and keeps
   health responsive`, ≈1 run in 26, reproducible on the pre-task tree). Not fixed here, by the
   brief.
5. **The gate scans `.` recursively, so an untracked scratch copy inside the worktree makes it
   red.** The orchestrator's own verification left two untracked directories in the worktree while
   this task ran: `.gate/` (its count-gate script and a green log) and `.negcopy/` (a copy of the
   tree with `README.md:9` still at `tests-141%20passing`). The D20 gate's exclusion list does not
   cover them, so a run of the gate *in the worktree* now reports `.negcopy/README.md:9` as a
   stale site and exits 1 — on a tree whose committed content is correct. That is why both proofs
   above were run against `git archive` exports of the committed tree, which carry no untracked
   files. Those two directories are scratch, not deliverables: they are not staged and not
   committed, and they should be removed before anything else runs the gate in the worktree.
   (For the same reason, never `git add -A` in this worktree.)

## What e04s06 needs to know

e04s06 is issue #19, "Reconcile SSE usage without breaking streaming". It is now the head of the
chain (`todo`, `spec: null`, `tasks: null`): it needs a capsule — `plan-work` or `slice-tasks`
for that slice, not another `develop-tdd` — before anything can be executed. Points that carry
over from this story:

* **The budget wait does not exist.** `budget.js` has no wait primitive and the request path has
  no wait to call; an over-budget request is answered immediately with a `429` and a
  `Retry-After` derived from the window's own oldest reservation. ADR 0002 §1.6 records the
  early-release wait as still deferred.
* **A model rejection never charges the global window.** That is the atomicity e04s05 shipped, so
  the global budget is no longer a proxy for total request volume while per-model limits exist.
  Any reconciliation design must decide whether a *reconciled* cost (the actual token count from
  the upstream) is charged against the global window, the model window, or both.
* **Usage reconciliation is still unimplemented.** `CONTEXT.md` keeps the glossary term: absent,
  invalid or unavailable usage keeps the estimate, and the proxy reconciles nothing today.
* **The per-model map is inert without the global pair** (`PROXY_RPM`/`PROXY_TPM`), and the body
  is not even buffered in that mode — a fact the streaming path of e04s06 depends on.
* **The model ID is matched exactly.** Model IDs match case-sensitively, the stored map is
  never trimmed or lowercased, and a model named `__proto__` is enforced, not swallowed. A
  reconciliation that re-reads the body must not change the matching rule.
* **The client learns nothing about which budget bit.** The reason stays inside the proxy: a
  model rejection is the same `429 {"error":"Too many requests"}` with a `Retry-After` from the
  model's own window, and the request log line never names the model or the reason.
* **Count discipline.** The suite is 161 and the count gate is the D20 one; the next slice that
  adds tests must re-sync the fourteen living sites and keep the exclusion set in `AGENTS.md`
  in step with the gate.
