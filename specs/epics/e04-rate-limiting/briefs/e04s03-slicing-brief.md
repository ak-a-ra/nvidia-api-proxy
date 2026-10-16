# e04s03 slicing brief

## Objective

Create the next executable story capsule for issue #16, “Make admission abort-aware and shutdown-safe.” User value: abandoned queued requests consume no capacity or upstream work, and SIGTERM promptly rejects queued clients while admitted streams retain the existing grace period.

## Source of truth

- GitHub issue #16: `https://github.com/ak-a-ra/nvidia-api-proxy/issues/16`
- `specs/state.yaml` handoff and decisions, especially the carried e04s02 gaps and the decision that cancellation/shutdown belong to e04s03.
- `specs/epics/e04-rate-limiting/epic.yaml` and e04s02 capsule/task ledger.

## Required scope

Cover issue #16 acceptance criteria: remove queued waiter and clear its timer/listeners on disconnect; abort active upstream work on client disconnect before headers or during streaming; release admission exactly once; close admission before server shutdown and reject each queued request with status 503 and exact body `{ "error": "Service unavailable" }`; allow admitted streams to finish within existing 10-second grace; keep `/health` responsive; exercise repeated transitions, races, and child survival through black-box tests.

Also close carried e04s02 findings from state handoff: timer-mid-release race, default-32-queue observation, guard against writing 429 after response destruction, and reviewer’s fixed 250ms no-bypass observation window if relevant to the revised tests. `releaseOnce` listener removal is harmless and optional; do not inflate scope absent concrete value.

## Constraints

- Keep zero runtime dependencies, ESM, existing child-process black-box test seam, and admission ownership in `admission.js`.
- Preserve current auth/config ordering, exact existing 429 contract, and 10-second SIGTERM grace behavior.
- No future-slice RPM/TPM enforcement or stats endpoint.
- Story spec is written later by `plan-work`; this task only creates task ledger and updates capsule/state indexes.
- Every task needs a runnable, focused `verify:` command. Include full-suite verification in a final task.
- Estimate story at no more than 8 BCP; split only if independent, demonstrable slices emerge.

## Deliverables

- `specs/epics/e04-rate-limiting/e04s03-tasks.yaml`
- Update `epic.yaml` e04s03 from blocked placeholder to planned story, with BCP and `MODIFIED` requirement delta.
- Update `specs/execution-status.yaml` e04s03 to `todo`.
- Update `specs/state.yaml` handoff to `plan-work`, recording the capsule creation and keeping VCS identity accurate.
- Leave `release-plan.yaml` ordering unchanged unless evidence requires a change.

## Report

Write implementation report to `specs/epics/e04-rate-limiting/briefs/e04s03-slicing-report.md`; include chosen task boundaries, BCP estimate, verification commands, files changed, and unresolved concerns. Do not commit.
