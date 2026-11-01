import http from "node:http";
import { pipeline, Readable, Transform } from "node:stream";
import { createHash, timingSafeEqual } from "node:crypto";
import { parseConfig, CONNECT_TIMEOUT_SECONDS, IDLE_TIMEOUT_SECONDS } from "./config.js";
import { createAdmission, REJECTION_REASONS } from "./admission.js";
import { createBudget, estimateCost } from "./budget.js";
import { createSseObserver, createJsonObserver } from "./observer.js";

const PORT = Number(process.env.PORT || 10000);

// What a caller is told to retry after when the queue — not the configured
// wait — turned it away. A slot frees on its own, so the honest advice is
// "very soon"; the configured wait is the answer to a different question.
const FULL_QUEUE_RETRY_AFTER_SECONDS = 1;

const config = parseConfig(process.env);
const admission = createAdmission(config.limits);
// The budget gate is built once from the same validated config: a null rate
// pair yields a disabled gate that fails open, so a deployment without
// PROXY_RPM/PROXY_TPM never allocates a window or buffers a body. The
// per-model map rides along with it, and stays inert without the global pair:
// a model's own windows exist only next to the global ones they are checked
// against.
const budget = createBudget(config.rateLimit, config.limits, config.modelLimits);

// Compare SHA-256 digests rather than raw bytes: equal-length inputs mean
// timingSafeEqual never throws on length mismatch, and a throw-vs-compare
// timing difference would otherwise leak the token's length.
const TOKEN_DIGEST = config.proxyToken
  ? createHash("sha256").update(config.proxyToken).digest()
  : null;

// config.baseURL never changes after startup, so its origin is resolved once
// here instead of re-parsing the same string on every request.
const BASE_ORIGIN = new URL(config.baseURL).origin;

export { CONNECT_TIMEOUT_SECONDS, IDLE_TIMEOUT_SECONDS };

// Process-lifetime monotonic counters, read by /stats. Incremented exactly
// once per terminal event, never reset.
let completed = 0;
let oversizedBodyRejections = 0;
let activeClientDisconnects = 0;

// Headers stripped when copying in either direction. Not all of these are
// hop-by-hop: host is re-derived per upstream call and content-length is
// re-evaluated (stripped during copying and selectively restored for
// pass-through responses).
const STRIPPED_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
]);

// fetch() automatically decompresses upstream response bodies, so forwarding
// their content-encoding header would misrepresent the returned bytes. Client
// request bodies are not decompressed and must retain their encoding header.
const RESPONSE_STRIPPED_HEADERS = new Set([...STRIPPED_HEADERS, "content-encoding"]);

function sendJson(req, res, status, body, extraHeaders = {}) {
  req.resume(); // drain so keep-alive connections survive early rejections
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    ...extraHeaders,
  });
  res.end(payload);
}

function authorized(req) {
  if (!TOKEN_DIGEST) return false;
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) return false;
  return timingSafeEqual(createHash("sha256").update(header.slice(7)).digest(), TOKEN_DIGEST);
}

// Rate-limit mode only. Reads the caller's body up to the byte cap and hands
// back the exact bytes, so the caller's original encoding (gzip, br, an
// uncompressed but non-JSON payload) survives: this function never decompresses
// and never re-serializes. Over the cap answers 413 once, drains what is left
// of the stream so the keep-alive connection is reusable, and returns null. A
// client that disconnects mid-body returns null too, without answering a
// socket nobody is reading.
//
// The cap counts bytes as they arrive, not bytes after a decode: a compressed
// body is measured by what the proxy actually read.
async function readBodyWithCap(req, res, maxBytes) {
  const chunks = [];
  let seen = 0;
  for await (const chunk of req) {
    seen += chunk.length;
    if (seen > maxBytes) {
      oversizedBodyRejections++;
      if (!res.destroyed && !res.writableEnded) {
        sendJson(req, res, 413, { error: "Request too large" });
      }
      req.resume(); // drain the remainder so the socket is reusable
      return null;
    }
    chunks.push(chunk);
  }
  if (res.destroyed || res.writableEnded) return null;
  return Buffer.concat(chunks);
}

// JSON for the estimator, or null. A parse failure is not an error: the
// estimator's fallback rule (four characters per token, minimum one) is the
// documented answer for malformed JSON, and an encoded body is never decoded
// here — its content-encoding header passes through untouched, and the
// fallback measures its bytes.
function parseJsonBody(buffer) {
  if (!buffer || buffer.length === 0) return null;
  // An encoded body is deliberately not decoded: decoding it here would
  // mean the proxy holds a plaintext copy of a body the caller sent
  // compressed, and the forwarded copy must stay the original bytes anyway.
  try {
    return JSON.parse(buffer.toString("utf8"));
  } catch {
    return null;
  }
}

// Reserve budget. Returns the reservation on success, or a rejection carrying
// retryAfterSeconds for the 429 arm.
//
// Over budget is answered, not waited out: a rolling 60-second window frees
// only when its oldest reservation ages out, so a wait would hold the caller —
// and its concurrency slot — for most of a minute to reach a state the clock,
// not this module, controls. The answer is the immediate 429 with a
// Retry-After rooted in the window's own history (budget.js derives it from
// the oldest live reservation), which is the bounded wait the issue asks for
// without a held slot and without polling.
//
// The rejection names the constraint that bit — the global window's rpm or
// tpm, or a model's own — and the name stays inside the proxy: the client is
// told to come back, never which budget said so.
//
// There is no wait to call. budget.js exposes no waiting primitive, and the
// per-model windows are decided in the same synchronous pass as the global
// ones, so a request over its own model's budget is answered, not parked.
// Budget waiting proper — the bounded, abort-armed wait that answers an
// in-window-tight request the moment an earlier reservation is released early —
// is deferred to a later story.
async function admitWithBudget(cost) {
  const outcome = budget.reserve(cost);
  if (outcome.admitted) return outcome;
  return { admitted: false, reason: outcome.reason, retryAfterSeconds: outcome.retryAfter };
}

// Opt-in per-request logging (PROXY_LOG_REQUESTS, parsed by config.js). One
// JSON line per request, on `close` and never earlier: a streamed response has
// no duration until its last byte, and a line written from the pipeline
// callback can precede the response it describes. Method, path, status, and
// duration are the whole line by construction — no header, no body, no
// credential, no upstream host ever reaches it.
function logRequestOnClose(req, res, startedAt, incoming) {
  res.on("close", () => {
    try {
      console.log(
        JSON.stringify({
          ts: new Date().toISOString(),
          method: req.method,
          path: `${incoming.pathname}${incoming.search}`,
          // The last status written to the client. 0 means the response was
          // destroyed before any status reached it — a client disconnect, or a
          // mid-stream upstream abort. That is a fact about the socket, not a
          // code the client saw, and a code it never saw is not invented here.
          status: res.headersSent ? res.statusCode : 0,
          ms: Date.now() - startedAt,
        })
      );
    } catch {
      // A closed or full stdout throws (EPIPE/ENOSPC), and this runs inside a
      // response event, where an uncaught throw is an uncaught exception: the
      // process would die over a log line. Swallowed on purpose — the request
      // is already complete, the line is the only thing lost, and stderr is no
      // safer a place to report it than stdout was.
    }
  });
}

// The validated deploy base URL (config.baseURL, e.g.
// https://integrate.api.nvidia.com/v1) is the single source of truth.
// The incoming path is forwarded verbatim onto the base host: the /v1 a
// client sends is the one the upstream sees. Dropping the incoming /v1
// (as earlier versions did) targeted NVIDIA's bare endpoints, which 404.
// The base's own /v1 suffix is intentionally ignored, so bases with or
// without it produce identical upstream URLs.
function upstreamUrl(incoming) {
  return `${BASE_ORIGIN}${incoming.pathname}${incoming.search}`;
}

const server = http.createServer(async (req, res) => {
  try {
    const incoming = new URL(req.url || "/", "http://localhost");

    // Opt-in only: neither the clock nor the listener exists when the flag is
    // off, so the disabled path is byte-for-byte today's path. Registered
    // above every branch, so /health and every local rejection are logged too,
    // and the clock starts here at arrival rather than whenever the response
    // happens to end.
    if (config.logRequests) logRequestOnClose(req, res, Date.now(), incoming);

    if (incoming.pathname === "/health") {
      if (config.unconfigured) return sendJson(req, res, 503, { status: "unconfigured" });
      return sendJson(req, res, 200, { status: "ok" });
    }

    // /stats bypasses admission and budgets and never contacts the upstream.
    // Authentication precedes the unconfigured check so a missing token leaks
    // as 401, never 503. /stats increments no counter (self-exclusion).
    if (incoming.pathname === "/stats") {
      if (!authorized(req)) {
        return sendJson(req, res, 401, { error: "Unauthorized" });
      }
      if (config.unconfigured) {
        return sendJson(req, res, 503, { error: "Proxy is not configured" });
      }
      if (req.method !== "GET") {
        return sendJson(req, res, 404, { error: "Not found" });
      }
      return sendJson(req, res, 200, {
        rateLimitEnabled: config.rateLimit !== null,
        effectiveGlobalRpm: config.rateLimit ? budget.effective.rpm : null,
        effectiveGlobalTpm: config.rateLimit ? budget.effective.tpm : null,
        safetyMarginPct: config.limits.safetyMarginPct,
        maxConcurrentRequests: config.limits.maxConcurrentRequests,
        maxQueueSize: config.limits.maxQueueSize,
        queueTimeoutSeconds: config.limits.queueTimeoutSeconds,
        active: admission.active,
        queued: admission.queued,
        admitted: admission.admitted,
        waits: admission.waits,
        queueFullRejections: admission.queueFullRejections,
        queueTimeoutRejections: admission.queueTimeoutRejections,
        oversizedBodyRejections,
        costOverLimitRejections: budget.costOverLimitRejections,
        queuedClientDisconnects: admission.queuedClientDisconnects,
        activeClientDisconnects,
        completed,
        usageReconciled: budget.usageReconciled,
        usageEstimateFallbacks: budget.usageEstimateFallbacks,
        trackedModels: budget.trackedModels,
      });
    }

    // Bare /v1 or /v1/ — the proxy forwards /v1/* paths, not the /v1
    // prefix itself. With the default base URL this would hit NVIDIA's
    // API root, which isn't what clients expect from a /v1 proxy.
    if (incoming.pathname === "/v1" || incoming.pathname === "/v1/") {
      return sendJson(req, res, 404, { error: "Not found" });
    }

    if (!incoming.pathname.startsWith("/v1/")) {
      return sendJson(req, res, 404, { error: "Not found" });
    }

    if (!authorized(req)) {
      return sendJson(req, res, 401, { error: "Unauthorized" });
    }

    if (config.unconfigured) {
      return sendJson(req, res, 503, { error: "Proxy is not configured" });
    }

    // The close listeners are registered BEFORE any wait, and that order is
    // the whole fix for a queued client disconnect: `res` emits "close" during
    // an await when the caller gives up, and a listener attached afterwards
    // would be dead on arrival. The drain would then hand a slot to that dead
    // ticket, its release would never fire, and the ceiling would be
    // permanently reduced — every later request queueing to the timeout and
    // answering 429. One abort listener covers both timelines, and the release
    // handle does nothing when no ticket was ever handed out. Removing the
    // waiter from the queue entirely (so a disconnect also cancels its queue
    // entry, with no wasted upstream call) is e04s03, issue #16.
    const ac = new AbortController();
    const onDownstreamClose = () => ac.abort(new Error("client disconnected"));
    res.on("close", onDownstreamClose);

    let ticket = null;
    const releaseOnce = () => {
      if (!ticket || !ticket.admitted) return;
      const held = ticket;
      ticket = null;
      held.release();
    };
    res.on("close", releaseOnce);

    // Rate-limit mode: the body is buffered here and only here, so the
    // estimator sees it and the byte cap can refuse it. The gate reads the
    // bytes, never owns them: the original buffer is what gets forwarded
    // upstream, byte-identically, with the caller's headers intact.
    let forwardedBody = undefined;
    let budgetReservation = null;
    if (budget.enabled) {
      const buffer = await readBodyWithCap(req, res, config.limits.maxBufferedBodyBytes);
      // null already answered the client (413), or the client is gone: drop
      // the lifecycle listeners the same way the rejection arms below do, so
      // nothing is left listening on a response that is finished.
      if (buffer === null) {
        res.removeListener("close", onDownstreamClose);
        res.removeListener("close", releaseOnce);
        return;
      }
      forwardedBody = buffer;
    }

    // Budget gate. When rate limiting is off this whole block is skipped: the
    // request stays the original stream, nothing is buffered, and the
    // behavior of a build without rate limiting is preserved exactly.
    //
    // It runs before the concurrency ticket on purpose: a request over budget
    // must never take a slot it cannot use. The estimate is the whole answer
    // to "may this request exist", and the window is charged once, when the
    // reservation succeeds.
    if (budget.enabled) {
      const cost = estimateCost(parseJsonBody(forwardedBody), forwardedBody);
      const outcome = await admitWithBudget(cost);
      if (!outcome.admitted) {
        res.removeListener("close", onDownstreamClose);
        res.removeListener("close", releaseOnce);
        // Client vanished before the answer could matter, or the window closed
        // under it during shutdown: answer nobody, spend nothing. A cancelled
        // waiter is not an overload report.
        if (ac.signal.aborted || res.destroyed || res.writableEnded) {
          return;
        }
        return sendJson(
          req,
          res,
          429,
          { error: "Too many requests" },
          { "retry-after": String(outcome.retryAfterSeconds) }
        );
      }
      budgetReservation = outcome.reservation || null;
    }

    ticket = await admission.acquire(ac.signal);
    if (!ticket.admitted) {
      // Clean up the downstream-close listeners before any early return so a
      // rejected request cannot later abort a finished or unrelated stream.
      res.removeListener("close", onDownstreamClose);
      res.removeListener("close", releaseOnce);
      if (ticket.reason === REJECTION_REASONS.CANCELLED || ac.signal.aborted) {
        // Client went away while queued: consume no slot response and do not
        // report overload/shutdown to a socket no-one is reading.
        return;
      }
      if (res.destroyed || res.writableEnded) {
        return;
      }
      if (ticket.reason === REJECTION_REASONS.SHUTTING_DOWN) {
        return sendJson(req, res, 503, { error: "Service unavailable" });
      }
      const retryAfter =
        ticket.reason === REJECTION_REASONS.QUEUE_TIMEOUT
          ? config.limits.queueTimeoutSeconds
          : FULL_QUEUE_RETRY_AFTER_SECONDS;
      return sendJson(
        req,
        res,
        429,
        { error: "Too many requests" },
        { "retry-after": String(retryAfter) }
      );
    }
    if (res.destroyed || res.writableEnded) {
      releaseOnce();
      completed++;
      return;
    }

    // Node's req.headers values are string | string[]. undici accepts an array
    // but silently collapses it into one comma-joined value, so normalize to a
    // scalar here and join with ", " — byte-identical to what
    // Headers.append("set-cookie", ...) produces. In practice only set-cookie can
    // arrive as an array (cookie is pre-merged by Node; STRIPPED_HEADERS covers
    // the hop-by-hop candidates). The response direction solves its sibling
    // problem with getSetCookie() below.
    /** @type {Record<string, string>} */
    const headers = {};
    for (const [name, value] of Object.entries(req.headers)) {
      const v = Array.isArray(value) ? value.join(", ") : value;
      if (!STRIPPED_HEADERS.has(name)) headers[name] = v;
    }
    headers.authorization = `Bearer ${config.apiKey}`; // overwrites the caller's token
    headers["accept-encoding"] = "identity";

    const method = req.method;
    const body =
      method === "GET" || method === "HEAD"
        ? undefined
        : forwardedBody !== undefined
          ? forwardedBody
          : req;

    // In rate-limit mode the caller's body is a buffer we read in full, so
    // the request's own content-length is still the exact truth and is
    // restored after STRIPPED_HEADERS removed it. Leaving it unset would make
    // undici frame the request as chunked and the upstream would see a body
    // that arrived in a framing the original bytes never had.
    if (forwardedBody !== undefined && req.headers["content-length"] !== undefined) {
      headers["content-length"] = String(forwardedBody.length);
    }

    // The per-request AbortController was created before admission (above) so
    // the same signal cancels a queued request. It also owns the connect
    // window and downstream lifecycle here: remove its listener on normal
    // completion so completed requests retain no lifecycle handlers.
    const connectTimer = CONNECT_TIMEOUT_SECONDS
      ? setTimeout(
          () => ac.abort(new Error("upstream connect timeout")),
          CONNECT_TIMEOUT_SECONDS * 1000
        )
      : null;
    let upstream;
    try {
      upstream = await fetch(upstreamUrl(incoming), {
        method,
        headers,
        body,
        // Required when `body` is a readable stream and we also read the
        // response — without it Node throws ERR_STREAM_DUPLICATE_STREAM_OUTPUT.
        duplex: body ? "half" : undefined,
        signal: ac.signal,
      });
    } finally {
      clearTimeout(connectTimer);
    }

    // Copy raw multi-value headers (forEach over Headers merges duplicates
    // with ", " which corrupts set-cookie). getSetCookie handles the most
    // common multi-value header; raw entries cover the rest.
    /** @type {import("node:http").OutgoingHttpHeaders} */
    const responseHeaders = {};
    for (const [name, value] of upstream.headers) {
      if (RESPONSE_STRIPPED_HEADERS.has(name)) continue;
      if (name === "set-cookie") continue;
      responseHeaders[name] = value;
    }
    const cookies = upstream.headers.getSetCookie();
    if (cookies.length > 0) responseHeaders["set-cookie"] = cookies;

    // Preserve the upstream content-length for pure pass-through responses:
    // the body is untouched, so it still has exactly that many bytes, and
    // forwarding the header avoids chunked framing. Responses generated
    // locally (401/404/502/503, /health) set their own length, and bodies
    // without one (e.g. 204) must not gain a stale value. HEAD responses
    // have no body stream per spec but valid content-length must be preserved.
    const declaredRaw = upstream.headers.get("content-length");
    const declared = Number(declaredRaw);
    if (
      declaredRaw &&
      Number.isInteger(declared) &&
      declared >= 0 &&
      (upstream.body || method === "HEAD") &&
      !upstream.headers.has("content-encoding")
    ) {
      responseHeaders["content-length"] = String(declared);
    }

    res.writeHead(upstream.status, responseHeaders);

    if (!upstream.body) {
      completed++;
      if (budgetReservation) {
        budgetReservation.reconcile(null);
      }
      res.removeListener("close", onDownstreamClose);
      return res.end();
    }

    // pipeline owns the streams and the error path: a mid-stream upstream
    // failure destroys this response instead of crashing the process. The
    // idle watchdog bounds stalls: every received chunk resets the timer, so
    // a stream that keeps producing is never cut off, but a silent upstream
    // cannot hold the client connection open forever.
    const src = Readable.fromWeb(upstream.body);
    let idleTimer = null;
    const armIdle = () => {
      if (!IDLE_TIMEOUT_SECONDS) return;
      clearTimeout(idleTimer);
      idleTimer = setTimeout(
        () => src.destroy(new Error("upstream idle timeout")),
        IDLE_TIMEOUT_SECONDS * 1000
      );
      idleTimer.unref();
    };
    armIdle();
    src.on("data", armIdle);

    // SSE responses in rate-limit mode are observed by a copy: the bytes are
    // forwarded unchanged, while an internal observer parses usage out of a
    // copy. Non-SSE and disabled mode keep the original pass-through path.
    const isSse =
      budget.enabled &&
      Boolean(budgetReservation) &&
      String(upstream.headers.get("content-type") || "").includes("text/event-stream");
    const isJson = budget.enabled && Boolean(budgetReservation) && !isSse && Boolean(upstream.body);
    let sseObserver = null;
    let jsonObserver = null;
    let observedUsage = null;
    if (isSse) {
      sseObserver = createSseObserver((usage) => {
        observedUsage = usage;
      });
    }
    if (isJson) {
      jsonObserver = createJsonObserver((usage) => {
        observedUsage = usage;
      });
    }

    if (isJson && jsonObserver) {
      src.on("data", (chunk) => {
        try {
          jsonObserver.observe(chunk);
        } catch {
          try {
            jsonObserver.detach();
          } catch {
            // ignore
          }
        }
      });
    }

    const onComplete = (error) => {
      clearTimeout(idleTimer);
      completed++;
      if (sseObserver) {
        try {
          sseObserver.end();
        } catch {
          // Observer failures must never affect pass-through.
        }
      }
      if (jsonObserver) {
        try {
          jsonObserver.end();
        } catch {
          // Observer failures must never affect pass-through.
        }
      }
      res.removeListener("close", onDownstreamClose);
      // Reconcile only on successful completion. A disconnect, a mid-stream
      // failure, or a shutdown that cuts the stream keeps the estimate.
      if (!error && budgetReservation && (sseObserver || jsonObserver)) {
        // Reconcile once with the observed total, including null: a missing,
        // malformed, or unusable body records one fallback and keeps the
        // estimate. SSE already follows this contract.
        budgetReservation.reconcile(observedUsage);
      }
      if (error) {
        // error.code names the abort source (e.g. UND_ERR_BODY_TIMEOUT from
        // undici's internal 300s body timeout vs our "upstream idle timeout").
        console.error("stream error:", error.message, error.code ?? "");
        res.destroy();
      }
    };

    if (isSse) {
      const observerTransform = new Transform({
        transform(chunk, encoding, callback) {
          this.push(chunk);
          if (sseObserver) {
            try {
              sseObserver.observe(chunk);
            } catch {
              // Detach on any observer failure; pass-through is unaffected.
              try {
                sseObserver.detach();
              } catch {
                // ignore
              }
            }
          }
          callback();
        },
        flush(callback) {
          if (sseObserver) {
            try {
              sseObserver.end();
            } catch {
              // ignore
            }
          }
          callback();
        },
      });
      pipeline(src, observerTransform, res, onComplete);
    } else {
      pipeline(src, res, onComplete);
    }
  } catch (error) {
    if (error.name === "AbortError" && error.message === "client disconnected") {
      // Client went away: nothing to report, no response to send.
      activeClientDisconnects++;
      return;
    }
    console.error(error);
    if (!res.headersSent && !res.destroyed) {
      // Internal details (DNS names, URLs) must not leak to callers.
      sendJson(req, res, 502, { error: "Bad gateway" });
    } else {
      res.destroy();
    }
  }
});

server.listen(PORT, config.host, () => {
  console.log(`NVIDIA API proxy listening on port ${PORT}`);
});

// Render sends SIGTERM on deploys: stop accepting, drop idle keep-alive
// sockets, let in-flight streams finish, force-exit after a grace period.
process.on("SIGTERM", () => {
  admission.close();
  // Close the budget windows too: a waiter must not outlive the process that
  // was going to serve it. Same synchronous, idempotent contract as admission.
  budget.close();
  server.closeIdleConnections();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 10_000).unref();
});

export default server;
