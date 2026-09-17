import http from "node:http";
import { pipeline, Readable } from "node:stream";
import { timingSafeEqual } from "node:crypto";

const PORT = Number(process.env.PORT || 10000);
const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY;
const PROXY_AUTH_TOKEN = process.env.PROXY_AUTH_TOKEN;
const NVIDIA_BASE_URL = process.env.NVIDIA_BASE_URL;

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

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

// Drain the request so keep-alive connections survive early rejections.
function drain(req) {
  req.resume();
}

function constantTimeBearerEqual(presented, expected) {
  try {
    // timingSafeEqual throws on length mismatch, which covers both cases.
    return timingSafeEqual(Buffer.from(presented), Buffer.from(expected));
  } catch {
    return false;
  }
}

function authorized(req) {
  if (!PROXY_AUTH_TOKEN) return false;
  return constantTimeBearerEqual(req.headers.authorization, `Bearer ${PROXY_AUTH_TOKEN}`);
}

// The deploy config (NVIDIA_BASE_URL, e.g. https://integrate.api.nvidia.com/v1)
// is the single source of truth. Incoming /v1/... paths are mapped onto the
// base path with its trailing /v1 segment removed, so any correct base works.
function upstreamUrl(incoming) {
  const suffix = incoming.pathname.replace(/^\/v1\/?/, "/");
  return `${NVIDIA_BASE_URL.replace(/\/v1\/?$/, "")}${suffix}${incoming.search}`;
}

const server = http.createServer(async (req, res) => {
  try {
    const incoming = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    if (incoming.pathname === "/health") {
      if (!NVIDIA_API_KEY || !PROXY_AUTH_TOKEN) {
        return sendJson(res, 503, { status: "unconfigured" });
      }
      return sendJson(res, 200, { status: "ok" });
    }

    if (!/^\/v1\/?$/.test(incoming.pathname) && !incoming.pathname.startsWith("/v1/")) {
      drain(req);
      return sendJson(res, 404, { error: "Not found" });
    }

    if (!authorized(req)) {
      drain(req);
      return sendJson(res, 401, { error: "Unauthorized" });
    }

    if (!NVIDIA_API_KEY || !PROXY_AUTH_TOKEN) {
      drain(req);
      return sendJson(res, 503, { error: "Proxy is not configured" });
    }

    const headers = {};
    for (const [name, value] of Object.entries(req.headers)) {
      if (!STRIPPED_HEADERS.has(name.toLowerCase()) && name.toLowerCase() !== "authorization") {
        headers[name] = value;
      }
    }
    headers.authorization = `Bearer ${NVIDIA_API_KEY}`;

    const method = req.method || "GET";
    const body = method === "GET" || method === "HEAD" ? undefined : req;

    const upstream = await fetch(upstreamUrl(incoming), {
      method,
      headers,
      body,
      duplex: body ? "half" : undefined,
    });

    // Copy raw multi-value headers (forEach over Headers merges duplicates
    // with ", " which corrupts set-cookie). getSetCookie handles the most
    // common multi-value header; raw entries cover the rest.
    const responseHeaders = {};
    for (const [name, value] of upstream.headers) {
      if (STRIPPED_HEADERS.has(name.toLowerCase())) continue;
      if (name.toLowerCase() === "set-cookie") continue;
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
      sendJson(res, 502, { error: "Bad gateway" });
    } else {
      res.destroy();
    }
  }
});

if (!NVIDIA_BASE_URL) {
  console.error("NVIDIA_BASE_URL is required");
  process.exit(1);
}

server.listen(PORT, "0.0.0.0", () => {
  console.log(`NVIDIA API proxy listening on port ${PORT}`);
});

export default server;
