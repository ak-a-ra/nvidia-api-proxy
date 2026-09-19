# Triage Labels

Label strings used by the triage state machine. Each role maps to exactly one label.

| Role | Label | Description |
|---|---|---|
| Evaluate | `needs-triage` | Maintainer needs to evaluate this issue |
| Waiting | `needs-info` | Waiting on reporter for more information |
| Agent-ready | `ready-for-agent` | Fully specified; an AFK agent can pick this up |
| Human-ready | `ready-for-human` | Needs human implementation |
| Won't fix | `wontfix` | Will not be actioned |

## Usage

- When triaging, apply exactly one of these labels to indicate the issue's current state.
- Remove the previous triage label before applying a new one.
- These labels can coexist with other labels (e.g. `bug`, `enhancement`).
