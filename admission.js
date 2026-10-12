// Admission controller for bounding concurrent requests and queueing excess
// traffic.
//
// Invariants enforced here:
// 1. When limits.maxConcurrentRequests is null, everything admits immediately
//    with a no-op release callback, without queue allocation or timers.
// 2. When limits.maxConcurrentRequests is a positive number, active requests
//    never exceed limits.maxConcurrentRequests at any observable moment.
// 3. Excess requests wait in a strict FIFO queue bounded by limits.maxQueueSize.
// 4. Queued requests are protected by an individual queueTimeoutSeconds timer;
//    a ticket that times out is rejected and is never admitted afterwards.
// 5. Release is idempotent per admission handle (released boolean flag);
//    repeated calls never double-release capacity.
// 6. Waiting is strictly event-driven: resolved by release() or timeout timer,
//    never polled.
//
// Every value arrives validated from config.js, which is the only owner of
// defaults and parsing: a ceiling is null (disabled) or a positive integer, a
// queue size and a timeout are positive integers. This module re-reads no
// environment and carries no fallback of its own, so a default can exist in
// exactly one place.

// Rejection reasons, named once so the request path never string-compares a
// literal against a value this module invented.
export const REJECTION_REASONS = Object.freeze({
  QUEUE_FULL: "queue_full",
  QUEUE_TIMEOUT: "queue_timeout",
});

export function createAdmission(limits) {
  const maxConcurrent = limits.maxConcurrentRequests;
  const maxQueueSize = limits.maxQueueSize;
  const timeoutMs = limits.queueTimeoutSeconds * 1000;

  // Disabled ceiling: immediate admission, zero queue allocation, no timers.
  if (maxConcurrent === null) {
    const noopRelease = () => {};
    return {
      acquire() {
        return Promise.resolve({
          admitted: true,
          release: noopRelease,
        });
      },
    };
  }

  let active = 0;
  const queue = [];

  function createReleaseHandle() {
    let released = false;
    return () => {
      if (released) return;
      released = true;

      // Drain timed-out / cancelled tickets from front of FIFO queue
      while (queue.length > 0) {
        const next = queue.shift();
        if (next.consumed) continue;
        next.consumed = true;
        clearTimeout(next.timer);
        const nextRelease = createReleaseHandle();
        next.resolve({
          admitted: true,
          release: nextRelease,
        });
        return;
      }

      // No waiting ticket claimed the slot: decrement active count
      active--;
    };
  }

  function acquire() {
    if (active < maxConcurrent && queue.length === 0) {
      active++;
      return Promise.resolve({
        admitted: true,
        release: createReleaseHandle(),
      });
    }

    if (queue.length >= maxQueueSize) {
      return Promise.resolve({
        admitted: false,
        reason: REJECTION_REASONS.QUEUE_FULL,
      });
    }

    return new Promise((resolve) => {
      const ticket = {
        consumed: false,
        timer: null,
        resolve,
      };

      ticket.timer = setTimeout(() => {
        if (ticket.consumed) return;
        ticket.consumed = true;
        const idx = queue.indexOf(ticket);
        if (idx !== -1) {
          queue.splice(idx, 1);
        }
        resolve({
          admitted: false,
          reason: REJECTION_REASONS.QUEUE_TIMEOUT,
        });
      }, timeoutMs);

      // Unref timeout so it does not block node process exit
      ticket.timer.unref();

      queue.push(ticket);
    });
  }

  return {
    acquire,
  };
}
