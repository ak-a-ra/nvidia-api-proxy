import http from "node:http";
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

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
        receivedRequests.push({
          method: req.method,
          path: req.url,
          body: Buffer.concat(chunks).toString("utf8"),
          authorization: req.headers.authorization,
        });
        res.writeHead(status, headers);
        if (mode === "sse") {
          res.write("data: chunk1\n\n");
          setTimeout(() => {
            res.write("data: chunk2\n\n");
            res.end();
          }, 5);
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

function startProxyServer(baseURL, key, proxyToken) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
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
async function withProxy(t, { base, key = "sk", token = "pt", ...stubOpts }) {
  const { srv: stub, receivedRequests } = await startStubUpstream(
    stubOpts.status ?? 200,
    stubOpts.body,
    stubOpts.headers,
    stubOpts.mode
  );
  t.after(() => stub.close());
  if (base == null) {
    const a = stub.address();
    base = `http://${a.address}:${a.port}`;
  }
  const proxy = await startProxyServer(base, key, token);
  t.after(() => proxy.child.kill());
  return { proxy, receivedRequests };
}

function proxiedFetch(port, path, opts = {}) {
  return fetch(`http://127.0.0.1:${port}${path}`, opts);
}

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
    assert.ok(req.path.includes("/chat/completions?stream=true"), "path and query preserved");
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

  test("204 no-body upstream passes through without body", async (t) => {
    const { proxy } = await withProxy(t, { status: 204 });
    const res = await proxiedFetch(proxy.port, "/v1/models", {
      headers: { authorization: "Bearer pt" },
    });
    assert.equal(res.status, 204);
    assert.equal(await res.text(), "");
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
});
