import http from "node:http";
import { pipeline, Readable } from "node:stream";
import { createHash, timingSafeEqual } from "node:crypto";

const PORT = Number(process.env.PORT || 10000);

// Single source of truth for configuration: one function validates every
// required variable. NVIDIA_BASE_URL problems are fatal at startup — the
// proxy must never come up half-configured or doomed. Missing key/token are
// runtime problems instead: /health and proxied requests report 503 until
// they are set.
function validateConfig(env) {
  const rawBase = env.NVIDIA_BASE_URL;
  if (!rawBase || !rawBase.trim()) {
    console.error("NVIDIA_BASE_URL is required");
    process.exit(1);
  }
  try {
    new URL(rawBase);
  } catch {
    console.error(`NVIDIA_BASE_URL is not a valid URL: ${rawBase}`);
    process.exit(1);
  }
  return {
    baseURL: rawBase,
    apiKey: env.NVIDIA_API_KEY,
    proxyToken: env.PROXY_AUTH_TOKEN,
    unconfigured: !env.NVIDIA_API_KEY || !env.PROXY_AUTH_TOKEN,
  };
}

const config = validateConfig(process.env);

// Compare SHA-256 digests rather than raw bytes: equal-length inputs mean
// timingSafeEqual never throws on length mismatch, and a throw-vs-compare
// timing difference would otherwise leak the token's length.
const TOKEN_DIGEST = config.proxyToken
  ? createHash("sha256").update(config.proxyToken).digest()
  : null;

// Headers stripped when copying in either direction. Not all of these are
// hop-by-hop: host is re-derived per upstream call, content-length no longer
// applies once a request body is re-streamed, and response content-length is
// recomputed by Node when we stream the body through.
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

function sendJson(req, res, status, body) {
  req.resume(); // drain so keep-alive connections survive early rejections
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function authorized(req) {
  if (!TOKEN_DIGEST) return false;
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) return false;
  return timingSafeEqual(
    createHash("sha256").update(header.slice(7)).digest(),
    TOKEN_DIGEST
  );
}

// The validated deploy base URL (config.baseURL, e.g.
// https://integrate.api.nvidia.com/v1) is the single source of truth.
// Incoming /v1/... paths are mapped onto the base path with its trailing /v1
// segment removed, so any correct base works.
function upstreamUrl(incoming) {
  const suffix = incoming.pathname.replace(/^\/v1\/?/, "/");
  return `${config.baseURL.replace(/\/v1\/?$/, "")}${suffix}${incoming.search}`;
}

const server = http.createServer(async (req, res) => {
  try {
    const incoming = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    if (incoming.pathname === "/health") {
      if (config.unconfigured) return sendJson(req, res, 503, { status: "unconfigured" });
      return sendJson(req, res, 200, { status: "ok" });
    }

    // Bare /v1 or /v1/ — the proxy forwards /v1/* paths, not the /v1
    // prefix itself. With the default base URL this would hit NVIDIA's
    // API root, which isn't what clients expect from a /v1 proxy.
    if (/^\/v1\/?$/.test(incoming.pathname)) {
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

    const headers = {};
    for (const [name, value] of Object.entries(req.headers)) {
      if (!STRIPPED_HEADERS.has(name)) headers[name] = value;
    }
    headers.authorization = `Bearer ${config.apiKey}`; // overwrites the caller's token

    const method = req.method;
    const body = method === "GET" || method === "HEAD" ? undefined : req;

    const upstream = await fetch(upstreamUrl(incoming), {
      method,
      headers,
      body,
      // Required when `body` is a readable stream and we also read the
      // response — without it Node throws ERR_STREAM_DUPLICATE_STREAM_OUTPUT.
      duplex: body ? "half" : undefined,
    });

    // Copy raw multi-value headers (forEach over Headers merges duplicates
    // with ", " which corrupts set-cookie). getSetCookie handles the most
    // common multi-value header; raw entries cover the rest.
    const responseHeaders = {};
    for (const [name, value] of upstream.headers) {
      if (STRIPPED_HEADERS.has(name)) continue;
      if (name === "set-cookie") continue;
      responseHeaders[name] = value;
    }
    const cookies = upstream.headers.getSetCookie();
    if (cookies.length > 0) responseHeaders["set-cookie"] = cookies;

    res.writeHead(upstream.status, responseHeaders);

    if (!upstream.body) return res.end();

    // pipeline owns the streams and the error path: a mid-stream upstream
    // failure destroys this response instead of crashing the process.
    pipeline(Readable.fromWeb(upstream.body), res, (error) => {
      if (error) {
        console.error("stream error:", error.message);
        res.destroy();
      }
    });
  } catch (error) {
    console.error(error);
    if (!res.headersSent) {
      // Internal details (DNS names, URLs) must not leak to callers.
      sendJson(req, res, 502, { error: "Bad gateway" });
    } else {
      res.destroy();
    }
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`NVIDIA API proxy listening on port ${PORT}`);
});

// Render sends SIGTERM on deploys: stop accepting, drop idle keep-alive
// sockets, let in-flight streams finish, force-exit after a grace period.
process.on("SIGTERM", () => {
  server.closeIdleConnections();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 10_000).unref();
});

export default server;
