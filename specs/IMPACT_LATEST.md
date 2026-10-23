# Impact: e04s06 SSE usage reconciliation

## Target
server.js streaming pipeline (`pipeline(src, res)` around `Readable.fromWeb(upstream.body)`) and budget.js reservation lifecycle (`reserve`, `release`, and a new reconcile capability).

## Dependents
- server.js: one call site for `pipeline(src, res)` in the main request handler; reservation created before upstream contact.
- budget.js: `reserve()` returns admission decision; `release()` currently no-op; needs reconcile to replace estimated tokens with actual usage.
- server.test.js: black-box SSE stub mode and streaming assertions; new tests expected for byte-identical passthrough and usage reconciliation.

## Affected Stories
- e04s06: Reconcile SSE usage without breaking streaming (issue #19)
- e04s07: non-streaming reconciliation and terminal fallbacks (depends on e04s06)
- e04s09: integration/docs/verify pass

## Test Coverage
- Existing SSE stub mode (`mode === "sse"`) in server.test.js; tests for stream pass-through and client disconnect.
- Gap: no usage parsing, reconciliation, or exact-byte SSE comparison tests yet.

## Risk: High
Shared streaming path and budget reservation lifecycle; incorrect reconciliation can leak or undercount quota, and any buffering would break streaming. New observer module must not alter pass-through bytes.

## Recommended action
Proceed with plan-work; keep pass-through byte-identical; add observer as separate module; reconcile only on successful completion.
