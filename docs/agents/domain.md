# Domain Docs

How engineering skills consume this repo's domain documentation.

## Layout

Single-context repository.

## Before exploring

- Read `CONTEXT.md` at repo root first when work touches domain concepts, naming, architecture, or tests.
- Read relevant ADRs under `docs/adr/` before proposing architectural changes.
- If files are missing, proceed silently. `/domain-modeling` creates them when terminology or decisions need recording.

## File structure

- `CONTEXT.md`: canonical domain language, concepts, and bounded context.
- `docs/adr/`: Architectural Decision Records in standard MADR format.

## Use glossary vocabulary

When output names a domain concept in an issue title, proposal, hypothesis, or test, use the term defined in `CONTEXT.md`. Do not drift to synonyms the glossary explicitly avoids.

If a needed concept is missing, either reconsider invented language or note a real gap for `/domain-modeling`.

## ADR conflicts

If proposed work contradicts an existing ADR, surface the conflict explicitly rather than silently overriding it.
