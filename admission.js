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
// 7. A ticket settles exactly once; cancellation, timeout, admission, and
//    shutdown all funnel through one settle helper.
// 8. A downstream abort while a ticket is queued removes that exact waiter,
//    clears its timer and abort listener, and consumes no slot.
// 9. close() is synchronous and idempotent: it refuses new tickets, drains
//    queued ones as shutting-down rejections, and leaves admitted work alone.
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
  SHUTTING_DOWN: "shutting_down",
  CANCELLED: "cancelled",
});

export function createAdmission(limits) {
  const maxConcurrent = limits.maxConcurrentRequests;
  const maxQueueSize = limits.maxQueueSize;
  const timeoutMs = limits.queueTimeoutSeconds * 1000;

  // Disabled ceiling: immediate admission, zero queue allocation, no timers.
  if (maxConcurrent === null) {
    let closed = false;
    const noopRelease = () => {};
    const admission = {
      acquire(signal) {
        if (closed) {
          return Promise.resolve({
            admitted: false,
            reason: REJECTION_REASONS.SHUTTING_DOWN,
          });
        }
        return Promise.resolve({
          admitted: true,
          release: noopRelease,
        });
      },
      close() {
        closed = true;
      },
    };
    Object.defineProperties(admission, {
      active: { get: () => 0, enumerable: true },
      queued: { get: () => 0, enumerable: true },
      admitted: { get: () => 0, enumerable: true },
      waits: { get: () => 0, enumerable: true },
      queueFullRejections: { get: () => 0, enumerable: true },
      queueTimeoutRejections: { get: () => 0, enumerable: true },
      queuedClientDisconnects: { get: () => 0, enumerable: true },
    });
    return admission;
  }

  let active = 0;
  const queue = [];
  let closed = false;
  let admittedCount = 0;
  let waitsCount = 0;
  let queueFullRejectionsCount = 0;
  let queueTimeoutRejectionsCount = 0;
  let queuedClientDisconnectsCount = 0;

  // One terminal transition per ticket. The first caller wins; later ones are
  // no-ops. Timer, listener, and queue removal are handled by callers that
  // know whether the ticket is still listed, but the listener/promise settle
  // always happens exactly once.
  function settleTicket(ticket, outcome) {
    if (ticket.settled) return false;
    ticket.settled = true;
    if (ticket.timer) {
      clearTimeout(ticket.timer);
      ticket.timer = null;
    }
    if (ticket.signal && ticket.abortListener) {
      try {
        ticket.signal.removeEventListener("abort", ticket.abortListener);
      } catch {
        // A detached signal still must not throw during teardown.
      }
      ticket.abortListener = null;
    }
    ticket.resolve(outcome);
    return true;
  }

  function createReleaseHandle() {
    let released = false;
    return () => {
      if (released) return;
      released = true;

      // Wake the oldest unsettled waiter, skipping any ticket that already
      // settled (timed out, cancelled, or shut down) while this slot was
      // held.
      while (queue.length > 0) {
        const next = queue.shift();
        if (next.settled) continue;
        const nextRelease = createReleaseHandle();
        admittedCount++;
        settleTicket(next, {
          admitted: true,
          release: nextRelease,
        });
        return;
      }

      // No waiting ticket claimed the slot: decrement active count.
      active--;
      if (active < 0) active = 0;
    };
  }

  function removeTicket(ticket) {
    const idx = queue.indexOf(ticket);
    if (idx !== -1) queue.splice(idx, 1);
  }

  function close() {
    if (closed) return;
    closed = true;
    for (const ticket of [...queue]) {
      removeTicket(ticket);
      settleTicket(ticket, {
        admitted: false,
        reason: REJECTION_REASONS.SHUTTING_DOWN,
      });
    }
  }

  function acquire(signal) {
    if (closed) {
      return Promise.resolve({
        admitted: false,
        reason: REJECTION_REASONS.SHUTTING_DOWN,
      });
    }

    if (active < maxConcurrent && queue.length === 0) {
      active++;
      admittedCount++;
      return Promise.resolve({
        admitted: true,
        release: createReleaseHandle(),
      });
    }

    if (queue.length >= maxQueueSize) {
      queueFullRejectionsCount++;
      return Promise.resolve({
        admitted: false,
        reason: REJECTION_REASONS.QUEUE_FULL,
      });
    }

    return new Promise((resolve) => {
      const ticket = {
        settled: false,
        timer: null,
        signal: signal || null,
        abortListener: null,
        resolve,
      };

      ticket.timer = setTimeout(() => {
        if (ticket.settled) return;
        removeTicket(ticket);
        queueTimeoutRejectionsCount++;
        settleTicket(ticket, {
          admitted: false,
          reason: REJECTION_REASONS.QUEUE_TIMEOUT,
        });
      }, timeoutMs);

      if (ticket.timer && typeof ticket.timer.unref === "function") {
        ticket.timer.unref();
      }

      if (signal) {
        if (signal.aborted) {
          // An already-aborted ticket is never queued: retro-firing is not
          // guaranteed by EventTarget, so settle it now and free the slot path.
          queuedClientDisconnectsCount++;
          settleTicket(ticket, {
            admitted: false,
            reason: REJECTION_REASONS.CANCELLED,
          });
          return;
        }
        const listener = () => {
          if (ticket.settled) return;
          removeTicket(ticket);
          queuedClientDisconnectsCount++;
          settleTicket(ticket, {
            admitted: false,
            reason: REJECTION_REASONS.CANCELLED,
          });
        };
        ticket.abortListener = listener;
        signal.addEventListener("abort", listener, { once: true });
      }

      waitsCount++;
      queue.push(ticket);
    });
  }

  const enabled = {
    acquire,
    close,
  };
  Object.defineProperties(enabled, {
    active: { get: () => active, enumerable: true },
    queued: { get: () => queue.length, enumerable: true },
    admitted: { get: () => admittedCount, enumerable: true },
    waits: { get: () => waitsCount, enumerable: true },
    queueFullRejections: { get: () => queueFullRejectionsCount, enumerable: true },
    queueTimeoutRejections: { get: () => queueTimeoutRejectionsCount, enumerable: true },
    queuedClientDisconnects: { get: () => queuedClientDisconnectsCount, enumerable: true },
  });
  return enabled;
}
