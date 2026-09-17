import http from "node:http";
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

// Stub upstream: records requests, returns canned responses, can be told to
// stream SSE, return multi-value set-cookie, abort mid-stream, or be unreachable.
// Test scaffolding, not production code.
const receivedRequests = [];

function startStubUpstream(status, body, headers, mode) {
  return new Promise((resolve) => {
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
    srv.listen(0, "127.0.0.1", () => resolve(srv));
  });
}

// address().address is only the host; the proxy needs host:port.
function stubBase(stub) {
  const a = stub.address();
  return `http://${a.address}:${a.port}`;
}

// Spawn a fresh server.js in a child process so module-level env reads (which
// run at import time) pick up per-test configuration. server.js calls
// server.listen at import, so we just report the port back over IPC.
const SERVER_PATH = new URL("./server.js", import.meta.url).pathname;

function startProxyServer(baseURL, key, proxyToken) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    if (baseURL !== undefined) env.NVIDIA_BASE_URL = baseURL;
    if (key !== undefined) env.NVIDIA_API_KEY = key;
    if (proxyToken !== undefined) env.PROXY_AUTH_TOKEN = proxyToken;
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

function proxiedFetch(port, path, opts = {}) {
  return fetch(`http://127.0.0.1:${port}${path}`, opts);
}

describe("proxy", () => {
  test("POST body forwarded byte-identical + query preserved + auth replaced upstream", async (t) => {
    const stub = await startStubUpstream(200, JSON.stringify({ ok: true, echoed: "body" }), {
      "content-type": "application/json",
    });
    t.after(() => {
      stub.close();
      stub.closeAllConnections();
    });
    const proxy = await startProxyServer(stubBase(stub), "sk-test", "pt-secret");
    t.after(() => proxy.child.kill());
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
    const stub = await startStubUpstream(200);
    t.after(() => stub.close());
    const proxy = await startProxyServer(stubBase(stub), "sk", "pt");
    t.after(() => proxy.child.kill());
    const res = await proxiedFetch(proxy.port, "/health");
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { status: "ok" });
  });

  test("health 503 when unconfigured (missing proxy token)", async (t) => {
    const stub = await startStubUpstream(200);
    t.after(() => stub.close());
    const proxy = await startProxyServer(stubBase(stub), "sk", undefined);
    t.after(() => proxy.child.kill());
    const res = await proxiedFetch(proxy.port, "/health");
    assert.equal(res.status, 503);
  });

  test("401 without proxy auth token", async (t) => {
    const stub = await startStubUpstream(200);
    t.after(() => stub.close());
    const proxy = await startProxyServer(stubBase(stub), "sk", "pt-secret");
    t.after(() => proxy.child.kill());
    const res = await proxiedFetch(proxy.port, "/v1/models");
    assert.equal(res.status, 401);
  });

  test("404 for non-/v1 paths", async (t) => {
    const stub = await startStubUpstream(200);
    t.after(() => stub.close());
    const proxy = await startProxyServer(stubBase(stub), "sk", "pt");
    t.after(() => proxy.child.kill());
    const res = await proxiedFetch(proxy.port, "/foo", {
      headers: { authorization: "Bearer pt" },
    });
    assert.equal(res.status, 404);
  });

  test("bare /v1 and /v1/ accepted as proxy roots", async (t) => {
    const stub = await startStubUpstream(200, JSON.stringify({ data: [] }), {
      "content-type": "application/json",
    });
    t.after(() => stub.close());
    const proxy = await startProxyServer(stubBase(stub), "sk", "pt");
    t.after(() => proxy.child.kill());
    for (const path of ["/v1", "/v1/"]) {
      const res = await proxiedFetch(proxy.port, path, {
        headers: { authorization: "Bearer pt" },
      });
      assert.equal(res.status, 200, `expected 200 for ${path}, got ${res.status}`);
    }
  });

  test("multi-value set-cookie preserved (not merged)", async (t) => {
    const stub = await startStubUpstream(200, "x", {
      "content-type": "text/plain",
      "set-cookie": ["a=1; Path=/", "b=2; Path=/"],
    });
    t.after(() => stub.close());
    const proxy = await startProxyServer(stubBase(stub), "sk", "pt");
    t.after(() => proxy.child.kill());
    const res = await proxiedFetch(proxy.port, "/v1/models", {
      headers: { authorization: "Bearer pt" },
    });
    const cookies = res.headers.getSetCookie();
    assert.deepEqual(cookies, ["a=1; Path=/", "b=2; Path=/"]);
  });

  test("SSE streamed through unbuffered", async (t) => {
    const stub = await startStubUpstream(200, undefined, {
      "content-type": "text/event-stream",
    }, "sse");
    t.after(() => stub.close());
    const proxy = await startProxyServer(stubBase(stub), "sk", "pt");
    t.after(() => proxy.child.kill());
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
    const stub = await startStubUpstream(404, JSON.stringify({ error: "not found" }), {
      "content-type": "application/json",
    });
    t.after(() => stub.close());
    const proxy = await startProxyServer(stubBase(stub), "sk", "pt");
    t.after(() => proxy.child.kill());
    const res = await proxiedFetch(proxy.port, "/v1/missing", {
      method: "POST",
      headers: { authorization: "Bearer pt", "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { error: "not found" });
  });

  test("mid-stream upstream failure does not crash the process", async (t) => {
    const stub = await startStubUpstream(200, undefined, {
      "content-type": "text/plain",
    }, "midabort");
    t.after(() => stub.close());
    const proxy = await startProxyServer(stubBase(stub), "sk", "pt");
    t.after(() => proxy.child.kill());
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
    const proxy = await startProxyServer("http://127.0.0.1:1", "sk", "pt");
    t.after(() => proxy.child.kill());
    const res = await proxiedFetch(proxy.port, "/v1/models", {
      headers: { authorization: "Bearer pt" },
    });
    assert.equal(res.status, 502);
    const body = await res.json();
    assert.deepEqual(body, { error: "Bad gateway" });
    assert.equal(body.message, undefined);
  });

  test("wrong auth token rejected", async (t) => {
    const stub = await startStubUpstream(200, JSON.stringify({ data: [] }), {
      "content-type": "application/json",
    });
    t.after(() => stub.close());
    const proxy = await startProxyServer(stubBase(stub), "sk", "pt-secret");
    t.after(() => proxy.child.kill());
    const res = await proxiedFetch(proxy.port, "/v1/models", {
      headers: { authorization: "Bearer wrong-token" },
    });
    assert.equal(res.status, 401);
  });
});
