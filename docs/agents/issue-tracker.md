# Issue Tracker

## Provider

GitHub Issues

## Repository

`ak-a-ra/nvidia-api-proxy`

## CLI

`gh` (GitHub CLI)

## Workflow

- **Create issue:** `gh issue create --title "..." --body "..." [--label "..."]`
- **List issues:** `gh issue list [--label "..."] [--state open]`
- **View issue:** `gh issue view <number>`
- **Close issue:** `gh issue close <number>`
- **Add labels:** `gh issue edit <number> --add-label "label1,label2"`
- **Remove labels:** `gh issue edit <number> --remove-label "label1"`
- **Comment:** `gh issue comment <number> --body "..."`

## Notes

- All issue operations assume the current working directory is inside the repo clone.
- The `gh` CLI must be authenticated (`gh auth status`).
- When creating issues from plans/specs, use `--label` to apply triage labels from `triage-labels.md`.
