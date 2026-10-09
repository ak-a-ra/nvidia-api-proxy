# Task Review — e04s02 / task 1: root-level `admission.js`

- **Verdict:** PASS
- **Commit SHA:** `f1968c6988e10ca11c935beddef765ac4def4ae1`
- **Reviewer:** Subagent (Independent Reviewer)

## Requirements Checklist

1. **Root-level ESM Module:**
   - PASS. `admission.js` created at project root, ESM `import`/`export` syntax used.

2. **Interface & Construction (`createAdmission(limits)`):**
   - PASS. Factory function `createAdmission(limits)` exported.
   - Defaults: `maxConcurrentRequests ?? null`, `maxQueueSize ?? 32`, `queueTimeoutSeconds ?? 30`.

3. **Disabled Ceiling Bypass:**
   - PASS. When `limits.maxConcurrentRequests` is `null`, returns `{ acquire() }` resolving `{ admitted: true, release: noopRelease }`. Zero queue allocation, zero timers created.

4. **Bounded Concurrency & Slot Transfer:**
   - PASS. Concurrency capped strictly at `maxConcurrent`. `active` increments on initial admission up to ceiling. When releasing, if waiters exist in queue, slot transfers directly to oldest non-settled ticket without decrement/re-increment jitter, keeping `active <= maxConcurrent` invariant strictly preserved.

5. **FIFO Queue & Bounded Size:**
   - PASS. Queue enqueues via `push` and dequeues via `shift` (FIFO). Rejects immediately with `{ admitted: false, reason: "queue_full" }` when `queue.length >= maxQueueSize`.

6. **Ticket Timeout & Non-Admission After Timeout:**
   - PASS. Waiters scheduled with unref'd `setTimeout` for `timeoutMs`. If timer fires, ticket is marked `settled = true`, removed from queue, and resolves `{ admitted: false, reason: "queue_timeout" }`. On release, timed-out tickets (`next.settled === true`) are skipped. A timed-out ticket is never admitted.

7. **Idempotent Release:**
   - PASS. `makeRelease()` uses local boolean closure flag `let settled = false`. Repeated invocations return immediately without side effects or double-decrements.

8. **Event-Driven Execution:**
   - PASS. No polling loops (`while(true)`) or `setInterval`. Waiters resolve strictly on `release()` or `setTimeout`.

9. **Zero Runtime Dependencies:**
   - PASS. Standard JS and Node built-in timer functions only.

10. **Information Hiding & Clean Seams:**
    - PASS. `server.js` exports unchanged (`CONNECT_TIMEOUT_SECONDS`, `IDLE_TIMEOUT_SECONDS`, default server). No limiter internals exported.

11. **Config & Test Isolation:**
    - PASS. `CONFIG_ENV_VARS` in `server.test.js` not touched.

## Independent Verification

1. **Task Verify Command:**
   - Command:
     ```bash
     npm test && node -e "const s=require('fs').readFileSync('admission.js','utf8'); if(!/maxConcurrentRequests/.test(s)){console.error('admission.js does not read the configured ceiling');process.exit(1);} const v=require('fs').readFileSync('server.js','utf8'); if(/export\s*{[^}]*\b(createAdmission|admission|acquire)\b/.test(v)){console.error('server.js must not re-export limiter internals');process.exit(1);} if(/setInterval/.test(s)){console.error('admission must be event-driven, never polled');process.exit(1);} console.log('no new security findings in affected paths: no new export, no polling');"
     ```
   - Result: Exit 0. 100/100 tests pass. Regex and AST checks pass.

2. **Quality & Standards Check (`npm run check`):**
   - Result: Exit 0 (ESLint clean, TypeScript clean, Prettier format clean).
   - Direct lint and format on `admission.js`: Clean.

3. **Ledger Status:**
   - `specs/epics/e04-rate-limiting/e04s02-tasks.yaml` task 1 updated to `status: passing`.

## Findings

No defects or architectural violations identified.
