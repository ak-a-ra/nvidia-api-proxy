# e01s01: Run the suite and test count sync on every push

* Story: `e01s01`
* Epic: `e01` — CI workflow
* Issue: [#12](https://github.com/ak-a-ra/nvidia-api-proxy/issues/12)
* Status: done
* BCPs: 3
* Type: chore | Context: infra

## 1. Business narrative

The repository has no continuous integration. `AGENTS.md` states plainly: "No CI: tests
only run when run locally — run `npm test` before pushing." Every guarantee this project
makes — 34 passing tests, pinned header-fidelity invariants, the streaming behavior that
makes it usable as a drop-in — rests on a human remembering to run a command. The rate
limiting epic (#13–#22) adds nine slices whose acceptance criteria repeatedly reference
"the full suite passes". That reference is currently unenforceable.

## 2. Problem statement

Nothing verifies the suite on push or pull request. A change can merge red and be discovered
at deploy time, or not at all.

## 3. Actors

- **Contributor** — pushes a change and needs fast, automatic confirmation the suite is green.
- **Maintainer** — needs the suite to run on every change before reviewing.
- **Deployment platform** — Render builds from the default branch.

## 4. Preconditions

- `npm test` passes locally (verified green at branch `epic-14-config-owner`, 34/34).
- Zero dependencies, so CI needs no install step.

## 5. Solution and main flow

Add `.github/workflows/ci.yml` that runs `npm test` on every push and pull request. A second
job runs lint, typecheck and format. The test count is enforced by the inline sweep
`AGENTS.md` documents, not by a separate script.

*Superseded since*: the shipped workflow tests Node 20, 22 and 24, not 18/20/24 — e08s02 raised
`engines.node` from `>=18` to `>=20`, which removed the floor this story's 18 leg existed to
guard. `specs/epics/e08-project-config/e08s02-node-engine.md` holds that decision.

*Superseded since*: the third axis "runs only on the default branch and re-derives the test
count" was never built as described and is not needed. `scripts/check-test-count.mjs`, which
tasks 1, 2, 4 and 6 named, has never existed in this repository; the count gate that shipped is
the inline grep sweep from `AGENTS.md` — the same replacement e04s01 task 12 and e03s01 task 7
already made. The `quality` job also carries `scripts/check-state-yaml.py`, which negative-tests
the ledger reader.

## 6. Constraints and alternative flows

- **Zero dependencies is a hard constraint** — the workflow must not add an install step or
  a package manager action beyond `actions/checkout` and `actions/setup-node` on the test job.
- **Node ≥ 20 is the floor** per `package.json` engines (e08s02). The matrix is 20, 22 and 24.
- **Test count sync is the project's own rule**, restated in `AGENTS.md`, `CONVENTIONS.md`,
  and `plans/README.md`. CI is the only place that can enforce it mechanically rather than
  by grep discipline.
- Alternative considered: run on 20 and 24 only. Rejected — a middle leg catches breakage that
  a two-point range lets through.
- Alternative considered: add a linter. Rejected — out of scope, and the project has
  explicitly declined a lint config.

## 7. Domain glossary

Uses existing terms: **Client**, **Upstream**, **Pass-through**, **Header fidelity**,
**Response stream**. No new domain terms.

## 8. Interfaces and contracts

New file `.github/workflows/ci.yml`. No change to any runtime interface.

## 9. Configuration

Workflow-level only. No new application env vars.

## 10. Data and state

None. The count-sync job reads `node --test` output and the living docs; it writes nothing.

## 11. Invariants

- The workflow must not add a dependency to `package.json`.
- The workflow must not modify tracked files.
- Every living doc that states a test count is checked; `plans/*.md` and
  `docs/research/config-invariant-guard-tests.md` are dated historical records and are
  explicitly exempt.

## 12. Failure modes

- A flaky test would block PRs. The suite spawns child processes with real sockets; if
  flakes appear, fix the test rather than adding retries.
- The count-sync job could false-positive on docs that mention a number incidentally. The
  grep pattern from `AGENTS.md` is narrow for this reason; keep it identical.

## 13. Security and privacy

Uses only first-party actions (`actions/checkout`, `actions/setup-node`) — no third-party
marketplace actions in a zero-dependency project. No secrets are needed: the suite spawns
its own stub upstream and never contacts the real NVIDIA API.

## 14. Observability

The GitHub Actions check appears on the PR and can be a required status check. Wiring it as
required is a repository-settings change, outside the worktree.

## 15. Dependencies

None. Blocks e04's final acceptance criterion ("issue #12 runs the suite when available").

## 16. Risks and assumptions

- Assumption: the repository owner is `ak-a-ra` and the default branch is `main`. Confirmed
  from `git remote -v`.
- Risk: making the check required would block the maintainer if CI is down. Recommendation:
  add the workflow first, require it later as a separate decision.

## 17. Acceptance criteria (Gherkin)

```gherkin
Scenario: Suite runs on every push across the supported Node range
  Given a commit pushed to the repository
  When the CI workflow runs
  Then "npm test" executes on Node 18, 20, and 24
  And no dependency installation step is required

Scenario: A red suite blocks the check
  Given a commit that breaks a test
  When the CI workflow runs
  Then the check reports failure
  And the failure names the failing test

Scenario: Test count drift is caught
  Given the suite reports N tests
  And a living document states a different count M
  When the count-sync job runs
  Then the job fails and names the document and line

Scenario: Historical documents are exempt
  Given plans/01-ci-github-actions.md states a count from a past plan
  When the count-sync job runs
  Then that file is not checked
```

## 18. Out of scope

- Making the check a required status check (repository settings).
- Any linting, formatting, or type checking. *Superseded since*: `1c7ab4e` added them as
  dev-only tooling in a separate `quality` job, so they are in scope now — the reason this
  story excluded them was that the project had declined a lint config, which stopped being
  true when `eslint.config.js` landed.
- Any package manager action beyond `checkout` and `setup-node`. *Superseded since*: the
  `quality` job runs `npm ci`, because lint/typecheck/format are dev-only dependencies. The
  zero-install promise survives where it was made: `npm test` still needs no install, and the
  `test` job installs nothing.

*Scenario clarification, added 2026-11-15.* The first scenario's "Node 18, 20, and 24" is left
as written because it is an acceptance criterion; e08s02 raised `engines.node` to `>=20`, so the
shipped matrix is 20, 22 and 24 and §6 carries the current floor. The third scenario's
"count-sync job" is the inline sweep inside `quality`, not a separate job, and it does name the
offending document and line — `grep -rn` prints `file:line:`. The fourth scenario's exemption
list has since grown: `LOG.md`, `specs/epics/*/briefs/`, `specs/epics/*/*-tasks.yaml`,
`specs/epics/archive/**`, and `specs/verifications/**` are exempt too, all for the same reason —
they are dated or append-only records of what a task reported at the time, not live claims.
- Changing the test suite itself.

## 19. Verification

`npm test` locally, plus one push to observe the workflow run. See
`e01s01-tasks.yaml` for the runnable per-task verify commands.

## 20. References and traceability

- Issue [#12](https://github.com/ak-a-ra/nvidia-api-proxy/issues/12)
- `plans/01-ci-github-actions.md` — the agent-executable plan this story implements
- `AGENTS.md` §Commands — the "No CI" statement this story makes false
- `package.json` — `engines.node >= 18.14`, zero dependencies
