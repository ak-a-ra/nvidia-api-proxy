# e03s01 / tasks 1-5 — implementer report

* Branch: `feat/e03-opt-in-request-logging`, branched off merged `main` (`e69fa8f`)
* Worktree: `/data/data/com.termux/files/home/workspace/epic-14-config-owner`
* Tasks implemented: 1-5 of `e03s01-tasks.yaml`. Tasks 6 and 7 were not done, except the
  test-count sync the brief requires of every task.
* Suite before: 85 passing. Suite after: 99 passing.

## 1. `PROXY_LOG_REQUESTS` — truthy set and fatal-vs-lenient

**Truthy set: `1`, `true`, `yes`, `on`. Falsy set: `0`, `false`, `no`, `off`.** Both matched
case-insensitively after trimming. Unset or whitespace-only is off.

**Invalid is fatal.** A non-blank value in neither set exits 1 from `parseConfig` with one
stderr line:

```text
PROXY_LOG_REQUESTS must be 1, 0, true, false, yes, no, on or off, got: maybe
```

Why this reading, in the order the arguments matter:

1. It contradicts story §9 ("any non-blank non-`0`/`false` value enables logging"). The brief
   directed the strict set and said the story loses on this point, so the deviation is recorded
   here and in `specs/state.yaml` rather than resolved silently.
2. The story's rule makes `PROXY_LOG_REQUESTS=maybe` switch a feature **on**, with no signal that
   a typo was reinterpreted. That is the failure ADR 0002 exists to prevent, in the same family as
   `Number("1e3")` being `1000` for a rate limit.
3. Fatal beats lenient for a flag even though a flag is the weakest case for strictness: the
   failure shape is identical — a value the operator wrote and the proxy did not honor, noticed by
   nobody — and the variable is new, so the fatal path cannot break a deployment that predates it.
4. Lenient here would be the file's second parsing dialect after `readSeconds`, and the first that
   accepts arbitrary operator text.

The message names the variable, states the rule, and echoes the offending value bounded at 60
characters via the existing `boundText` helper and the existing `fatal()` helper. Pinned by the
test that asserts the interpolated rule and the `got: <value>` text, never the bare variable name,
because ADR 0002's standing rule says a stack dump quoting the source line would satisfy a
name-only assertion. That test also asserts one line of stderr, no stack-dump marker, and no
`node:internal` marker.

`config.js` was otherwise untouched: the diff is one field in the returned object plus one new
helper. No existing variable, regime, or fatal message changed.

## 2. Log line format, and what a mid-stream abort records

Written by `logRequestOnClose` in `server.js`, on the response's `close` event, inside
`try`/`catch`:

```json
{"ts":"2026-10-01T16:43:01.186Z","method":"POST","path":"/v1/chat/completions?stream=true","status":502,"ms":1204}
```

- `ts` — `new Date().toISOString()` at write time.
- `method` — `req.method`.
- `path` — the incoming pathname plus its query string, the same string forwarded upstream.
- `status` — the **last status written to the client**, or `0` if the response was destroyed
  before any status was written.
- `ms` — `Date.now() - startedAt`, where `startedAt` is read at request arrival, above the
  `/health` branch and before any `await`.

No other field exists, so a header, body, credential, or upstream host cannot reach the line.
The tests assert the exact key set, not just the absence of secret strings.

**Status on an incomplete response.** Two cases, both decided and both tested:

- *Stream cut after headers* (upstream failure mid-stream, idle watchdog fires): the line records
  the status the client actually received — `200`. Not a synthetic 5xx: that would describe the
  proxy rather than the exchange.
- *Destroyed before any status* (client disconnects before upstream headers): the line records
  `0`. Node's `res.statusCode` defaults to `200` even when nothing was ever written, so recording
  it unconditionally would invent a 200 for a client that received no response at all. The gate is
  `res.headersSent ? res.statusCode : 0`.

`-` was rejected: one field with two types. `0` is a documented sentinel, not a value a status can
take. Both decisions are recorded in `specs/state.yaml`.

`server.js` was otherwise untouched: the diff is one new function and one guarded call in the
handler. No header, credential, path-mapping, or response behavior changed, and the handler was not
restructured. The disabled path registers no listener and reads no clock.

## 3. Child stdout capture

The gap first: `startProxyServer` spawned with `stdio: ["ignore", "ignore", "ignore", "ipc"]`, so
stdout went nowhere. "No secret in the log" would have been a claim about an unreadable stream.

**Mechanism.** `startProxyServer` gained an optional fifth parameter, `options`:

- `captureStdout: true` — `stdio[1]` becomes `"pipe"`, chunks are collected into an array, and the
  resolved handle exposes `stdout: () => Buffer.concat(chunks).toString("utf8")`. A function, not a
  snapshot string, because lines arrive after the client already has the response.
- `logThrows: true` — spawns a second init template that replaces the global `console.log` with a
  function that lets the startup banner through and throws on everything else. `console` is a
  global object, so the patch is visible to `server.js`'s own `console.log` call site. This is the
  only way to provoke the failure the story's §11 describes; closing the pipe does not make
  `console.log` throw, because Node buffers pipe writes asynchronously.

`withProxy` gained a `proxyOpts` field forwarded to `startProxyServer`, and now also returns
`base` so a test can name the upstream host it must never see in a log.

**No regression of the default path.** `captureStdout` and `logThrows` both default to `false`; the
non-`logThrows` init template is byte-identical to the previous one; and with `captureStdout`
unset the child's `stdio[1]` is still `"ignore"`, so the 85 pre-existing tests keep paying nothing.
The pre-existing helper changes are 7 lines in `startProxyServer`/`withProxy` and one entry in
`CONFIG_ENV_VARS`; `git diff -U0 server.test.js` shows no other deleted line, so no existing test
name, assertion, or ordering changed.

`PROXY_LOG_REQUESTS` was added to `CONFIG_ENV_VARS` in the same commit, so the suite stays hermetic
against an ambient `PROXY_LOG_REQUESTS=true`. The pre-existing `childEnv strips the variables the
proxy reads and inherits the rest` test iterates `CONFIG_ENV_VARS`, so the new variable is covered
by that test without modifying it. Adding an ambient-value row to the `harness environment
isolation` block would have been a modification of an existing block, which the brief forbids;
reported here as the one hermeticity proof I did not add.

## 4. Tests added — names verbatim

Fourteen tests, appended as a new `describe("request logging")` block at the end of
`server.test.js`:

1. `logging is off by default: unset, blank, 0 and false write no request log line`
2. `PROXY_LOG_REQUESTS accepts its documented truthy and falsy words`
3. `PROXY_LOG_REQUESTS with a non-blank invalid value exits 1 naming the variable and its rule`
4. `logging enabled writes one JSON line per request with method, path, status and ms`
5. `/health is logged when logging is enabled`
6. `local rejections are logged: 401 for a bad token and 404 for a bare /v1`
7. `an unreachable upstream is logged as 502 without naming the upstream host or URL`
8. `no request log line contains the proxy token, the API key, an authorization value, a request body, or the upstream host:port`
9. `an SSE response is byte-identical with logging on and off and is logged on completion`
10. `a streamed response is logged on close, not mid-stream, and its duration covers the whole stream`
11. `enabling logging changes no response status, body, or headers`
12. `a failing log write does not reach the response path`
13. `a mid-stream upstream failure logs a well-formed line with the last written status and leaves the process healthy`
14. `a client disconnect before any status is written logs status 0 and no invented code`

Mapping to the brief's nine required areas: off-by-default = 1; on = 4; `/health` = 5; local
rejections = 6; upstream failure = 7; no secrets (task 4, P0) = 8; streaming byte-identity (task 3)
= 9 and 10; no response change (task 5) = 11; failing write unreachable from the request path = 12.
Tests 2, 3, 13, and 14 cover requirements the brief left to the implementer's judgement: the parse
rule in both directions, the fatal message, and the two incomplete-response status cases.

Two stub-mode choices worth recording:

- Streaming byte-identity uses the `sse` mode the brief names, comparing the client-visible text
  with logging on and off, and asserting the logging-off child wrote no line at all.
- The mid-stream failure test uses `stall` with `UPSTREAM_IDLE_TIMEOUT_SECONDS=1`, not `midabort`.
  `midabort` writes a chunk and destroys the upstream socket immediately, so whether undici delivers
  the response headers before processing the destroy is a race — the same stub legitimately yields
  `200` or `502`. That was observed: a first attempt asserting `200` on `midabort` failed with
  `502 !== 200`. `stall` flushes headers and one chunk, then goes silent, so headers are guaranteed
  to have reached the client before the failure and the assertion can mean something.

Test 11 compares `date` headers as filtered out: two children answer microseconds apart, and `date`
is the wall clock rather than part of the response. Everything else — status, body, and every other
header, including `set-cookie` — is compared with `assert.deepEqual`.

## 5. Verify output

```text
$ node --test --test-name-pattern 'logging' server.test.js
ℹ tests 14
ℹ pass 14
ℹ fail 0
exit 0

$ node --test --test-name-pattern 'stream' server.test.js
ℹ tests 22
ℹ pass 22
ℹ fail 0
exit 0

$ npm test
ℹ tests 99
ℹ suites 8
ℹ pass 99
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 185811.823575
exit 0
```

**New total: 99** (85 before, 14 added). Baseline before the change was `ℹ tests 85 / ℹ pass 85`,
run in this worktree on a clean shell.

## 6. Mutations — run, caught, reverted, re-run green

Three, each reverted by restoring the pre-mutation file and confirming with a diff plus a re-run.

**(a) Log on `finish` instead of `close`.** `res.on("close", ...)` → `res.on("finish", ...)`.

```text
✖ a mid-stream upstream failure logs a well-formed line with the last written status and leaves the process healthy
✖ a client disconnect before any status is written logs status 0 and no invented code
ℹ tests 14  ℹ pass 12  ℹ fail 2
```

Caught by 2 tests. Decisive line from the disconnect test:

```text
AssertionError [ERR_ASSERTION]: expected 1 request log line(s), saw 0: "NVIDIA API proxy listening on port 0\n"
```

`finish` never fires for a destroyed response, so a request that never completes loses its line
entirely. Reverted: both tests pass again (`ℹ pass 2 / ℹ fail 0`).

Note that the two tests whose names promise the streaming timing did **not** catch this, and that is
correct rather than a hole: for a stream that completes, `finish` and `close` are microseconds apart
and the timing assertions cannot tell them apart. The observable difference is entirely in the
destroyed-response cases.

**(b) Include the authorization header and a body field in the line.** Added
`authorization: req.headers.authorization` and `body: req.method` to the JSON object.

```text
✖ logging enabled writes one JSON line per request with method, path, status and ms
✖ no request log line contains the proxy token, the API key, an authorization value, a request body, or the upstream host:port
ℹ tests 14  ℹ pass 12  ℹ fail 2
```

Caught by 2 tests, the P0 one by name. Decisive line:

```text
AssertionError [ERR_ASSERTION]: proxied proxy: no field beyond method, path, status, duration:
{"ts":"...","method":"POST","path":"/v1/chat/completions","authorization":"Bearer pt-super-secret-proxy-token","body":"POST","status":200,"ms":169}
```

Reverted: both pass again (`ℹ pass 2 / ℹ fail 0`).

**(c) Remove the `try`/`catch` around the write.** Not required by the brief; run because the
"swallowed write failure" claim is otherwise untested.

```text
✖ a failing log write does not reach the response path
AssertionError [ERR_ASSERTION]: a throwing log write must not take the process down
  1 !== null
```

Caught by 1 test. Without the `catch`, the throw escapes the `close` event and kills the child,
which is exactly what `exitCode === null` catches. Reverted: passes again.

No mutation produced zero catches, so there is no coverage hole to report.

## 7. Count sweep, before and after

Command (the brief's, with its exclusions):

```sh
grep -rnE 'tests(-| )?[0-9]{2,4}|[0-9]{2,4}[ -]?tests?|\(currently [0-9]+\)' --include='*.md' --include='*.yaml' . \
  | grep -vE '^\./(plans/|docs/research/|LOG\.md|specs/epics/)'
```

**Before** — 13 sites, all at 85:
`AGENTS.md:89` (`npm test` bullet), `AGENTS.md:107` (`(currently 85)`), `AGENTS.md:109` (site list
naming the README badge), `CONVENTIONS.md:17`, `README.md:9` (badge `tests-85%20passing`),
`README.md:86`, `specs/README.md:19`, `specs/product/VISION_LATEST.yaml:20`,
`specs/state.yaml:24` (e04s01 handoff note), `specs/tech-architecture/TEST_PLAN_LATEST.md:44,294,351`,
`specs/tech-architecture/tech-stack.md:143`.

**After** — every one of those reads 99, and the sweep output is:

```text
./AGENTS.md:89   full suite (99 tests, ...)
./AGENTS.md:107  (currently 99)
./AGENTS.md:109  README.md:9 badge tests-99%20passing
./CONVENTIONS.md:17  runs all 99 tests
./README.md:9   badge tests-99%20passing
./README.md:86   Run the test suite (99 tests, no deps needed)
./specs/README.md:19   99 tests in server.test.js
./specs/product/VISION_LATEST.yaml:20   99 tests covering all major scenarios
./specs/state.yaml:30   the suite is 99 tests green in a clean environment
./specs/tech-architecture/TEST_PLAN_LATEST.md:44   99 tests covering all major scenarios
./specs/tech-architecture/TEST_PLAN_LATEST.md:294  All 99 tests must pass
./specs/tech-architecture/TEST_PLAN_LATEST.md:351  The 99-test suite provides ...
./specs/tech-architecture/tech-stack.md:143   **Test Count**: 99 tests
```

Stale-number sweep `\b(84|85)\b`, same exclusions, leaves exactly two hits and neither is a count
claim: `AGENTS.md:108` (the example grep pattern in the testing-quirks bullet) and
`specs/state.yaml:31` (this handoff's own "(85 before this work)").

Also re-derived, because `AGENTS.md`'s line inventory goes stale with any addition: `server.js`
~288, `config.js` ~343, `server.test.js` ~2351, from `wc -l`.

`specs/state.yaml:24` needed a decision rather than a number swap. That line was the e04s01 handoff
note, whose claim ("the suite is 85 tests green") is about a completed story. Rewriting the number
inside it would leave a dated record asserting the current suite size, and excluding the file would
silence the sweep. The handoff block is current state rather than append-only history — `LOG.md` is
the append-only record — so it was replaced with this session's handoff. Flagging it because it is
an edit a reviewer may read as scope creep, and it is: the brief requires the sweep to come back
clean, and the file is not excluded.

## 8. Deviations, by requirement number

Story-beats-brief and brief-beats-story:

- **Requirement 1 (off by default).** As written, "zero bytes on stdout" is unreachable:
  `server.js` has always printed `NVIDIA API proxy listening on port N` at startup. The test asserts
  zero **request log lines** — no line that starts a JSON object — which is the claim the
  requirement means. The banner is filtered in the test's line helper and named in its comment.
- **Requirement 7 (status for an incomplete response).** The brief offered `0`, `-`, or the last
  known status. All three appear in the implementation, by case: last written status when headers
  reached the client, `0` when none did, and never `-`. Documented in code, in `specs/state.yaml`,
  and in tests 13 and 14.
- **Requirement 5 (non-empty catch).** The catch body is a comment, not a statement. Emitting to
  stderr would be the only alternative, and stderr is not safer than the stdout that just failed;
  reporting into the request path is what the requirement forbids. The mutation (c) run above is
  the evidence the block exists and matters.

Story-beats-plan, as the brief directed:

- **`plans/05-opt-in-request-logging.md` line 31** proposes `[req] POST /v1/chat/completions 200
  1234ms`; line 34 proposes `-` for an errored stream. Both are superseded by story §8/§12: the
  line is JSON, and the status is the last written one or `0`. `plans/05` was not edited — it is a
  dated record and marks itself superseded at its own line 130.

Judgment calls the brief left open:

- **Requirement 2 / §11 (`/health` logged).** Covered by test 5. No ambiguity to resolve.
- **Fatal-vs-lenient.** Resolved fatal; see §1 above and the `specs/state.yaml` decision.
- **Story §9 truthy set.** Overridden by the brief's direction; see §1 above.
- **Harness `logThrows`.** The brief asked for stdout to be made unwritable or `console.log` to be
  stubbed. Closing the child's stdout pipe does not make `console.log` throw, so the stub is the
  mechanism that works. It lives in the test's init template, not in `server.js`, and it lets the
  startup banner through so the child does not die before the first request for an unrelated
  reason.

Not done, by instruction: task 6 (`README.md` env var table, `specs/tech-architecture/tech-stack.md`
startup-config row), task 7's ledger and capsule status flips, and any ADR entry for this variable's
regime. `specs/state.yaml` carries the decision until an ADR exists. `package.json` untouched; no
dependency added; zero `node:`-external imports.

## 9. Concerns for the reviewer

1. `specs/state.yaml`'s handoff note was rewritten (§7). Defensible as current-state rather than
   history, but it is the one edit outside the count sites.
2. No ambient-value test for `PROXY_LOG_REQUESTS` in the `harness environment isolation` block,
   because adding one modifies an existing block. The pre-existing `CONFIG_ENV_VARS` loop test
   covers the variable mechanically.
3. Test 2 spawns twelve children and takes ~8s. It is the broadest parse pin in the suite and the
   slowest test added; splitting it into two tests would trade suite structure for a few seconds.
4. `server.js` is now 288 lines, `config.js` 343. Neither is near a limit, but the line inventory in
   `AGENTS.md` is updated and will go stale again on the next slice.
