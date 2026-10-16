// Token budget for the shared upstream credential: one rolling 60-second
// window pair, a Safety margin applied to every advertised limit, and an
// estimator that turns a request body into its token cost before the upstream
// is contacted. This module owns the numbers; the request path owns the bytes.
// Invariants:
//
// 1. Every value arrives validated from config.js, the only owner of defaults
//    and parsing: a disabled budget is null, and a present budget is
//    { rpm, tpm } with positive integers and a margin already bounded to
//    0-50. A caller must not be able to read a half-configured budget.
// 2. Effective limits are the configured numbers with the Safety margin
//    removed, floored at one: a zero or shrunken-to-zero budget is a budget
//    that appears to exist and does not.
// 3. A rolling window is a bounded event history, never a counter reset on a
//    timer: a request's cost leaves the window exactly WINDOW_MILLIS after it
//    was reserved, whether or not anything else arrived meanwhile. The window
//    therefore holds usage for the last 60 seconds and nothing older, and a
//    quiet minute always reads as an empty window.
// 4. Reserving is atomic against the live window: the estimate and the
//    admitted-or-rejected decision are computed against the same pruned
//    state, so two concurrent requests cannot both observe the last free
//    token.
// 5. A rejection carries a Retry-After derived from the window's own oldest
//    live reservation, so the caller is told when the state it cannot observe
//    will change, and never a number this module invented.
// 6. close() is synchronous and idempotent: it refuses new reservations, so a
//    request in flight while the process drains is never charged against a
//    window nothing will read again.
//
// No environment read, no timer, no default of its own.
//
// Deliberately absent is a budget wait. A wait would park a caller — and its
// concurrency slot — for most of a minute to reach a state only the clock
// controls, which is a worse answer than an immediate 429 with a real
// Retry-After. The one wait worth having is for a reservation released early
// by a client that disconnected after its estimate was taken; that lands with
// the per-model budget in e04s05, where holding a client for it is worth a
// slot. See estimateCost()'s callers in server.js.

// One shared horizon for both windows: a "per minute" budget and a "per
// minute" window are the same minute, so costs expire together.
export const WINDOW_MILLIS = 60_000;

// Fallback cost model for bodies the estimator cannot inspect: gzip and other
// encodings, malformed JSON, non-JSON, and bodies with no or an unknown
// model. Four characters per token, rounded up, and never below one token: a
// request that is admitted must have a cost, and a cost of zero would let it
// slip past the RPM count while consuming nothing against the token budget.
const FALLBACK_CHARS_PER_TOKEN = 4;
const MIN_TOKENS = 1;

// Requested output, when the body does not say. The cap and the default are
// estimator policy, not configuration: an operator sets a budget, not the
// model's optimism about its own reply length.
const DEFAULT_REQUESTED_OUTPUT_TOKENS = 1024;
const MAX_REQUESTED_OUTPUT_TOKENS = 4096;

// Effective limit arithmetic: the margin is a percentage taken out of the
// advertised budget, floored at one request or token so a limit that
// evaluates to zero cannot turn a configured budget into a dead proxy.
export function effectiveLimit(limit, safetyMarginPct) {
  const adjusted = Math.floor(limit * (1 - safetyMarginPct / 100));
  return Math.max(1, adjusted);
}

// The estimator's own output shape: everything the caller needs to decide
// whether a request can be admitted, and nothing about the caller's
// decisions. Input cost, requested output, the one-request charge, and the
// fallback flag for observability — never the body, which this module
// deliberately does not retain.
export function estimateCost(json, buffer) {
  const parsed = parseRequestMetadata(json);
  if (!parsed) return fallbackCostFromBuffer(buffer);

  // Input is summed per part; requested output is the one number the body can
  // name. Anything beyond the cap is flattened down to it, so a body asking
  // for an enormous completion cannot reserve a budget-busting cost.
  const requestedRaw = Number(parsed.maxTokens);
  const requested =
    Number.isFinite(requestedRaw) && requestedRaw > 0
      ? Math.min(MAX_REQUESTED_OUTPUT_TOKENS, Math.floor(requestedRaw))
      : DEFAULT_REQUESTED_OUTPUT_TOKENS;

  const inputTokens = tokensFromChars(parsed.inputChars + parsed.toolChars);
  return {
    inputTokens,
    outputTokens: requested,
    requestCharge: 1,
    totalTokens: inputTokens + requested,
    fallback: false,
  };
}

// Fallback estimate for a body the estimator could not open: encoded,
// malformed, non-JSON, or with no inspectable content. Characters per token
// rounds up, one token is the floor, and requested output keeps its default —
// the fallback is a cost, not a guess about what the body asked for.
function fallbackCostFromBuffer(buffer) {
  const chars = buffer ? buffer.length : 0;
  return {
    inputTokens: Math.max(MIN_TOKENS, Math.ceil(chars / FALLBACK_CHARS_PER_TOKEN)),
    outputTokens: DEFAULT_REQUESTED_OUTPUT_TOKENS,
    requestCharge: 1,
    totalTokens:
      Math.max(MIN_TOKENS, Math.ceil(chars / FALLBACK_CHARS_PER_TOKEN)) +
      DEFAULT_REQUESTED_OUTPUT_TOKENS,
    fallback: true,
  };
}

// Parsed request metadata. Returns null when the body cannot be estimated
// structurally — the caller then falls back to the byte estimate. A parsed
// shape is never trusted for its numeric fields: max_tokens and friends go
// through the same positive-integer discipline as every other number here.
function parseRequestMetadata(json) {
  if (!json || typeof json !== "object") return null;
  const messages = Array.isArray(json.messages) ? json.messages : [];
  const tools = Array.isArray(json.tools) ? json.tools : [];
  if (messages.length === 0 && tools.length === 0) return null;

  let textChars = 0;
  let toolChars = 0;
  for (const message of messages) {
    textChars += countMessageChars(message);
  }
  for (const tool of tools) {
    toolChars += countTextChars(tool);
  }

  // Models are named by the request; their pricing is not this module's
  // business. A body naming no or an unknown model is estimated exactly like
  // any other: the proxy holds no per-model table, so per-model distinctions
  // are e04s05's job, not a special case bolted on here.
  const maxTokensRaw = json.max_tokens ?? json.max_completion_tokens ?? json.maxTokens;
  const maxTokens = Number(maxTokensRaw);

  return {
    messages,
    tools,
    inputChars: textChars,
    toolChars,
    estimable: true,
    maxTokens: Number.isFinite(maxTokens) && maxTokens > 0 ? maxTokens : null,
  };
}

function countMessageChars(message) {
  if (typeof message === "string") return countTextChars(message);
  if (!message || typeof message !== "object") return 0;
  return countTextChars(message.content);
}

function countTextChars(value) {
  if (value == null) return 0;
  if (typeof value === "string") return value.length;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value).length;
  }
  if (Array.isArray(value)) {
    let total = 0;
    for (const part of value) {
      if (typeof part === "string") total += part.length;
      else if (part && typeof part === "object") {
        if (typeof part.text === "string") total += part.text.length;
        if (typeof part.content === "string") total += part.content.length;
      }
    }
    return total;
  }
  if (typeof value === "object") {
    if (typeof value.text === "string") return value.text.length;
    if (typeof value.content === "string") return value.content.length;
    return Object.keys(value).join("").length;
  }
  return 0;
}

// Input characters to tokens: four characters per token, rounded up, floored
// at one. Mirrors the fallback rule so one estimator policy governs both
// paths, and an estimable body cannot claim a cheaper rate than the bytes it
// actually carries.
function tokensFromChars(chars) {
  return Math.max(MIN_TOKENS, Math.ceil(chars / FALLBACK_CHARS_PER_TOKEN));
}

// The factory. rateLimit is config.js's object or null; limits supplies the
// margin. A null rate limit builds a disabled gate: reserve() fails open,
// wait() never blocks, close() does nothing, and nothing is allocated.
export function createBudget(rateLimit, limits) {
  if (!rateLimit) {
    return {
      enabled: false,
      effective: null,
      reserve() {
        return { admitted: true, cost: null };
      },
      release() {},
      close() {},
    };
  }

  const margin = limits?.safetyMarginPct ?? 5;
  const effective = {
    rpm: effectiveLimit(rateLimit.rpm, margin),
    tpm: effectiveLimit(rateLimit.tpm, margin),
  };

  // Event histories: costs are pushed with the time they were reserved, and
  // pruned on read. A cost expires exactly WINDOW_MILLIS later; nothing else
  // removes it, so a quiet minute is indistinguishable from a fresh start.
  const requestEvents = [];
  const tokenEvents = [];

  let closed = false;

  function prune(events, now) {
    while (events.length > 0 && now - events[0].at >= WINDOW_MILLIS) {
      events.shift();
    }
  }

  function totals(now) {
    prune(requestEvents, now);
    prune(tokenEvents, now);
    return {
      requests: requestEvents.length,
      tokens: tokenEvents.reduce((sum, e) => sum + e.tokens, 0),
    };
  }

  // The whole admission decision, and the only place tokens are consumed.
  // Reserve-or-reject against the same pruned snapshot so two concurrent
  // requests cannot both read the last free token.
  function reserve(cost) {
    if (closed) {
      return { admitted: false, reason: "closed", retryAfter: 1 };
    }
    const now = Date.now();
    const used = totals(now);

    if (cost.requestCharge > 0 && used.requests >= effective.rpm) {
      return {
        admitted: false,
        reason: "rpm",
        retryAfter: retryAfterSeconds(requestEvents[0].at, now),
      };
    }
    if (cost.totalTokens > 0 && used.tokens + cost.totalTokens > effective.tpm) {
      return {
        admitted: false,
        reason: "tpm",
        retryAfter: retryAfterSeconds(oldestTokenEvent(tokenEvents), now),
      };
    }

    if (cost.requestCharge > 0) requestEvents.push({ at: now });
    if (cost.totalTokens > 0) tokenEvents.push({ at: now, tokens: cost.totalTokens });
    return { admitted: true, cost, retryAfter: null };
  }

  function oldestTokenEvent(events) {
    return events.length > 0 ? events[0].at : null;
  }

  function retryAfterSeconds(oldestAt, now) {
    if (oldestAt == null) return 1;
    return Math.max(1, Math.ceil((WINDOW_MILLIS - (now - oldestAt)) / 1000));
  }

  // Give capacity back. A reservation is never refunded: the window ages it
  // out on its own, which is what makes a rolling window honest — a cost taken
  // back by hand would let one client's retry spend the same minute twice. The
  // hook exists so the request path can hand a release over without having to
  // know that.
  function release() {}

  function close() {
    // Refuse new reservations from here on: a request in flight while the
    // process drains must not be charged against a window nothing reads again.
    closed = true;
  }

  return {
    enabled: true,
    effective,
    reserve,
    release,
    close,
  };
}
