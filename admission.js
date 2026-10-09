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
// 5. Release is idempotent per admission handle (settled boolean flag);
//    repeated calls never double-release capacity.
// 6. Waiting is strictly event-driven: resolved by release() or timeout timer,
//    never polled.

export function createAdmission(limits) {
  const maxConcurrent = limits?.maxConcurrentRequests ?? null;
  const maxQueueSize = limits?.maxQueueSize ?? 32;
  const timeoutMs = (limits?.queueTimeoutSeconds ?? 30) * 1000;

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

  function makeRelease() {
    let settled = false;
    return () => {
      if (settled) return;
      settled = true;

      // Drain timed-out / cancelled tickets from front of FIFO queue
      while (queue.length > 0) {
        const next = queue.shift();
        if (next.settled) continue;
        next.settled = true;
        clearTimeout(next.timer);
        const nextRelease = makeRelease();
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
        release: makeRelease(),
      });
    }

    if (queue.length >= maxQueueSize) {
      return Promise.resolve({
        admitted: false,
        reason: "queue_full",
      });
    }

    return new Promise((resolve) => {
      const ticket = {
        settled: false,
        timer: null,
        resolve,
      };

      ticket.timer = setTimeout(() => {
        if (ticket.settled) return;
        ticket.settled = true;
        const idx = queue.indexOf(ticket);
        if (idx !== -1) {
          queue.splice(idx, 1);
        }
        resolve({
          admitted: false,
          reason: "queue_timeout",
        });
      }, timeoutMs);

      // Unref timeout so it does not block node process exit
      if (typeof ticket.timer.unref === "function") {
        ticket.timer.unref();
      }

      queue.push(ticket);
    });
  }

  return {
    acquire,
  };
}
