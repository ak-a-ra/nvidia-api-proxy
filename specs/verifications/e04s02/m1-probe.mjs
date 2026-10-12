// M1 regression probe — the exact scenario both reviewers reproduced.
// ceiling 1, queue 2, timeout 120s. A holder occupies the slot, a waiter's
// socket is aborted mid-wait, the holder is released, and a third request must
// be admitted. Pre-fix the aborted waiter was handed the slot and never
// released it, so the ceiling stayed 0 forever and the third request queued to
// the 120s timeout.
// Zero deps; boots its own stub + proxy child.
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

const stub = await new Promise((resolve) => {
  const received = [];
  const held = [];
  const srv = http.createServer((req, res) => {
    received.push(req.url);
    res.flushHeaders();
    res.write("held");
    held.push(res);
  });
  srv.listen(0, "127.0.0.1", () => resolve({ srv, received, held }));
});

const proxy = await new Promise((resolve, reject) => {
  const env = { ...process.env };
  for (const name of CONFIG_ENV_VARS) delete env[name];
  Object.assign(env, {
    NVIDIA_BASE_URL: `http://127.0.0.1:${stub.srv.address().port}/v1`,
    NVIDIA_API_KEY: "sk-test", PROXY_AUTH_TOKEN: "pt", PORT: "0",
    PROXY_MAX_CONCURRENT_REQUESTS: "1",
    PROXY_MAX_QUEUE_SIZE: "2",
    PROXY_QUEUE_TIMEOUT_SECONDS: "120",
  });
  const child = spawn(process.execPath, [
    "--input-type=module", "-e",
    `import server from ${JSON.stringify(SERVER_PATH)};
     server.on("listening", () => process.send({ port: server.address().port }));`,
  ], { env, stdio: ["ignore", "ignore", "pipe", "ipc"] });
  let stderr = "";
  child.stderr.on("data", (d) => (stderr += d));
  const timer = setTimeout(() => reject(new Error("proxy did not start")), 5000);
  timer.unref();
  child.on("message", (msg) => { clearTimeout(timer); resolve({ child, port: msg.port, stderr: () => stderr }); });
  child.on("error", reject);
});

const P = (p, opts) => fetch(`http://127.0.0.1:${proxy.port}${p}`, opts);
const settle = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (what, check, expected, timeoutMs = 8000) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const seen = check();
    if (seen === expected) return;
    if (Date.now() >= deadline) throw new Error(`timeout: ${what} (was ${seen}, wanted ${expected})`);
    await settle(10);
  }
};

// 1. Holder takes the only slot.
const holder = P("/v1/models", { headers: { authorization: "Bearer pt" } }).catch(() => {});
await waitFor("holder to occupy the slot", () => stub.held.length, 1);

// 2. Waiter queues (queue size 2, so it fits).
const waiter = P("/v1/models", { headers: { authorization: "Bearer pt" } }).catch(() => {});
await settle(150);

// 3. Waiter's client disconnects while queued: a second request joins the
//    queue behind the first waiter, then its socket is aborted mid-wait.
const ac = new AbortController();
const aborting = P("/v1/models", { headers: { authorization: "Bearer pt" }, signal: ac.signal }).catch(() => {});
await settle(150);
ac.abort();
await settle(150);

// 4. Release the holder and drain every held response as it appears, the way
//    the suite's drain pump does: each release admits the next waiter, whose
//    own response is held in turn, so a single end() is never enough. The
//    aborted ticket, when the drain reaches it, is admitted onto a destroyed
//    response and released by the post-acquire check without an upstream call.
stub.held.shift().end();
await holder;
const arrivalsBefore = stub.received.length;
const third = P("/v1/models", { headers: { authorization: "Bearer pt" } });
// The pump runs until the THIRD request's arrival: waiter#1's arrival alone
// leaves its response held, and the dead ticket between waiter#1 and the
// third adds no arrival of its own.
const pump = (async () => {
  while (stub.received.length < arrivalsBefore + 2) {
    while (stub.held.length > 0) stub.held.shift().end();
    await settle(10);
  }
})();
let thirdStatus;
try {
  thirdStatus = (await Promise.race([
    third.then((r) => r.status),
    settle(5000).then(() => "TIMEOUT"),
  ]));
} finally {
  await pump;
}

console.log(JSON.stringify({
  verdict: thirdStatus === 200 ? "FIXED" : "STILL BROKEN",
  third_status: thirdStatus,
  upstream_arrivals: stub.received.length,
  expected_arrivals: arrivalsBefore + 2,
  wasted_call_for_dead_ticket: stub.received.length > arrivalsBefore + 2,
  stderr_has_unable_to_pipe: proxy.stderr().includes("ERR_STREAM_UNABLE_TO_PIPE"),
}, null, 2));

stub.held.forEach((r) => r.end());
proxy.child.kill();
stub.srv.close();
process.exit(thirdStatus === 200 ? 0 : 1);
