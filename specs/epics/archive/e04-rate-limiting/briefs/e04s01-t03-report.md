# Task report — e04s01 / task 3: the rate pair (`PROXY_RPM` / `PROXY_TPM`)

- **Status:** done
- **Commits:** code `8169595` (`feat(config): parse the mandatory PROXY_RPM/PROXY_TPM rate pair`), LOG.md append `4c4ae90`
- **Baseline:** `e9e3191`
- **Suite:** `tests 47 · pass 47 · fail 0 · skipped 0 · todo 0` (was 37)

## Verify

The ledger command for task 3, run verbatim from the worktree root, exit code **0**:

```
$ out=$(node --test --test-reporter=tap --test-name-pattern 'PROXY_RPM|PROXY_TPM' server.test.js 2>&1); rc=$?; test $rc -eq 0 && printf '%s\n' "$out" | grep -qE '^[[:space:]]*ok [0-9]+ - .*(PROXY_RPM|PROXY_TPM)' && node -e "...rate pair not both read..."
no new security findings in affected paths: partial rate policy fails closed
VERIFY_EXIT=0
```

The 10 matching tests all pass; `config.js` reads both names. (`compdef:153: _comps: assignment to invalid subscript range` in the captured output is zsh startup noise, not command output.)

## What landed

`config.js` — `parseConfig` gains one field, `rateLimit: { rpm, tpm }`, or `null`. One field, not two, so a caller cannot read half a pair that was never completed. The existing keys (`baseURL`, `host`, `apiKey`, `proxyToken`, `unconfigured`) are unchanged; `readSeconds` and the two timeout variables are untouched.

- Both absent or blank → `null`, rate limiting disabled, startup succeeds.
- Exactly one non-blank → exit 1, stderr names **both** variables: `PROXY_RPM and PROXY_TPM must be set together: PROXY_TPM is missing`.
- A non-blank value must match `/^[0-9]+$/` after trimming and be a positive safe integer, else exit 1 naming the offending variable: `PROXY_RPM must be a positive integer, got: 1.5`.
- The blank check (`?.trim()`) runs before any numeric parsing, so `Number("  ")` never becomes a supplied value.

Nothing acts on the values. No new test seam; `server.js` unchanged; `export default server` still the only export from the entry.

## Tests added

New `describe("rate budget config")` block in `server.test.js`, ten tests, every name containing `PROXY_RPM` or `PROXY_TPM`. Only the two existing harness seams are used: `runProxyOnce` for every fatal case (each passes a valid `NVIDIA_BASE_URL` plus both credentials, so an exit 1 proves the rate pair and not a missing base URL) and `withProxy` for every configuration that must start.

| Test | Covers |
| --- | --- |
| both absent leaves rate limiting disabled | area 1 |
| blank (`""`, `"   "`, `" \t "` vs `""`) starts, disabled | area 2 + the §12 whitespace case |
| both valid start and serve `/health` (`60`/`100000`, `1`/`1`, `" 60 "` trimmed) | area 3 |
| tiny budget still proxies normally | brief's "do not act on the values" |
| `PROXY_RPM` set, `PROXY_TPM` absent → exit 1, both names | area 4 |
| `PROXY_TPM` set, `PROXY_RPM` absent → exit 1, both names | area 5 |
| `PROXY_TPM` set, `PROXY_RPM` whitespace-only → exit 1, both names | blank partner = exactly one set |
| `PROXY_RPM` invalid → exit 1 naming `PROXY_RPM` (`0`, `-1`, `1.5`, `abc`, `2^53+1`, 30 digits) | area 6 |
| `PROXY_TPM` invalid → exit 1 naming `PROXY_TPM` (same six) | area 6 |
| `1e3` / `0x10` / `+5` / `.5` / `1_000` / `1e400` rejected, `1000` / `16` accepted | area 7, the pinned decision |

The one permitted edit to an existing test: `server.test.js:745` now carries `assert.equal(proxy.address, "127.0.0.1");` in the third `PROXY_HOST` test, next to its other assertions. Additive only. No existing test was weakened, deleted, reordered, or skipped; the stub was not loosened.

Before implementing, the six fatal-case tests failed for the right reason — the child did not exit at all (`error: 'proxy process did not exit'`, the 4s `runProxyOnce` timer) because nothing validated the pair yet. The four "must start" tests passed pre-implementation, which is correct: they pin behavior that must not regress.

## Test count sync (37 → 47)

All in commit `8169595`:

- `README.md:9` — shields badge `tests-47%20passing`
- `README.md:86` — tip "(47 tests, no deps needed)"
- `AGENTS.md:89` — `npm test` bullet
- `AGENTS.md:107` — the site-inventory line, whose `tests-47%20passing` reference follows the badge
- `CONVENTIONS.md:17` — "runs all 47 tests"
- `specs/README.md:19`
- `specs/product/VISION_LATEST.yaml:20`
- `specs/tech-architecture/TEST_PLAN_LATEST.md:44`, `:294`, `:351` ("The 47-test suite")
- `specs/tech-architecture/tech-stack.md:129` — `**Test Count**: 47 tests`
- `specs/epics/e04-rate-limiting/e04s01-config-owner-and-bind-host.md:336` — the §16 risk narrative's "unchanged existing suite (47 tests)". Not named in the brief's site list and not in its exclusion list, and it is a current-count statement, so it would otherwise fail task 12's count check.

Not touched, per the brief: `plans/*.md`, `docs/research/config-invariant-guard-tests.md`, `specs/epics/*/briefs/`, `specs/epics/*/*-tasks.yaml`. The count-shaped hits remaining in the sweep are two historical `LOG.md` entries (lines 18 and 20, for `cafcc41` and `36be6ed`) that quote the counts those commits reported; `LOG.md` is append-only history, so they stay. Correction recorded after review: this report originally also claimed the sweep "returns 47 everywhere", which was false — `LOG.md` was not excluded by the brief's list. `LOG.md` has since been added to task 12's exclusion in `e04s01-tasks.yaml`, so task 12's count check passes with `n=47`; every living doc outside the exclusions does state 47.

## Mutation check

Each mutation was applied to `config.js`, the suite was re-run under the ledger's own name pattern, and the implementation was restored afterwards (`diff -q` against the backup: identical). Five mutations, five catches:

| # | Mutation | Caught by |
| --- | --- | --- |
| 1 | Delete the `hasRpm !== hasTpm` pair check (lenient pair) | tests 5, 6, 7 — "PROXY_RPM set with PROXY_TPM absent", "PROXY_TPM set with PROXY_RPM absent", "PROXY_TPM set with PROXY_RPM whitespace-only" |
| 2 | `readPositiveInteger` → `return Number(raw.trim())` (no guard at all) | tests 8, 9, 10 |
| 3 | Drop only `/^[0-9]+$/`, keep the safe-integer and `> 0` checks (accepts `1e3`) | test 10 only — the pinned test, and nothing else, which is the point of pinning it |
| 4 | Blankness decided after presence: `const hasRpm = rawRpm != null` | tests 2 and 7 — the blank-pair test and the whitespace-partner test |
| 5 | Drop only `Number.isSafeInteger(value)`, keep the digit regex | tests 8, 9 — the `2^53+1` and 30-digit cases |

Mutation 5 is the one worth calling out: `Number("9007199254740993")` rounds to 2^53, which the digit regex accepts and which is *not* a safe integer, so that case exercises the safe-integer guard rather than the regex. Without it, the "unsafe integer" case would have been vacuous.

## Ledger

`specs/epics/e04-rate-limiting/e04s01-tasks.yaml` task 3 flipped `failing` → `passing`, in commit `8169595`, only after the verify command exited 0. `specs/execution-status.yaml` still reads `e04s01: failing` — the story is incomplete. `LOG.md` gained exactly three lines (one to each of `done`, `decided`, `next`) in the follow-up commit `4c4ae90`.

## Concerns

1. **The decimal-digits-only rule rejects `1e3` and `0x10`, and I implemented it as written.** It is strict, and an operator who legitimately wants `1e3` gets a startup crash with a message that does not mention the accepted notation. I think the call is right for this story — the rejection is loud, local, and one keystroke from correct, while `Number()` acceptance is silent and produces a policy nobody chose — and the cost of being wrong is one regex plus one pinned test. But the guard is stricter than the spec requires: the story only says "positive integers" and asks this story to settle the notation question explicitly. If a later slice finds operators setting these from templated values that arrive in exponent form, the reversal should be made deliberately and in one place, not by widening the regex in passing.
2. **The one-field `rateLimit` shape is not directly asserted by any test.** The black-box harness cannot see the config object, and the brief forbids adding a seam, so requirement 2's "one field, not two, and `null` when absent" is only verified by the absence of a second field — which nothing checks. The startup behavior behind it is covered; the shape is not. A reviewer may want that acknowledged in the ADR rather than left implicit.
3. **The fatal-case tests surface a 4s harness timeout instead of an assertion failure when the guard is missing.** Pre-implementation they failed with `'proxy process did not exit'` rather than `expected 0 to equal 1`. Correct, but slow and easy to misread as infrastructure flakiness.
4. **Task 6's verify now matches a test that task 6 did not write.** Task 6 filters on the name pattern `whitespace`, and task 3's blank-pair test is named `PROXY_RPM and PROXY_TPM blank (empty or whitespace-only) start with rate limiting disabled`, so that pattern already matches a passing test. Task 6's own whitespace coverage must go beyond the `PROXY_RPM`/`PROXY_TPM` case, or narrow its pattern, or its verify will pass on task 3's test. Flagged in the `next` section of `LOG.md`.
5. **The ambient environment can leak into these tests.** `withProxy` and `runProxyOnce` both inherit `process.env`, so a developer machine or CI runner with `PROXY_RPM` set in the shell would break the "both absent" and "both blank" cases. This is pre-existing harness behavior that the `PROXY_HOST` tests already live with, and I did not change it; the rate pair is simply the first variable whose accidental presence would be fatal.

## Not done

- No push, no PR, nothing outside this worktree touched.
- Task 4 onward untouched; `tech-stack.md`'s startup-config table and `docs/adr/` entries for the new variables remain task 7 / task 8 work, as the LOG's `next` section records.
