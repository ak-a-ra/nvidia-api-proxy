# e04s03 slicing report

## Result

Created task capsule for issue #16, “Make admission abort-aware and shutdown-safe.” Estimated 8 BCP, at the story ceiling. One vertical story remains appropriate: queued cancellation, active request abort, and shutdown handling share admission lifecycle ownership and only provide the stated user value together.

## Task boundaries

1. Admission ticket cancellation, waiter cleanup, timer/release race, and no upstream work for cancelled waiters.
2. Client disconnect abort before headers or during streaming, with exactly-once capacity release.
3. Close admission before SIGTERM; reject queue with exact 503 contract, while preserving admitted stream grace and `/health`.
4. Guard late 429 writes and cover queue default, FIFO/no-bypass observation, and rejection edges.
5. Update living docs and test-count references.
6. Full-suite and repository quality gate.

Tasks 1–4 require passing TAP assertions for specifically named cases, so zero matched tests fail verification. Task 2 includes explicit no-502 coverage. Task 3 requires no upstream calls for SIGTERM-rejected waiters and `/health` under queue saturation. Task 5 derives suite count, checks README badge and living-doc count claims—including `(currently <n>)`—then checks diff whitespace. Task 6 includes `npm test` and `npm run check`.

## Changed files

- `specs/epics/e04-rate-limiting/e04s03-tasks.yaml`
- `specs/epics/e04-rate-limiting/epic.yaml`
- `specs/execution-status.yaml`
- `specs/release-plan.yaml`
- `specs/state.yaml`
- This report

Epic total updated to 25 BCP: e04s01 9 + e04s02 8 + e04s03 8. Release-plan ordering unchanged; its stale note now reflects #16 planned. State handoff now points to `plan-work`, and `metrics.story_start` is `2026-10-16T13:11:42Z`; VCS identity records current HEAD `dd389d2a3aed1e9b861292c5c0157a09fe27754b` on `main`.

## Unresolved concerns

- No tests or quality gate run, per task brief; validation limited to YAML syntax and artifact diff checks.

## Validation evidence

- `rtk python -c 'import yaml; from pathlib import Path; fs=["specs/epics/e04-rate-limiting/e04s03-tasks.yaml","specs/epics/e04-rate-limiting/epic.yaml","specs/execution-status.yaml","specs/state.yaml","specs/release-plan.yaml"]; [yaml.safe_load((lambda s: s.split("```yaml",1)[1].split("```",1)[0] if "```yaml" in s else s)(Path(f).read_text())) for f in fs]; print("YAML syntax ok")'` — all five YAML artifacts parsed.
- `rtk python -c 'import subprocess,yaml; from pathlib import Path; d=yaml.safe_load(Path("specs/epics/e04-rate-limiting/e04s03-tasks.yaml").read_text()); [subprocess.run(["sh","-n"],input=t["verify"],text=True,check=True) for t in d["tasks"]]; print("all verify shell syntax ok")'` — all six verify commands passed shell syntax validation.
- Extracted task 5 JavaScript and ran `node --check -` — syntax passed.
- `rtk git diff --check` — passed.
- Tests and `npm run check` were not run.
