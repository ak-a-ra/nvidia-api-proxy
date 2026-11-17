# Team workflow — bigpowers rules for teammates

SPDX-License-Identifier: MIT

Source of truth: `.agents/skills/using-bigpowers` + `SKILL-INDEX.md` catalog.
This repo runs **solo-git** mode (`specs/state.yaml` `workflow_mode: solo-git`):
land via local merge to `main`, push only on lead instruction (lead confirms with human).

## Rules every teammate follows

1. **specs/ is memory.** All plans, decisions, investigation outputs, reports go under `specs/`. Never create GitHub issues from skills — local Markdown only.
2. **verify: every step.** Every task must end with a runnable `verify` command (evidence over claims): `npm test`, `npm run check`, targeted `node --test --test-name-pattern`.
3. **Lifecycle phases** (orchestrate-project): Discover → Elaborate → Plan → Build → Verify → Release. Lead assigns the phase; teammate works inside it.
4. **One skill, one thing.** If unsure which skill applies, that's `survey-context`'s job — ask lead.
5. **Commits:** Conventional Commits (`feat:`/`fix:`/`docs:`/`build:`/`test:`). Run `npm run check` before every commit.
6. **Hard constraints (AGENTS.md/CONVENTIONS.md):** zero runtime deps, ESM only, never delete/relax/skip existing tests, new env var → `CONFIG_ENV_VARS` in same commit, test-count sync in living docs on change, error responses never leak internals.
7. **Role boundaries** (from spawn briefs): coder never pushes/GitHub/main; reviewer never edits; github-ops only on explicit lead instruction, never closes issues/merges/force-pushes unbidden.
8. **Reports:** implementer writes report file under `specs/epics/<epic>/briefs/` and messages `lead` a short summary. Reviewer messages `lead` verdict APPROVE/CHANGES with categorized findings (blocker/major/minor/nit, file:line).
9. **Escalation:** blocked only on human decision (irreversible, security, outside-worktree side effects) → message `lead`, lead asks human.

## Handoff
Lead records state in `specs/state.yaml` (`handoff.next_skill`, `active_flow`, `active_epic/story`).
