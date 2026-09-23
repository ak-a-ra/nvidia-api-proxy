# NVIDIA API Proxy Specs

All planning documents for this project.

## Current State

This project is in the **Discover** phase of the bigpowers lifecycle. It has existing production code but lacks the bigpowers planning infrastructure (specs/ directory, CONVENTIONS.md, release-plan.yaml).

## Next Steps

1. Run `seed-conventions` to establish bigpowers infrastructure
2. Follow the bigpowers lifecycle: Design → Plan → Initiate → Execute → Verify
3. Use TDD for all implementation work
4. Run `npm test` before pushing changes

## Project Overview

Zero-dependency Node.js reverse proxy for NVIDIA NIM API with:
- 34 tests in server.test.js
- No external dependencies
- ESM-only architecture
- Node >= 18.14 requirement
- SIGTERM graceful shutdown support