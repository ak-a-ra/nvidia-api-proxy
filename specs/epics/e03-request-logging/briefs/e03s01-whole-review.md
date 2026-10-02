# Whole-story review — e03s01, opt-in request logging via `PROXY_LOG_REQUESTS`

* Reviewer: whole-story reviewer (independent), not the implementer
* Branch: `feat/e03-opt-in-request-logging` in
  `/data/data/com.termux/files/home/workspace/epic-14-config-owner`
* Base: `main` at `e69fa8f`; four commits `17a7c4a`, `381e643`, `6c6a54a`, `601f136`
* Date: 2026-10-01
* Node verified on: v24.18.0 (local only — CI's Node 20 and 22 legs were **not** exercised)

## Verdict

**SHIP WITH FIXES.**

Nothing found blocks the merge. The security boundary holds against everything I could
throw at it, the story's five Gherkin scenarios and its §11/§12/§13 invariants hold under
nine independent mutations, and the suite is genuinely additive. The fixes are documentation
defects, one of which (F1) misstates a privacy guarantee an operator will rely on.

---

## Findings

### F1 — P1 — `path` is client-controlled verbatim and can carry a credential into the line; README's exclusion list does not say so

**Where:** `server.js:82` (`path: \`${incoming.pathname}${incoming.search}\``),
`README.md:179` and `README.md:183`.

**What is wrong.** The only client-supplied field in the line is the whole incoming path *and
query string*, unredacted. The README then says:

> Those five fields are the whole line. **A line never contains** request or response headers,
> the `authorization` header value, `NVIDIA_API_KEY`, `PROXY_AUTH_TOKEN`, any request or
> response body, or the upstream host and port.

Each item in that list is literally true — the proxy never writes its own key, token, header,
body, or host. What the list does not say is that the one remaining field is attacker-controlled
and echoed byte for byte, so any secret a *client* places in the URL lands in the operator's
stdout. Verified by running the proxy and asking for it:

```text
{"path":"/v1/models?api_key=sk-QUERY-KEY-ccc333&access_token=QUERYTOKEN-ddd444","status":200,"ms":105}
{"path":"/v1/chat/completions?authorization=Bearer%20QUERYBEAR-eee555","status":200,"ms":12}
{"path":"/v1/models?PROXY_AUTH_TOKEN=pt-QUERY-PROXY-fff666","status":200,"ms":23}
```

**Why it matters.** A query-parameter credential is a documented convention for several
OpenAI-compatible gateways (`?api-key=`, `?api-version=`, `?key=`), and `NVIDIA_BASE_URL` is
operator-configurable, so this is not hypothetical for a non-NVIDIA base. The story's own
acceptance criterion §17 scenario 2 says *"the line contains no credential"* without
qualification; for this shape it is false. The brief directed "path (including query string)"
and the story §6 exclusion list does not name query parameters, so the code is doing what it was
told to do — but the operator-facing sentence is the artifact people will audit, and it reads as
a closed privacy guarantee.

**Fix (documentation only, one sentence).** In `README.md` after line 183, and one bullet in
`tech-stack.md`'s Request Logging section, state that `path` is the incoming request target
verbatim, that a client-supplied query string is echoed as-is, and therefore that a secret must
never be placed in a URL — the proxy's configured key and token are excluded, but a caller's own
URL is not scrubbed. If a stronger guarantee is wanted instead, log `incoming.pathname` only
(mutation (e) below shows the current test pins the query, so that is a deliberate change, not
a silent one).

### F2 — P2 — ADR 0002 and tech-stack.md now say "the nine rate-limiting variables" where there are eight, and the fatal count is off by one

**Where:** `docs/adr/0002-config-operational-fail-fast.md:61`, `:325`, `:584`;
`specs/tech-architecture/tech-stack.md:60` versus `:146`.

**What is wrong.** ADR 0002 §Context enumerates "nine more variables": `PROXY_HOST`, `PROXY_RPM`,
`PROXY_TPM`, `PROXY_MAX_CONCURRENT_REQUESTS`, `PROXY_MAX_QUEUE_SIZE`,
`PROXY_QUEUE_TIMEOUT_SECONDS`, `PROXY_SAFETY_MARGIN_PCT`, `PROXY_MAX_BUFFERED_BODY_BYTES`,
`PROXY_MODEL_LIMITS_JSON`. Eight of those are rate-limiting variables; the ninth is
`PROXY_HOST`, a bind address. This branch relabelled the group in three places — Decision 1.4
now reads "The **nine rate-limiting** variables above", as does `tech-stack.md:60` and
`ADR:584` — while `tech-stack.md:146` (untouched, pre-existing) correctly says "the **eight**
limit variables". The same file now contradicts itself six lines apart.

The count chain then breaks. `ADR:325` reads "Eleven variables fail fast (the base URL from
ADR 0001, these nine, and `PROXY_LOG_REQUESTS`)". The fatal set is actually
`NVIDIA_BASE_URL` + eight rate-limiting + `PROXY_LOG_REQUESTS` = **ten**; `PROXY_HOST` has no
fatal path at all (`config.js:29-33`, "Not parsed" in the startup table). The pre-existing text
had the same off-by-one ("Ten variables fail fast"), so this is a carried error, not a new
invention — but the branch bumped the number without noticing the error.

Meanwhile `ADR:5`, `:39` and `:506` call `PROXY_LOG_REQUESTS` "the tenth operational variable",
which is correct under a different denominator (host + eight + log = ten). So the ADR asserts
both "this is the tenth" and "these nine rate-limiting variables precede it" in the same
document.

**Why it matters.** No behaviour impact. It matters because this branch's whole thesis is
precision about the configuration surface, and this is the ADR a future slice reads before
adding the eleventh variable. The one-word fix makes it self-consistent: call the group "the
eight rate-limiting variables" (with `PROXY_HOST` named separately, as `config.js:29` already
does), and say ten fail fast.

### F3 — P2 — issue #9's acceptance criterion "AGENTS.md invariant bullet added" is unmet

**Where:** `AGENTS.md` — the `### Proxy invariants (tests assert these)` block at line 112.

**What is wrong.** `AGENTS.md` was edited by this branch (count sync and line inventory), and the
"Proxy invariants" list has no entry for the new stdout surface: nothing records that a line is
written on `close`, that the field set is closed, or that no credential may reach it. ADR 0002
even argues the point ("The request log line's field set is closed *by construction*, not by
filtering") — but the agent-facing entry point does not carry it.

**Why it matters.** `AGENTS.md` is what every future agent reads before touching `server.js`.
The story capsule's numbered sections remain the acceptance criteria, and no story section asks
for this bullet, so this is the issue's framing going unmet rather than the story's. Cheap to
add, and the invariant is the one most likely to be broken by a well-meaning later edit.

### F4 — P2 — `specs/release-plan.yaml` `bugs.note` undercounts closed issues (pre-flagged, confirmed)

**Where:** `specs/release-plan.yaml:83` — "All 10 closed issues #2-#8, #10, #11, #12 were
closed by direct fix".

`gh issue list` today: #2–#8 (7) + #10 + #11 + #12 + **#14** (closed 2026-10-01T16:20:14Z) = 11.
Confirmed, not fixed, as instructed.

### F5 — P2 — story §4 precondition "Suite green at 34/34" was left at the authoring-time figure while §9 was edited in the same commit

**Where:** `specs/epics/e03-request-logging/e03s01-opt-in-request-logging.md:31`.

The branch base was 85 tests. `601f136` edited this file (the §9 row) and left §4 at 34/34.
Precedent: `e04s01-whole-review.md:111` (F14) judged the identical drift in
`e04s01-config-owner-and-bind-host.md:103` "defensible as a record of the precondition at
authoring time. Low weight". Consistent to leave it; recorded here only because this branch
edited the file.

---

## Security and privacy — what I actually verified

I read `logRequestOnClose` (`server.js:69-99`) line by line and then tried to defeat it against a
live child (`PROXY_LOG_REQUESTS=1`, `sk-PROBE-API-KEY-aaa111`, `pt-PROBE-TOKEN-bbb222`).

**Excluded by construction — confirmed unreachable:**

| Vector | Probe | Result |
| --- | --- | --- |
| `authorization` header | `x-api-key`, `cookie: session=COOKIE-SECRET-888`, `authorization` | absent from stdout |
| Request body | `{"messages":[{"content":"BODY-SECRET-777"}]}` | absent |
| Proxy token / API key (the proxy's own) | every line | absent |
| Upstream host **and** port | `NVIDIA_BASE_URL=http://secret-upstream-hostname.example:38775`, request fails DNS | stdout line is `{"method":"GET","path":"/v1/models","status":502,"ms":168}`; `stdout.includes("http://") === false` |
| Error message embedding the host | unreachable upstream → `ENOTFOUND secret-upstream-hostname.example` | hostname appears on **stderr** via the pre-existing `console.error(error)` at `server.js:267`, never on stdout. Correct scope: the claim is about the line. |
| Log injection via control characters | raw socket: literal TAB → HTTP 400; literal DEL → HTTP 400; literal LF truncates the request target at `path":"/v1/models?a=b"` and still parses | no newline ever reaches stdout; percent-encoded `%0a%0d` stays percent-encoded; `JSON.stringify` escapes `"` and `\` |
| Extra field | mutation (b) | caught |

**Not excluded — see F1:** `path` echoes the incoming request target verbatim, including any
credential a client puts in the query string.

**Try/catch.** `server.js:77-98`. The catch body is a comment; nothing is emitted, which is the
right call (reporting into stderr is not "safer" than the stdout that just failed, and the story
forbids reporting into the request path). I provoked a real throw via the harness's `logThrows`
mode and confirmed the child survives and keeps serving. Mutation (c) — deleting the
`try`/`catch` — is caught, so the block is load-bearing, not decorative.

**Volume.** A single line is bounded: an 8 000-byte and a 16 000-byte query both logged in full
(8 093 / 16 092-byte lines), a 20 000-byte and a 60 000-byte query were rejected by Node with
HTTP 431 and never reached the handler. So `path` cannot be used to flood stdout beyond ~16 KB
per request, and only when an operator has opted in. Not a finding.

---

## Story coverage

### §17 Gherkin scenarios

| Scenario | Result | Evidence |
| --- | --- | --- |
| Logging is off by default (unset; byte-identical response; no line) | **PASS** | test `logging is off by default: unset, blank, 0 and false write no request log line` over five states; mutation (d) (unset → on) and (g) (listener unconditional) both turn it red |
| Logging enabled explicitly — one JSON line, method/path/status/duration, no credential/body/upstream hostname | **PASS, with F1** | test `logging enabled writes one JSON line per request with method, path, status and ms` asserts an exact key set `["method","ms","path","status","ts"]`; the "no credential" clause is falsified only by a query-string credential (F1) |
| Local responses logged: 401 logged with status 401, body unchanged | **PASS** | test `local rejections are logged: 401 for a bad token and 404 for a bare /v1` asserts `[["/v1/models",401],["/v1",404]]` and `receivedRequests.length === 0` |
| Streaming requests log on completion; SSE bytes byte-identical | **PASS** | tests `an SSE response is byte-identical with logging on and off…` and `a streamed response is logged on close, not mid-stream…` (`ms >= 1400` on a 1.5 s `slowfinish`); mutation (i) (duration always ~0) is caught |
| A logging failure never breaks the request | **PASS** | test `a failing log write does not reach the response path`; mutation (c) is caught |

### Numbered sections

| § | Result | Note |
| --- | --- | --- |
| §5 default-off, no extra work | PASS | `config.logRequests` false ⇒ no listener, no clock (`server.js:116`) |
| §6 default-off + local response privacy | PASS except the query caveat | F1; also the "no behavior change when enabled" half is PASS (mutation-free test 11) |
| §8 line format | PASS | matches §8's example shape; §17's example omits `?stream=true` from the path but that is an illustrative example |
| §9 configuration | PASS as corrected | the row was corrected at closure against `readLogRequests` and the correction note explains the reversal |
| §11 invariants (four bullets) | PASS except the third | `/health` not special-cased: PASS (test 5, mutation (h)); "never contains credentials" is F1 |
| §12 failure modes | PASS | `close` not `finish` (`server.js:77`); try/catch present; no buffering |
| §13 privacy | PASS except F1 | the boundary is closed by construction — the object literal names five fields and nothing else |
| §16 risks | PASS | the `pipeline`-callback risk is real and was avoided: the listener is registered at `server.js:116`, above every branch, and `close` fires for destroyed responses |
| §18 out of scope | PASS | no levels, no rotation, no bodies, no counters, no `/stats`, no dependency |
| §4 precondition | stale at 34/34 | F5 |

**Not testable / not tested here:** Node 20 and Node 22 (CI legs). The `logThrows` init template
and `captureStdout` path are Node-version-sensitive in principle — `console.log` as a patchable
global and `child.stdout` as a non-null pipe — but nothing in either depends on a version-specific
API, and Node 24 is the highest leg anyway.

---

## The fatal-on-invalid decision (task 3 in my brief)

**My judgment: correct as implemented, and correctly documented.**

Failing a deploy over `PROXY_LOG_REQUESTS=maybe` is the harshest possible response to the one
variable whose failure costs nothing operationally. ADR 0002's own text concedes this
("the one place where this ADR's regime is arguably harsher than the stakes justify") rather
than pretending otherwise, and that honesty is what makes the trade acceptable. The three
substantive arguments all hold:

- The failure mode being prevented is the ADR's own named failure — a value the operator wrote
  and the proxy silently did not honor. `maybe` enabling logging is worse than `maybe` leaving
  it off, because the operator believes they asked for logs.
- The variable is new, so no existing deployment can carry a value the guard rejects. The
  compatibility cost is zero *today*; it is a real cost only if a future slice ever reuses the
  name with different semantics.
- Leniency would be the file's second parsing dialect and the first with no closed set.

**Where an operator hits it:** `README.md:110` (env-var table, "any other value is fatal"),
`README.md:160-163` (a `> [!NOTE]` block stating the rule in plain words before the sample
block), and `specs/tech-architecture/tech-stack.md:58` (the startup-config table). That is the
right surface — the fatal rule is stated where the operator sets the variable, not only in the
ADR. README:160 names the four shapes (`maybe`, `TRUE_`, an internal space) that a reader would
otherwise guess at.

**Can the flag leak or wedge the proxy?** No. Enabling it writes five fields and nothing else;
I could not construct a leak that F1 does not already cover. It cannot wedge the proxy: the
`try`/`catch` absorbs every write failure, the listener is removed from consideration once
`close` fires, no state accumulates across requests, and the falsy set is a literal 8-word
regex rather than a coercion. The *fatal* path can stop the process, but only on a value the
operator wrote.

---

## Test quality — mutation results

Run in a throwaway copy at `~/tmp/e03-review/mut` (`server.js`, `config.js`, `server.test.js`,
`package.json` copied out; **no file in either repo was modified**), restored and diff-verified
between every mutation (`restored: yes` × 9), and the scratch directory was deleted afterwards.

| # | Mutation | Caught? | Decisive line |
| --- | --- | --- | --- |
| (a) | `res.on("close")` → `res.on("finish")` | **yes**, 2 tests | `expected 1 request log line(s), saw 0` — matches the implementer's claim |
| (b) | add `authorization: req.headers.authorization` + `body: req.method` | **yes**, 2 tests | `no field beyond method, path, status, duration: {…"authorization":"Bearer pt-super-secret-proxy-token"…}` |
| (c) | delete the `try`/`catch` | **yes**, 1 test | `a throwing log write must not take the process down` |
| (d) | *(mine)* unset means **on** | **yes**, 2 tests | `the logging-off child wrote no request log line` |
| (e) | *(mine)* `path` drops the query string | **yes**, 1 test | `Expected values to be strictly equal` (the line-shape test pins `?stream=true`) |
| (f) | *(mine)* drop `res.headersSent ?` gate | **yes**, 1 test | `no status reached the client, so none is reported` |
| (g) | *(mine)* register the listener unconditionally | **yes**, 3 tests | `expected 0 to disable logging` |
| (h) | *(mine)* move the listener below the local branches | **yes**, 4 tests | `expected 2 request log line(s), saw 1` (401 and 404 no longer logged) |
| (i) | *(mine)* `ms: Date.now() - Date.now()` | **yes**, 1 test | `duration must span the stream (1.5s), got 0ms` |

**Nine for nine. Zero coverage holes.** The three claimed mutations reproduce exactly; the two
the implementer claimed are load-bearing each move ≥1 test, and mutation (a) confirms the
implementer's own note that the two streaming-timing tests correctly *cannot* distinguish
`close` from `finish` — the destroyed-response tests are what catch it.

**Harness plumbing (`captureStdout` / `logThrows` / `withProxy(…, base)`).**

- *No default-path regression.* `captureStdout` and `logThrows` both default to `false`; with
  them unset, `stdio[1]` is still `"ignore"` (`server.test.js:207`) and the non-`logThrows` init
  template is the original `init`, selected by a ternary. Verified structurally by the hunk
  list: every `server.test.js` hunk is at line ≤ 249 (the helper region) or the single append at
  1798 — **nothing between 250 and 1798, where all 85 pre-existing tests live, is touched.**
- *No cross-test stream leak.* `const chunks = []` is declared inside `startProxyServer`, so each
  handle owns its own buffer; children are killed via `t.after` (LIFO, child before stub). The
  two-proxy test iterates both handles separately.
- *`base` returned from `withProxy`* is purely additive and exists so a test can name the host it
  must never see — used by exactly the two tests that need it.
- One observation, not a defect: `proxyOpts` and `base` both ride the same destructuring bag, so
  a caller writing `{ base: ... }` intending a stub opt-in now also gets it back as the return
  value. Harmless, and `base` was already the destructured key name before this change.

---

## Regression risk

- **Additive only — proven, not asserted.** Test-name diff between `e69fa8f` and `HEAD`: 85 names
  before, 99 after, **0 removed or renamed, 14 added** (`comm -23` output empty). `server.js`
  diff is `+39 -0` with two insertion-only hunks; `config.js` is `+34 -0` with two
  insertion-only hunks. The handler was not restructured, no header/credential/path-mapping
  behaviour moved, `package.json` untouched, zero dependencies added, ESM preserved.
- **The per-request listener is registered only when logging is on.** `server.js:116` —
  `if (config.logRequests) logRequestOnClose(...)`. Nothing is registered and `Date.now()` is not
  called on the disabled path. Mutation (g) confirms the guard is load-bearing.
- **SIGTERM.** `✔ SIGTERM drops idle connections and exits promptly (665 ms)` in the clean run.
  The pre-existing test does not enable logging, so it gains no listener; and even when logging
  is on, the listener is removed by `close` on every response and does not hold the process open.
- **Header/credential/streaming invariants** are covered by the unchanged 85, all green.

---

## The `CONFIG_ENV_VARS` obligation

`PROXY_LOG_REQUESTS` is at `server.test.js:137`, in the same commit (`17a7c4a`) that added it to
`config.js` — `git diff -U0` shows it as its own hunk at line 136/137 of that file. `childEnv`
deletes every name in the list before applying a test's overrides, and `runProxyOnce` routes
through `childEnv` too.

**Hermeticity proven by running, not by reading.** Full suite under
`env -i` plus `PROXY_LOG_REQUESTS=1 PROXY_RPM=5 PROXY_SAFETY_MARGIN_PCT=51` — the last two are
values that break 64 and 61 tests respectively when inherited:

```text
ℹ tests 99   ℹ pass 99   ℹ fail 0
EXIT=0
```

## Documentation consistency

| Claim | Source | Verdict |
| --- | --- | --- |
| Accepted values, case-insensitive, trimmed | `config.js:224-225`, README:110/160, tech-stack:58, ADR:112-114 | all four agree with the code |
| Default off, unset/blank is off | `config.js:229`, README:169, tech-stack:58, ADR:112 | agree |
| Fatal on anything else, exit 1 | `config.js:235-238`, README:110/160, tech-stack:58, ADR:5/48 | agree — the message text is pinned by a test asserting the interpolated rule, the echoed value, one line, and no stack marker |
| "Every `PROXY_*` row … except `PROXY_HOST` and `PROXY_LOG_REQUESTS` is validated and stored, not enforced" | README:113-117, tech-stack:60 | **correct now.** The stale universal claim was updated in `381e643`; the new sentence is accurate (8 stored + 2 live) |
| Test count 99 | README:9 badge, README:86, AGENTS.md:89/107/109, CONVENTIONS.md:17, specs/README.md:19, VISION_LATEST.yaml:20, state.yaml:25, TEST_PLAN_LATEST.md:44/294/351, tech-stack.md:154, e04s01 story:345 | **all correct, all 99.** Task 7's own gate confirms it mechanically (§ below) |
| Stale-number sweep `\b(84\|85)\b` | — | two hits, neither a count claim: `AGENTS.md:108` (the example grep pattern) and `state.yaml:25` ("85 before this story") |
| Line inventory `~288 / ~343 / ~2351` | AGENTS.md:85 | matches `wc -l` exactly: 288 / 343 / 2351 |
| ADR 0001 unmodified | — | `git diff --name-only` returns zero `0001` files. Confirmed |
| `SCOPE_LATEST.yaml`, `CONTEXT.md` | — | neither contradicts the code. SCOPE excludes "monitoring beyond health endpoint"; the story §20 argues opt-in+default-off keeps it inside, and CONTEXT.md's "stored but not enforced" paragraph enumerates the 8 rate variables by name and never claims anything about `PROXY_LOG_REQUESTS` |
| Operational-variable counts | ADR:61/325/584, tech-stack:60 | **wrong — see F2** |

### Task 7's verify replacement (my brief item 8)

**Legitimate, and recorded where a reader will see it.** `scripts/` does not exist in this
repository (`ls: cannot access 'scripts': No such file or directory`) — the script belongs to
`e01s01`, which never landed, so the original command could never exit 0 and flipping the row to
`passing` on it would have recorded a gate that is red. The replacement is not an invention: it
is **byte-identical** to `e04s01-tasks.yaml` task 12's gate, which `diff` on the two parsed
values confirms. Three independent records of the change exist: the task 7 `description` in
`e03s01-tasks.yaml` states the old command, why it cannot pass, and what replaced it; a
dedicated `decisions` entry in `specs/state.yaml` ("Task 7's count gate stops calling the e01
script that never landed") gives the rationale; and commit `601f136` says it in the message.
Rewriting a ledger's verify is acceptable when the gate it named was unrunnable and the
replacement is stronger, not weaker — which is the case, since the old script's behaviour
cannot be compared and the new gate derives N from `npm test` rather than hard-coding it.

---

## Repository hygiene

- **Conventional Commits.** `feat(logging):`, `docs:`, `docs(adr):`, `docs(e03s01):` — all
  conform; bodies explain *why*, not just *what*.
- **Zero dependencies.** `package.json` untouched, no `dependencies` field, no non-`node:` import
  added.
- **ESM.** `import` throughout; the new harness templates are `--input-type=module` strings.
- **No stray files.** `git status --porcelain` clean; 20 changed files, all accounted for.
- **No TODOs/FIXMEs/XXX** in any changed source file (the `FIXME` hits are README's pre-existing
  fill-in-the-blank placeholders).
- **Prose.** Comments are dense but each one carries a non-obvious constraint — the
  `res.headersSent` rationale, the blank-before-parse ordering, the `midabort`-race note in the
  test, the reason the log listener is registered above every branch. No narration of the change
  back to the reader, no restating the code. This matches the surrounding file's voice.

---

## What I verified by running

| Check | Decisive output |
| --- | --- |
| Full suite, clean env | `ℹ tests 99 / ℹ pass 99 / ℹ fail 0` … `EXIT=0` |
| Full suite, ambient `PROXY_LOG_REQUESTS=1 PROXY_RPM=5 PROXY_SAFETY_MARGIN_PCT=51` | `ℹ tests 99 / ℹ pass 99 / ℹ fail 0` … `EXIT=0` |
| Task 1/2/4/5 verify (`--test-name-pattern 'logging'`) | `ℹ tests 14 / ℹ pass 14 / ℹ fail 0` |
| Task 3 verify (`--test-name-pattern 'stream'`) | `ℹ tests 22 / ℹ pass 22 / ℹ fail 0` |
| Task 6 verify (two greps) | `task6 exit 0` |
| Task 7 verify (the replacement gate, verbatim) | `count ok: 99 across the living docs` … `GATE_EXIT=0` |
| Test-name diff `e69fa8f..HEAD` | 85 → 99, **0 removed/renamed**, 14 added |
| `git diff -U0` hunk map for all three source files | insertions only; no hunk between `server.test.js:250` and `:1798` |
| Nine mutations (throwaway copy, restored each time) | 9/9 caught, `restored: yes` × 9 |
| Credential-shaped query params against a live child | `path` echoes them verbatim → **F1** |
| Unreachable upstream with a hostname in the error | stdout line carries no host; stderr does (pre-existing `console.error`) |
| Raw-socket control characters in the request target | HTTP 400 for TAB/DEL; LF truncates the target; no stdout injection |
| Log-line size bound | 16 000-byte query logged (16 092-byte line); 20 000-byte query → HTTP 431, never logged |
| `gh issue view 9` / `gh issue list` | #9 open; #14 `CLOSED` 2026-10-01T16:20:14Z → **F4** |
| Gate byte-comparison against e04s01 task 12 | `IDENTICAL to e04s01 task 12's gate` |

Scratch directory `~/tmp/e03-review` (throwaway copy, probe scripts, logs) removed after the run.
No file in `/data/data/com.termux/files/home/workspace/epic-14-config-owner` was modified except
this report; nothing was pushed, no PR opened, no merge, issue #9 left open.

---

## Claims I could not verify

- **Node 20 and Node 22.** CI runs the suite on all three; I only have v24.18.0 locally. No
  claim is made here about the other two legs.
- **The report's §3 statement that `git diff -U0 server.test.js` shows no other deleted line.**
  I re-derived the same conclusion independently and it holds, but the report's exact phrasing
  ("the pre-existing helper changes are 7 lines") is not something I counted.
- **The report's §4 claim that `midabort` legitimately yields 200 or 502 (a race).** I took the
  author's side on the stub choice without reproducing the race; `stall` is the right call for a
  deterministic assertion either way.
- **`render.yaml` surfacing stdout in production.** Story §16 lists this as an assumption to
  confirm; I did not confirm it against Render. The story correctly marks it as unconfirmed.
- **Test 2's runtime cost (~8 s for twelve children)** — observed in the `logging` run
  (`duration_ms 34205`) but I did not isolate it.

## Recommended before merge

1. **F1** — one sentence in `README.md` (and one bullet in `tech-stack.md`'s Request Logging
   section) disclosing that `path` is the incoming request target verbatim, so a client-supplied
   query-string secret does reach the line. No code change required.
2. **F2** — "nine rate-limiting variables" → "eight", in `ADR:61`, `ADR:584`,
   `tech-stack.md:60`; and "Eleven variables fail fast" → "ten", at `ADR:325`.
3. **F3** — add the one-line invariant bullet to `AGENTS.md` (issue #9's own AC).
4. **F4, F5** — P2; fix opportunistically, do not block on them.