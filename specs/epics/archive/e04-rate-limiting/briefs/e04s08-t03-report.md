# e04s08 task 3 report — server.js counters

## git log -2 --oneline
```
f6f9dde feat(server): add monotonic request-path counters
1dac39e feat(stats): expose monotonic budget counters
```

## Task 3 verify (`e04s08-tasks.yaml` id 3)
Command:
```
node -e "
  const fs = require('fs');
  const s = fs.readFileSync('server.js', 'utf8');
  if (!/completed/.test(s) || !/oversizedBodyRejections/.test(s) || !/activeClientDisconnects/.test(s)) {
    console.error('server.js missing one of the three stats counters'); process.exit(1);
  }
  console.log('server.js counters present');
"
```
Output:
```
server.js counters present
```
rc: 0

## Implementation
Added module-level private monotonic counters in `server.js` (`completed`, `oversizedBodyRejections`, `activeClientDisconnects`), incremented exactly once per terminal site:

- `oversizedBodyRejections++` — 413 arm in `readBodyWithCap` (pre-admission body-cap rejection).
- `completed++` — post-admission terminal outcomes: `res.destroyed || res.writableEnded` after `admission.acquire`, no-body upstream response (`!upstream.body`), and `pipeline` `onComplete` (covers both SSE and non-SSE pass-through, success and error).
- `activeClientDisconnects++` — catch block, swallowed `AbortError` message `client disconnected` (admitted-request client disconnect).

Not incremented: `/health`, `/stats`, unauthenticated 401, unconfigured 503, bare `/v1`, non-`/v1` 404, pre-admission admission-acquire rejections (queue full / queue timeout / shutdown / cancelled). Counters read-only until `/stats` reads them in task 4; no counter reset, no response-behavior change.

## npm test
```
tests 217
pass 217
fail 0
```
rc: 0

## npm run check (lint + typecheck + format:check)
rc: 0, clean. ESLint clean, tsc clean, Prettier clean.

## Concerns
- Counters are write-only until `/stats` (task 4) exposes them; a `void` read reference is kept to satisfy `no-unused-vars` on the module-level `let` declarations. No behavior change.
- No RED test was observable without `/stats` 200 (task 4), so this commit is GREEN per brief; black-box observability arrives in task 4 via `/stats` black-box tests.
- `completed` increments in `onComplete` for both success and mid-stream failure; client-disconnect abort before headers completes via the catch `activeClientDisconnects` arm rather than `completed`, matching spec (admitted client disconnect counted under its own counter).
