// e04s02 verify-work UAT — standalone, zero deps, independent of server.test.js.
// Boots a fresh stub upstream + a fresh server.js child per configuration and
// drives real HTTP requests through the admission gate, one observable step at
// a time. Prints STEP lines; exits non-zero on the first failed step.
import http from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const SERVER_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../server.js");
const CONFIG_ENV_VARS = [
  "PORT", "NVIDIA_BASE_URL", "NVIDIA_API_KEY", "PROXY_AUTH_TOKEN", "PROXY_HOST",
  "PROXY_RPM", "PROXY_TPM", "PROXY_MAX_CONCURRENT_REQUESTS", "PROXY_MAX_QUEUE_SIZE",
  "PROXY_QUEUE_TIMEOUT_SECONDS", "PROXY_SAFETY_MARGIN_PCT", "PROXY_MAX_BUFFERED_BODY_BYTES",
  "PROXY_MODEL_LIMITS_JSON", "PROXY_LOG_REQUESTS",
  "UPSTREAM_CONNECT_TIMEOUT_SECONDS", "UPSTREAM_IDLE_TIMEOUT_SECONDS",
];

let failures = 0;
const step = (name, ok, detail) => {
  console.log(`STEP ${name}: ${ok ? "PASS" : "FAIL"}${detail ? " — " + detail : ""}`);
  if (!ok) failures++;
};

function startStub(mode, body, headers) {
  return new Promise((resolve) => {
    const received = [];
    const held = [];
    const srv = http.createServer((req, res) => {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        received.push({
          method: req.method,
          path: req.url,
          body: Buffer.concat(chunks).toString("utf8"),
          rawBody: Buffer.concat(chunks),
          authorization: req.headers.authorization,
        });
        if (mode === "hold") {
          res.flushHeaders();
          res.write("held");
          held.push(res);
          return;
        }
        if (mode === "sse") {
          res.write("data: chunk1\n\n");
          setTimeout(() => { res.write("data: chunk2\n\n"); res.end(); }, 50);
          return;
        }
        if (mode === "activelong") {
          res.write("part1-");
          setTimeout(() => { res.write("part2-"); setTimeout(() => res.end("part3"), 300); }, 300);
          return;
        }
        res.writeHead(200, headers ?? { "content-type": "application/json" });
        res.end(body ?? "{}");
      });
    });
    srv.listen(0, "127.0.0.1", () => resolve({ srv, received, held }));
  });
}

function startProxy(baseURL, proxyEnv) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    for (const name of CONFIG_ENV_VARS) delete env[name];
    Object.assign(env, proxyEnv, {
      NVIDIA_BASE_URL: baseURL,
      NVIDIA_API_KEY: "sk-test",
      PROXY_AUTH_TOKEN: "pt",
      PORT: "0",
    });
    const child = spawn(process.execPath, [
      "--input-type=module", "-e",
      `import server from ${JSON.stringify(SERVER_PATH)};
       server.on("listening", () => process.send({ port: server.address().port }));`,
    ], { env, stdio: ["ignore", "ignore", "ignore", "ipc"] });
    const timer = setTimeout(() => reject(new Error("proxy did not start")), 5000);
    timer.unref();
    child.on("message", (msg) => { clearTimeout(timer); resolve({ child, port: msg.port }); });
    child.on("error", reject);
    child.on("exit", (code) => { if (code !== 0) reject(new Error(`proxy exited ${code}`)); });
  });
}

const fetchProxy = (port, p, opts) => fetch(`http://127.0.0.1:${port}${p}`, opts);
const settle = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(what, check, expected, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const seen = check();
    if (seen === expected) return;
    if (Date.now() >= deadline) throw new Error(`timeout waiting for ${what} (was ${seen}, wanted ${expected})`);
    await settle(10);
  }
}

// --- UAT-1: ceiling absent admits everything (Gherkin scenario 1) ---
{
  const stub = await startStub();
  const proxy = await startProxy(`http://127.0.0.1:${stub.srv.address().port}/v1`, {});
  const health = await fetchProxy(proxy.port, "/health");
  const healthBody = await health.json();
  step("cold-start /health 200", health.status === 200 && healthBody.status === "ok", JSON.stringify(healthBody));
  const fetches = Array.from({ length: 3 }, () =>
    fetchProxy(proxy.port, "/v1/models", { headers: { authorization: "Bearer pt" } }));
  fetches.forEach((f) => f.catch(() => {}));
  await waitFor("3 admissions", () => stub.received.length, 3);
  const results = await Promise.all(fetches);
  step("UAT-1 ceiling absent: 3 concurrent all reach upstream",
    results.every((r) => r.status === 200) && stub.received.length === 3,
    `${stub.received.length} upstream arrivals, all 200`);
  proxy.child.kill();
  stub.srv.close();
}

// --- UAT-2/3/4: saturation — 429, health bypass, FIFO admission ---
{
  const stub = await startStub("hold");
  const proxy = await startProxy(`http://127.0.0.1:${stub.srv.address().port}/v1`, {
    PROXY_MAX_CONCURRENT_REQUESTS: "1",
    PROXY_MAX_QUEUE_SIZE: "1",
    PROXY_QUEUE_TIMEOUT_SECONDS: "120",
  });
  const postOpts = {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer pt" },
    body: JSON.stringify({ tag: "holder" }),
  };
  const holder = fetchProxy(proxy.port, "/v1/chat/completions", postOpts);
  holder.catch(() => {});
  const queued = fetchProxy(proxy.port, "/v1/chat/completions", {
    ...postOpts, body: JSON.stringify({ tag: "queued" }),
  });
  queued.catch(() => {});
  await waitFor("holder to occupy the slot", () => stub.held.length, 1);
  await settle(100); // the second request has reached the gate by now
  const rejected = await fetchProxy(proxy.port, "/v1/chat/completions", {
    ...postOpts, body: JSON.stringify({ tag: "rejected" }),
  });
  const rejectedBody = await rejected.text();
  const retryAfter = rejected.headers.get("retry-after");
  step("UAT-2 full queue: 429 + exact body + positive Retry-After",
    rejected.status === 429 && rejectedBody === '{"error":"Too many requests"}' && /^1[0-9]*$/.test(retryAfter ?? ""),
    `status=${rejected.status} body=${rejectedBody} retry-after=${retryAfter}`);
  const health = await fetchProxy(proxy.port, "/health");
  const healthBody = await health.json();
  step("UAT-3 /health 200 under saturation",
    health.status === 200 && healthBody.status === "ok",
    `status=${health.status} body=${JSON.stringify(healthBody)}`);
  step("UAT-2 leak check: no model, path, queue, budget, or host in the 429",
    !/nemotron|chat\/completions|PROXY|queue|admission|127\.0\.0\.1/.test(rejectedBody),
    "body carries no operational detail");
  stub.held.shift().end(); // release the holder
  await waitFor("queued waiter admitted", () => stub.received.length, 2);
  const tags = stub.received.map((r) => JSON.parse(r.body).tag);
  step("UAT-4 FIFO: holder admitted before the queued waiter",
    tags[0] === "holder" && tags[1] === "queued", `arrival order: ${tags.join(", ")}`);
  while (stub.held.length > 0) stub.held.shift().end();
  await Promise.allSettled([holder, queued]);
  proxy.child.kill();
  stub.srv.close();
}

// --- UAT-5: queue timeout rejection carries the configured wait ---
{
  const stub = await startStub("hold");
  const proxy = await startProxy(`http://127.0.0.1:${stub.srv.address().port}/v1`, {
    PROXY_MAX_CONCURRENT_REQUESTS: "1",
    PROXY_QUEUE_TIMEOUT_SECONDS: "1",
  });
  const holder = fetchProxy(proxy.port, "/v1/models", { headers: { authorization: "Bearer pt" } });
  holder.catch(() => {});
  await waitFor("holder to occupy the slot", () => stub.held.length, 1);
  const waiting = await fetchProxy(proxy.port, "/v1/models", { headers: { authorization: "Bearer pt" } });
  step("UAT-5 queue timeout: 429 + configured Retry-After",
    waiting.status === 429 && waiting.headers.get("retry-after") === "1" &&
    (await waiting.text()) === '{"error":"Too many requests"}',
    `status=${waiting.status} retry-after=${waiting.headers.get("retry-after")}`);
  stub.held.shift().end();
  await Promise.allSettled([holder]);
  proxy.child.kill();
  stub.srv.close();
}

// --- UAT-6: pass-through parity (Gherkin scenario 9) ---
{
  const stub = await startStub("sse");
  const proxy = await startProxy(`http://127.0.0.1:${stub.srv.address().port}/v1`, {
    PROXY_MAX_CONCURRENT_REQUESTS: "4",
  });
  const payload = JSON.stringify({ model: "nemotron", messages: [{ role: "user", content: "héllo ✓" }] });
  const res = await fetchProxy(proxy.port, "/v1/chat/completions?stream=true", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer pt" },
    body: payload,
  });
  const text = await res.text();
  const upstream = stub.received[0];
  step("UAT-6 pass-through: path+query, credential swap, byte-identical body, SSE",
    upstream.path === "/v1/chat/completions?stream=true" &&
    upstream.authorization === "Bearer sk-test" &&
    upstream.body === payload &&
    text.includes("data: chunk1") && text.includes("data: chunk2"),
    `path=${upstream.path} auth=${upstream.authorization} body-identical=${upstream.body === payload} sse=${text.includes("chunk2")}`);
  proxy.child.kill();
  stub.srv.close();
}

// --- UAT-7: SIGTERM lets an in-flight stream finish, exits 0 ---
{
  const stub = await startStub("activelong");
  const proxy = await startProxy(`http://127.0.0.1:${stub.srv.address().port}/v1`, {
    PROXY_MAX_CONCURRENT_REQUESTS: "1",
  });
  const streaming = fetchProxy(proxy.port, "/v1/models", { headers: { authorization: "Bearer pt" } });
  streaming.catch(() => {});
  await settle(150);
  proxy.child.kill("SIGTERM");
  const exitCode = await new Promise((resolve) => proxy.child.on("exit", (c) => resolve(c)));
  step("UAT-7 SIGTERM: in-flight stream finishes, child exits 0", exitCode === 0, `exit=${exitCode}`);
  const streamRes = await streaming.then((r) => r, () => null);
  step("UAT-7 stream completed through the grace period",
    streamRes !== null && (await streamRes.text()).includes("part3"), "client received the full stream");
  stub.srv.close();
}

console.log(failures === 0 ? "UAT COMPLETE: all steps passed" : `UAT FAILED: ${failures} step(s) failed`);
process.exit(failures === 0 ? 0 : 1);
