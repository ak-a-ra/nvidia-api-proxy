import http from "node:http";
import { Readable } from "node:stream";

const PORT = Number(process.env.PORT || 10000);
const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY;
const PROXY_AUTH_TOKEN = process.env.PROXY_AUTH_TOKEN;
const NVIDIA_BASE_URL = (process.env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1").replace(/\/$/, "");

const HOP_BY_HOP = new Set([
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

function authorized(req) {
  if (!PROXY_AUTH_TOKEN) return false;
  return req.headers.authorization === `Bearer ${PROXY_AUTH_TOKEN}`;
}

function upstreamUrl(req) {
  const incoming = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const suffix = incoming.pathname.replace(/^\/v1/, "");
  return `${NVIDIA_BASE_URL}${suffix}${incoming.search}`;
}

const server = http.createServer(async (req, res) => {
  try {
    const incoming = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    if (incoming.pathname === "/health") {
      return sendJson(res, 200, { status: "ok" });
    }

    if (!incoming.pathname.startsWith("/v1/")) {
      return sendJson(res, 404, { error: "Not found" });
    }

    if (!NVIDIA_API_KEY || !PROXY_AUTH_TOKEN) {
      return sendJson(res, 503, { error: "Proxy is not configured" });
    }

    if (!authorized(req)) {
      return sendJson(res, 401, { error: "Unauthorized" });
    }

    const headers = {};
    for (const [name, value] of Object.entries(req.headers)) {
      if (!HOP_BY_HOP.has(name.toLowerCase()) && name.toLowerCase() !== "authorization") {
        headers[name] = value;
      }
    }
    headers.authorization = `Bearer ${NVIDIA_API_KEY}`;

    const method = req.method || "GET";
    const body = method === "GET" || method === "HEAD" ? undefined : req;

    const upstream = await fetch(upstreamUrl(req), {
      method,
      headers,
      body,
      duplex: body ? "half" : undefined,
    });

    const responseHeaders = {};
    upstream.headers.forEach((value, name) => {
      if (!HOP_BY_HOP.has(name.toLowerCase())) responseHeaders[name] = value;
    });

    res.writeHead(upstream.status, responseHeaders);

    if (!upstream.body) return res.end();
    Readable.fromWeb(upstream.body).pipe(res);
  } catch (error) {
    console.error(error);
    if (!res.headersSent) {
      sendJson(res, 502, { error: "Bad gateway", message: error.message });
    } else {
      res.destroy();
    }
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`NVIDIA API proxy listening on port ${PORT}`);
});
