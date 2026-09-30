import http from "node:http";
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import zlib from "node:zlib";

// Stub upstream: records requests, returns canned responses, can be told to
// stream SSE, return multi-value set-cookie, abort mid-stream, or be unreachable.
// Test scaffolding, not production code.

function startStubUpstream(status, body, headers, mode) {
  return new Promise((resolve) => {
    const receivedRequests = [];
    const srv = http.createServer((req, res) => {
      let chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        const requestBody = Buffer.concat(chunks);
        receivedRequests.push({
          method: req.method,
          path: req.url,
          body: requestBody.toString("utf8"),
          rawBody: requestBody,
          authorization: req.headers.authorization,
          contentEncoding: req.headers["content-encoding"],
          setCookie: req.headers["set-cookie"],
        });
        if (mode === "silent") return; // accept request, never send response headers
        // Real APIs (like NVIDIA) declare content-length on JSON responses;
        // mirror that so pass-through behavior is exercised realistically.
        const outHeaders = { ...headers };
        const hasCL = Object.keys(outHeaders).some(
          (k) => k.toLowerCase() === "content-length"
        );
        if (body !== undefined && !hasCL) {
          outHeaders["content-length"] = String(Buffer.byteLength(String(body)));
        }
        res.writeHead(status, outHeaders);
        if (mode === "sse") {
          res.write("data: chunk1\n\n");
          setTimeout(() => {
            res.write("data: chunk2\n\n");
            res.end();
          }, 5);
          return;
        }
        if (mode === "stall") {
          // One chunk flushes the headers; then silence forever — the idle
          // watchdog must cut this.
          res.write("hello");
          return;
        }
        if (mode === "slowfinish") {
          res.write("slow");
          setTimeout(() => res.end(" done"), 1500); // silent gap exceeds 1s idle window
          return;
        }
        if (mode === "activelong") {
          res.write("part1-");
          setTimeout(() => {
            res.write("part2-");
            setTimeout(() => {
              res.end("part3");
            }, 600);
          }, 600);
          return;
        }
        if (mode === "midabort") {
          res.write("data: partial");
          req.socket.destroy();
          return;
        }
        if (mode === "abortable") {
          // Send one chunk then hold the connection open without more data.
          // The client receives the first chunk, then the downstream request
          // is aborted; the proxy must close the upstream stream in response.
          res.write("part1-");
          return;
        }
        if (body !== undefined) res.end(body, "utf8");
        else res.end();
      });
    });
    const sockets = new Map();
    srv.on("connection", (socket) => {
      sockets.set(socket);
      socket.on("close", () => sockets.delete(socket));
    });
    srv.listen(0, "127.0.0.1", () =>
      resolve({ srv, receivedRequests, sockets })
    );
  });
}

// Spawn a fresh server.js in a child process so module-level env reads (which
// run at import time) pick up per-test configuration. server.js calls
// server.listen at import, so we just report the port back over IPC.
const SERVER_PATH = new URL("./server.js", import.meta.url).pathname;

function startProxyServer(baseURL, key, proxyToken, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, ...extraEnv };
    // Loose != null: passing undefined would collide with caller-side
    // destructuring defaults, so null is the "leave unset" sentinel.
    if (baseURL != null) env.NVIDIA_BASE_URL = baseURL;
    if (key != null) env.NVIDIA_API_KEY = key;
    if (proxyToken != null) env.PROXY_AUTH_TOKEN = proxyToken;
    env.PORT = String(0);

    const init = `
      import server from ${JSON.stringify(SERVER_PATH)};
      server.on("listening", () => {
        const bound = server.address();
        process.send({ port: bound.port, address: bound.address });
      });
      server.on("error", (e) => process.send({ error: e.message }));
    `;

    const child = spawn(process.execPath, ["--input-type=module", "-e", init], {
      env,
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    });

    const timer = setTimeout(() => reject(new Error("proxy did not start")), 3000);
    timer.unref();

    child.on("message", (msg) => {
      if (msg.error) reject(new Error(msg.error));
      else resolve({ child, port: msg.port, address: msg.address });
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code !== 0) reject(new Error(`proxy exited ${code}`));
    });
  });
}

// Start a stub upstream and a proxy child pointing at it; both cleanups are
// registered on the test context (LIFO: child killed before stub closed).
async function withProxy(t, { base, baseSuffix = "/v1", key = "sk", token = "pt", proxyEnv = {}, ...stubOpts }) {
  const { srv: stub, receivedRequests, sockets } = await startStubUpstream(
    stubOpts.status ?? 200,
    stubOpts.body,
    stubOpts.headers,
    stubOpts.mode
  );
  t.after(() => stub.close());
  if (base == null) {
    const a = stub.address();
    // Default to the documented NVIDIA base shape (…/v1) so path-mapping
    // behavior is exercised against a realistic base. baseSuffix: ""
    // yields an origin-only base for the equivalent-shape tests.
    base = `http://${a.address}:${a.port}${baseSuffix}`;
  }
  const proxy = await startProxyServer(base, key, token, proxyEnv);
  t.after(() => proxy.child.kill());
  return { proxy, receivedRequests, sockets };
}

function proxiedFetch(port, path, opts = {}) {
  return fetch(`http://127.0.0.1:${port}${path}`, opts);
}

// Run server.js once as a bare child (no IPC) and collect how it exits —
// for asserting startup validation failures.
function runProxyOnce(envOverrides) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--input-type=module", "-e", `import server from ${JSON.stringify(SERVER_PATH)};`],
      {
        env: { ...process.env, ...envOverrides, PORT: "0" },
        stdio: ["ignore", "ignore", "pipe", "ignore"],
      }
    );
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d));
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("proxy process did not exit"));
    }, 4000);
    timer.unref();
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ code, stderr });
    });
    child.on("error", reject);
  });
}

describe("startup", () => {
  test("exits 1 when NVIDIA_BASE_URL is missing", async () => {
    const { code, stderr } = await runProxyOnce({
      NVIDIA_BASE_URL: "",
      NVIDIA_API_KEY: "k",
      PROXY_AUTH_TOKEN: "t",
    });
    assert.equal(code, 1);
    assert.ok(stderr.includes("NVIDIA_BASE_URL is required"));
  });

  test("exits 1 when NVIDIA_BASE_URL is not a valid URL", async () => {
    const { code, stderr } = await runProxyOnce({
      NVIDIA_BASE_URL: "not-a-url",
      NVIDIA_API_KEY: "k",
      PROXY_AUTH_TOKEN: "t",
    });
    assert.equal(code, 1);
    assert.ok(stderr.includes("not a valid URL"));
  });

  test("exits 1 when NVIDIA_BASE_URL is not http(s)", async () => {
    const { code, stderr } = await runProxyOnce({
      NVIDIA_BASE_URL: "file:///etc/hosts",
      NVIDIA_API_KEY: "k",
      PROXY_AUTH_TOKEN: "t",
    });
    assert.equal(code, 1);
    assert.ok(stderr.includes("must use http or https"));
  });
});

describe("proxy", () => {
  test("POST body forwarded byte-identical + query preserved + auth replaced upstream", async (t) => {
    const { proxy, receivedRequests } = await withProxy(t, {
      key: "sk-test",
      token: "pt-secret",
      body: JSON.stringify({ ok: true, echoed: "body" }),
      headers: { "content-type": "application/json" },
    });
    const payload = JSON.stringify({ model: "nemotron", messages: [{ role: "user", content: "hi" }] });
    const res = await proxiedFetch(proxy.port, "/v1/chat/completions?stream=true", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer pt-secret" },
      body: payload,
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "application/json");
    assert.deepEqual(JSON.parse(await res.text()), { ok: true, echoed: "body" });
    const req = receivedRequests.find((r) => r.body === payload);
    assert.ok(req, "upstream should receive the proxied POST body verbatim");
    assert.equal(req.authorization, "Bearer sk-test");
    assert.equal(req.method, "POST");
    assert.equal(req.path, "/v1/chat/completions?stream=true", "path and query forwarded verbatim");
  });

  test("path mapping: upstream receives the /v1 path the client sent", async (t) => {
    const { proxy, receivedRequests } = await withProxy(t, { body: "{}" });
    const res = await proxiedFetch(proxy.port, "/v1/models", {
      headers: { authorization: "Bearer pt" },
    });
    assert.equal(res.status, 200);
    // NVIDIA-style upstreams serve /v1/models; a mapping that strips the
    // incoming /v1 would request /models and 404 upstream (the live bug).
    assert.equal(receivedRequests[0].path, "/v1/models");
  });

  test("path mapping: origin-only base still targets /v1 endpoints", async (t) => {
    const { proxy, receivedRequests } = await withProxy(t, {
      baseSuffix: "",
      body: "{}",
    });
    const res = await proxiedFetch(proxy.port, "/v1/models", {
      headers: { authorization: "Bearer pt" },
    });
    assert.equal(res.status, 200);
    assert.equal(receivedRequests[0].path, "/v1/models");
  });

  test("health 200 when configured", async (t) => {
    const { proxy } = await withProxy(t, {});
    const res = await proxiedFetch(proxy.port, "/health");
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { status: "ok" });
  });

  test("health 503 when unconfigured (missing proxy token)", async (t) => {
    const { proxy } = await withProxy(t, { token: null });
    const res = await proxiedFetch(proxy.port, "/health");
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), { status: "unconfigured" });
  });

  // Non-leak invariant: auth is checked before the unconfigured flag, so an
  // anonymous probe must learn nothing about which credential is missing.
  // A deployment missing only NVIDIA_API_KEY answers 401 on /v1/*, never 503.
  test("unauthenticated request gets 401 (not 503) when only the API key is missing", async (t) => {
    const { proxy, receivedRequests } = await withProxy(t, { key: " " });
    const res = await proxiedFetch(proxy.port, "/v1/models");
    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), { error: "Unauthorized" });
    // the proxy must reject before ever contacting the upstream
    assert.equal(receivedRequests.length, 0);
  });

  // Degraded responses must be generic: the 503 body may not name the
  // missing credential, so its content is pinned here.
  test("proxied request on unconfigured proxy returns generic 503 body", async (t) => {
    const { proxy, receivedRequests } = await withProxy(t, { key: " " });
    const res = await proxiedFetch(proxy.port, "/v1/chat/completions", {
      method: "POST",
      headers: { authorization: "Bearer pt", "content-type": "application/json" },
      body: JSON.stringify({ model: "m", messages: [] }),
    });
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), { error: "Proxy is not configured" });
    assert.equal(receivedRequests.length, 0);
  });

  test("401 without proxy auth token", async (t) => {
    const { proxy } = await withProxy(t, { token: "pt-secret" });
    const res = await proxiedFetch(proxy.port, "/v1/models");
    assert.equal(res.status, 401);
  });

  test("404 for non-/v1 paths", async (t) => {
    const { proxy } = await withProxy(t, {});
    const res = await proxiedFetch(proxy.port, "/foo", {
      headers: { authorization: "Bearer pt" },
    });
    assert.equal(res.status, 404);
  });

  test("bare /v1 and /v1/ return 404 (not proxied to upstream root)", async (t) => {
    const { proxy, receivedRequests } = await withProxy(t, {
      body: JSON.stringify({ data: [] }),
      headers: { "content-type": "application/json" },
    });
    for (const path of ["/v1", "/v1/"]) {
      const res = await proxiedFetch(proxy.port, path, {
        headers: { authorization: "Bearer pt" },
      });
      assert.equal(res.status, 404, `expected 404 for ${path}, got ${res.status}`);
    }
    assert.equal(receivedRequests.length, 0); // short-circuited, never proxied
  });

  test("multi-value set-cookie preserved (not merged)", async (t) => {
    const { proxy } = await withProxy(t, {
      body: "x",
      headers: { "content-type": "text/plain", "set-cookie": ["a=1; Path=/", "b=2; Path=/"] },
    });
    const res = await proxiedFetch(proxy.port, "/v1/models", {
      headers: { authorization: "Bearer pt" },
    });
    const cookies = res.headers.getSetCookie();
    assert.deepEqual(cookies, ["a=1; Path=/", "b=2; Path=/"]);
  });

  test("SSE streamed through unbuffered", async (t) => {
    const { proxy } = await withProxy(t, {
      headers: { "content-type": "text/event-stream" },
      mode: "sse",
    });
    const res = await proxiedFetch(proxy.port, "/v1/chat/completions", {
      method: "POST",
      headers: { authorization: "Bearer pt", "content-type": "application/json" },
      body: JSON.stringify({ stream: true }),
    });
    const text = await res.text();
    assert.ok(text.includes("data: chunk1"), "first SSE chunk received");
    assert.ok(text.includes("data: chunk2"), "second SSE chunk received");
  });

  test("upstream status passed through unchanged", async (t) => {
    const { proxy } = await withProxy(t, {
      status: 404,
      body: JSON.stringify({ error: "not found" }),
      headers: { "content-type": "application/json" },
    });
    const res = await proxiedFetch(proxy.port, "/v1/missing", {
      method: "POST",
      headers: { authorization: "Bearer pt", "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { error: "not found" });
  });

  test("mid-stream upstream failure does not crash the process", async (t) => {
    const { proxy } = await withProxy(t, {
      headers: { "content-type": "text/plain" },
      mode: "midabort",
    });
    try {
      const res = await proxiedFetch(proxy.port, "/v1/models", {
        headers: { authorization: "Bearer pt" },
      });
      const text = await res.text();
      assert.ok(text.includes("partial"), "got partial data before abort");
    } catch {
      // connection drop is acceptable; the assertion is that the process lives
    }
    assert.equal(proxy.child.exitCode, null, "proxy process must survive the abort");
  });

  test("unreachable upstream returns 502 without internal details", async (t) => {
    const { proxy } = await withProxy(t, { base: "http://127.0.0.1:1" });
    const res = await proxiedFetch(proxy.port, "/v1/models", {
      headers: { authorization: "Bearer pt" },
    });
    assert.equal(res.status, 502);
    const body = await res.json();
    assert.deepEqual(body, { error: "Bad gateway" });
    assert.equal(body.message, undefined);
  });

  test("upstream that never sends response headers times out with 502", async (t) => {
    const { proxy, receivedRequests } = await withProxy(t, {
      mode: "silent",
      proxyEnv: { UPSTREAM_CONNECT_TIMEOUT_SECONDS: "1" },
    });
    const started = Date.now();
    const res = await proxiedFetch(proxy.port, "/v1/models", {
      headers: { authorization: "Bearer pt" },
    });
    assert.equal(res.status, 502);
    assert.deepEqual(await res.json(), { error: "Bad gateway" });
    // The 1s connect window must have been honored (undici's own header
    // timeout is ~300s, so only our abort can produce a fast 502 here).
    assert.ok(Date.now() - started >= 900, "waited for the connect window");
    assert.ok(Date.now() - started < 5000, "connect timeout fired quickly");
    assert.equal(proxy.child.exitCode, null, "proxy survives the timeout");
  });

  test("stalled stream is cut by the idle timeout", async (t) => {
    const { proxy } = await withProxy(t, {
      headers: { "content-type": "text/plain" },
      mode: "stall",
      proxyEnv: { UPSTREAM_IDLE_TIMEOUT_SECONDS: "1" },
    });
    const res = await proxiedFetch(proxy.port, "/v1/models", {
      headers: { authorization: "Bearer pt" },
    });
    assert.equal(res.status, 200);
    const reader = res.body.getReader();
    const first = await reader.read();
    assert.equal(new TextDecoder().decode(first.value), "hello");
    // Second read must fail: the idle watchdog destroys the stalled stream.
    await assert.rejects(reader.read());
    assert.equal(proxy.child.exitCode, null, "proxy survives the idle timeout");
  });

  test("idle timeout disabled (0) lets a slow stream finish", async (t) => {
    const { proxy } = await withProxy(t, {
      headers: { "content-type": "text/plain" },
      mode: "slowfinish",
      proxyEnv: { UPSTREAM_IDLE_TIMEOUT_SECONDS: "0" },
    });
    const res = await proxiedFetch(proxy.port, "/v1/models", {
      headers: { authorization: "Bearer pt" },
    });
    assert.equal(res.status, 200);
    assert.equal(await res.text(), "slow done");
    assert.equal(proxy.child.exitCode, null);
  });

  test("204 no-body upstream passes through without body", async (t) => {
    const { proxy } = await withProxy(t, { status: 204 });
    const res = await proxiedFetch(proxy.port, "/v1/models", {
      headers: { authorization: "Bearer pt" },
    });
    assert.equal(res.status, 204);
    assert.equal(await res.text(), "");
  });

  test("upstream content-length is preserved on pass-through", async (t) => {
    const body = JSON.stringify({ data: [1, 2, 3] });
    const { proxy } = await withProxy(t, {
      body,
      headers: { "content-type": "application/json" },
    });
    const res = await proxiedFetch(proxy.port, "/v1/models", {
      headers: { authorization: "Bearer pt" },
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-length"), String(Buffer.byteLength(body)));
    assert.equal(await res.text(), body); // complete, not truncated
  });

  test("generated 404 keeps its own content-length", async (t) => {
    const { proxy, receivedRequests } = await withProxy(t, {});
    const res = await proxiedFetch(proxy.port, "/v1", {
      headers: { authorization: "Bearer pt" },
    });
    assert.equal(res.status, 404);
    assert.equal(res.headers.get("content-length"), "21"); // {"error":"Not found"}
    assert.equal(await res.text(), '{"error":"Not found"}');
    assert.equal(receivedRequests.length, 0); // generated locally, not proxied
  });

  test("SIGTERM drops idle connections and exits promptly", async (t) => {
    const { proxy } = await withProxy(t, {});
    // keep-alive connection held open by undici pool
    await proxiedFetch(proxy.port, "/health");
    proxy.child.kill("SIGTERM");
    const exited = new Promise((resolve) => proxy.child.on("exit", resolve));
    const code = await Promise.race([
      exited,
      new Promise((_, rej) => setTimeout(() => rej(new Error("proxy did not exit after SIGTERM")), 4000)),
    ]);
    assert.equal(code, 0);
  });

  test("wrong auth token rejected", async (t) => {
    const { proxy } = await withProxy(t, {
      token: "pt-secret",
      body: JSON.stringify({ data: [] }),
      headers: { "content-type": "application/json" },
    });
    const res = await proxiedFetch(proxy.port, "/v1/models", {
      headers: { authorization: "Bearer wrong-token" },
    });
    assert.equal(res.status, 401);
  });

  test("stream duration exceeding connect timeout finishes successfully", async (t) => {
    const { proxy } = await withProxy(t, {
      headers: { "content-type": "text/plain" },
      mode: "activelong",
      proxyEnv: {
        UPSTREAM_CONNECT_TIMEOUT_SECONDS: "1",
        UPSTREAM_IDLE_TIMEOUT_SECONDS: "5",
      },
    });
    const res = await proxiedFetch(proxy.port, "/v1/models", {
      headers: { authorization: "Bearer pt" },
    });
    assert.equal(res.status, 200);
    assert.equal(await res.text(), "part1-part2-part3");
    assert.equal(proxy.child.exitCode, null);
  });

  test("HEAD request preserves content-length without body", async (t) => {
    const body = JSON.stringify({ data: [1, 2, 3] });
    const { proxy } = await withProxy(t, {
      body,
      headers: { "content-type": "application/json" },
    });
    const res = await proxiedFetch(proxy.port, "/v1/models", {
      method: "HEAD",
      headers: { authorization: "Bearer pt" },
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-length"), String(Buffer.byteLength(body)));
    assert.equal(await res.text(), "");
  });

  test("empty or whitespace timeout env vars fall back to defaults", async (t) => {
    const { proxy } = await withProxy(t, {
      body: JSON.stringify({ ok: true }),
      headers: { "content-type": "application/json" },
      proxyEnv: {
        UPSTREAM_CONNECT_TIMEOUT_SECONDS: "",
        UPSTREAM_IDLE_TIMEOUT_SECONDS: "   ",
      },
    });
    const res = await proxiedFetch(proxy.port, "/v1/models", {
      headers: { authorization: "Bearer pt" },
    });
    assert.equal(res.status, 200);
  });

  test("gzip request body and content-encoding reach the upstream unchanged", async (t) => {
    const payload = Buffer.from(JSON.stringify({ model: "nemotron" }));
    const gzipped = zlib.gzipSync(payload);
    const { proxy, receivedRequests } = await withProxy(t, { body: "{}" });
    const res = await proxiedFetch(proxy.port, "/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: "Bearer pt",
        "content-encoding": "gzip",
        "content-type": "application/json",
      },
      body: gzipped,
    });
    assert.equal(res.status, 200);
    assert.deepEqual(receivedRequests[0].rawBody, gzipped);
    assert.equal(receivedRequests[0].contentEncoding, "gzip");
  });

  test("upstream content-encoding is stripped and decompressed body streamed cleanly", async (t) => {
    const json = JSON.stringify({ ok: true });
    const gzipped = zlib.gzipSync(Buffer.from(json));
    const { proxy } = await withProxy(t, {
      body: gzipped,
      headers: {
        "content-type": "application/json",
        "content-encoding": "gzip",
        "content-length": String(gzipped.length),
      },
    });
    const res = await proxiedFetch(proxy.port, "/v1/models", {
      headers: { authorization: "Bearer pt" },
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-encoding"), null);
    assert.notEqual(res.headers.get("content-length"), String(gzipped.length));
    assert.equal(await res.text(), json);
  });

  // Client disconnects → upstream work must be cancelled. The per-request
  // AbortController must receive the downstream lifecycle, not just the
  // connect-timeout signal. Two phases: pending upstream (no headers yet)
  // and active streaming (first chunk already flushed to client).
  test("downstream disconnect aborts pending upstream (pre-headers)", async (t) => {
    const { proxy, receivedRequests, sockets } = await withProxy(t, {
      mode: "silent", // accepts request, never sends response headers
      proxyEnv: { UPSTREAM_CONNECT_TIMEOUT_SECONDS: "30" },
    });
    const controller = new AbortController();
    const req = proxiedFetch(proxy.port, "/v1/models", {
      headers: { authorization: "Bearer pt" },
      signal: controller.signal,
    });
    // Wait until the proxy has forwarded the request to the upstream.
    const deadline = Date.now() + 3000;
    while (receivedRequests.length === 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 10));
    }
    assert.equal(receivedRequests.length, 1, "upstream received the request");
    // Abort the downstream fetch — simulates client disconnect. The promise
    // rejects with AbortError; swallow it — the assertion is about the
    // upstream socket, not the downstream fetch result.
    controller.abort();
    req.catch(() => {});
    // The upstream connection must close because the proxy aborted the fetch.
    const socketClosed = Promise.race([
      (async () => {
        const check = () => sockets.size === 0;
        if (check()) return true;
        for (let i = 0; i < 200 && !check(); i++) {
          await new Promise((r) => setTimeout(r, 10));
        }
        return check();
      })(),
      new Promise((r) => setTimeout(() => r(false), 3000)),
    ]);
    assert.ok(await socketClosed, "upstream connection should close on downstream disconnect");
    // Proxy must survive: a subsequent health check proves availability.
    const health = await fetch(`http://127.0.0.1:${proxy.port}/health`);
    assert.equal(health.status, 200);
    assert.equal(proxy.child.exitCode, null, "proxy survives downstream disconnect");
  });

  test("downstream disconnect aborts active upstream stream", async (t) => {
    const { proxy, receivedRequests, sockets } = await withProxy(t, {
      mode: "abortable", // sends one chunk, then holds the stream open
      proxyEnv: { UPSTREAM_CONNECT_TIMEOUT_SECONDS: "30", UPSTREAM_IDLE_TIMEOUT_SECONDS: "0" },
    });
    // Start the proxied request as a stream so we can abort mid-flight.
    const res = await proxiedFetch(proxy.port, "/v1/models", {
      headers: { authorization: "Bearer pt" },
    });
    assert.equal(res.status, 200);
    const reader = res.body.getReader();
    const first = await reader.read();
    assert.ok(first.value, "first chunk received from upstream");
    assert.equal(new TextDecoder().decode(first.value), "part1-");
    // Simulate downstream client disconnect.
    reader.cancel();
    // The upstream connection must close — the proxy must abort its fetch.
    const socketClosed = (async () => {
      for (let i = 0; i < 200 && sockets.size > 0; i++) {
        await new Promise((r) => setTimeout(r, 10));
      }
      return sockets.size === 0;
    })();
    assert.ok(await socketClosed, "upstream stream should close on downstream disconnect");
    // Proxy must survive.
    const health = await fetch(`http://127.0.0.1:${proxy.port}/health`);
    assert.equal(health.status, 200);
    assert.equal(proxy.child.exitCode, null, "proxy survives downstream disconnect");
  });

  test("request set-cookie headers reach the upstream as one comma-joined header", async (t) => {
    const { proxy, receivedRequests } = await withProxy(t, { body: "{}" });
    // proxiedFetch cannot be used here: undici collapses duplicate set-cookie
    // request headers into one before they leave, so node:http builds the wire
    // request to guarantee two headers actually arrive at the proxy.
    const res = await new Promise((resolve, reject) => {
      const r = http.request(
        {
          host: "127.0.0.1",
          port: proxy.port,
          path: "/v1/models",
          method: "GET",
          headers: { authorization: "Bearer pt" },
        },
        (response) => {
          response.resume();
          response.on("end", () => resolve(response));
        }
      );
      r.on("error", reject);
      // Two headers so the pre-fix and post-fix bytes differ: unfixed, undici
      // coerces the array to "a,b"; fixed, the loop joins to "a, b".
      r.setHeader("set-cookie", ["sid=abc; Path=/", "theme=dark; Path=/"]);
      r.end();
    });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(receivedRequests[0].setCookie, [
      "sid=abc; Path=/, theme=dark; Path=/",
    ]);
  });
});

// Bind address is config, not a literal: the bound address is asserted from
// server.address() in the child (reported over IPC), never by guessing which
// non-loopback address this host happens to have.
describe("bind host", () => {
  test("PROXY_HOST=127.0.0.1 binds loopback and serves /health", async (t) => {
    const { proxy } = await withProxy(t, {
      proxyEnv: { PROXY_HOST: "127.0.0.1" },
    });
    assert.equal(proxy.address, "127.0.0.1");
    const res = await proxiedFetch(proxy.port, "/health");
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { status: "ok" });
  });

  // Default-path regression guard: unset, empty, and whitespace-only all keep
  // the historical wildcard bind that render.yaml and the live deploy assume.
  test("PROXY_HOST unset, empty, or whitespace-only binds 0.0.0.0", async (t) => {
    for (const proxyEnv of [{}, { PROXY_HOST: "" }, { PROXY_HOST: "   " }]) {
      const { proxy } = await withProxy(t, { proxyEnv });
      assert.equal(
        proxy.address,
        "0.0.0.0",
        `expected the 0.0.0.0 default for ${JSON.stringify(proxyEnv)}`
      );
    }
  });

  // A non-wildcard bind changes nothing else: header forwarding, credential
  // swap, path mapping, and /health must behave exactly as on the default.
  test("PROXY_HOST=127.0.0.1 leaves header forwarding, credential swap, path mapping, and /health unchanged", async (t) => {
    const gzipped = zlib.gzipSync(Buffer.from(JSON.stringify({ model: "nemotron" })));
    const { proxy, receivedRequests } = await withProxy(t, {
      proxyEnv: { PROXY_HOST: "127.0.0.1" },
      key: "sk-test",
      token: "pt-secret",
      body: "{}",
    });
    assert.equal(proxy.address, "127.0.0.1");
    const res = await proxiedFetch(proxy.port, "/v1/chat/completions?stream=true", {
      method: "POST",
      headers: {
        authorization: "Bearer pt-secret",
        "content-encoding": "gzip",
        "content-type": "application/json",
      },
      body: gzipped,
    });
    assert.equal(res.status, 200);
    const req = receivedRequests[0];
    assert.equal(req.contentEncoding, "gzip", "request headers forwarded");
    assert.deepEqual(req.rawBody, gzipped, "request body forwarded byte-identical");
    assert.equal(req.authorization, "Bearer sk-test", "client token swapped upstream");
    assert.equal(
      req.path,
      "/v1/chat/completions?stream=true",
      "path and query forwarded verbatim"
    );
    const health = await proxiedFetch(proxy.port, "/health");
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: "ok" });
  });
});

// PROXY_RPM and PROXY_TPM are a mandatory pair. Nothing acts on the values in
// this story — the assertions are about startup: which configurations come up,
// which crash, and what stderr says. Both seams already existed: runProxyOnce
// for the fatal cases (with a valid base URL and credentials, so an exit 1
// proves the rate pair and not a missing NVIDIA_BASE_URL) and withProxy for
// the configurations that must start.
describe("rate budget config", () => {
  // Fatal cases inherit process.env, so a valid upstream base and both
  // credentials are passed explicitly: without them the child would exit 1
  // for an unrelated reason and the assertion would prove nothing.
  const BASE_ENV = {
    NVIDIA_BASE_URL: "https://example.com/v1",
    NVIDIA_API_KEY: "k",
    PROXY_AUTH_TOKEN: "t",
  };

  // Values that are non-blank but not a positive safe integer written in plain
  // decimal digits. 2^53+1 and the 30-digit run are the safe-integer bound;
  // the rest are the shapes Number() would happily accept or reinterpret.
  const INVALID_VALUES = [
    ["zero", "0"],
    ["negative", "-1"],
    ["fraction", "1.5"],
    ["non-numeric", "abc"],
    ["unsafe integer", "9007199254740993"],
    ["30-digit run", "1".repeat(30)],
  ];

  test("PROXY_RPM and PROXY_TPM both absent leaves rate limiting disabled", async (t) => {
    const { proxy } = await withProxy(t, {});
    const res = await proxiedFetch(proxy.port, "/health");
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { status: "ok" });
  });

  // Number("  ") is 0, so a whitespace-only value that reaches numeric parsing
  // looks like a supplied value instead of an absent one — a budget that
  // appears to exist and does not. Blank must mean absent.
  test("PROXY_RPM and PROXY_TPM blank (empty or whitespace-only) start with rate limiting disabled", async (t) => {
    for (const proxyEnv of [
      { PROXY_RPM: "", PROXY_TPM: "" },
      { PROXY_RPM: "   ", PROXY_TPM: "   " },
      { PROXY_RPM: " \t ", PROXY_TPM: "" },
    ]) {
      const { proxy } = await withProxy(t, { proxyEnv });
      const res = await proxiedFetch(proxy.port, "/health");
      assert.equal(res.status, 200, `expected a successful start for ${JSON.stringify(proxyEnv)}`);
    }
  });

  test("PROXY_RPM and PROXY_TPM both valid start and serve /health", async (t) => {
    for (const proxyEnv of [
      { PROXY_RPM: "60", PROXY_TPM: "100000" },
      { PROXY_RPM: "1", PROXY_TPM: "1" },
      { PROXY_RPM: " 60 ", PROXY_TPM: " 100000 " },
    ]) {
      const { proxy } = await withProxy(t, { proxyEnv });
      const res = await proxiedFetch(proxy.port, "/health");
      assert.equal(res.status, 200, `expected a successful start for ${JSON.stringify(proxyEnv)}`);
    }
  });

  // This story validates and stores the pair; it does not enforce it. A tiny
  // budget must still pass a request through, so a later slice that starts
  // acting on it has to change this test deliberately.
  test("PROXY_RPM and PROXY_TPM set to a tiny budget still proxy normally (values validated, not applied)", async (t) => {
    const { proxy, receivedRequests } = await withProxy(t, {
      proxyEnv: { PROXY_RPM: "1", PROXY_TPM: "1" },
      body: "{}",
    });
    const res = await proxiedFetch(proxy.port, "/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: "Bearer pt",
        "content-type": "application/json",
      },
      body: JSON.stringify({ model: "nemotron" }),
    });
    assert.equal(res.status, 200);
    assert.equal(receivedRequests.length, 1);
  });

  test("PROXY_RPM set with PROXY_TPM absent exits 1 naming both variables", async () => {
    const { code, stderr } = await runProxyOnce({ ...BASE_ENV, PROXY_RPM: "60" });
    assert.equal(code, 1);
    assert.ok(stderr.includes("PROXY_RPM"), `stderr should name PROXY_RPM: ${stderr}`);
    assert.ok(stderr.includes("PROXY_TPM"), `stderr should name PROXY_TPM: ${stderr}`);
  });

  test("PROXY_TPM set with PROXY_RPM absent exits 1 naming both variables", async () => {
    const { code, stderr } = await runProxyOnce({ ...BASE_ENV, PROXY_TPM: "100000" });
    assert.equal(code, 1);
    assert.ok(stderr.includes("PROXY_RPM"), `stderr should name PROXY_RPM: ${stderr}`);
    assert.ok(stderr.includes("PROXY_TPM"), `stderr should name PROXY_TPM: ${stderr}`);
  });

  // Blank is absent, so a blank partner is the "exactly one set" case, not a
  // valid half-empty pair.
  test("PROXY_TPM set with PROXY_RPM whitespace-only exits 1 naming both variables", async () => {
    const { code, stderr } = await runProxyOnce({ ...BASE_ENV, PROXY_RPM: "   ", PROXY_TPM: "100000" });
    assert.equal(code, 1);
    assert.ok(stderr.includes("PROXY_RPM"), `stderr should name PROXY_RPM: ${stderr}`);
    assert.ok(stderr.includes("PROXY_TPM"), `stderr should name PROXY_TPM: ${stderr}`);
  });

  test("PROXY_RPM non-blank but not a positive integer exits 1 naming PROXY_RPM", async () => {
    for (const [label, value] of INVALID_VALUES) {
      const { code, stderr } = await runProxyOnce({
        ...BASE_ENV,
        PROXY_RPM: value,
        PROXY_TPM: "100000",
      });
      assert.equal(code, 1, `expected exit 1 for PROXY_RPM ${label} (${value})`);
      assert.ok(
        stderr.includes("PROXY_RPM"),
        `stderr should name PROXY_RPM for ${label}: ${stderr}`
      );
    }
  });

  test("PROXY_TPM non-blank but not a positive integer exits 1 naming PROXY_TPM", async () => {
    for (const [label, value] of INVALID_VALUES) {
      const { code, stderr } = await runProxyOnce({
        ...BASE_ENV,
        PROXY_RPM: "60",
        PROXY_TPM: value,
      });
      assert.equal(code, 1, `expected exit 1 for PROXY_TPM ${label} (${value})`);
      assert.ok(
        stderr.includes("PROXY_TPM"),
        `stderr should name PROXY_TPM for ${label}: ${stderr}`
      );
    }
  });

  // Pinned decision (story §12): decimal digits only, never Number() coercion.
  // Number("1e3") is 1000 and Number("0x10") is 16, so a permissive check would
  // silently reinterpret an operator's ceiling. The equivalent literals are
  // accepted in the same test, so the assertion is about the notation, not the
  // magnitude. Reversing this is one guard and this one test.
  test("PROXY_RPM and PROXY_TPM reject 1e3 and 0x10 while accepting the same values in decimal", async (t) => {
    const NOTATIONS = [
      ["scientific", "1e3"],
      ["hex", "0x10"],
      ["explicitly signed", "+5"],
      ["leading-dot fraction", ".5"],
      ["digit separator", "1_000"],
      ["overflowing exponent", "1e400"],
    ];
    for (const [name, partner] of [["PROXY_RPM", "PROXY_TPM"], ["PROXY_TPM", "PROXY_RPM"]]) {
      for (const [label, value] of NOTATIONS) {
        const { code, stderr } = await runProxyOnce({
          ...BASE_ENV,
          [name]: value,
          [partner]: "1000",
        });
        assert.equal(code, 1, `${name}=${value} (${label}) should be fatal`);
        assert.ok(stderr.includes(name), `stderr should name ${name} for ${label}: ${stderr}`);
      }
    }
    for (const proxyEnv of [
      { PROXY_RPM: "1000", PROXY_TPM: "1000" },
      { PROXY_RPM: "16", PROXY_TPM: "16" },
    ]) {
      const { proxy } = await withProxy(t, { proxyEnv });
      const res = await proxiedFetch(proxy.port, "/health");
      assert.equal(res.status, 200, `expected a successful start for ${JSON.stringify(proxyEnv)}`);
    }
  });
});

// The four operational limit variables. Nothing acts on them in this story —
// the assertions are about startup: which configurations come up, which crash,
// and what stderr says. Both harness seams already existed: runProxyOnce for
// the fatal cases (with a valid base URL and credentials, so an exit 1 proves
// the limit and not a missing NVIDIA_BASE_URL) and withProxy for the ones that
// must start.
describe("operational limit config", () => {
  // Fatal cases inherit process.env, so a valid upstream base and both
  // credentials are passed explicitly: without them the child would exit 1
  // for an unrelated reason and the assertion would prove nothing.
  const BASE_ENV = {
    NVIDIA_BASE_URL: "https://example.com/v1",
    NVIDIA_API_KEY: "k",
    PROXY_AUTH_TOKEN: "t",
  };

  // Each variable paired with the rule its stderr has to state. The message is
  // the only thing an operator reads, so it is pinned: "non-negative integer"
  // on the ceiling reads as if 0 were a usable limit, when 0 is the documented
  // disable value.
  const LIMIT_VARIABLES = [
    ["PROXY_MAX_CONCURRENT_REQUESTS", "a positive integer (0 disables)"],
    ["PROXY_MAX_QUEUE_SIZE", "a positive integer"],
    ["PROXY_QUEUE_TIMEOUT_SECONDS", "a positive integer"],
    ["PROXY_SAFETY_MARGIN_PCT", "an integer between 0 and 50"],
  ];

  // Non-blank values that are not a safe integer in plain decimal digits, so
  // every one of the four variables must reject them. 2^53+1 and the 30-digit
  // run are the safe-integer bound; the rest are the shapes Number() would
  // accept or reinterpret. `0` is absent here because it is a legal value for
  // two of the four, not an invalid one: it disables the ceiling and is the
  // low end of the margin's 0-50 range (both pinned below), and it is fatal
  // only for the queue size and the queue timeout (see the zero test).
  const INVALID_VALUES = [
    ["negative", "-1"],
    ["fraction", "1.5"],
    ["non-numeric", "abc"],
    ["unsafe integer", "9007199254740993"],
    ["scientific", "1e3"],
    ["hex", "0x10"],
    ["explicitly signed", "+5"],
    ["leading-dot fraction", ".5"],
    ["digit separator", "1_000"],
    ["30-digit run", "1".repeat(30)],
  ];

  // withProxy merges proxyEnv over process.env, so passing nothing would pin
  // the author's shell rather than absence. undefined drops the key from the
  // child's env entirely, which is what makes this the absent case.
  test("PROXY_MAX_CONCURRENT_REQUESTS, PROXY_MAX_QUEUE_SIZE, PROXY_QUEUE_TIMEOUT_SECONDS and PROXY_SAFETY_MARGIN_PCT all absent start and serve /health", async (t) => {
    const { proxy } = await withProxy(t, {
      proxyEnv: {
        PROXY_MAX_CONCURRENT_REQUESTS: undefined,
        PROXY_MAX_QUEUE_SIZE: undefined,
        PROXY_QUEUE_TIMEOUT_SECONDS: undefined,
        PROXY_SAFETY_MARGIN_PCT: undefined,
      },
    });
    const res = await proxiedFetch(proxy.port, "/health");
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { status: "ok" });
  });

  // Number("  ") is 0, so a blank value that reached the numeric guard would
  // read as a supplied value instead of an absent one — for the defaulted
  // variables a silently zeroed ceiling instead of the documented default.
  test("PROXY_MAX_CONCURRENT_REQUESTS, PROXY_MAX_QUEUE_SIZE, PROXY_QUEUE_TIMEOUT_SECONDS and PROXY_SAFETY_MARGIN_PCT blank start and serve /health", async (t) => {
    for (const blank of ["", "   ", " \t "]) {
      const proxyEnv = {
        PROXY_MAX_CONCURRENT_REQUESTS: blank,
        PROXY_MAX_QUEUE_SIZE: blank,
        PROXY_QUEUE_TIMEOUT_SECONDS: blank,
        PROXY_SAFETY_MARGIN_PCT: blank,
      };
      const { proxy } = await withProxy(t, { proxyEnv });
      const res = await proxiedFetch(proxy.port, "/health");
      assert.equal(res.status, 200, `expected a successful start for ${JSON.stringify(proxyEnv)}`);
    }
  });

  test("PROXY_MAX_CONCURRENT_REQUESTS, PROXY_MAX_QUEUE_SIZE, PROXY_QUEUE_TIMEOUT_SECONDS and PROXY_SAFETY_MARGIN_PCT at their boundary values start and serve /health", async (t) => {
    for (const proxyEnv of [
      {
        PROXY_MAX_CONCURRENT_REQUESTS: "1",
        PROXY_MAX_QUEUE_SIZE: "1",
        PROXY_QUEUE_TIMEOUT_SECONDS: "1",
        PROXY_SAFETY_MARGIN_PCT: "0",
      },
      {
        PROXY_MAX_CONCURRENT_REQUESTS: "64",
        PROXY_MAX_QUEUE_SIZE: "32",
        PROXY_QUEUE_TIMEOUT_SECONDS: "30",
        PROXY_SAFETY_MARGIN_PCT: "50",
      },
    ]) {
      const { proxy } = await withProxy(t, { proxyEnv });
      const res = await proxiedFetch(proxy.port, "/health");
      assert.equal(res.status, 200, `expected a successful start for ${JSON.stringify(proxyEnv)}`);
    }
  });

  // The one documented zero-disables case. Pinned, not assumed: a later slice
  // that makes 0 fatal would silently turn a running deploy into a crash loop.
  test("PROXY_MAX_CONCURRENT_REQUESTS=0 starts and serves /health (zero disables the ceiling)", async (t) => {
    const { proxy } = await withProxy(t, {
      proxyEnv: { PROXY_MAX_CONCURRENT_REQUESTS: "0" },
    });
    const res = await proxiedFetch(proxy.port, "/health");
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { status: "ok" });
  });

  // Blank is what an unset variable looks like, so the blank case has to start
  // too. Whether it reaches the same internal state as 0 is not observable
  // through this harness, and no test claims it is.
  test("PROXY_MAX_CONCURRENT_REQUESTS blank (spaces or tab) starts and serves /health", async (t) => {
    for (const blank of ["", "   ", " \t "]) {
      const { proxy } = await withProxy(t, {
        proxyEnv: { PROXY_MAX_CONCURRENT_REQUESTS: blank },
      });
      const res = await proxiedFetch(proxy.port, "/health");
      assert.equal(res.status, 200, `expected a successful start for ${JSON.stringify(blank)}`);
    }
  });

  test("each of PROXY_MAX_CONCURRENT_REQUESTS, PROXY_MAX_QUEUE_SIZE, PROXY_QUEUE_TIMEOUT_SECONDS and PROXY_SAFETY_MARGIN_PCT rejects a non-blank invalid value, names itself and states its rule", async () => {
    for (const [name, rule] of LIMIT_VARIABLES) {
      for (const [label, value] of INVALID_VALUES) {
        const { code, stderr } = await runProxyOnce({ ...BASE_ENV, [name]: value });
        assert.equal(code, 1, `expected exit 1 for ${name} ${label} (${value})`);
        assert.ok(
          stderr.includes(`${name} must be ${rule}`),
          `stderr should state ${name}'s rule for ${label}: ${stderr}`
        );
      }
    }
  });

  // Only the concurrency ceiling has the zero-disables carve-out. A zero queue
  // size or a zero-second wait turns queueing into immediate rejection — a
  // limit that appears to exist and does not.
  test("PROXY_MAX_QUEUE_SIZE and PROXY_QUEUE_TIMEOUT_SECONDS reject 0", async () => {
    for (const name of ["PROXY_MAX_QUEUE_SIZE", "PROXY_QUEUE_TIMEOUT_SECONDS"]) {
      const { code, stderr } = await runProxyOnce({ ...BASE_ENV, [name]: "0" });
      assert.equal(code, 1, `expected exit 1 for ${name}=0`);
      assert.ok(stderr.includes(name), `stderr should name ${name}: ${stderr}`);
    }
  });

  // 51 is the story's named fatal case; -1 comes from the generic rule, so
  // both ends of the range are pinned: 0 and 50 start (test above), 51 and -1
  // do not.
  test("PROXY_SAFETY_MARGIN_PCT outside 0-50 exits 1 naming PROXY_SAFETY_MARGIN_PCT", async () => {
    for (const [label, value] of [["51", "51"], ["negative", "-1"], ["100", "100"]]) {
      const { code, stderr } = await runProxyOnce({ ...BASE_ENV, PROXY_SAFETY_MARGIN_PCT: value });
      assert.equal(code, 1, `expected exit 1 for PROXY_SAFETY_MARGIN_PCT ${label} (${value})`);
      assert.ok(
        stderr.includes("PROXY_SAFETY_MARGIN_PCT"),
        `stderr should name PROXY_SAFETY_MARGIN_PCT for ${label}: ${stderr}`
      );
    }
  });

  // This story validates and stores the limits; it does not enforce them. A
  // one-slot ceiling over a one-deep queue must still pass a request through,
  // so a later slice that starts acting on them has to change this test
  // deliberately.
  test("PROXY_MAX_CONCURRENT_REQUESTS=1 over a one-slot queue still proxies normally (values validated, not applied)", async (t) => {
    const { proxy, receivedRequests } = await withProxy(t, {
      proxyEnv: {
        PROXY_MAX_CONCURRENT_REQUESTS: "1",
        PROXY_MAX_QUEUE_SIZE: "1",
        PROXY_QUEUE_TIMEOUT_SECONDS: "1",
      },
      body: "{}",
    });
    const res = await proxiedFetch(proxy.port, "/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: "Bearer pt",
        "content-type": "application/json",
      },
      body: JSON.stringify({ model: "nemotron" }),
    });
    assert.equal(res.status, 200);
    assert.equal(receivedRequests.length, 1);
  });
});

// The buffered-body ceiling and the per-model budget map, the last two
// variables this story adds. Neither is acted on here: the assertions are
// about startup — which configurations come up, which crash, and what stderr
// says. Both harness seams already existed: runProxyOnce for the fatal cases
// (with a valid base URL and credentials, so an exit 1 proves these two
// variables and not an unrelated missing NVIDIA_BASE_URL) and withProxy for the
// configurations that must start.
describe("buffered body ceiling and per-model limits", () => {
  const NAME = "PROXY_MODEL_LIMITS_JSON";

  // Fatal cases inherit process.env, so a valid upstream base and both
  // credentials are passed explicitly: without them the child would exit 1
  // for an unrelated reason and the assertion would prove nothing.
  const BASE_ENV = {
    NVIDIA_BASE_URL: "https://example.com/v1",
    NVIDIA_API_KEY: "k",
    PROXY_AUTH_TOKEN: "t",
  };

  // Non-blank ceiling values that are not a safe integer in plain decimal
  // digits: the same shapes the other scalar ceilings reject, plus 0. 0 is in
  // the table rather than beside it because it needs its own reasoning — a
  // zero-byte buffer rejects every request body, a limit that appears to
  // exist and does not. 2^53+1 and the 30-digit run are the safe-integer bound.
  const INVALID_CEILINGS = [
    ["zero", "0"],
    ["negative", "-1"],
    ["fraction", "1.5"],
    ["non-numeric", "abc"],
    ["unsafe integer", "9007199254740993"],
    ["scientific", "1e3"],
    ["hex", "0x10"],
    ["explicitly signed", "+5"],
    ["leading-dot fraction", ".5"],
    ["digit separator", "1_000"],
    ["30-digit run", "1".repeat(30)],
  ];

  // Non-object roots. An array parses and its indices would silently become
  // model IDs; a number or string is not a budget map at all.
  const NON_OBJECT_ROOTS = [
    ["null", "null"],
    ["array", "[]"],
    ["string", '"a"'],
    ["number", "5"],
    ["boolean", "true"],
  ];

  // Budget values that are not positive safe integers. Note the asymmetry with
  // the env-var guard: "60" and true are JSON-typed, not text, so they are
  // rejected by type before the integer guard ever sees them, while 1e30 is a
  // real JSON number that only the guard's safe-integer bound can reject.
  const INVALID_BUDGETS = [
    ["zero", "0"],
    ["negative", "-1"],
    ["fraction", "1.5"],
    ["quoted number", '"60"'],
    ["boolean", "true"],
    ["overflowing exponent", "1e30"],
  ];

  // withProxy merges proxyEnv over process.env, so omitting a key pins the
  // author's shell rather than absence. undefined drops the key from the
  // child's env entirely, which is what makes these the absent cases.
  test("PROXY_MAX_BUFFERED_BODY_BYTES and PROXY_MODEL_LIMITS_JSON absent start and serve /health", async (t) => {
    const { proxy } = await withProxy(t, {
      proxyEnv: {
        PROXY_MAX_BUFFERED_BODY_BYTES: undefined,
        PROXY_MODEL_LIMITS_JSON: undefined,
      },
    });
    const res = await proxiedFetch(proxy.port, "/health");
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { status: "ok" });
  });

  // JSON.parse("  ") throws, so a blank model-limits value that reached the
  // parser would exit 1 — a blank value crashing startup is the silent rewrite
  // the story names in §12. Number("  ") is 0, so the ceiling's blank check has
  // to precede numeric parsing for the same reason: blank means absent.
  test("PROXY_MAX_BUFFERED_BODY_BYTES and PROXY_MODEL_LIMITS_JSON blank start and serve /health", async (t) => {
    for (const blank of ["", "   ", " \t "]) {
      const proxyEnv = {
        PROXY_MAX_BUFFERED_BODY_BYTES: blank,
        PROXY_MODEL_LIMITS_JSON: blank,
      };
      const { proxy } = await withProxy(t, { proxyEnv });
      const res = await proxiedFetch(proxy.port, "/health");
      assert.equal(res.status, 200, `expected a successful start for ${JSON.stringify(proxyEnv)}`);
    }
  });

  test("PROXY_MAX_BUFFERED_BODY_BYTES at its boundary values starts and serves /health", async (t) => {
    for (const proxyEnv of [
      { PROXY_MAX_BUFFERED_BODY_BYTES: "1" },
      { PROXY_MAX_BUFFERED_BODY_BYTES: "8388608" },
      { PROXY_MAX_BUFFERED_BODY_BYTES: "9007199254740991" },
      { PROXY_MAX_BUFFERED_BODY_BYTES: " 4096 " },
    ]) {
      const { proxy } = await withProxy(t, { proxyEnv });
      const res = await proxiedFetch(proxy.port, "/health");
      assert.equal(res.status, 200, `expected a successful start for ${JSON.stringify(proxyEnv)}`);
    }
  });

  test("PROXY_MAX_BUFFERED_BODY_BYTES rejects a non-blank invalid value, names itself and states its rule", async () => {
    for (const [label, value] of INVALID_CEILINGS) {
      const { code, stderr } = await runProxyOnce({ ...BASE_ENV, PROXY_MAX_BUFFERED_BODY_BYTES: value });
      assert.equal(code, 1, `expected exit 1 for PROXY_MAX_BUFFERED_BODY_BYTES ${label} (${value})`);
      assert.ok(
        stderr.includes("PROXY_MAX_BUFFERED_BODY_BYTES must be a positive integer"),
        `stderr should name PROXY_MAX_BUFFERED_BODY_BYTES and its rule for ${label}: ${stderr}`
      );
      assert.ok(
        stderr.includes(`got: ${value}`),
        `stderr should echo the offending value for ${label}: ${stderr}`
      );
    }
  });

  // This story validates and stores the ceiling; it does not enforce it. A
  // one-byte body ceiling must still pass a request through, so a later slice
  // that starts buffering has to change this test deliberately.
  test("PROXY_MAX_BUFFERED_BODY_BYTES=1 still proxies normally (values validated, not applied)", async (t) => {
    const { proxy, receivedRequests } = await withProxy(t, {
      proxyEnv: { PROXY_MAX_BUFFERED_BODY_BYTES: "1" },
      body: "{}",
    });
    const res = await proxiedFetch(proxy.port, "/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: "Bearer pt",
        "content-type": "application/json",
      },
      body: JSON.stringify({ model: "nemotron" }),
    });
    assert.equal(res.status, 200);
    assert.equal(receivedRequests.length, 1);
  });

  // Four well-formed shapes: both fields, rpm alone, tpm alone, and the empty
  // object — zero models is a well-formed statement that no per-model budget
  // exists, not a missing configuration.
  test("PROXY_MODEL_LIMITS_JSON with well-formed budgets starts and serves /health", async (t) => {
    for (const value of [
      '{"gpt-4o-mini":{"rpm":60,"tpm":100000}}',
      '{"gpt-4o-mini":{"rpm":60}}',
      '{"gpt-4o-mini":{"tpm":100000}}',
      "{}",
    ]) {
      const { proxy } = await withProxy(t, { proxyEnv: { PROXY_MODEL_LIMITS_JSON: value } });
      const res = await proxiedFetch(proxy.port, "/health");
      assert.equal(res.status, 200, `expected a successful start for ${value}`);
    }
  });

  test("PROXY_MODEL_LIMITS_JSON with well-formed budgets still proxies normally (values validated, not applied)", async (t) => {
    const { proxy, receivedRequests } = await withProxy(t, {
      proxyEnv: { PROXY_MODEL_LIMITS_JSON: '{"nemotron":{"rpm":1,"tpm":1}}' },
      body: "{}",
    });
    const res = await proxiedFetch(proxy.port, "/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: "Bearer pt",
        "content-type": "application/json",
      },
      body: JSON.stringify({ model: "nemotron" }),
    });
    assert.equal(res.status, 200);
    assert.equal(receivedRequests.length, 1);
  });

  test("PROXY_MODEL_LIMITS_JSON with bad JSON exits 1 naming the variable", async () => {
    const { code, stderr } = await runProxyOnce({ ...BASE_ENV, PROXY_MODEL_LIMITS_JSON: "{not json" });
    assert.equal(code, 1);
    assert.ok(stderr.includes(NAME), `stderr should name ${NAME}: ${stderr}`);
  });

  test("PROXY_MODEL_LIMITS_JSON with a non-object root exits 1 naming the variable", async () => {
    for (const [label, value] of NON_OBJECT_ROOTS) {
      const { code, stderr } = await runProxyOnce({ ...BASE_ENV, PROXY_MODEL_LIMITS_JSON: value });
      assert.equal(code, 1, `expected exit 1 for a ${label} root (${value})`);
      assert.ok(stderr.includes(NAME), `stderr should name ${NAME} for a ${label} root: ${stderr}`);
    }
  });

  test("PROXY_MODEL_LIMITS_JSON with a blank model key exits 1 naming the variable", async () => {
    for (const [label, value] of [
      ["empty", '{"":{"rpm":5}}'],
      ["spaces", '{"   ":{"rpm":5}}'],
      ["tab", '{"\\t":{"rpm":5}}'],
    ]) {
      const { code, stderr } = await runProxyOnce({ ...BASE_ENV, PROXY_MODEL_LIMITS_JSON: value });
      assert.equal(code, 1, `expected exit 1 for a ${label} model key (${value})`);
      assert.ok(stderr.includes(NAME), `stderr should name ${NAME} for a ${label} model key: ${stderr}`);
    }
  });

  // The model key is in the message because the document can be large: an
  // operator reading only stderr has to be able to find the offending entry.
  test("PROXY_MODEL_LIMITS_JSON with a non-object entry exits 1 naming the variable and the model key", async () => {
    for (const [label, value] of [
      ["number", '{"gpt":5}'],
      ["null", '{"gpt":null}'],
      ["array", '{"gpt":[]}'],
      ["string", '{"gpt":"x"}'],
    ]) {
      const { code, stderr } = await runProxyOnce({ ...BASE_ENV, PROXY_MODEL_LIMITS_JSON: value });
      assert.equal(code, 1, `expected exit 1 for a ${label} entry (${value})`);
      assert.ok(stderr.includes(`${NAME}["gpt"]`), `stderr should name the model key for a ${label} entry: ${stderr}`);
    }
  });

  test("PROXY_MODEL_LIMITS_JSON with an invalid rpm or tpm exits 1 naming the model key and the field", async () => {
    for (const field of ["rpm", "tpm"]) {
      for (const [label, value] of INVALID_BUDGETS) {
        const doc = `{"gpt-4o-mini":{"${field}":${value}}}`;
        const { code, stderr } = await runProxyOnce({ ...BASE_ENV, PROXY_MODEL_LIMITS_JSON: doc });
        assert.equal(code, 1, `expected exit 1 for ${field}=${value} (${label})`);
        assert.ok(
          stderr.includes(`${NAME}["gpt-4o-mini"].${field} must be a positive integer`),
          `stderr should name the model key and field for ${label} ${field}: ${stderr}`
        );
      }
    }
  });

  // An entry that supplies neither field, and an entry whose key was
  // misspelled, are the same failure: a budget that appears to exist and does
  // not. Neither is silently accepted, and neither is partially adopted.
  test("PROXY_MODEL_LIMITS_JSON with an entry that supplies no budget exits 1 naming the model key", async () => {
    for (const [label, value] of [
      ["neither rpm nor tpm", '{"gpt":{}}'],
      ["a misspelled field name", '{"gpt":{"rps":5}}'],
      ["a misspelled field name beside a real one", '{"gpt":{"rpm":5,"rps":1}}'],
    ]) {
      const { code, stderr } = await runProxyOnce({ ...BASE_ENV, PROXY_MODEL_LIMITS_JSON: value });
      assert.equal(code, 1, `expected exit 1 for ${label} (${value})`);
      assert.ok(stderr.includes(`${NAME}["gpt"]`), `stderr should name the model key for ${label}: ${stderr}`);
    }
  });

  // The observable half of "never partially applied": the harness cannot read
  // the stored map, but it can prove the process does not come up, which means
  // the valid half was not adopted alongside the invalid one.
  test("PROXY_MODEL_LIMITS_JSON with one valid and one invalid entry exits 1 (never partially applied)", async () => {
    const { code, stderr } = await runProxyOnce({
      ...BASE_ENV,
      PROXY_MODEL_LIMITS_JSON: '{"gpt-4o-mini":{"rpm":60},"gpt":{"rpm":0}}',
    });
    assert.equal(code, 1);
    assert.ok(stderr.includes(`${NAME}["gpt"].rpm`), `stderr should name the rejected entry: ${stderr}`);
  });

  // Keys are exact, case-sensitive model IDs. Two that differ only in case are
  // two distinct models and both survive, so no lowercasing happens; a key with
  // surrounding spaces can never match anything, so it is fatal rather than
  // trimmed into a match the operator did not write.
  test("PROXY_MODEL_LIMITS_JSON model keys are case-sensitive and unnormalized", async (t) => {
    const { proxy } = await withProxy(t, {
      proxyEnv: { PROXY_MODEL_LIMITS_JSON: '{"Gpt":{"rpm":5},"gpt":{"rpm":6}}' },
    });
    const res = await proxiedFetch(proxy.port, "/health");
    assert.equal(res.status, 200, "keys differing only in case are two distinct models");
  });

  test("PROXY_MODEL_LIMITS_JSON with a model key that has surrounding spaces exits 1 naming the variable", async () => {
    const { code, stderr } = await runProxyOnce({
      ...BASE_ENV,
      PROXY_MODEL_LIMITS_JSON: '{" gpt-4o-mini ":{"rpm":60}}',
    });
    assert.equal(code, 1);
    assert.ok(stderr.includes(NAME), `stderr should name ${NAME}: ${stderr}`);
    assert.ok(stderr.includes("gpt-4o-mini"), `stderr should name the offending model key: ${stderr}`);
  });
});
