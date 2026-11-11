# e05s01: Bound request-body buffering before admission control

* Story: e05s01
* Epic: e05 — Request handling
* Issue: [#24](https://github.com/ak-a-ra/nvidia-api-proxy/issues/24)
* Status: todo
* BCPs: 3
* Type: feat | Context: rate-limit / request-handling

## 1. Business narrative

In rate-limit mode, server.js fully reads and buffers each request body before calling admission.acquire(). The 8 MiB cap is per-request, not aggregate. A burst of authenticated clients can allocate many request buffers and hold upload connections before the concurrency ceiling or FIFO queue takes effect. Slow uploads occupy connections while admission still reports no active or queued work. Resource protection should cover the upload/buffering phase as well as upstream work.

## 2. Problem statement

No bound exists on aggregate buffered body bytes across concurrent requests. Memory can grow unbounded under many simultaneous uploads, independent of the admission concurrency ceiling.

## 3. Actors

- Operator — deploys the proxy and expects memory protection during upload bursts.
- Authenticated client — uploads request bodies; expects fair admission regardless of upload speed.

## 4. Preconditions

- npm test passes (248 tests).
- Rate-limit modules (config, budget, admission) are implemented and passing (e04 complete).

## 5. Solution and main flow

- Add an aggregate buffered-byte budget (separate from per-request cap) enforced at body-read time in server.js.
- Optionally add a body-read semaphore limiting concurrent body reads.
- Reject or queue excess uploads before accumulating full bodies.
- Keep per-request byte cap and byte-identical forwarding.
- Release the budget/semaphore slot on response close or error.

## 6. Constraints and alternative flows

- Zero runtime dependencies (Node built-ins only).
- Do not change NVIDIA API endpoint or forwarding behavior.
- Admission/upstream concurrency limit remains independent of body-reader capacity.
- Alternative: body-read timeout / minimum upload rate — deferred to follow-up if not achievable in this slice.

## 7. Domain glossary

- Body-read semaphore — bounds concurrent body reads.
- Aggregate buffered-byte budget — total bytes buffered across all in-flight requests.

## 8. Interfaces and contracts

New exported helpers in server.js or a new root module for body-read budgeting. server.js calls into it at request time.

## 9. Configuration

No new env vars required for this slice; reuse existing PROXY_MAX_BUFFERED_BODY_BYTES as the per-request ceiling reference. Aggregate bound can be a fixed multiple or derived constant.

## 10. Data and state

Body-read semaphore state and aggregate byte counter live in request scope, released on close/error.

## 11. Invariants

- Concurrent slow uploads cannot grow memory without a configured bound.
- Admission concurrency limit independent of body-reader capacity.
- Byte-identical forwarding preserved.

## 12. Failure modes

- Body read timeout → reject request, release slot.
- Client disconnect during upload → release slot immediately.

## 13. Security and privacy

No secrets logged. Body contents never written to logs.

## 14. Observability

Test coverage via black-box HTTP tests: many simultaneous uploads, slow uploads, disconnects during upload, recovery after slot release.

## 15. Dependencies

Depends on e04 (admission, budget) being complete. Blocks nothing new.

## 16. Risks and assumptions

- Aggregate bound value must be justified and documented.
- Tests must spawn child processes with per-test env (hermetic).

## 17. Acceptance criteria (Gherkin)

```gherkin
Scenario: Concurrent slow uploads cannot grow memory without bound
  Given many simultaneous uploads
  When bodies are being read
  Then aggregate buffered bytes stay within the configured bound

Scenario: Admission concurrency limit independent of body-reader capacity
  Given body-reader at capacity
  When admission slot is free
  Then a new request can still be admitted up to the concurrency ceiling

Scenario: Disconnect during upload releases the slot
  Given a client disconnects mid-upload
  When the upload aborts
  Then the buffered-byte budget and semaphore slot are released

Scenario: Recovery after a reader slot is released
  Given a slot was held by a disconnected client
  When the slot releases
  Then a new upload can proceed
```

## 18. Out of scope

- Body-read timeout / minimum upload rate (deferred).
- Changing NVIDIA API endpoint.
- Server-side request replay.

## 19. Verification

npm test full suite green. New tests cover simultaneous uploads, slow uploads, disconnects, recovery. See e05s01-tasks.yaml.

## 20. References and traceability

- Issue [#24](https://github.com/ak-a-ra/nvidia-api-proxy/issues/24)
- server.js body-read path (~line 303)
- admission.js acquire/release
