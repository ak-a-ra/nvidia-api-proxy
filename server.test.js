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
        if (body !== undefined) res.end(body, "utf8");
        else res.end();
      });
    });
    srv.listen(0, "127.0.0.1", () => resolve({ srv, receivedRequests }));
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
        process.send({ port: server.address().port });
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
      else resolve({ child, port: msg.port });
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
  const { srv: stub, receivedRequests } = await startStubUpstream(
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
  return { proxy, receivedRequests };
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
});
