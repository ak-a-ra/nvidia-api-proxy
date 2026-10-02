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
    // One record per arriving request, in arrival order. Registered at request
    // entry (not in the `end` handler) so a request aborted mid-body still
    // produces a record.
    const teardowns = [];
    const srv = http.createServer((req, res) => {
      let resolveClosed;
      const record = {
        reqAborted: false,
        reqClosed: false,
        resClosed: false,
        resFinished: false,
        closed: new Promise((resolve) => {
          resolveClosed = resolve;
        }),
      };
      teardowns.push(record);
      req.on("aborted", () => (record.reqAborted = true));
      req.on("close", () => (record.reqClosed = true));
      res.on("close", () => {
        record.resClosed = true;
        resolveClosed(record);
      });
      res.on("finish", () => (record.resFinished = true));
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
    srv.listen(0, "127.0.0.1", () =>
      resolve({ srv, receivedRequests, teardowns })
    );
  });
}

// Spawn a fresh server.js in a child process so module-level env reads (which
// run at import time) pick up per-test configuration. server.js calls
// server.listen at import, so we just report the port back over IPC.
const SERVER_PATH = new URL("./server.js", import.meta.url).pathname;

// Every variable server.js and config.js read at import time. A spawned child
// must never inherit one of these from the ambient shell: the suite asserts on
// startup behavior for each of them, so an operator's exported value would
// decide the result (an ambient PROXY_RPM=5 makes every fatal-config child exit
// 1, and an ambient PROXY_AUTH_TOKEN satisfies the credential that a test meant
// to leave unset). Stripped, then re-added only by the test that asked for it.
const CONFIG_ENV_VARS = [
  "PORT",
  "NVIDIA_BASE_URL",
  "NVIDIA_API_KEY",
  "PROXY_AUTH_TOKEN",
  "PROXY_HOST",
  "PROXY_RPM",
  "PROXY_TPM",
  "PROXY_MAX_CONCURRENT_REQUESTS",
  "PROXY_MAX_QUEUE_SIZE",
  "PROXY_QUEUE_TIMEOUT_SECONDS",
  "PROXY_SAFETY_MARGIN_PCT",
  "PROXY_MAX_BUFFERED_BODY_BYTES",
  "PROXY_MODEL_LIMITS_JSON",
  "PROXY_LOG_REQUESTS",
  "UPSTREAM_CONNECT_TIMEOUT_SECONDS",
  "UPSTREAM_IDLE_TIMEOUT_SECONDS",
];

// The child's environment: everything ambient except the variables the proxy
// reads, then the test's own overrides on top. An override of undefined stays
// unset, because spawn skips undefined env values.
function childEnv(overrides = {}) {
  const env = { ...process.env };
  for (const name of CONFIG_ENV_VARS) delete env[name];
  return { ...env, ...overrides };
}

// options.captureStdout pipes the child's stdout into this process and exposes
// it as stdout(); the default keeps it ignored, because a test that does not
// assert on the proxy's log output should not pay for a pipe. Every assertion
// about a request log line needs it: without it "no secret in the log" would
// be a claim about a stream nobody can read.
function startProxyServer(baseURL, key, proxyToken, extraEnv = {}, options = {}) {
  return new Promise((resolve, reject) => {
    const { captureStdout = false, logThrows = false } = options;
    const env = childEnv(extraEnv);
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

    // logThrows replaces the global console.log before server.js is imported,
    // so every write it attempts fails the way a closed or full stdout fails.
    // The startup banner is let through: it is written before the test's first
    // request, and a throw inside the listen callback would kill the child for
    // a reason the test is not about. console is a global object, so the patch
    // is visible to server.js's own console.log call site.
    const initLogThrows = `
      const realLog = console.log;
      console.log = (...args) => {
        if (String(args[0]).startsWith("NVIDIA API proxy listening")) return realLog(...args);
        throw new Error("stdout unavailable");
      };
      const { default: server } = await import(${JSON.stringify(SERVER_PATH)});
      server.on("listening", () => {
        const bound = server.address();
        process.send({ port: bound.port, address: bound.address });
      });
      server.on("error", (e) => process.send({ error: e.message }));
    `;

    const child = spawn(
      process.execPath,
      ["--input-type=module", "-e", logThrows ? initLogThrows : init],
      {
        env,
        stdio: ["ignore", captureStdout ? "pipe" : "ignore", "ignore", "ipc"],
      }
    );

    const chunks = [];
    if (child.stdout) child.stdout.on("data", (d) => chunks.push(d));

    const timer = setTimeout(() => reject(new Error("proxy did not start")), 3000);
    timer.unref();

    child.on("message", (msg) => {
      if (msg.error) reject(new Error(msg.error));
      else
        resolve({
          child,
          port: msg.port,
          address: msg.address,
          stdout: () => Buffer.concat(chunks).toString("utf8"),
        });
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code !== 0) reject(new Error(`proxy exited ${code}`));
    });
  });
}

// Start a stub upstream and a proxy child pointing at it; both cleanups are
// registered on the test context (LIFO: child killed before stub closed).
// proxyOpts is forwarded to startProxyServer (captureStdout, logThrows); base
// is returned so a test can name the upstream host it must never see in a log.
async function withProxy(t, { base, baseSuffix = "/v1", key = "sk", token = "pt", proxyEnv = {}, proxyOpts = {}, ...stubOpts }) {
  const { srv: stub, receivedRequests, teardowns } = await startStubUpstream(
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
  const proxy = await startProxyServer(base, key, token, proxyEnv, proxyOpts);
  t.after(() => proxy.child.kill());
  return { proxy, receivedRequests, teardowns, base };
}

// Wait for the first arriving upstream request's response to be torn down
// (closed without finishing), then assert the abort actually happened. The
// timeout only exists to fail fast on regression; the failure message names
// the lifecycle flags observed so the cause is diagnosable from test output.
async function assertUpstreamAborted(teardowns, timeoutMs = 2000) {
  const record = teardowns[0];
  assert.ok(record, "upstream received a request");
  let timer;
  const timedOut = await Promise.race([
    record.closed.then(() => false),
    new Promise((resolve) => {
      timer = setTimeout(() => resolve(true), timeoutMs);
      timer.unref();
    }),
  ]);
  clearTimeout(timer);
  const flags =
    `reqAborted=${record.reqAborted} reqClosed=${record.reqClosed} ` +
    `resClosed=${record.resClosed} resFinished=${record.resFinished}`;
  assert.ok(!timedOut, `upstream response was not torn down within ${timeoutMs}ms (${flags})`);
  assert.equal(record.resClosed, true, `upstream response closed (${flags})`);
  // A normal completion emits finish before close; only an abort skips it.
  assert.equal(record.resFinished, false, `upstream response aborted, not completed (${flags})`);
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
        env: childEnv({ ...envOverrides, PORT: "0" }),
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

  // Non-leak invariant, token side: auth is checked before the unconfigured
  // flag regardless of which credential is missing. A proxy whose only
  // problem is an absent PROXY_AUTH_TOKEN must answer 401 on /v1/*, never
  // 503 — and must reject before contacting the upstream.
  test("unauthenticated request gets 401 (not 503) when only the proxy token is missing", async (t) => {
    const { proxy, receivedRequests } = await withProxy(t, { token: null });
    const res = await proxiedFetch(proxy.port, "/v1/models", {
      headers: { authorization: "Bearer whatever" },
    });
    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), { error: "Unauthorized" });
    assert.equal(receivedRequests.length, 0);
  });

  // Whitespace-only credentials count as missing (server.js uses .trim());
  // the API-key side is pinned by the tests passing key: " ". Pin the token
  // side: a whitespace token behaves like an absent one. Only the /health
  // assertion below depends on .trim() — the 401 holds either way.
  test("whitespace-only proxy token counts as missing (401 + health 503)", async (t) => {
    const { proxy, receivedRequests } = await withProxy(t, { token: "   " });
    const res = await proxiedFetch(proxy.port, "/v1/models", {
      headers: { authorization: "Bearer whatever" },
    });
    assert.equal(res.status, 401);
    assert.equal(receivedRequests.length, 0);

    const health = await proxiedFetch(proxy.port, "/health");
    assert.equal(health.status, 503);
    assert.deepEqual(await health.json(), { status: "unconfigured" });
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
    const { proxy, receivedRequests, teardowns } = await withProxy(t, {
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
    // upstream request teardown, not the downstream fetch result.
    controller.abort();
    req.catch(() => {});
    // The upstream response must be closed, not finished: the proxy aborted
    // its fetch instead of letting the upstream request complete.
    await assertUpstreamAborted(teardowns);
    // Proxy must survive: a subsequent health check proves availability.
    const health = await fetch(`http://127.0.0.1:${proxy.port}/health`);
    assert.equal(health.status, 200);
    assert.equal(proxy.child.exitCode, null, "proxy survives downstream disconnect");
  });

  test("downstream disconnect aborts active upstream stream", async (t) => {
    const { proxy, receivedRequests, teardowns } = await withProxy(t, {
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
    // The upstream stream must be closed, not finished — the proxy must abort
    // its fetch rather than drain the upstream response.
    await assertUpstreamAborted(teardowns);
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

  // Whitespace-only is absence, not a number. Number("  ") is 0, and 0 is a
  // legal value for two of the four variables — it disables the concurrency
  // ceiling and is the low end of the margin's 0-50 range — so a blank value
  // that reached a numeric guard would read as a supplied 0 instead of an
  // unset variable. The blank check has to come first, and these tests are the
  // only place in the suite that says so.
  //
  // What the harness can actually prove is narrower than "starts" suggests.
  // The config object is invisible to a child-process test, so a proxy coming
  // up does not show which branch was taken: a blank concurrency ceiling and
  // an explicit 0 produce the same observable startup. The falsifiable half is
  // the two variables whose 0 is fatal, PROXY_MAX_QUEUE_SIZE and
  // PROXY_QUEUE_TIMEOUT_SECONDS, pinned by the zero test above. Read as a
  // number, whitespace exits 1 on those two and the test below fails; read as
  // absent, both take their documented defaults and start. No test here claims
  // whitespace reaches the same internal state as 0, and none can — that would
  // need a second seam this story forbids.
  test("PROXY_MAX_QUEUE_SIZE and PROXY_QUEUE_TIMEOUT_SECONDS whitespace-only starts and serves /health, where 0 is fatal", async (t) => {
    for (const blank of ["", "   ", " \t "]) {
      const { proxy } = await withProxy(t, {
        proxyEnv: {
          PROXY_MAX_QUEUE_SIZE: blank,
          PROXY_QUEUE_TIMEOUT_SECONDS: blank,
        },
      });
      const res = await proxiedFetch(proxy.port, "/health");
      assert.equal(res.status, 200, `expected a successful start for ${JSON.stringify(blank)}`);
    }
  });

  // The same rule on the variable whose 0 is a legal disable rather than fatal.
  // A blank ceiling must start, and it does — but a start alone cannot separate
  // the absent path from the zero-disables path, so this pins only that a
  // whitespace value never reaches the integer guard, where it would be
  // rejected rather than adopted. The 0-disables behavior itself is pinned by
  // its own test above.
  test("PROXY_MAX_CONCURRENT_REQUESTS whitespace-only starts and serves /health", async (t) => {
    for (const blank of ["", "   ", " \t "]) {
      const { proxy } = await withProxy(t, {
        proxyEnv: { PROXY_MAX_CONCURRENT_REQUESTS: blank },
      });
      const res = await proxiedFetch(proxy.port, "/health");
      assert.equal(res.status, 200, `expected a successful start for ${JSON.stringify(blank)}`);
    }
  });

  // The margin's ends stay pinned where they are: 0 and 50 start, 51, 100 and
  // -1 exit 1. A blank margin belongs on the absent side of that range rather
  // than on its 0 end; the range guard rejects a whitespace value outright, so
  // reaching it is a crash rather than a silent default. Nothing here weakens
  // the boundary test.
  test("PROXY_SAFETY_MARGIN_PCT whitespace-only starts and serves /health", async (t) => {
    for (const blank of ["", "   ", " \t "]) {
      const { proxy } = await withProxy(t, {
        proxyEnv: { PROXY_SAFETY_MARGIN_PCT: blank },
      });
      const res = await proxiedFetch(proxy.port, "/health");
      assert.equal(res.status, 200, `expected a successful start for ${JSON.stringify(blank)}`);
    }
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
    ]) {
      const { proxy } = await withProxy(t, { proxyEnv });
      const res = await proxiedFetch(proxy.port, "/health");
      assert.equal(res.status, 200, `expected a successful start for ${JSON.stringify(proxyEnv)}`);
    }
  });

  // Padded, not a boundary: the guard trims before it checks, so " 4096 " is
  // the same ceiling as "4096". Separate from the boundary test so the padding
  // case is pinned by a test whose name claims it.
  test("PROXY_MAX_BUFFERED_BODY_BYTES with surrounding spaces starts and serves /health", async (t) => {
    for (const proxyEnv of [
      { PROXY_MAX_BUFFERED_BODY_BYTES: " 4096 " },
      { PROXY_MAX_BUFFERED_BODY_BYTES: " 8388608\t" },
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

  // The scalar guards echo operator text rather than a JSON-shaped value, so
  // they need the bound on their own path: a 100,000-digit PROXY_RPM used to
  // put 100,044 bytes on one stderr line. Same rule as describeValue, reached
  // through boundText. The under-300-byte ceiling is the assertion that fails
  // without the fix — the message is not a crash, so nothing else here would
  // notice. Short values are unaffected: the 30-digit row in INVALID_CEILINGS
  // asserts `got: <value>` verbatim and stays green.
  test("a long invalid ceiling is echoed bounded, not in full", async () => {
    const digits = "1".repeat(100_000);
    const { code, stderr } = await runProxyOnce({
      ...BASE_ENV,
      PROXY_MAX_BUFFERED_BODY_BYTES: digits,
    });
    assert.equal(code, 1, "a 100,000-digit ceiling is not a safe integer");
    assert.ok(
      stderr.includes("PROXY_MAX_BUFFERED_BODY_BYTES must be a positive integer"),
      `stderr should still name the variable and its rule: ${stderr.length} bytes`
    );
    assert.ok(
      stderr.includes(`got: ${"1".repeat(60)}…`),
      `stderr should echo the value bounded at 60 characters with an ellipsis: ${stderr.length} bytes`
    );
    assert.equal(stderr.trim().split("\n").length, 1, "stderr must stay on one line");
    assert.ok(stderr.length < 300, `stderr must stay short, got ${stderr.length} bytes`);
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
  // the valid half was not adopted alongside the invalid one. Both orderings,
  // because the guard has to fire whichever entry the parser hands over first —
  // a refactor that collected the valid entries before validating them would
  // pass a table holding only the invalid-last row.
  test("PROXY_MODEL_LIMITS_JSON with one valid and one invalid entry exits 1 (never partially applied)", async () => {
    for (const doc of [
      '{"gpt-4o-mini":{"rpm":60},"gpt":{"rpm":0}}',
      '{"gpt":{"rpm":0},"gpt-4o-mini":{"rpm":60}}',
    ]) {
      const { code, stderr } = await runProxyOnce({ ...BASE_ENV, PROXY_MODEL_LIMITS_JSON: doc });
      assert.equal(code, 1, `expected exit 1 for ${doc}`);
      assert.ok(stderr.includes(`${NAME}["gpt"].rpm`), `stderr should name the rejected entry: ${stderr}`);
    }
  });

  // A model ID cannot contain a control character either, so the same rule that
  // rejects a padded key rejects this one. The document escapes the byte, so
  // the parsed key really holds it: written raw, JSON.parse rejects the whole
  // document as bad JSON first and the key check is never reached. The message
  // names the code point in escaped form and never echoes the raw byte, so
  // stderr stays one line and cannot carry an escape into a terminal.
  test("PROXY_MODEL_LIMITS_JSON with a control character in a model key exits 1 naming the byte, not the raw byte", async () => {
    for (const point of ["U+0001", "U+001B", "U+007F"]) {
      // The JSON text carries the byte as an escape, so JSON.parse hands the key
      // the raw character; `raw` is that character, for the assertion that stderr
      // never echoes it.
      const hex = point.slice(2);
      const raw = String.fromCharCode(parseInt(hex, 16));
      const doc = `{"gpt\\u${hex}x":{"rpm":5}}`;
      const { code, stderr } = await runProxyOnce({ ...BASE_ENV, PROXY_MODEL_LIMITS_JSON: doc });
      assert.equal(code, 1, `expected exit 1 for a ${point} model key`);
      assert.ok(
        stderr.includes(`control character: ${point}`),
        `stderr should name the offending code point ${point}: ${JSON.stringify(stderr)}`
      );
      assert.ok(
        !stderr.includes(raw),
        `stderr must not echo the raw ${point} byte: ${JSON.stringify(stderr)}`
      );
      assert.equal(
        stderr.trim().split("\n").length,
        1,
        `stderr must stay on one line for a ${point} key: ${JSON.stringify(stderr)}`
      );
    }
  });

  // The fatal path must survive a pathological document. A JSON.stringify of the
  // offending value recurses without bound, so deep nesting used to throw
  // RangeError inside the fatal path: the process still exited 1, but stderr was
  // a stack dump quoting the source line, which names the variable and the rule
  // by accident. So nothing here may assert the variable name alone — the
  // interpolated field path is the assertion the dump cannot fake, and the
  // stack-dump and length checks pin both the crash and the flood. The long
  // string row pins the same bound on the other branch: a primitive is echoed,
  // but not in full.
  test("PROXY_MODEL_LIMITS_JSON with a pathological budget value exits 1 with a bounded one-line message, not a crash", async () => {
    const nested = (depth) => `{"a":${'{"a":'.repeat(depth - 1)}1${"}".repeat(depth - 1)}}`;
    for (const [label, doc, shown] of [
      ["2,000 levels of nesting", `{"gpt":{"rpm":${nested(2000)}}}`, "an object"],
      ["7,000 levels of nesting", `{"gpt":{"rpm":${nested(7000)}}}`, "an object"],
      ["a 5,000-character string value", `{"gpt":{"rpm":"${"x".repeat(5000)}"}}`, "…"],
    ]) {
      const { code, stderr } = await runProxyOnce({ ...BASE_ENV, PROXY_MODEL_LIMITS_JSON: doc });
      assert.equal(code, 1, `expected exit 1 for ${label}`);
      assert.ok(
        stderr.includes(`${NAME}["gpt"].rpm must be a positive integer`),
        `stderr should carry the interpolated field path for ${label}: ${JSON.stringify(stderr)}`
      );
      assert.ok(
        stderr.includes(shown),
        `stderr should report ${shown} for ${label}: ${JSON.stringify(stderr)}`
      );
      for (const marker of ["RangeError", "Maximum call stack size exceeded", "at JSON.stringify", "${model}"]) {
        assert.ok(!stderr.includes(marker), `stderr must be a message, not a stack dump (${marker}) for ${label}: ${JSON.stringify(stderr)}`);
      }
      assert.equal(stderr.trim().split("\n").length, 1, `stderr must stay on one line for ${label}`);
      assert.ok(stderr.length < 300, `stderr must stay short for ${label}, got ${stderr.length} bytes`);
    }
  });

  // Keys are exact model IDs, stored byte for byte: never trimmed, never
  // lowercased. Two that differ only in case are two distinct models, and the
  // document is accepted whole rather than rejected as a duplicate. The 200
  // proves acceptance only; the stored map is invisible to this harness (ADR
  // 0002), and a mutation that lowercased at the assignment would leave it
  // green. So the case claim is pinned where it is observable instead: the
  // fatal path echoes the offending key, and an uppercase key echoed as
  // `"GPT "` cannot have been lowercased anywhere on the way there. What stays
  // reviewed-by-eye is the map that key is eventually copied into.
  test("PROXY_MODEL_LIMITS_JSON model keys are case-sensitive and unnormalized", async (t) => {
    const { proxy } = await withProxy(t, {
      proxyEnv: { PROXY_MODEL_LIMITS_JSON: '{"Gpt":{"rpm":5},"gpt":{"rpm":6}}' },
    });
    const res = await proxiedFetch(proxy.port, "/health");
    assert.equal(res.status, 200, "keys differing only in case are two distinct models, not a duplicate");

    // Same document shape, one fatal key: uppercase is carried into the message
    // unchanged, so nothing along the path normalized it.
    const { code, stderr } = await runProxyOnce({
      ...BASE_ENV,
      PROXY_MODEL_LIMITS_JSON: '{"GPT ":{"rpm":5}}',
    });
    assert.equal(code, 1, "a padded key is fatal whatever its case");
    assert.ok(
      stderr.includes('model key "GPT " has surrounding spaces'),
      `stderr must echo the key byte for byte, uppercase included: ${JSON.stringify(stderr)}`
    );
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

// The suite must decide its own outcome. Every assertion above is about what a
// child does with the environment the test handed it, so an operator's exported
// value must never reach that child: an ambient PROXY_SAFETY_MARGIN_PCT=51 makes
// every fatal case start instead of exiting 1, an ambient PROXY_RPM=5 makes every
// fatal case exit 1 for the wrong reason, and an ambient PROXY_AUTH_TOKEN
// satisfies a credential a test meant to leave unset (null means leave-unset,
// not remove). The harness owns that, because config.js reading its own
// environment is correct production behavior and silencing it there would hide
// a real deployment mistake.
describe("harness environment isolation", () => {
  // Every value below is fatal or absent-changing on its own, so a leaked one
  // cannot fail quietly: each would change a startup outcome on the next spawn.
  const AMBIENT = {
    PROXY_SAFETY_MARGIN_PCT: "51",
    PROXY_RPM: "5",
    PROXY_MAX_QUEUE_SIZE: "0",
    PROXY_MAX_BUFFERED_BODY_BYTES: "0",
    PROXY_MODEL_LIMITS_JSON: "{",
    PROXY_HOST: "10.255.255.1",
  };

  // Mutating process.env in-process is safe here and nowhere else: the child
  // reads its own environment at import time, and the values are restored
  // synchronously right after the spawn, before any other test runs.
  function withAmbientEnv(vars) {
    const saved = {};
    for (const [name, value] of Object.entries(vars)) {
      saved[name] = process.env[name];
      process.env[name] = value;
    }
    return () => {
      for (const [name, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    };
  }

  test("an ambient fatal value does not stop a child the test configured cleanly", async (t) => {
    const restore = withAmbientEnv(AMBIENT);
    let proxy;
    try {
      ({ proxy } = await withProxy(t, {}));
    } finally {
      restore();
    }
    const res = await proxiedFetch(proxy.port, "/health");
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { status: "ok" });
  });

  test("an ambient PROXY_AUTH_TOKEN does not satisfy a credential the test left unset", async (t) => {
    const restore = withAmbientEnv({ PROXY_AUTH_TOKEN: "ambient-token" });
    let proxy;
    try {
      ({ proxy } = await withProxy(t, { token: null }));
    } finally {
      restore();
    }
    const res = await proxiedFetch(proxy.port, "/health");
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), { status: "unconfigured" });
  });

  // The fatal cases are the half that breaks in the other direction: an ambient
  // PROXY_MODEL_LIMITS_JSON="{" (or PROXY_RPM=5, or a margin of 51) turns every
  // child into an exit 1, so an assertion like the ones above would pass on the
  // wrong reason. Naming the variable the test asked to be rejected, and
  // refusing to name any other, is what makes the exit mean what it claims.
  test("a fatal case exits 1 for the variable the test named, not an ambient one", async () => {
    const restore = withAmbientEnv(AMBIENT);
    let result;
    try {
      result = await runProxyOnce({
        NVIDIA_BASE_URL: "https://example.com/v1",
        NVIDIA_API_KEY: "k",
        PROXY_AUTH_TOKEN: "t",
        PROXY_MAX_QUEUE_SIZE: "0",
      });
    } finally {
      restore();
    }
    assert.equal(result.code, 1);
    assert.match(result.stderr, /PROXY_MAX_QUEUE_SIZE/);
    for (const name of ["PROXY_MODEL_LIMITS_JSON", "PROXY_RPM", "PROXY_SAFETY_MARGIN_PCT"]) {
      assert.ok(
        !result.stderr.includes(name),
        `an ambient ${name} must not be the reason: ${result.stderr}`
      );
    }
  });

  // Targeted, not a wholesale wipe: the child still needs PATH, HOME and the
  // rest of the shell to exec node and resolve a stub upstream.
  test("childEnv strips the variables the proxy reads and inherits the rest", () => {
    const restore = withAmbientEnv({ ...AMBIENT, PROXY_AUTH_TOKEN: "ambient", PATH: "/usr/bin" });
    let env;
    try {
      env = childEnv({ PROXY_RPM: "60" });
    } finally {
      restore();
    }
    for (const name of CONFIG_ENV_VARS) {
      if (name === "PROXY_RPM") continue;
      assert.equal(env[name], undefined, `${name} must not be inherited`);
    }
    assert.equal(env.PROXY_RPM, "60", "an explicit test value still wins");
    assert.equal(env.PATH, "/usr/bin", "unrelated ambient variables are inherited");
  });
});

// Opt-in request logging (PROXY_LOG_REQUESTS). Every assertion here is about a
// line the child wrote to stdout, so each of these children is spawned with
// proxyOpts: { captureStdout: true } — the harness ignores stdout by default,
// and a privacy claim about a log nobody can read is not a test.
describe("request logging", () => {
  const LOG = { PROXY_LOG_REQUESTS: "1" };

  // The startup banner is the proxy's only pre-existing stdout output, so a
  // request log line is exactly a line that starts a JSON object. Parsing it is
  // also what pins requirement "a destroyed response emits no malformed line".
  function logLines(proxy) {
    return proxy
      .stdout()
      .split("\n")
      .filter((line) => line.startsWith("{"))
      .map((line) => JSON.parse(line));
  }

  // A log line is written on the response's close event, which can land after
  // the client already holds the response body, so asserting on it means
  // waiting for it rather than assuming it is there. The timeout only exists
  // to fail fast on regression; the message carries what was written.
  async function waitForLines(proxy, count, timeoutMs = 3000) {
    const deadline = Date.now() + timeoutMs;
    let lines = logLines(proxy);
    while (lines.length < count && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 10));
      lines = logLines(proxy);
    }
    assert.ok(
      lines.length >= count,
      `expected ${count} request log line(s), saw ${lines.length}: ${JSON.stringify(proxy.stdout())}`
    );
    return lines;
  }

  const settle = (ms) => new Promise((r) => setTimeout(r, ms));

  // Off is four different states of the same variable, and all four must be
  // indistinguishable from a build without the feature: no line, no listener,
  // no clock. Unset is passed as undefined because withProxy merges proxyEnv
  // over process.env, so omitting the key would pin the author's shell.
  test("logging is off by default: unset, blank, 0 and false write no request log line", async (t) => {
    for (const proxyEnv of [
      { PROXY_LOG_REQUESTS: undefined },
      { PROXY_LOG_REQUESTS: "" },
      { PROXY_LOG_REQUESTS: "   " },
      { PROXY_LOG_REQUESTS: "0" },
      { PROXY_LOG_REQUESTS: "false" },
    ]) {
      const { proxy } = await withProxy(t, {
        proxyEnv,
        proxyOpts: { captureStdout: true },
        body: JSON.stringify({ ok: true }),
      });
      const res = await proxiedFetch(proxy.port, "/v1/models", {
        headers: { authorization: "Bearer pt" },
      });
      assert.equal(res.status, 200);
      await res.text();
      await settle(150); // the line, if there were one, is written by now
      assert.deepEqual(
        logLines(proxy),
        [],
        `no request log line for ${JSON.stringify(proxyEnv)}: ${JSON.stringify(proxy.stdout())}`
      );
    }
  });

  // Both directions of the vocabulary, so the strict truthy set is pinned as a
  // set rather than by one spelling: a rule that accepted "yes" but rejected
  // "1" (or a falsy set that ignored "no") would pass a narrower test.
  test("PROXY_LOG_REQUESTS accepts its documented truthy and falsy words", async (t) => {
    for (const value of ["1", "true", "yes", "on", "TRUE", "On"]) {
      const { proxy } = await withProxy(t, {
        proxyEnv: { PROXY_LOG_REQUESTS: value },
        proxyOpts: { captureStdout: true },
        body: JSON.stringify({ ok: true }),
      });
      const res = await proxiedFetch(proxy.port, "/health");
      await res.text();
      const [line] = await waitForLines(proxy, 1);
      assert.equal(line.path, "/health", `expected ${value} to enable logging`);
      proxy.child.kill();
    }
    for (const value of ["0", "false", "no", "off", "FALSE", "Off"]) {
      const { proxy } = await withProxy(t, {
        proxyEnv: { PROXY_LOG_REQUESTS: value },
        proxyOpts: { captureStdout: true },
        body: JSON.stringify({ ok: true }),
      });
      const res = await proxiedFetch(proxy.port, "/health");
      assert.equal(res.status, 200);
      await res.text();
      await settle(150);
      assert.deepEqual(
        logLines(proxy),
        [],
        `expected ${value} to disable logging: ${JSON.stringify(proxy.stdout())}`
      );
      proxy.child.kill();
    }
  });

  // The rule is a closed vocabulary, so a typo is fatal rather than a guess.
  // ADR 0002's regime for operational variables, and the standing rule from
  // that ADR applies: assert the interpolated message, not the variable name
  // alone, so a stack dump cannot pass this by quoting the source line.
  test("PROXY_LOG_REQUESTS with a non-blank invalid value exits 1 naming the variable and its rule", async () => {
    const BASE_ENV = {
      NVIDIA_BASE_URL: "https://example.com/v1",
      NVIDIA_API_KEY: "k",
      PROXY_AUTH_TOKEN: "t",
    };
    for (const value of ["maybe", "2", "enabled", "truthy", "1 1", "onoff"]) {
      const { code, stderr } = await runProxyOnce({ ...BASE_ENV, PROXY_LOG_REQUESTS: value });
      assert.equal(code, 1, `expected exit 1 for PROXY_LOG_REQUESTS=${value}`);
      assert.ok(
        stderr.includes("PROXY_LOG_REQUESTS must be 1, 0, true, false, yes, no, on or off"),
        `stderr should name the variable and its rule for ${value}: ${stderr}`
      );
      assert.ok(
        stderr.includes(`got: ${value}`),
        `stderr should echo the offending value for ${value}: ${stderr}`
      );
      for (const marker of ["Error:", "at ", "node:internal"]) {
        assert.ok(!stderr.includes(marker), `stderr must be a message, not a dump (${marker}): ${stderr}`);
      }
      assert.equal(stderr.trim().split("\n").length, 1, `stderr must stay on one line for ${value}`);
    }
  });

  // The line shape. Object.keys is asserted too: a line that grew a sixth
  // field would be a format change this story never agreed to, and the field
  // list is the cheapest place to catch one.
  test("logging enabled writes one JSON line per request with method, path, status and ms", async (t) => {
    const { proxy } = await withProxy(t, {
      proxyEnv: LOG,
      proxyOpts: { captureStdout: true },
      body: JSON.stringify({ ok: true }),
      headers: { "content-type": "application/json" },
    });
    const res = await proxiedFetch(proxy.port, "/v1/chat/completions?stream=true", {
      method: "POST",
      headers: { authorization: "Bearer pt", "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(res.status, 200);
    await res.text();
    const [line, ...extra] = await waitForLines(proxy, 1);
    await settle(150); // a second line, if one were coming, has now been written
    assert.equal(extra.length, 0, "exactly one line per request");
    assert.deepEqual(
      Object.keys(line).sort(),
      ["method", "ms", "path", "status", "ts"],
      `the line carries method, path, status, duration and nothing else: ${JSON.stringify(line)}`
    );
    assert.equal(line.method, "POST");
    assert.equal(line.path, "/v1/chat/completions?stream=true");
    assert.equal(line.status, 200);
    assert.equal(typeof line.ts, "string");
    assert.ok(!Number.isNaN(Date.parse(line.ts)), `ts is a timestamp: ${line.ts}`);
    assert.equal(typeof line.ms, "number");
    assert.ok(Number.isInteger(line.ms) && line.ms >= 0, `ms is a whole duration: ${line.ms}`);
    assert.ok(line.ms < 10_000, `ms is a duration, not a timestamp: ${line.ms}`);
  });

  // Every branch, /health included: the listener is registered above them, not
  // inside the proxy path. A /health line is also the cheapest proof that
  // logging is not reading only the proxied branch's state.
  test("/health is logged when logging is enabled", async (t) => {
    const { proxy } = await withProxy(t, {
      proxyEnv: LOG,
      proxyOpts: { captureStdout: true },
      body: JSON.stringify({ ok: true }),
    });
    const res = await proxiedFetch(proxy.port, "/health");
    assert.equal(res.status, 200);
    await res.text();
    const [line] = await waitForLines(proxy, 1);
    assert.equal(line.method, "GET");
    assert.equal(line.path, "/health");
    assert.equal(line.status, 200);
  });

  // 401 and 404 are generated locally: the upstream is never contacted, and
  // both are exactly what an operator needs to see when a client complains.
  test("local rejections are logged: 401 for a bad token and 404 for a bare /v1", async (t) => {
    const { proxy, receivedRequests } = await withProxy(t, {
      proxyEnv: LOG,
      proxyOpts: { captureStdout: true },
      token: "pt-secret",
      body: JSON.stringify({ ok: true }),
    });
    const unauthorized = await proxiedFetch(proxy.port, "/v1/models", {
      headers: { authorization: "Bearer wrong-token" },
    });
    assert.equal(unauthorized.status, 401);
    await unauthorized.text();
    const notFound = await proxiedFetch(proxy.port, "/v1", {
      headers: { authorization: "Bearer pt-secret" },
    });
    assert.equal(notFound.status, 404);
    await notFound.text();
    const lines = await waitForLines(proxy, 2);
    assert.deepEqual(
      lines.map((l) => [l.path, l.status]),
      [
        ["/v1/models", 401],
        ["/v1", 404],
      ]
    );
    assert.equal(receivedRequests.length, 0, "both were generated locally");
  });

  // An unreachable upstream is the case an operator most needs, and the one
  // most likely to leak: the error it produces names the host and the port.
  // The 502 body already refuses to leak them; the log line must as well.
  test("an unreachable upstream is logged as 502 without naming the upstream host or URL", async (t) => {
    const { proxy, base } = await withProxy(t, {
      base: "http://127.0.0.1:1",
      proxyEnv: LOG,
      proxyOpts: { captureStdout: true },
    });
    const res = await proxiedFetch(proxy.port, "/v1/models", {
      headers: { authorization: "Bearer pt" },
    });
    assert.equal(res.status, 502);
    await res.text();
    const [line] = await waitForLines(proxy, 1);
    assert.equal(line.status, 502);
    assert.equal(line.path, "/v1/models");
    const stdout = proxy.stdout();
    for (const secret of [new URL(base).host, "127.0.0.1:1", "ECONNREFUSED", "http://"]) {
      assert.ok(!stdout.includes(secret), `stdout must not name the upstream (${secret}): ${stdout}`);
    }
  });

  // Task 4, P0. Three request shapes, three proxies' worth of output: a normal
  // proxied request, an unauthorized one, and a failing one. The secret values
  // are distinctive strings, so an assertion cannot pass by accident, and the
  // field-list check closes the shape half of the claim (a header value under
  // a new field name would otherwise slip past a value-only search).
  test("no request log line contains the proxy token, the API key, an authorization value, a request body, or the upstream host:port", async (t) => {
    const TOKEN = "pt-super-secret-proxy-token";
    const KEY = "sk-super-secret-api-key";
    const BODY = JSON.stringify({ prompt: "unique-body-payload-abc123" });
    const customSecret = "unique-custom-header-value-xyz789";
    const { proxy, base } = await withProxy(t, {
      key: KEY,
      token: TOKEN,
      proxyEnv: LOG,
      proxyOpts: { captureStdout: true },
      body: "{}",
      headers: { "content-type": "application/json" },
    });
    const upstreamHost = new URL(base).host;

    const ok = await proxiedFetch(proxy.port, "/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${TOKEN}`,
        "content-type": "application/json",
        "x-custom-secret": customSecret,
      },
      body: BODY,
    });
    assert.equal(ok.status, 200);
    await ok.text();

    const unauthorized = await proxiedFetch(proxy.port, "/v1/models", {
      headers: { authorization: "Bearer not-the-token-at-all" },
    });
    assert.equal(unauthorized.status, 401);
    await unauthorized.text();

    const failing = await withProxy(t, {
      base: "http://127.0.0.1:1",
      proxyEnv: LOG,
      proxyOpts: { captureStdout: true },
    });
    const gateway = await proxiedFetch(failing.proxy.port, "/v1/models", {
      headers: { authorization: "Bearer pt" },
    });
    assert.equal(gateway.status, 502);
    await gateway.text();

    await waitForLines(proxy, 2);
    await waitForLines(failing.proxy, 1);
    for (const [label, handle] of [
      ["proxied proxy", proxy],
      ["failing proxy", failing.proxy],
    ]) {
      const stdout = handle.stdout();
      const lines = logLines(handle);
      assert.ok(lines.length > 0, `${label} logged at least one line`);
      for (const line of lines) {
        assert.deepEqual(
          Object.keys(line).sort(),
          ["method", "ms", "path", "status", "ts"],
          `${label}: no field beyond method, path, status, duration: ${JSON.stringify(line)}`
        );
      }
      for (const [what, value] of [
        ["proxy token", TOKEN],
        ["API key", KEY],
        ["authorization header value", "not-the-token-at-all"],
        ["authorization header name", "Bearer"],
        ["request body", BODY],
        ["body payload", "unique-body-payload-abc123"],
        ["custom header value", customSecret],
        ["upstream host:port", upstreamHost],
        ["upstream host:port (failing proxy)", new URL("http://127.0.0.1:1").host],
      ]) {
        assert.ok(!stdout.includes(value), `${label}: the log must not carry the ${what} (${value}): ${stdout}`);
      }
    }
  });

  // The disclosed half of that boundary. The closed field set keeps the proxy's
  // own key, token, headers and bodies out; it does not scrub the one field a
  // client controls. `path` is the incoming request target copied byte for byte,
  // query string included, so a caller who puts a secret in a query parameter
  // puts it in the operator's log — stated in README, tech-stack.md and ADR
  // 0002. Pinned here so turning on redaction is a deliberate, visible change
  // rather than a silent narrowing of what an operator can debug.
  test("the query string is logged verbatim: a client-supplied query credential reaches the line", async (t) => {
    const { proxy } = await withProxy(t, {
      proxyEnv: LOG,
      proxyOpts: { captureStdout: true },
      body: JSON.stringify({ ok: true }),
    });
    const target = "/v1/models?api_key=sk-QUERY-KEY-ccc333&access_token=QUERYTOKEN-ddd444&limit=2";
    const res = await proxiedFetch(proxy.port, target, {
      headers: { authorization: "Bearer pt" },
    });
    assert.equal(res.status, 200);
    await res.text();
    const [line] = await waitForLines(proxy, 1);
    assert.equal(line.path, target, "the request target is echoed byte for byte, query string included");
    const stdout = proxy.stdout();
    for (const secret of ["sk-QUERY-KEY-ccc333", "QUERYTOKEN-ddd444"]) {
      assert.ok(
        stdout.includes(secret),
        `disclosed behavior: a client query credential is logged verbatim (${secret}): ${stdout}`
      );
    }
    assert.deepEqual(
      Object.keys(line).sort(),
      ["method", "ms", "path", "status", "ts"],
      "redacting the query must not come with a new field: the five are still the whole line"
    );
  });

  // Task 3. Byte-identity is the part that proves the log is not touching the
  // stream: the same stub, the same bytes, logging on and off.
  test("an SSE response is byte-identical with logging on and off and is logged on completion", async (t) => {
    const stub = { headers: { "content-type": "text/event-stream" }, mode: "sse" };
    const request = (port) =>
      proxiedFetch(port, "/v1/chat/completions", {
        method: "POST",
        headers: { authorization: "Bearer pt", "content-type": "application/json" },
        body: JSON.stringify({ stream: true }),
      });

    const off = await withProxy(t, { ...stub, proxyOpts: { captureStdout: true } });
    const offRes = await request(off.proxy.port);
    const offText = await offRes.text();

    const on = await withProxy(t, { ...stub, proxyEnv: LOG, proxyOpts: { captureStdout: true } });
    const onRes = await request(on.proxy.port);
    const onText = await onRes.text();

    assert.equal(onRes.status, offRes.status);
    assert.equal(onText, offText, "client-visible SSE bytes are unchanged by logging");
    assert.ok(onText.includes("data: chunk1") && onText.includes("data: chunk2"), "both chunks arrived");
    assert.deepEqual(logLines(off.proxy), [], "the logging-off child wrote no request log line");
    const [line] = await waitForLines(on.proxy, 1);
    assert.equal(line.status, 200);
    assert.equal(line.path, "/v1/chat/completions");
  });

  // The timing claim, pinned where it is observable: a line written while the
  // stream is still open would appear here, and a duration measured from the
  // handler's return instead of the request's arrival would be ~0. slowfinish
  // holds the response open for 1.5s, so both mistakes are visible.
  test("a streamed response is logged on close, not mid-stream, and its duration covers the whole stream", async (t) => {
    const { proxy } = await withProxy(t, {
      proxyEnv: LOG,
      proxyOpts: { captureStdout: true },
      headers: { "content-type": "text/plain" },
      mode: "slowfinish",
    });
    const res = await proxiedFetch(proxy.port, "/v1/models", {
      headers: { authorization: "Bearer pt" },
    });
    assert.equal(res.status, 200);
    const reader = res.body.getReader();
    const first = await reader.read();
    assert.equal(new TextDecoder().decode(first.value), "slow");
    assert.deepEqual(
      logLines(proxy),
      [],
      "no line while the stream is still open"
    );
    let rest = "";
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      rest += new TextDecoder().decode(chunk.value);
    }
    assert.equal(rest, " done");
    const [line] = await waitForLines(proxy, 1);
    assert.equal(line.status, 200);
    assert.ok(
      line.ms >= 1400,
      `duration must span the stream (1.5s), got ${line.ms}ms`
    );
  });

  // Logging on changes no response. Compared field by field, status and body
  // and every header, for a proxied request and for a locally rejected one.
  test("enabling logging changes no response status, body, or headers", async (t) => {
    const shape = async (port, path, headers) => {
      const res = await proxiedFetch(port, path, { headers });
      const body = await res.text();
      return {
        status: res.status,
        body,
        // date is the wall clock, not the response: the two children answer
        // microseconds apart and the claim is about everything else.
        headers: [...res.headers].filter(([name]) => name !== "date"),
      };
    };
    const off = await withProxy(t, {
      token: "pt-secret",
      body: JSON.stringify({ ok: true }),
      headers: { "content-type": "application/json", "set-cookie": ["a=1; Path=/"] },
    });
    const on = await withProxy(t, {
      token: "pt-secret",
      proxyEnv: LOG,
      proxyOpts: { captureStdout: true },
      body: JSON.stringify({ ok: true }),
      headers: { "content-type": "application/json", "set-cookie": ["a=1; Path=/"] },
    });
    for (const [label, path, headers] of [
      ["proxied", "/v1/models", { authorization: "Bearer pt-secret" }],
      ["unauthorized", "/v1/models", { authorization: "Bearer wrong" }],
      ["not found", "/v1", { authorization: "Bearer pt-secret" }],
    ]) {
      assert.deepEqual(
        await shape(on.proxy.port, path, headers),
        await shape(off.proxy.port, path, headers),
        `${label} response is identical with logging on and off`
      );
    }
    await waitForLines(on.proxy, 3);
  });

  // A write failure is swallowed, so it cannot reach the response path: with
  // every console.log past the banner throwing, the request still completes
  // and the process is still serving. Without the try/catch the throw escapes a
  // response event and kills the child, which is what exitCode catches.
  test("a failing log write does not reach the response path", async (t) => {
    const { proxy } = await withProxy(t, {
      proxyEnv: LOG,
      proxyOpts: { captureStdout: true, logThrows: true },
      body: JSON.stringify({ ok: true }),
      headers: { "content-type": "application/json" },
    });
    const res = await proxiedFetch(proxy.port, "/v1/models", {
      headers: { authorization: "Bearer pt" },
    });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
    await settle(150);
    assert.deepEqual(logLines(proxy), [], "the line was attempted and lost");
    assert.equal(proxy.child.exitCode, null, "a throwing log write must not take the process down");
    const health = await proxiedFetch(proxy.port, "/health");
    assert.equal(health.status, 200, "the proxy still serves after the failed write");
  });

  // Requirement 7: a response that never completes still yields a well-formed
  // line and a live process. `stall` flushes headers and one chunk, then goes
  // silent; the idle watchdog destroys the response a second later. Headers
  // therefore definitely reached the client before the failure, so the recorded
  // status is the one that was written — and the line is still one whole JSON
  // object, which is what a truncated stream could corrupt.
  //
  // midabort (write a chunk, then destroy the upstream socket immediately) is
  // not used here: whether undici delivers the response headers before
  // processing the socket destroy is a race, so the same stub legitimately
  // yields 200 or 502 and the assertion could not mean anything.
  test("a mid-stream upstream failure logs a well-formed line with the last written status and leaves the process healthy", async (t) => {
    const { proxy } = await withProxy(t, {
      proxyEnv: { PROXY_LOG_REQUESTS: "1", UPSTREAM_IDLE_TIMEOUT_SECONDS: "1" },
      proxyOpts: { captureStdout: true },
      headers: { "content-type": "text/plain" },
      mode: "stall",
    });
    const res = await proxiedFetch(proxy.port, "/v1/models", {
      headers: { authorization: "Bearer pt" },
    });
    assert.equal(res.status, 200);
    const reader = res.body.getReader();
    const first = await reader.read();
    assert.equal(new TextDecoder().decode(first.value), "hello", "headers and one chunk reached the client");
    // The stream is cut under the client: the read fails rather than ending.
    await assert.rejects(reader.read());
    const [line] = await waitForLines(proxy, 1);
    assert.equal(typeof line.status, "number", "a status is recorded even though the stream never completed");
    assert.equal(line.status, 200, "the last status written to the client");
    assert.equal(line.path, "/v1/models");
    assert.equal(typeof line.ms, "number");
    assert.equal(proxy.child.exitCode, null, "the process survives the failure");
    const health = await proxiedFetch(proxy.port, "/health");
    assert.equal(health.status, 200, "the proxy still serves after the failure");
  });

  // A response destroyed before any status reached the client has no status to
  // report. `silent` never sends response headers, so a client that gives up
  // mid-request produces the 0 the code documents rather than a code the
  // client never saw.
  test("a client disconnect before any status is written logs status 0 and no invented code", async (t) => {
    const { proxy } = await withProxy(t, {
      proxyOpts: { captureStdout: true },
      mode: "silent",
      proxyEnv: { PROXY_LOG_REQUESTS: "1", UPSTREAM_CONNECT_TIMEOUT_SECONDS: "30" },
    });
    const controller = new AbortController();
    const pending = proxiedFetch(proxy.port, "/v1/models", {
      headers: { authorization: "Bearer pt" },
      signal: controller.signal,
    });
    pending.catch(() => {});
    await settle(100); // the upstream request has been made; no headers yet
    controller.abort();
    const lines = await waitForLines(proxy, 1);
    assert.equal(lines.length, 1);
    assert.equal(lines[0].status, 0, "no status reached the client, so none is reported");
    assert.equal(lines[0].path, "/v1/models");
    assert.equal(proxy.child.exitCode, null, "the process survives the disconnect");
  });
});
