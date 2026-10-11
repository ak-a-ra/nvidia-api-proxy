# Task report — e04s02 / task 7: correct every living document that calls the ceiling inert

- **Status:** done
- **Commit SHA:** none. Left unstaged for the reviewer.

Intended Conventional Commits message:

```text
docs(e04s02): move the concurrency ceiling into the live set in every living document
```

No code touched: `server.js`, `admission.js`, `config.js`, and `server.test.js` are byte-identical
after this task. Six documents corrected, one commit.

## What landed

| Document | Correction |
| --- | --- |
| `README.md` | IMPORTANT note rewritten: the ceiling trio is enforced at request time (bounded FIFO queue, `429` + `Retry-After` on a full queue or expired wait), the five budgets keep the stored-only claim, and the live set is named explicitly — `PROXY_HOST`, `PROXY_LOG_REQUESTS`, and the trio — so the note keeps naming its two long-live exceptions instead of being deleted wholesale. Env-table rows for the trio marked `**enforced**`. Copy-paste block retitled and split: `admission (enforced)` above `budgets (validated and stored, not enforced yet)` |
| `specs/tech-architecture/tech-stack.md` | Startup paragraph rewritten: the trio is read by the admission gate through root-level `admission.js`, the other five keep the stored wording; "The eight … not enforced" became the smaller number. Gray Areas' Rate Limiting bullet updated the same way. `PROXY_LOG_REQUESTS`'s table row drops its now-false "the only `PROXY_*` variable that is live" |
| `CONTEXT.md` | The glossary-adjacent paragraph: Admission control and Queue are enforced since e04s02; Rate budget, Per-model budget, Safety margin keep their disclaimers, as does Usage reconciliation's no-implementation note. Glossary definitions unchanged |
| `docs/adr/0002-config-operational-fail-fast.md` | New amendment line; Decision §1.4 rewritten to "the concurrency-ceiling trio is enforced; the other five stay validated and stored"; §1.5's "one operational variable that is live" becomes "first … and live"; Coverage gains the trio as the second field the harness can pin (behavior over HTTP, value still reviewed by eye); Consequences' invisible-limit bullet now covers five of eight; Compliance's renamed test title updated to the e04s02 one |
| `specs/product/SCOPE_LATEST.yaml` | Accepted-tradeoffs paragraph: only the ceiling trio is read at request time, the five budgets stay stored |
| `CONVENTIONS.md` | `admission.js` added to Architecture and File Organization with the ownership split `config.js` established; Defensive Code Categories' Rate limit entry now records the admission half enforced and the budget half stored (#17–#22) |

## Verification Output

Task 7's verify, run verbatim from the repo root:

```text
all five documents no longer claim the ceiling is inert
VERIFY_EXIT=0
```

The first run was red with one finding, `README: note must name the ceiling it now enforces`. The
reason is worth recording: the check reads the window from the first `validated and stored,`
onward, and the rewritten note named `PROXY_MAX_CONCURRENT_REQUESTS` only in its *first* sentence —
before that phrase — so the name sat outside the captured window. The fix moved the live-set naming
into the tail of the note after the stored-only claim, which is also where a reader looks after
being told five budgets do nothing.

Full suite (documents-only change, run to prove it):

```text
ℹ tests 116
ℹ suites 12
ℹ pass 116
ℹ fail 0
```

## `npm run check` Output

```text
> nvidia-api-proxy@1.0.0 lint
> node ./node_modules/eslint/bin/eslint.js server.js config.js server.test.js

> nvidia-api-proxy@1.0.0 typecheck
> node ./node_modules/typescript/bin/tsc -p tsconfig.json

> nvidia-api-proxy@1.0.0 format:check
> node ./node_modules/prettier/bin/prettier.cjs --check server.js config.js server.test.js eslint.config.js

Checking formatting...
All matched files use Prettier code style!
CHECK_EXIT=0
```

## Notes, deviations, and concerns

**Two stalenesses outside this task's mandate were found and left alone.**

1. `CONVENTIONS.md`'s Testing Philosophy still says "No lint/typecheck/formatter config" and its
   Commands section still says `npm test` runs 100 tests. The config claim has been false since
   `1c7ab4e` landed the dev-only tooling; the count is task 8's. Both are one-line fixes in a file
   this task already edited, but neither is the stored-vs-enforced claim task 7 owns, and the count
   in particular is gated by task 8's floor check.
2. ADR 0002's References still says the six glossary terms are "not yet recorded" in `CONTEXT.md`
   and that "task 8 owns that entry" — but the glossary has carried Admission control and Queue
   since e04s01. The sentence was already stale before e04s02.

**`CONVENTIONS.md`'s Architecture line inventory was refreshed for `server.js` (283 → 304) and
`server.test.js` (2464 → 3476) because this task rewrote that block anyway** and the numbers were
already wrong before the block was touched — LOG.md records task 9 of e04s01 as their owner, and
they were never corrected there. `config.js`'s ~352 is accurate.

**What task 7 deliberately did not touch:** the `plans/` archive, `docs/research/`, and the
`specs/epics/*/briefs/` reports — dated records, excluded by task 8's gate for the same reason.
