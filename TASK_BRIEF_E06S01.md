# Task Brief — e06s01 Timeout Validation (issue #33 P1)

## Story
Move UPSTREAM_CONNECT_TIMEOUT_SECONDS and UPSTREAM_IDLE_TIMEOUT_SECONDS reads into parseConfig with digits-only validation; fail fast on invalid input.

## Constraints (hard)
- Zero runtime dependencies (Node built-ins only). ESM only.
- npm test plain `node --test` must stay green.
- `npm run check` (lint + typecheck + format:check) must pass before commit.
- Never weaken/delete tests.
- Test count currently 255 — sync all living docs if suite size changes.
- Config hermeticity: new env vars must be added to CONFIG_ENV_VARS in same commit as config.js.

## Story spec
specs/epics/e06-config-validation/e06s01-timeout-validation.md (20 sections).

## Tasks (specs/epics/e06-config-validation/e06s01-tasks.yaml)
t01: Locate timeout reads outside parseConfig in config.js.
t02: Move reads into parseConfig with digits-only validation (0 disables), fail fast on invalid.
t03: Add tests: valid, invalid, zero, missing values for both timeouts.
t04: Run full suite + lint + format:check.

## Implementation scope
- config.js: Move UPSTREAM_CONNECT_TIMEOUT_SECONDS / UPSTREAM_IDLE_TIMEOUT_SECONDS reads into parseConfig.
- Validate digits-only (/^[0-9]+$/ after trim), 0 disables.
- Invalid → exit 1 with stderr naming the variable.
- Defaults: connect 30, idle 120.
- server.js must not read these env vars directly (config owns them).

## Tests to add
Black-box HTTP: invalid UPSTREAM_CONNECT_TIMEOUT_SECONDS=abc → proxy exits 1, stderr names variable. UPSTREAM_IDLE_TIMEOUT_SECONDS=-5 → exits 1. UPSTREAM_CONNECT_TIMEOUT_SECONDS=0 → connect timeout disabled. UPSTREAM_IDLE_TIMEOUT_SECONDS=60 → idle timeout 60s.

## Deliverables
- IMPLEMENTER_REPORT_E06S01.md at worktree root.
- e06s01-tasks.yaml all tasks done.
- npm test green, npm run check clean.
- All committed on branch e06s01-timeout-validation.

## Orchestrator rules
Lead never writes implementation code. Dispatch implementer → read report → dispatch reviewer → resolve findings.

## Repo paths
Main repo: /data/data/com.termux/files/home/projects/nvidia-api-proxy
Worktree: /data/data/com.termux/files/home/projects/e06s01-timeout-validation
Base commit: fe41ad7 (e05s02 complete, count 249).