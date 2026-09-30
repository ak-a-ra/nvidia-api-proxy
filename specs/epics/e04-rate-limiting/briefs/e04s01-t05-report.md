# Task report — e04s01 / task 5: the buffered-body ceiling and the per-model limits map

Branch `epic-14-config-owner`. Commits, oldest first:

| SHA | Subject |
| --- | --- |
| `21279f2` | `test(config): the buffered-body ceiling and per-model limits, pinned before they exist` |
| `2199159` | `feat(config): the buffered-body ceiling and the per-model limits map` |
| `b954b32` | `docs: the living test count moves to 72 across every doc that states one` |

Nothing pushed. `server.js` untouched by this task:

```
$ git diff 83fc7bc..HEAD -- server.js | wc -l
0
```

(`83fc7fc` is the pre-task HEAD. Against the branch merge-base `4cc7fc6` the diff is 89 lines, all of it task 1's config extraction.)

## The config shape this task adds

`parseConfig`'s return, quoted from `config.js`:

```js
  return {
    baseURL: rawBase,
    host: rawHost?.trim() ? rawHost : "0.0.0.0",
    rateLimit: readRateLimit(env),
    limits: readLimits(env),
    // Its own field, parallel to rateLimit: limits holds scalar ceilings, this
    // holds a map of budgets. A caller must not be able to read a per-model
    // budget map beside a half-configured global rate pair.
    modelLimits: readModelLimits(env),
    apiKey: env.NVIDIA_API_KEY,
    proxyToken: env.PROXY_AUTH_TOKEN,
    unconfigured: !env.NVIDIA_API_KEY?.trim() || !env.PROXY_AUTH_TOKEN?.trim(),
  };
```

`limits` gains one member, the ceiling:

```js
    // 8 MiB, the plain positive-integer rule like every other ceiling here.
    // 0 is fatal, not a disable: a zero-byte buffer rejects every request body,
    // a limit that appears to exist and does not.
    maxBufferedBodyBytes: hasMaxBodyBytes
      ? readPositiveInteger("PROXY_MAX_BUFFERED_BODY_BYTES", rawMaxBodyBytes)
      : 8388608,
```

`modelLimits` is `null` when the variable is absent or blank, and otherwise a
null-prototype map of model key → `{ rpm?, tpm? }`, keys stored byte for byte:

```js
  const limits = Object.create(null);
  …
    budget[field] = readPositiveInteger(`PROXY_MODEL_LIMITS_JSON["${model}"].${field}`, String(value));
    …
    limits[model] = budget;
  return limits;
```

Stored shape, read back from a scratch probe that imported `parseConfig` directly
(nothing committed, no second test seam added):

```
absent           {"limits":{…,"maxBufferedBodyBytes":8388608},"modelLimits":null}
blank            {"limits":{…,"maxBufferedBodyBytes":8388608},"modelLimits":null}
ceiling 4096     {"limits":{…,"maxBufferedBodyBytes":4096},"modelLimits":null}
proto key        {"limits":{…},"modelLimits":{"__proto__":{"rpm":5}}}
```

## Tests added

One new `describe("buffered body ceiling and per-model limits")` block, appended
after `operational limit config`. Sixteen tests, names verbatim from the passing
run:

```
✔ PROXY_MAX_BUFFERED_BODY_BYTES and PROXY_MODEL_LIMITS_JSON absent start and serve /health
✔ PROXY_MAX_BUFFERED_BODY_BYTES and PROXY_MODEL_LIMITS_JSON blank start and serve /health
✔ PROXY_MAX_BUFFERED_BODY_BYTES at its boundary values starts and serves /health
✔ PROXY_MAX_BUFFERED_BODY_BYTES rejects a non-blank invalid value, names itself and states its rule
✔ PROXY_MAX_BUFFERED_BODY_BYTES=1 still proxies normally (values validated, not applied)
✔ PROXY_MODEL_LIMITS_JSON with well-formed budgets starts and serve /health
✔ PROXY_MODEL_LIMITS_JSON with well-formed budgets still proxies normally (values validated, not applied)
✔ PROXY_MODEL_LIMITS_JSON with bad JSON exits 1 naming the variable
✔ PROXY_MODEL_LIMITS_JSON with a non-object root exits 1 naming the variable
✔ PROXY_MODEL_LIMITS_JSON with a blank model key exits 1 naming the variable
✔ PROXY_MODEL_LIMITS_JSON with a non-object entry exits 1 naming the variable and the model key
✔ PROXY_MODEL_LIMITS_JSON with an invalid rpm or tpm exits 1 naming the model key and the field
✔ PROXY_MODEL_LIMITS_JSON with an entry that supplies no budget exits 1 naming the model key
✔ PROXY_MODEL_LIMITS_JSON with one valid and one invalid entry exits 1 (never partially applied)
✔ PROXY_MODEL_LIMITS_JSON model keys are case-sensitive and unnormalized
✔ PROXY_MODEL_LIMITS_JSON with a model key that has surrounding spaces exits 1 naming the variable
```

Against the ten required test areas: 1 → test 1; 2 → test 2; 3 → tests 3 and 5;
4 → test 4 (its own table; task 4's `INVALID_VALUES` is untouched, `0` folded in
with a comment saying why); 5 → test 4 (`zero` row, asserting the whole
`PROXY_MAX_BUFFERED_BODY_BYTES must be a positive integer` text plus the echoed
value); 6 → tests 6 and 7; 7 → tests 8–13 and 16; 8 → test 14; 9 → tests 15 and
16; 10 → `git diff 83fc7bc..HEAD --numstat -- server.test.js` = `278 0`, purely
additive.

No test name contains the word `whitespace` (`grep -i whitespace` over the new
block's `test(` lines is empty), so task 6's gate stays falsifiable. Every test
that means "absent" passes `undefined`, never omits the key.

### The tests failed first, for the right reason

Before the implementation (`21279f2`):

```
raw rc=1
  ok 1 - PROXY_MAX_BUFFERED_BODY_BYTES and PROXY_MODEL_LIMITS_JSON absent start and serve /health
  ok 2 - PROXY_MAX_BUFFERED_BODY_BYTES and PROXY_MODEL_LIMITS_JSON blank start and serve /health
  ok 3 - PROXY_MAX_BUFFERED_BODY_BYTES at its boundary values starts and serves /health
  not ok 4 - PROXY_MAX_BUFFERED_BODY_BYTES rejects a non-blank invalid value, names itself and states its rule
  ok 5 - PROXY_MAX_BUFFERED_BODY_BYTES=1 still proxies normally (values validated, not applied)
  ok 6 - PROXY_MODEL_LIMITS_JSON with well-formed budgets starts and serve /health
  ok 7 - PROXY_MODEL_LIMITS_JSON with well-formed budgets still proxies normally (values validated, not applied)
  not ok 8 - PROXY_MODEL_LIMITS_JSON with bad JSON exits 1 naming the variable
  not ok 9 - PROXY_MODEL_LIMITS_JSON with a non-object root exits 1 naming the variable
  not ok 10 - PROXY_MODEL_LIMITS_JSON with a blank model key exits 1 naming the variable
  not ok 11 - PROXY_MODEL_LIMITS_JSON with a non-object entry exits 1 naming the variable and the model key
  not ok 12 - PROXY_MODEL_LIMITS_JSON with an invalid rpm or tpm exits 1 naming the model key and the field
  not ok 13 - PROXY_MODEL_LIMITS_JSON with an entry that supplies no budget exits 1 naming the model key
  not ok 14 - PROXY_MODEL_LIMITS_JSON with one valid and one invalid entry exits 1 (never partially applied)
  ok 15 - PROXY_MODEL_LIMITS_JSON model keys are case-sensitive and unnormalized
  not ok 16 - PROXY_MODEL_LIMITS_JSON with a model key that has surrounding spaces exits 1 naming the variable
# tests 16
# pass 7
# fail 9
```

Every failure was `error: 'proxy process did not exit'` — the proxy *started*
where it should have died, so the behavior was missing, not the assertion. The
seven passing ones are the "must start" cases, which a build that ignores the
variables passes trivially.

The nine fatal tests were all still failing after the first implementation pass,
and test 8 exposed a real gap. With `JSON.parse` left uncaught, the child did
exit 1 — but stderr was Node's crash dump and never named the variable:

```
stderr should name PROXY_MODEL_LIMITS_JSON: <anonymous_script>:1
{not json
 ^
SyntaxError: Expected property name or '}' in JSON at position 1 (line 1 column 2)
    at JSON.parse (<anonymous>)
    at readModelLimits (…/config.js:141:23)
```

That is requirement 8 unmet, so the implementation now catches the parse failure
only to name the variable (see deviation D1).

## Verify

The brief's command, verbatim, from the repo root:

```
$ sh ~/scratch/verify.sh
no new security findings in affected paths: model limits fail closed
verify rc=0
```

`~/scratch/verify.sh` holds the command byte for byte as the brief prints it. The
count of matching `ok` lines in that run is 16 (every test in the block matches
the pattern), comfortably over the required 1.

Before the implementation, the same command exited 1 (empty output — the `&&`
chain stops at `test $rc -eq 0`).

## Full suite

```
$ npm test
ℹ tests 72
ℹ suites 6
ℹ pass 72
ℹ fail 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 87235.206685
```

56 before this task, 72 after: 16 new tests, 0 existing tests touched. The suite
takes about 90 s on this machine, up from about 78 s, because each new test
spawns fresh child processes.

## Mutation check

Each mutation was applied to `config.js`, the verify command was run verbatim,
then the filtered tap run was inspected for the catching test, then `config.js`
was restored (`cmp` confirmed the restore, `git status` clean at the end).

| # | Mutation | verify rc | Caught by |
| --- | --- | --- | --- |
| M1 | `if (fields.length === 0) { fatal(…) }` → `continue` (an entry with no budget is silently skipped, i.e. partial application) | 1 | `PROXY_MODEL_LIMITS_JSON with an entry that supplies no budget exits 1 naming the model key` |
| M2 | `if (field !== "rpm" && field !== "tpm")` → `if (field !== "rpm")` (a **valid** `tpm`-only map becomes fatal) | 1 | `…with well-formed budgets starts and serve /health`, `…with well-formed budgets still proxies normally…`, `…with an invalid rpm or tpm exits 1…` |
| M3 | `maxBufferedBodyBytes: hasMaxBodyBytes ? readPositiveInteger(…) : 8388608` → `maxBufferedBodyBytes: 8388608` (the ceiling stops being validated at all) | 1 | `PROXY_MAX_BUFFERED_BODY_BYTES rejects a non-blank invalid value, names itself and states its rule` |
| M4 | the `typeof value !== "number"` fatal → `budget[field] = 0` (an invalid budget is stored instead of being fatal) | 1 | `PROXY_MODEL_LIMITS_JSON with an invalid rpm or tpm exits 1 naming the model key and the field` |

Both directions the brief asked for are covered: M1 and M4 turn a fatal
model-limits case non-fatal, M2 turns a valid map fatal, M3 turns the ceiling
non-fatal. After the last restore:

```
$ sh ~/scratch/verify.sh
no new security findings in affected paths: model limits fail closed
verify rc=0 (post-restore)
```

### Mutations nothing caught — coverage holes

Two mutations of this task's own code leave the verify at 0. Both are properties
of the *stored* config object, which the black-box child-process harness cannot
read, so no test in this file could have caught either:

| Probe | Mutation | verify rc |
| --- | --- | --- |
| P1 | `: 8388608` → `: 4194304` (the 8 MiB default silently becomes 4 MiB) | 0 |
| P2 | `const limits = Object.create(null)` → `const limits = {}` (a model key named `__proto__` would be swallowed by the prototype setter and vanish from the map) | 0 |

Neither is papered over. They belong to the same class of gap LOG.md already
records for `rateLimit` and `limits`: **task 7's ADR 0002 has to record that the
8 MiB default, the `null` modelLimits default, and the null-prototype map are
reviewed by eye and not by test.** P2 is the reason the map is built with
`Object.create(null)`: with a plain `{}`, `{"__proto__":{"rpm":5}}` assigns
through the prototype setter and the stored map comes back with no own keys —
an entry that silently disappears, the exact failure class this story exists to
prevent. The scratch probe in "The config shape this task adds" shows the key
surviving verbatim.

## Count sweep

Before (11 hits, all reading 56):

```
$ grep -rnE 'tests(-| )?[0-9]{2,4}|[0-9]{2,4}[ -]?tests?' --include='*.md' --include='*.yaml' . \
    | grep -vE '^\./(plans/|docs/research/|LOG\.md|specs/epics/)'
./AGENTS.md:89
./AGENTS.md:107
./CONVENTIONS.md:17
./README.md:9
./README.md:86
./specs/README.md:19
./specs/product/VISION_LATEST.yaml:20
./specs/tech-architecture/TEST_PLAN_LATEST.md:44
./specs/tech-architecture/TEST_PLAN_LATEST.md:294
./specs/tech-architecture/TEST_PLAN_LATEST.md:351
./specs/tech-architecture/tech-stack.md:129
```

After (the same 11 lines, all reading 72; line numbers unchanged except in
`AGENTS.md`, whose 89 and 106 are its own count sites):

```
./AGENTS.md:89:- `npm test` — full suite (72 tests, Node built-in `node --test` runner, no deps to install)
./AGENTS.md:107:  Sites as of 2026-09-30: `README.md:9` badge `tests-72%20passing`, …
./CONVENTIONS.md:17:- `npm test` — runs all 72 tests
./README.md:9:[![Tests](https://img.shields.io/badge/tests-72%20passing-blue?style=flat-square)](server.test.js)
./README.md:86:> Run the test suite (72 tests, no deps needed):
./specs/README.md:19:- 72 tests in server.test.js
./specs/product/VISION_LATEST.yaml:20:  - 72 tests covering all major scenarios
./specs/tech-architecture/TEST_PLAN_LATEST.md:44:- 72 tests covering all major scenarios
./specs/tech-architecture/TEST_PLAN_LATEST.md:294:- All 72 tests must pass
./specs/tech-architecture/TEST_PLAN_LATEST.md:351:… The 72-test suite provides good coverage …
./specs/tech-architecture/tech-stack.md:129:- **Test Count**: 72 tests
```

`AGENTS.md` by hand, which the sweep pattern cannot match:

- `AGENTS.md:89` — 56 → 72.
- `AGENTS.md:106` — "(currently 56)" → "(currently 72)".
- `AGENTS.md:107` — badge in the sites inventory `tests-56%20passing` → `tests-72%20passing`.
- `AGENTS.md:84` — Repository knowledge's line inventory: `config.js` (~52 lines) → (~265 lines), `server.test.js` (~705 lines) → (~1408 lines). `wc -l` at the time: `265 config.js`, `249 server.js`, `1408 server.test.js`.

Left alone deliberately: `specs/epics/e04-rate-limiting/e04s01-config-owner-and-bind-host.md:336`
still says "the unchanged existing suite (56 tests)". `specs/epics/` is an excluded
path for this sweep, task 5 does not own the story file, and that line records
task 1's baseline. Flagging it so the orchestrator can route it (task 2's
precedent corrected that file's stale "34 tests").

## Deviations

**D1 — requirement 5 (no try/catch on this path) vs requirement 8 (bad JSON must
name the variable).** The brief requires both. They cannot both hold literally:
the uncaught `SyntaxError` reaches stderr without naming `PROXY_MODEL_LIMITS_JSON`
(observed output above), so requirement 8 is unimplementable without a catch. I
took requirement 8, since it is the operator-facing half and requirement 5's
stated purpose is "a `JSON.parse` failure must be fatal" and "no `catch` that
swallows and continues" — neither of which this does:

```js
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    fatal("PROXY_MODEL_LIMITS_JSON", `is not valid JSON: ${error.message}`);
  }
```

The catch is non-empty (so the verify's own `/catch\s*\{\s*\}/` regex passes) and
the `process.exit(1)` inside `fatal` is unconditional. The parser's own message
carries the position, and the document is never echoed. This is the same
non-empty-catch shape `parseConfig` already uses for `NVIDIA_BASE_URL`.

**D2 — requirement 6 ("keys stored byte for byte") implemented on
`Object.create(null)` rather than `{}`.** A plain object would silently drop a
model key named `__proto__` through the prototype setter, and would also let a
later slice's `modelLimits["toString"]` lookup return an `Object.prototype`
member for an unconfigured model. Keys are still stored exactly as written —
nothing is trimmed, lowercased, or rejected for its name — so the requirement is
met; the container choice is an addition, not a normalization. Justified by
requirement 3's "never partially applied" and by probe P2.

**D3 — arrays are rejected with `Array.isArray` checks, not bare
`typeof … !== "object"`.** Needed for the same reason: `typeof []` is `"object"`,
so without it the array rows of requirement 3's table (`[]` root, `{"gpt":[]}`)
would have been accepted. `typeName` names the shape (`an array`, `null`, `a number`,
`a string`, `a boolean`) so an array does not print as `a object`.

**D4 — a new `fatal(name, problem)` helper.** Eight new rejection messages share
it. `readPositiveInteger`'s signature is unchanged, `integerRule`'s wording is
unchanged, and no existing message text changed — the existing suite's exact-text
assertions (including task 4's) pass untouched.

**D5 — message wording for the seven rejection shapes** (all contain
`PROXY_MODEL_LIMITS_JSON`; the entry-level ones also contain the model key):

| Shape | Message |
| --- | --- |
| bad JSON | `PROXY_MODEL_LIMITS_JSON is not valid JSON: <parser message>` |
| non-object root | `PROXY_MODEL_LIMITS_JSON must be a JSON object, got: an array` |
| blank key | `PROXY_MODEL_LIMITS_JSON has a blank model key` |
| padded key | `PROXY_MODEL_LIMITS_JSON model key " gpt-4o-mini " has surrounding spaces` |
| non-object entry | `PROXY_MODEL_LIMITS_JSON["gpt"] must be a JSON object, got: a number` |
| entry with no budget | `PROXY_MODEL_LIMITS_JSON["gpt"] must supply rpm or tpm, got: an empty object` |
| unknown field | `PROXY_MODEL_LIMITS_JSON["gpt"] has an unknown field: rps (only rpm and tpm are read)` |
| invalid budget | `PROXY_MODEL_LIMITS_JSON["gpt-4o-mini"].rpm must be a positive integer, got: 1.5` |

The last line's text is produced by the *existing* `readPositiveInteger` +
`integerRule` pair, unchanged. The brief requires the whole
`must be a positive integer` text for the ceiling's `0` case; test 4 asserts it.

## Constraints inherited, and how they were honored

- `server.js` byte-identical: `git diff 83fc7bc..HEAD -- server.js | wc -l` → 0.
- `server.test.js` additive only: `278` insertions, `0` deletions, block appended
  after `operational limit config`, no existing test edited, reordered, or skipped,
  and no existing stub changed. Task 4's `LIMIT_VARIABLES` / `INVALID_VALUES` are
  untouched — the new block declares its own tables.
- Credential regime: untouched. `unconfigured` and the 503 path are unchanged, and
  task 1's credential tests pass in the 72.
- `readSeconds`, `CONNECT_TIMEOUT_SECONDS`, `IDLE_TIMEOUT_SECONDS`: untouched.
- No dependency, no `package.json` change, no `/tmp` use (scratch went to
  `~/scratch`, which holds the verify wrapper, the mutation wrapper, and the tap
  logs; nothing there is committed).
- `whitespace` appears in no new test name.
- Fresh-child runs only: every new test goes through `runProxyOnce` or
  `withProxy`; no new seam, no import of `config.js` from the test file.

## Not done, and why

- The epic spec's `(56 tests)` on line 336 is stale (see the count sweep) — excluded
  path, not this task's file.
- The 8 MiB default, the `null` modelLimits default, and the null-prototype map are
  unpinned by tests (probes P1 and P2). They need to go into task 7's ADR 0002 as
  reviewed-by-eye, alongside the `rateLimit` and `limits` shapes already recorded
  there.
