# ADR 0002: Operational configuration — fail-fast, extending ADR 0001

* Status: accepted
* Date: 2026-10-01
* Amended: 2026-10-01 — e03s01 adds `PROXY_LOG_REQUESTS`, the tenth operational variable and the
  first one that is a flag rather than a ceiling. The regime does not move; the parsing rule is a
  closed vocabulary. See *Decision* §1.5, §2, and *Compliance*.
* Deciders: maintainers
* Extends: ADR 0001 — [Config validation — fail-fast for base URL, degrade for credentials](0001-config-validation-fail-fast-vs-degrade.md)
* Context file: [`CONTEXT.md`](../../CONTEXT.md) — see *misconfigured*, *unconfigured*, *health*, *connect window*, *idle window*

## Context and problem statement

ADR 0001 settled a regime split for three variables: a bad `NVIDIA_BASE_URL` is fatal at startup,
a missing `NVIDIA_API_KEY` or `PROXY_AUTH_TOKEN` degrades to a runtime 503. That split was derived
from the kind of state each variable describes, not from a preference for one behavior over the
other.

The rate limiting epic then arrived needing nine more variables, and none of them is a credential:
`PROXY_HOST`, `PROXY_RPM`, `PROXY_TPM`, `PROXY_MAX_CONCURRENT_REQUESTS`, `PROXY_MAX_QUEUE_SIZE`,
`PROXY_QUEUE_TIMEOUT_SECONDS`, `PROXY_SAFETY_MARGIN_PCT`, `PROXY_MAX_BUFFERED_BODY_BYTES`, and
`PROXY_MODEL_LIMITS_JSON`. Their failure modes are not obvious. A silently-defaulted queue depth, a
whitespace value read as `0`, a half-written rate pair — none of these crashes anything. They just
produce a proxy that enforces something other than what the operator wrote, or enforces nothing
while appearing to.

Two long-standing precedents pull the other way. `readSeconds` in `config.js` maps any
non-finite or negative timeout value to its fallback, so `UPSTREAM_IDLE_TIMEOUT_SECONDS=abc` has
silently become `120` for the life of the project. Two of the new variables,
`PROXY_QUEUE_TIMEOUT_SECONDS` and `PROXY_MAX_CONCURRENT_REQUESTS`, are *also* timeouts and
concurrency limits, so the same reasoning would apply to them with no obvious seam. And `Number()`
coercion, which `readSeconds` uses, silently reinterprets an operator's ceiling:
`Number("1e3")` is `1000`, `Number("0x10")` is `16`.

So the question this ADR answers is narrow and deliberate: **where does ADR 0001's regime split
fall for variables that describe an operational policy, and what happens to the existing lenient
fallback?**

A tenth operational variable has since arrived from a different epic — `PROXY_LOG_REQUESTS`
(issue #9, story `e03s01`) — and it is the first one that is not a ceiling. It is a flag, so it has
no range to validate: its rule is a vocabulary instead of a number. The same question applies, and
the answer is the same regime with a rule that could not have been written for the other nine.

## Decision

### 1. The two regimes extend; neither moves

1. **Operational configuration fails fast at startup.** Any of the nine variables above, supplied
   non-blank with a value its rule rejects, calls `process.exit(1)` from `parseConfig` with one
   line on stderr naming the variable and the rule it broke.
2. **The credential regime from ADR 0001 is unchanged.** A missing or whitespace-only
   `NVIDIA_API_KEY` or `PROXY_AUTH_TOKEN` still starts the process and still degrades to
   `unconfigured`: `/health` → 503 `{ status: "unconfigured" }`, proxied request → 503
   `{ error: "Proxy is not configured" }`. Unauthenticated callers still get 401 before that 503,
   so neither response ever reveals which credential is absent.
3. **`readSeconds` leniency is preserved, unchanged, for exactly two variables.**
   `UPSTREAM_CONNECT_TIMEOUT_SECONDS` and `UPSTREAM_IDLE_TIMEOUT_SECONDS` keep returning their
   fallback for an empty, whitespace, non-finite, or negative value. Tightening them is a
   behavior change outside this decision's scope. Nothing else may use `readSeconds`; the
   leniency is a named exception, not a general parsing mode.
4. **The nine rate-limiting variables above are validated and stored, not enforced.** Nothing in
   this change reads them at request time except `config.host`, which `server.js` passes to
   `server.listen`. The rate budgets, ceilings, and per-model map are dead weight on the config
   object until the later slices (#15–#22) act on them. This story changes nothing about request
   handling.
5. **`PROXY_LOG_REQUESTS` is under the same regime, and is the one operational variable that is
   live.** Anything outside its vocabulary is fatal at startup, exactly like a mistyped ceiling:
   the failure shape is identical — a value the operator wrote and the proxy did not honor, noticed
   by nobody. Unlike the nine, it *is* read at request time, so `config.logRequests` gates one
   stdout line per request rather than sitting unread. The variable is new, so this fatal path
   cannot break a deployment that predates it. Absent, blank, or falsy it is off, which is what
   keeps a deployment that never sets it byte-identical to a build without the feature.

### 2. Parsing rules, and why each exists

* **Decimal digits only, never `Number()` coercion.** A supplied scalar must match `/^[0-9]+$/`
  after trimming and be a safe integer in range. `readPositiveInteger` is the single guard; the
  two variables whose rules differ from the default pass `min`/`max`/`zeroDisables` into it rather
  than a near-copy that could drift. Rejected shapes: `-1`, `1.5`, `abc`, `1e3`, `0x10`, `+5`,
  `.5`, `1_000`, `1e400`, `9007199254740993`, a 30-digit run.
  An operator who wants 1000 gets 1000; one who typed `1e3` gets a crash one keystroke from
  correct. Failing closed is the cheaper mistake for a budget.
* **Blank is checked before any numeric parsing.** `Number("  ")` is `0`, so a whitespace-only
  value that reached the numeric guard would read as a *supplied* `0` rather than an absent
  variable — and for the defaulted ceilings that means a silently zeroed limit instead of the
  documented default. Every group checks `.trim()` truthiness first. For `PROXY_MODEL_LIMITS_JSON`
  the same ordering is required for a different reason: `JSON.parse("  ")` throws.
* **Scientific notation is rejected for env scalars only, and that asymmetry is forced.** JSON's
  numeric grammar accepts `1e3` and yields the number `1000`; by the time `readModelLimits` holds a
  per-model budget there is no textual evidence left of what was written, so no guard can inspect
  it. Env scalars have no such loss and are checked as written.
* **`0` means different things per variable, deliberately.** `PROXY_MAX_CONCURRENT_REQUESTS=0`
  disables the ceiling (stored as `null`). `0` is the low end of `PROXY_SAFETY_MARGIN_PCT`'s 0–50
  range. `0` is *fatal* for `PROXY_MAX_QUEUE_SIZE`, `PROXY_QUEUE_TIMEOUT_SECONDS`, and
  `PROXY_MAX_BUFFERED_BODY_BYTES`, because a zero-length queue, a zero-second wait, or a zero-byte
  buffer turns the mechanism into immediate rejection — a limit that appears to exist and does not.
  The rate pair takes the plain positive-integer rule, so `0` is fatal there too.
* **`PROXY_RPM` and `PROXY_TPM` are a mandatory pair.** Both absent or blank → `rateLimit` is
  `null` and rate limiting is off. Exactly one non-blank is fatal, and the message names *both*
  variables plus the missing half. Half a budget is a budget that appears to exist and does not.
* **`PROXY_MODEL_LIMITS_JSON` is rejected whole, never partially.** Bad JSON, a non-object root
  (including an array, whose indices would otherwise become model IDs), a blank, padded, or
  control-character-bearing model key, a non-object entry, an entry supplying neither `rpm` nor
  `tpm`, an unknown field inside an entry, and a non-positive-integer `rpm`/`tpm` are all fatal.
  One rejection ends the process, so no invalid entry is adopted beside a valid one and no
  per-row report is emitted. `{}` is accepted: zero models is a well-formed statement that no
  per-model budget exists.
* **`PROXY_HOST` is not parsed; it is passed through.** Absent, empty, or whitespace-only →
  `"0.0.0.0"`. Anything else is handed to `server.listen` verbatim and untrimmed, so no value is
  silently rewritten. No allowlist, no DNS check, no rule — see Consequences for why, and for the
  one way this is harsher than it looks.
* **`PROXY_LOG_REQUESTS` is a closed vocabulary, not a range.** `1`/`true`/`yes`/`on` enable,
  `0`/`false`/`no`/`off` disable, matched case-insensitively after trimming; unset, empty, or
  whitespace-only is off. Anything else is fatal, with the rule and the offending value (bounded at
  60 characters) in one stderr line. This is the file's **third** parsing shape, alongside
  `readPositiveInteger`'s digits-only range for the ceilings and `readSeconds`' lenient fallback for
  the two timeouts — and the first that reads a word list.
* **The blank-before-parse rule holds for the flag too, for the same reason as the numbers.**
  A whitespace-only `PROXY_LOG_REQUESTS` is an *absent* variable, not an unparseable one.

## Rationale

### Why the split is the right one

ADR 0001's test was *can the proxy be useful without this variable, and is its absence recoverable
without redeploying a broken image?* The nine new variables fail that test in the credential's
direction and pass it in the base URL's:

* **An operational variable describes a policy the operator has decided.** If the proxy cannot
  honor it, it must not start, because a running process is the signal that the policy is in
  force. A silently-defaulted or silently-dropped limit is a budget that appears to exist and does
  not — the exact failure this story exists to prevent, and the reason a typo in a ceiling is
  fatal rather than absorbed.
* **A credential describes data that may be attached late.** Its absence is fixable by setting one
  variable, and the failure stays visible and diagnosable because the process is up and can say
  so. A restart loop would bury a one-line cause under platform telemetry.

So the regimes are the same two regimes ADR 0001 defined, applied to a larger population. Reviewers
should not "fix" the asymmetry by making the credentials fatal, and should not "fix" it by giving
operational variables a silent fallback. Both directions were considered and rejected below.

### Why the timeout leniency survives

`UPSTREAM_CONNECT_TIMEOUT_SECONDS` and `UPSTREAM_IDLE_TIMEOUT_SECONDS` keep their fallback, and
that is a scoped decision rather than an endorsement of the practice:

* Changing them is a behavior change to a shipped default, outside this decision's scope and not
  required by any of the nine new variables.
* Their fallback is load-bearing in a way a budget's is not. A timeout set too low fails *loudly
  and immediately* — requests return 502, the operator sees it in one request, and the setting is
  one env var away from fixed. A queue size quietly defaulted to 32 under an operator who asked for
  256 fails silently for as long as traffic stays under 33 concurrent requests.

That asymmetry is about *observability of the failure*, not about how important the variable is.
The new ceilings earn strictness because their failure mode is the quiet kind.

### Why a flag is still fatal, when the alternative is merely "off"

A boolean is the weakest case for strictness, and the story that asked for it said so: it proposed
that *any* non-blank value other than `0`/`false` enables logging. Fatal was chosen over that, and
over a lenient "unrecognized means off" fallback, for four reasons:

* **The failure shape is the one this ADR exists to prevent.** `PROXY_LOG_REQUESTS=maybe` starting
  the feature means an operator wrote a value the proxy did not honor and nobody found out — the
  same family as `Number("1e3")` being `1000` for a rate limit, and the same reason a mistyped
  ceiling is fatal. A log line is not a budget, but the mechanism by which a wrong value goes
  unnoticed is identical.
* **"Off on a typo" is not neutral, it is a silent default.** Falling back to `false` means an
  operator who asked for logging and typo'd the value gets a proxy that looks configured and logs
  nothing. Failing closed at least leaves a one-line stderr message naming the variable.
* **The variable is new, so strictness costs nothing in compatibility.** No existing deployment
  can carry a value this guard rejects; the fatal path cannot break anything that predates it.
* **Leniency would add a second parsing dialect.** `readSeconds` is the file's one, and this ADR
  already names it a scoped exception rather than a mode. A flag that accepted arbitrary operator
  text would be the first rule in the file with no closed set at all.

The trade-off is real and recorded under Consequences: a boolean that could have failed open instead
crashes the process, so a typo in a *logging* variable blocks a deploy.

### Why `readPositiveInteger` is one guard

Two variables needed a different rule from the default (`PROXY_MAX_CONCURRENT_REQUESTS`'s
zero-disables, `PROXY_SAFETY_MARGIN_PCT`'s 0–50 range). Writing a second guard for them would put
two copies of the digits-only check in the file, and the copy is what drifts. Reversing the
digits-only decision is one guard and one test; the same is true for the range arguments.

## Coverage: what the test suite can and cannot see

### Reviewed by eye, not by test

**The black-box child-process harness in `server.test.js` cannot observe the config object.** Each
test spawns `server.js` as a child, reads the port and bound address back over IPC, and asserts on
HTTP responses and exit codes. `parseConfig` returns an object no test ever holds. There is
exactly one test seam — `server.js`'s default export — and this story forbids adding a second one,
so no test can assert on a stored value.

What that makes **reviewed by eye, not by test**:

* the stored defaults `32` (`maxQueueSize`), `30` (`queueTimeoutSeconds`), `5`
  (`safetyMarginPct`), and `8388608` (`maxBufferedBodyBytes`);
* the `null` that disables the concurrency ceiling;
* the `null` that means "no per-model budgets", the empty-object case, and the `null`-prototype map
  itself;
* the `rateLimit` shape from the rate pair — that it is one field, that both halves are present,
  that it is `null` rather than a partial object;
* the `limits` shape, including that `maxConcurrentRequests` is its only nullable member;
* **and every config field a later task adds.** This is a standing rule for the epic, not a
  one-time note about slice #14: any new field is invisible to the harness, so the shape and the
  defaults are review obligations from the moment they are written.

Distinguish this carefully from what the suite *does* pin, which is real and substantial: **which
configurations start, which exit 1, and exactly what stderr says.** The boundary tests do start the
proxy with `32`, `30`, `50`, and `8388608` — they prove those values are *accepted*. They cannot
prove that `32` is what is *stored when the variable is absent*, because a defaulted ceiling and a
supplied one are the same observable startup. Reviewers should read the defaults in `config.js`
rather than trust that a passing boundary test vouches for them.

**`config.logRequests` is the first operational field the harness *can* pin.** The rule above holds
because every earlier field's effect is invisible from outside the process. This one's effect is
stdout: a child started with the variable unset, blank, or falsy writes no request log line, and a
child started with `1` writes exactly one per request. That makes the stored boolean observable
without a second config seam, which no earlier field managed. What stays *reviewed by eye* is the
value's own identity — that `true` is `true` — and nothing asserts it separately, because the
stdout difference is the stronger claim and the two cannot disagree.

Two consequences follow, and both are already visible in the test comments:

* A blank `PROXY_MAX_CONCURRENT_REQUESTS` cannot be distinguished from an explicit `0` through
  this harness. The falsifiable half is the pair whose `0` *is* fatal —
  `PROXY_MAX_QUEUE_SIZE` and `PROXY_QUEUE_TIMEOUT_SECONDS` — where reading a blank as a number
  would exit 1 and the test would fail. No test claims more than that.
* A test name that says "validated, not applied" is doing something specific: it pins that a
  configuration extreme does not *change* traffic, so a later slice that starts enforcing has to
  change that test deliberately rather than discover the change in production.

### Standing rule: re-prove a fatal message by test, not by reading it

**A fatal message that can itself crash its own path must be proved by test rather than by
re-reading it**, because reading it is exactly what missed the defect.

The concrete instance: the fatal message for a non-positive-integer budget called
`JSON.stringify` on the offending value with no bound. A `PROXY_MODEL_LIMITS_JSON` value nested
7,000 levels deep threw `RangeError: Maximum call stack size exceeded` *inside* the fatal path. The
process still exited 1, but stderr was a Node stack dump that quoted the source line — so it
mentioned `PROXY_MODEL_LIMITS_JSON` by accident and named neither the field nor the rule. Below
the crash threshold the same expression put 36 KB of the operator's document on one stderr line.

Two rules follow, both now enforced by
`PROXY_MODEL_LIMITS_JSON with a pathological budget value exits 1 with a bounded one-line message, not a crash`:

* **Objects and arrays report their type; only primitives echo text**, bounded and escaped.
  `describeValue` never recurses into the offending value.
* **A test for a fatal path asserts the interpolated field path, never the variable name alone.**
  A stack dump quotes the source line, so an assertion that stderr merely *mentions*
  `PROXY_MODEL_LIMITS_JSON` passes against the very crash it exists to catch. The assertion that
  cannot be faked is `PROXY_MODEL_LIMITS_JSON["gpt"].rpm must be a positive integer`, plus the
  absence of `RangeError` and of a stack-dump marker, plus a one-line and under-300-byte bound.

Any future fatal path that formats operator-supplied data inherits this rule: the test's assertion
must be one that the failure mode itself cannot accidentally produce.

### Accepted fail-open: a duplicate top-level model key

**Accepted gap, recorded so it is not rediscovered as an oversight.**

```json
{"gpt":{"rpm":5,"tpm":9},"gpt":{"tpm":3}}
```

`JSON.parse` keeps the last member of a duplicated name, so the stored map holds only
`{"tpm":3}`. The `rpm: 5` the operator wrote vanishes, and the proxy starts silently. This is the
one case where a *valid* document produces a stored map that does not match what was written — the
same failure class the same code makes fatal for a misspelled field, which is exactly why it is
recorded here rather than left implicit.

**Decision: accept it.** Closing it in code is not cheap, and each available approach is worse than
the bug:

* `JSON.parse` exposes no duplicate-key hook. Detection needs a reviver with per-holder
  bookkeeping, and a reviver cannot know its own path — so the error message would be less useful
  than the ambiguity it reports.
* A regex over the raw text false-positives on nested keys (`{"gpt":{"note":"gpt"}}`) and on
  escaped ones.
* RFC 8259 §4 leaves the behavior for duplicate object names unpredictable and says most
  implementations report the last name/value pair only, so last-wins is not this proxy's quirk but
  the ecosystem's default.

The mitigation that does work is documentation, and it is task 8's: name the constraint where
operators will read it. Reversal would be one guard plus the tests that pin it.

### Control characters in a model key

A model key carrying a C0 control character or DEL is **fatal**, named by its byte in `U+XXXX`
form (`PROXY_MODEL_LIMITS_JSON model key "gpt\u0001x" contains a control character: U+0001`), never
stored and never echoed raw, so stderr stays one line and cannot carry an escape into a terminal.

This shape is closed rather than accepted for a coherent reason: the code already rejects a model
key that is not equal to its own trimmed form, because a padded key can never match a model ID. A
control character cannot match one either, so accepting it would contradict a rule the same function
applies two lines above. Model IDs are stored exactly as written — never trimmed, lowercased, or
otherwise normalized — and case sensitivity is load-bearing: `Gpt` and `gpt` are two distinct models.

## Consequences

**Positive**

* A mistyped ceiling is a one-line stderr message at deploy time, not a silent misconfiguration
  discovered in production traffic.
* The digits-only guard and the `integerRule` wording make the failure message self-sufficient: an
  operator reading only stderr knows which variable and which end of the range was violated, and
  that `0` is a disable rather than a limit of zero where that is the case.
* One guard, one config owner. Adding a variable means picking its regime and its rule explicitly,
  and the later slices that need it inherit both instead of writing a ninth parsing dialect.
* The validated-but-unenforced state is cheap to reverse: the values are already parsed, validated,
  and shaped for the fields the later slices read, so #15–#22 add enforcement without revisiting
  parsing.
* The request log line's field set is closed *by construction*, not by filtering: the object
  literal in `logRequestOnClose` names `ts`, `method`, `path`, `status`, and `ms` and nothing else,
  so a header, a body, a credential, or the upstream host cannot reach the line even if a future
  edit forgets to exclude one. Its privacy boundary is reviewable as a five-item list.

**Negative / neutral**

* **Two regimes — plus a third behavior for the two timeout variables — is a real asymmetry.**
  Eleven variables fail fast (the base URL from ADR 0001, these nine, and `PROXY_LOG_REQUESTS`),
  two degrade, and two keep their own fallback. The dividing line is a judgment about what kind of
  state a variable describes, so it has to be *understood*, not memorized — this ADR and ADR 0001
  are what carry it, and `config.js` states the rule at each guard.
* **`config.js` now holds three parsing shapes, and the flag's is a word list.** Digits-only range,
  lenient numeric fallback, closed boolean vocabulary. The first two were a documented pair; the
  third arrived with the first non-ceiling variable, and a reader who assumes a `PROXY_*` value is
  a number will misread `PROXY_LOG_REQUESTS`. Each guard states its own rule at the call site, which
  is the mitigation — but it is a mitigation, not a single dialect.
* **A typo in a logging variable blocks a deploy.** `PROXY_LOG_REQUESTS=maybe` exits 1 rather than
  starting with logging off. The strict reading buys an unambiguous signal at the price of the one
  variable whose failure costs nothing operationally, so the trade is deliberate and is the one
  place where this ADR's regime is arguably harsher than the stakes justify.
* **A configured limit is currently invisible in behavior.** Until enforcement lands, setting
  `PROXY_RPM=1` changes nothing an operator can see in traffic; the only honest reading today is
  "validated and stored". The four tests named "validated, not applied" exist so that a later
  slice has to change them deliberately, but a reader who takes the variables as enforcement today
  is wrong. This is the story's known risk, accepted per #13.
* **`PROXY_HOST` is the security-relevant variable and is the least validated one.** It is the only
  one that changes what the process is reachable from, and it is the only one with no rule at all:
  no allowlist, no parse, passed through verbatim. That is deliberate — rejecting an unfamiliar but
  valid address (a hostname, a container network alias) would turn a working deploy into a startup
  crash, and `server.listen` already fails on an address it cannot bind. Two honest consequences:
  * An unbindable or padded `PROXY_HOST` fails as an **unhandled `'error'` event**, so the process
    exits 1 with a Node stack dump rather than the one-line named-variable message every other
    operational fatal path produces. It is loud, and it is inconsistent with the rest of this ADR.
    `config.js`'s comment says `listen()` "fails loudly", which is true; it does not say it fails
    with the message discipline the rest of the file keeps.
  * A value that is whitespace-only is *absent* and takes the `0.0.0.0` default, but a value that is
    merely whitespace-*padded* (`" 127.0.0.1 "`) is passed through untrimmed and fails to bind.
    Every other variable in the file treats padding as surrounding whitespace to trim.
* **`PROXY_MODEL_LIMITS_JSON` rejects the whole document on the first bad entry.** An operator with
  one typo across 200 models gets no per-row report and no list of what was wrong with the rest.
  That is the deliberate price of never partially applying a budget; per-row reporting would mean
  the process could start with a map that does not match the document.
* **The duplicate-key fail-open is real and stays open.** An operator who writes the same model
  twice loses the earlier budget with no signal. Accepted, with the reasons above.
* **The suite is now hermetic against ambient operational variables, in the test harness and nowhere
  else.** It was not: a child inherited `process.env`, and a test that means "absent" had to drop
  the key explicitly, so an exported `PROXY_SAFETY_MARGIN_PCT=51` turned a green suite mostly red.
  The harness now strips every variable this ADR governs before applying a test's own overrides, so
  an operator's shell cannot decide the result. `config.js` deliberately keeps reading its own
  environment: silencing it there would hide a real deployment mistake, which is the opposite of
  what this ADR is for. A consequence worth stating: an operational variable added in a later slice
  is inherited by the harness until `CONFIG_ENV_VARS` in `server.test.js` names it, and the
  `harness environment isolation` tests catch that only for the variables they enumerate.
  `PROXY_LOG_REQUESTS` is the concrete instance and it landed correctly: it is in `CONFIG_ENV_VARS`
  in the same commit that added it to `config.js`, so an operator's exported
  `PROXY_LOG_REQUESTS=true` cannot turn the off-by-default test red. The list is named, not
  derived, which is why `AGENTS.md` now states the obligation as a rule for the commit that adds a
  variable rather than leaving it to be remembered.
* The `integerRule` branch that renders "a non-negative integer" has no caller today. It exists for
  a future variable passed `{ min: 0 }` without `zeroDisables`; a reader should not expect to see
  that wording in stderr yet.
* No dependency, no tooling, and no config file format is introduced. The rules live in one file
  with no new package, no new directory, and no `src/`.

## Alternatives considered

* **Validate operational variables leniently, like the timeouts** — rejected. It is the failure the
  story was written against: a ceiling that silently becomes its default, or a `0` that silently
  disables a budget the operator believed was set. It also makes `PROXY_MAX_QUEUE_SIZE=0` a quiet
  way to reject every queued request. Leniency survives only for the two timeout variables, where
  the failure is immediate and visible.
* **Fail-fast on credentials too** — rejected; it reopens the crash-loop-on-missing-secret problem
  ADR 0001 closed, and it would break the auth-before-unconfigured ordering that stops a 503 from
  revealing credential state to an anonymous caller. ADR 0001's credential regime is preserved here
  deliberately, including its `.trim()` treatment of whitespace-only secrets.
* **Degrade on operational variables** (start, apply a default, warn) — rejected. A proxy that is
  running says its policy is in force. A degraded limit has no state an operator can observe, so
  there is nothing to diagnose and nothing to alert on.
* **A JSON-lines or otherwise structured config format for per-model limits** — rejected. The
  operator-facing surface is environment variables on a deploy platform; a second format would add a
  parser, a file-mount dependency, and a new failure mode (a missing file, a stale file) to save
  nothing. JSON inside one env var keeps the single-scalar deployment model and needs no library.
* **Keep everything in `server.js` and grow `validateConfig`** — rejected. Nine more variables in
  the file that also owns HTTP handling, streaming, and shutdown; and nine later slices that each
  need to know what the limits are, in the one place a reviewer can look. `config.js` is the answer.
  ADR 0001's own note that "a single function owns the rule, so adding a future variable means
  picking its regime explicitly" is now load-bearing rather than aspirational.
* **Add a config-module unit-test seam to close the coverage gap above** — rejected for this story,
  explicitly, because it would be a second seam and the story forbids one. The gap is recorded here
  instead. Revisiting it is a decision for the epic, not a side effect of slice #14.
* **Tighten the two timeout variables while the file is open** — rejected as a behavior change
  outside this decision's scope. It remains available as its own change if the epic wants it.

## Compliance

Pinned by tests in `server.test.js`. Every name below is quoted from the suite.

**Startup regime (carried from ADR 0001, still green):**

* `exits 1 when NVIDIA_BASE_URL is missing`, `exits 1 when NVIDIA_BASE_URL is not a valid URL`,
  `exits 1 when NVIDIA_BASE_URL is not http(s)` — fatal regime, exit code 1 and stderr asserted.
* `health 503 when unconfigured (missing proxy token)` and `proxied request on unconfigured proxy
  returns generic 503 body` — degrade regime for credentials, 503 bodies pinned.
* `unauthenticated request gets 401 (not 503) when only the API key is missing` — pins the
  auth-before-unconfigured ordering and the upstream is never contacted.
* `health 200 when configured` — the configured path still starts and reports `ok`.

**`PROXY_HOST`:**

* `PROXY_HOST=127.0.0.1 binds loopback and serves /health`;
* `PROXY_HOST unset, empty, or whitespace-only binds 0.0.0.0` — the default-path regression guard;
* `PROXY_HOST=127.0.0.1 leaves header forwarding, credential swap, path mapping, and /health
  unchanged` — the only change is the listener address.

**Rate pair:**

* `PROXY_RPM and PROXY_TPM both absent leaves rate limiting disabled` and `PROXY_RPM and PROXY_TPM
  blank (empty or whitespace-only) start with rate limiting disabled`;
* `PROXY_RPM and PROXY_TPM both valid start and serve /health`;
* `PROXY_RPM and PROXY_TPM set to a tiny budget still proxy normally (values validated, not
  applied)`;
* `PROXY_RPM set with PROXY_TPM absent exits 1 naming both variables`, `PROXY_TPM set with PROXY_RPM
  absent exits 1 naming both variables`, `PROXY_TPM set with PROXY_RPM whitespace-only exits 1
  naming both variables` — the mandatory-pair rule, including that a blank partner counts as absent;
* `PROXY_RPM non-blank but not a positive integer exits 1 naming PROXY_RPM` and `PROXY_TPM
  non-blank but not a positive integer exits 1 naming PROXY_TPM` — `0`, `-1`, `1.5`, `abc`,
  `9007199254740993`, and a 30-digit run;
* `PROXY_RPM and PROXY_TPM reject 1e3 and 0x10 while accepting the same values in decimal` — the
  digits-only decision, pinned in both directions.

**Operational limits:**

* `PROXY_MAX_CONCURRENT_REQUESTS, PROXY_MAX_QUEUE_SIZE, PROXY_QUEUE_TIMEOUT_SECONDS and
  PROXY_SAFETY_MARGIN_PCT all absent start and serve /health`;
* `PROXY_MAX_CONCURRENT_REQUESTS, PROXY_MAX_QUEUE_SIZE, PROXY_QUEUE_TIMEOUT_SECONDS and
  PROXY_SAFETY_MARGIN_PCT blank start and serve /health`;
* `PROXY_MAX_CONCURRENT_REQUESTS, PROXY_MAX_QUEUE_SIZE, PROXY_QUEUE_TIMEOUT_SECONDS and
  PROXY_SAFETY_MARGIN_PCT at their boundary values start and serve /health`;
* `PROXY_MAX_CONCURRENT_REQUESTS=0 starts and serves /health (zero disables the ceiling)` and
  `PROXY_MAX_QUEUE_SIZE and PROXY_QUEUE_TIMEOUT_SECONDS reject 0` — the per-variable meaning of `0`;
* `PROXY_SAFETY_MARGIN_PCT outside 0-50 exits 1 naming PROXY_SAFETY_MARGIN_PCT`;
* `each of PROXY_MAX_CONCURRENT_REQUESTS, PROXY_MAX_QUEUE_SIZE, PROXY_QUEUE_TIMEOUT_SECONDS and
  PROXY_SAFETY_MARGIN_PCT rejects a non-blank invalid value, names itself and states its rule` — pins
  the exact stderr wording per variable, so `0 disables` cannot silently become `non-negative`;
* `PROXY_MAX_QUEUE_SIZE and PROXY_QUEUE_TIMEOUT_SECONDS whitespace-only starts and serves /health,
  where 0 is fatal`, `PROXY_MAX_CONCURRENT_REQUESTS whitespace-only starts and serves /health`,
  and `PROXY_SAFETY_MARGIN_PCT whitespace-only starts and serves /health` — blank-before-parse
  ordering for all four, including the one whose `0` is a legal disable;
* `PROXY_MAX_CONCURRENT_REQUESTS blank (spaces or tab) starts and serves /health` — the
  concurrency ceiling's own blank case;
* `PROXY_MAX_CONCURRENT_REQUESTS=1 over a one-slot queue still proxies normally (values validated,
  not applied)`.

**Buffered body ceiling and per-model limits:**

* `PROXY_MAX_BUFFERED_BODY_BYTES and PROXY_MODEL_LIMITS_JSON absent start and serve /health`;
* `PROXY_MAX_BUFFERED_BODY_BYTES and PROXY_MODEL_LIMITS_JSON blank start and serve /health`;
* `PROXY_MAX_BUFFERED_BODY_BYTES at its boundary values starts and serves /health`;
* `PROXY_MAX_BUFFERED_BODY_BYTES with surrounding spaces starts and serves /health` — padding is
  trimmed by the guard, so `" 4096 "` is the same ceiling as `"4096"`;
* `PROXY_MAX_BUFFERED_BODY_BYTES rejects a non-blank invalid value, names itself and states its
  rule` — including `0`, and including that the offending value is echoed;
* `PROXY_MAX_BUFFERED_BODY_BYTES=1 still proxies normally (values validated, not applied)`;
* `PROXY_MODEL_LIMITS_JSON with well-formed budgets starts and serves /health` — both fields, `rpm`
  alone, `tpm` alone, and the empty object;
* `PROXY_MODEL_LIMITS_JSON with well-formed budgets still proxies normally (values validated, not
  applied)`;
* `PROXY_MODEL_LIMITS_JSON with bad JSON exits 1 naming the variable`;
* `PROXY_MODEL_LIMITS_JSON with a non-object root exits 1 naming the variable`;
* `PROXY_MODEL_LIMITS_JSON with a blank model key exits 1 naming the variable`;
* `PROXY_MODEL_LIMITS_JSON with a model key that has surrounding spaces exits 1 naming the
  variable` — a key that can never match a model ID;
* `PROXY_MODEL_LIMITS_JSON with a control character in a model key exits 1 naming the byte, not the
  raw byte` — `U+0001`, `U+001B`, `U+007F`, each asserting the code point is named, the raw byte is
  not echoed, and stderr is one line;
* `PROXY_MODEL_LIMITS_JSON with a non-object entry exits 1 naming the variable and the model key`;
* `PROXY_MODEL_LIMITS_JSON with an entry that supplies no budget exits 1 naming the model key` —
  the empty entry and the misspelled field beside a real one;
* `PROXY_MODEL_LIMITS_JSON with an invalid rpm or tpm exits 1 naming the model key and the field`;
* `PROXY_MODEL_LIMITS_JSON with one valid and one invalid entry exits 1 (never partially applied)` —
  both orderings, so a refactor that collected valid entries first cannot pass;
* `PROXY_MODEL_LIMITS_JSON with a pathological budget value exits 1 with a bounded one-line message,
  not a crash` — the standing rule above, at 2000 and 7000 levels of nesting and with a
  5000-character string;
* `PROXY_MODEL_LIMITS_JSON model keys are case-sensitive and unnormalized` — the case claim is
  pinned by the fatal path echoing an uppercase key byte for byte, which a lowercasing mutation
  cannot fake. The stored map itself remains *reviewed by eye*: nothing in the harness can hold it.

**`PROXY_LOG_REQUESTS` (added by e03s01, the tenth operational variable):**

* `logging is off by default: unset, blank, 0 and false write no request log line` — the
  default-off regime, in all four of the ways it can be reached;
* `PROXY_LOG_REQUESTS accepts its documented truthy and falsy words` — the closed vocabulary in both
  directions, including the case-insensitive and trimmed forms;
* `PROXY_LOG_REQUESTS with a non-blank invalid value exits 1 naming the variable and its rule` — the
  fatal regime over six invalid values, and by the standing rule above it asserts the interpolated
  message plus the echoed value, one stderr line, and the absence of any stack-dump marker, rather
  than the bare variable name;
* `logging enabled writes one JSON line per request with method, path, status and ms` — the field
  set, asserted as an exact key set so a field added later fails;
* `/health is logged when logging is enabled`, `local rejections are logged: 401 for a bad token and
  404 for a bare /v1`, and `an unreachable upstream is logged as 502 without naming the upstream host
  or URL` — the line covers local and upstream responses alike;
* `no request log line contains the proxy token, the API key, an authorization value, a request
  body, or the upstream host:port` — the exclusion rule from the story, pinned against a child whose
  stdout the harness actually reads;
* `an SSE response is byte-identical with logging on and off and is logged on completion` and
  `a streamed response is logged on close, not mid-stream, and its duration covers the whole stream`
  — the close-event decision and the no-response-change invariant, for streams;
* `enabling logging changes no response status, body, or headers` — logging is live and still
  invisible in the response;
* `a failing log write does not reach the response path` — the swallowed write failure, which is
  the one failure this regime introduces that is *not* allowed to stop the process: an uncaught
  throw inside a response event would kill the proxy over a log line;
* `a mid-stream upstream failure logs a well-formed line with the last written status and leaves the
  process healthy` and `a client disconnect before any status is written logs status 0 and no
  invented code` — the two incomplete-response cases the status field has to have a rule for.

**Timeout leniency preserved:**

* `empty or whitespace timeout env vars fall back to defaults`,
  `upstream that never sends response headers times out with 502`,
  `stalled stream is cut by the idle timeout`,
  `idle timeout disabled (0) lets a slow stream finish`,
  `stream duration exceeding connect timeout finishes successfully` — `readSeconds` unchanged, and
  the suite is the regression guard against tightening it.

**Reviewed by eye, not by test** — the stored defaults `32`, `30`, `5`, `8388608`; the `null` that
disables the concurrency ceiling; the `null` that means "no per-model budgets"; the empty-object
case and the `null`-prototype map; the `rateLimit`, `limits`, and `modelLimits` shapes; and every
config field a later slice adds. See *Coverage* above for why the harness cannot reach them, and for
what it does pin instead. `config.logRequests` is deliberately absent from this list: its effect is
stdout, so it is pinned rather than reviewed by eye.

Rationale and test design documented in
[`docs/research/config-invariant-guard-tests.md`](../research/config-invariant-guard-tests.md).

## References

* [`docs/adr/0001-config-validation-fail-fast-vs-degrade.md`](0001-config-validation-fail-fast-vs-degrade.md)
  — ADR 0001, extended and not reopened. Owns the base-URL fatal regime and the credential
  degrade regime, both preserved here verbatim.
* `config.js` — `parseConfig`, `readRateLimit`, `readLimits`, `readModelLimits`, `readLogRequests`,
  `readPositiveInteger`, `integerRule`, `describeValue`, `describeKey`, `typeName`, `readSeconds`.
  Single source of truth for every rule named above.
* `server.js` — `import { parseConfig, CONNECT_TIMEOUT_SECONDS, IDLE_TIMEOUT_SECONDS }`,
  `server.listen(PORT, config.host, …)`, and `logRequestOnClose`, the one consumer of
  `config.logRequests`.
* `server.test.js` — the black-box child-process harness, and the `runProxyOnce` / `withProxy` seams
  every claim above is tested through.
* [`CONTEXT.md`](../../CONTEXT.md) — glossary entries *misconfigured*, *unconfigured*, *health*,
  *connect window*, *idle window*. Six further terms (*admission control*, *queue*, *rate budget*,
  *per-model budget*, *safety margin*, *usage reconciliation*) are introduced by this story but not
  yet recorded there; task 8 owns that entry.
* [`specs/tech-architecture/tech-stack.md`](../../specs/tech-architecture/tech-stack.md) — the
  startup-configuration table this story's variables extend; task 8 owns the row set.
* [`specs/state.yaml`](../../specs/state.yaml) — the recorded decisions this ADR implements:
  decimal digits only for rate limits; the task 4 limit rules and the margin's range; whole-value
  rejection for per-model limits; type-not-text in fatal messages; the accepted duplicate-key
  fail-open; and, from `e03s01`, `PROXY_LOG_REQUESTS` as a closed vocabulary with anything outside
  it fatal, and the rule that a log line records the last status written to the client or `0` when
  none reached it.
* [RFC 8259](https://www.rfc-editor.org/rfc/rfc8259) §4 — names within an object should be unique;
  behavior for duplicate names is unpredictable and most implementations report the last
  name/value pair only. Cited for the accepted fail-open.
* [`specs/epics/e04-rate-limiting/e04s01-config-owner-and-bind-host.md`](../../specs/epics/e04-rate-limiting/e04s01-config-owner-and-bind-host.md)
  — the story the nine rate-limiting variables come from.
* [`specs/epics/e03-request-logging/e03s01-opt-in-request-logging.md`](../../specs/epics/e03-request-logging/e03s01-opt-in-request-logging.md)
  — the story `PROXY_LOG_REQUESTS` comes from (issue #9). Its §9 configuration row specifies
  "any non-blank non-`0`/`false` value enables logging" and is **superseded** by the strict
  vocabulary above; §11, §13, and the log-line format are unchanged.
* `CONFIG_ENV_VARS` in `server.test.js` — the named list the harness strips from every spawned
  child. A new operational variable is inherited by the suite until it is added there, so the list
  is the mechanical half of the fail-fast contract, not a test convenience.
