# Domain Docs

## Layout

Single-context

## Context file

`CONTEXT.md` at repo root (create if missing — describes the project's domain language, key concepts, and bounded contexts).

## ADR directory

`docs/adr/` at repo root (create if missing — Architectural Decision Records in standard MADR format).

## Consumer rules

- **Always read `CONTEXT.md` first** when working on tasks that touch domain concepts, naming, or architecture.
- **Check `docs/adr/` before proposing architectural changes** — a prior ADR may already cover the decision.
- **Never modify `CONTEXT.md` or ADRs as a side effect** of other work. Update them intentionally via dedicated commits.
- **If a domain term is ambiguous**, check `CONTEXT.md` for the canonical definition before inventing new terminology.
