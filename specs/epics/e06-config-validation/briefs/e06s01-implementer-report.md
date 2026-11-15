# IMPLEMENTER_REPORT_E06S01

Story: e06s01 — Move upstream timeout env vars into parseConfig (issue #33 P1)
Branch: e06s01-timeout-validation
Base commit: fe41ad7

## Summary

Moved UPSTREAM_CONNECT_TIMEOUT_SECONDS and UPSTREAM_IDLE_TIMEOUT_SECONDS reads out of module-level readSeconds(process.env) calls and into parseConfig(env) with digits-only validation (0 disables). Invalid input fails fast: process.exit(1), stderr names the variable. Defaults: connect 30, idle 120. Added black-box tests for valid, invalid, zero, missing values for both timeouts (suite grew 249 → 255 tests, all passing). npm run check (lint + typecheck + format:check) clean.

## What changed

### config.js
- Removed the lenient readSeconds(name, fallback) helper (reads process.env[name] directly, fell back on any non-finite/negative value).
- Removed the module-level export const CONNECT_TIMEOUT_SECONDS = readSeconds("UPSTREAM_CONNECT_TIMEOUT_SECONDS", 30) and IDLE_TIMEOUT_SECONDS reads that sat outside parseConfig.
- Added timeouts: readTimeouts(env) to the parseConfig return shape.
- Added readTimeoutSeconds(name, raw, fallback): blank → fallback; otherwise /^[0-9]+$/ digits-only after trim, 0 allowed (disables), anything else → console.error("<name> must be a non-negative integer (0 disables), got: ...") + process.exit(1).
- Added readTimeouts(env) returning { connectTimeoutSeconds: ..., idleTimeoutSeconds: ... } with defaults 30 / 120.
- Named exports preserved: export { CONNECT_TIMEOUT_SECONDS, IDLE_TIMEOUT_SECONDS } derived at module load via readTimeouts(process.env) so server.js imports keep working unchanged.

### server.js
- Unchanged. Keeps import { parseConfig, CONNECT_TIMEOUT_SECONDS, IDLE_TIMEOUT_SECONDS } from "./config.js" and re-export at line 36. Connect timer (CONNECT_TIMEOUT_SECONDS * 1000) and idle watchdog (IDLE_TIMEOUT_SECONDS * 1000) read the named exports unchanged.

### server.test.js
- CONFIG_ENV_VARS already listed both UPSTREAM_CONNECT_TIMEOUT_SECONDS and UPSTREAM_IDLE_TIMEOUT_SECONDS (hermetic child-process env stripping satisfied — same-commit constraint met).
- New describe("upstream timeout config") block with 6 black-box tests:
  - UPSTREAM_CONNECT_TIMEOUT_SECONDS=abc → exit 1, stderr names the variable
  - UPSTREAM_IDLE_TIMEOUT_SECONDS=xyz → exit 1, stderr names the variable
  - UPSTREAM_CONNECT_TIMEOUT_SECONDS=0 → starts and serves /health (connect timeout disabled)
  - UPSTREAM_IDLE_TIMEOUT_SECONDS=60 → starts and serves /health (idle timeout set to 60s)
  - both unset → starts and serves /health (defaults applied)
  - both whitespace-only → starts and serves /health (blank → defaults)

### e06s01-tasks.yaml
- All 4 tasks status set to passing; story status passing.

## Verification

- npm test: 255 tests, 255 pass, 0 fail (baseline 249 + 6 new).
- npm run check: lint clean, typecheck clean, format:check clean.
- config.js loads cleanly under node --input-type=module.

## Living docs synced (249 → 255)

- README.md:9 badge tests-255%20passing
- README.md:116 tip (255 tests, no deps needed)
- AGENTS.md:89 full suite (255 tests
- AGENTS.md:113 (currently 255)
- CONVENTIONS.md:17 runs all 255 tests
- specs/README.md:19 255 tests in server.test.js
- specs/tech-architecture/tech-stack.md:172 **Test Count**: 255 tests
- specs/tech-architecture/tech-stack.md:54-55 timeout rows changed from lenient readSeconds fallback to fatal digits-only rule
- specs/tech-architecture/TEST_PLAN_LATEST.md:44,294,351 255 tests
- specs/product/VISION_LATEST.yaml:20 255 tests
- specs/state.yaml:33 npm test green (255 pass, 0 fail)

Not updated (exempt dated/append-only records): docs/research/config-invariant-guard-tests.md, LOG.md, specs/epics/*/briefs/, specs/epics/*/*-tasks.yaml, specs/verifications/.

## Constraints satisfied

- Zero runtime dependencies (Node built-ins only); ESM only.
- npm test stays plain node --test.
- npm run check clean before commit.
- No existing tests deleted or weakened.
- New env vars added to CONFIG_ENV_VARS in same commit as config.js (already present).
- Config hermeticity preserved: childEnv() strips both vars before test overrides.

## TDD workflow

1. RED: wrote failing fail-fast tests (invalid connect/idle → exit 1, stderr names variable), committed test(e06s01): ... .
2. GREEN: minimal config.js change (readTimeouts inside parseConfig + named exports), committed feat(e06s01): ... .
3. Verified npm test + npm run check clean after each step.

## Open objectives

None — all story work complete and verified.