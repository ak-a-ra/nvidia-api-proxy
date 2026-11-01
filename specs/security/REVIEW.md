# Security Review — Release Gate

- Generated: 2026-10-27T21:28:40Z
- Base SHA: 8142d64e1087d008c59f27dbb15eb8660c33ed49 (main)
- HEAD SHA (pre-commit): 8d87f70ec16e734d2224fd59c4ae01777ca85cd6
- Branch: e04s07-reconcile-non-streaming-usage
- Reviewed production diff at 8d87f70ec16e734d2224fd59c4ae01777ca85cd6
- Production files unchanged by this metadata-only commit.
- Subsequent release-artifact-only commits do not alter production scope.
- Scope: production diff `main...HEAD` (`observer.js`, `server.js`)

## Methodology

Five-phase scan per `.agents/skills/security-review/SKILL.md`: scope resolution, context research, vulnerability assessment (input-to-sink tracing, auth boundaries, crypto, deserialization, path operations), false-positive filtering (hard exclusions + precedents), and report generation. Only findings with confidence >= 8/10 are reported. Each surviving finding is mapped to a CWE. Denial-of-service, resource-exhaustion, and test-only concerns are excluded by the skill's hard exclusion rules.

## Findings

None. No unresolved HIGH, MEDIUM, or LOW findings with confidence >= 8.

Reviewed surfaces in the diff:

- `observer.js`: `usageTotalFromUsage` validates `usage` shape and numeric finiteness/non-negativity; `createJsonObserver` bounds the retained copy at `JSON_OBSERVATION_BYTE_BOUND` (1,048,576) bytes, detaches cleanly on overflow, and parses JSON once at `end()`. JSON parsing is wrapped; observer callbacks are guarded. No code execution, shell, filesystem, or network sinks are introduced.
- `server.js`: no-body branch reconciles `null` once; non-SSE pass-through keeps `pipeline(src, res, onComplete)` with the observer as a side listener; downstream close, mid-stream failure, and pre-header failure paths retain existing conservative behavior. No new auth, path, or deserialization surface.
- `docs/adr/0002-config-operational-fail-fast.md`: documentation only.

## Release verdict

PASS

---

# Security Review — e04s08 (branch feat/e04s08-stats)

- Generated: 2026-11-01T02:00:00Z
- HEAD SHA: d7ce5e5 (feat/e04s08-stats)
- Scope: production diff `main...HEAD` (`server.js`, `admission.js`, `budget.js`, `server.test.js`)
- Method: independent reviewer subagent traced the `/stats` data flow, auth ordering, allowlist construction, counter exposure, and logging; cross-checked against `.agents/skills/security-review/SKILL.md`.

## Findings

None. No HIGH, MEDIUM, or LOW findings with confidence >= 8.

Verified: `authorized()` (SHA-256 digest + `timingSafeEqual`) runs before the unconfigured 503, so a missing token never leaks credential state; non-GET `/stats` → 404; `/stats` never contacts upstream and increments no counter; body is the exact 21-key aggregate allowlist with no tokens, keys, upstream host, paths, or model IDs (`trackedModels` exposed as a count only, null-prototype map so `__proto__` is an ordinary key); `sendJson` drains the request and sets fixed headers; request logging stays the closed 5-field set.

## Release verdict

PASS
