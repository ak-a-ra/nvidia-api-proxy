import http from "node:http";
import { pipeline, Readable } from "node:stream";
import { createHash, timingSafeEqual } from "node:crypto";
import { parseConfig, CONNECT_TIMEOUT_SECONDS, IDLE_TIMEOUT_SECONDS } from "./config.js";
import { createAdmission, REJECTION_REASONS } from "./admission.js";

const PORT = Number(process.env.PORT || 10000);

// What a caller is told to retry after when the queue — not the configured
// wait — turned it away. A slot frees on its own, so the honest advice is
// "very soon"; the configured wait is the answer to a different question.
const FULL_QUEUE_RETRY_AFTER_SECONDS = 1;

const config = parseConfig(process.env);
const admission = createAdmission(config.limits);

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

    // The release handle is registered BEFORE the wait, and that order is the
    // whole fix for a queued client disconnect: `res` emits "close" during the
    // await when the caller gives up, and a listener attached afterwards would
    // be dead on arrival. The drain would then hand the slot to that dead
    // ticket, its release would never fire, and the ceiling would be
    // permanently reduced — every later request queueing to the timeout and
    // answering 429. One listener covers both timelines: it releases the
    // ticket the moment one exists and does nothing when none was ever handed
    // out. Removing the waiter from the queue entirely (so a disconnect also
    // cancels its queue entry, with no wasted upstream call) is e04s03,
    // issue #16.
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
    const body = method === "GET" || method === "HEAD" ? undefined : req;

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
    pipeline(src, res, (error) => {
      clearTimeout(idleTimer);
      res.removeListener("close", onDownstreamClose);
      if (error) {
        // error.code names the abort source (e.g. UND_ERR_BODY_TIMEOUT from
        // undici's internal 300s body timeout vs our "upstream idle timeout").
        console.error("stream error:", error.message, error.code ?? "");
        res.destroy();
      }
    });
  } catch (error) {
    if (error.name === "AbortError" && error.message === "client disconnected") {
      // Client went away: nothing to report, no response to send.
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
  server.closeIdleConnections();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 10_000).unref();
});

export default server;
