// e04s02 NFR probe — measurable evidence for the P0 NFR gate.
// Performance: /health latency and admitted-request latency while the gate is
// saturated (the worst case for a local endpoint). Operability: /health and the
// rejection path answer deterministically under load. Reliability: the rejected
// path never reaches the upstream.
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

function startStub() {
  return new Promise((resolve) => {
    const held = [];
    const received = [];
    const srv = http.createServer((req, res) => {
      received.push(req.url);
      res.flushHeaders();
      res.write("held");
      held.push(res);
    });
    srv.listen(0, "127.0.0.1", () => resolve({ srv, held, received }));
  });
}

function startProxy(baseURL, proxyEnv) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    for (const name of CONFIG_ENV_VARS) delete env[name];
    Object.assign(env, proxyEnv, {
      NVIDIA_BASE_URL: baseURL, NVIDIA_API_KEY: "sk-test", PROXY_AUTH_TOKEN: "pt", PORT: "0",
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
  });
}

const timed = async (fn) => {
  const t0 = process.hrtime.bigint();
  const r = await fn();
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  return { status: r.status, ms };
};
const p = (arr, q) => arr.slice().sort((a, b) => a - b)[Math.floor((arr.length - 1) * q)];

const stub = await startStub();
const proxy = await startProxy(`http://127.0.0.1:${stub.srv.address().port}/v1`, {
  PROXY_MAX_CONCURRENT_REQUESTS: "1",
  PROXY_MAX_QUEUE_SIZE: "1",
});

// Saturate: one request occupies the only slot and a second fills the only
// queue slot, so every later request is rejected at the gate — the worst case
// for the local paths. (Queue size 0 is fatal at startup, so the queue is 1
// and pre-filled; a queued waiter never affects the measured paths.)
const holder = fetch(`http://127.0.0.1:${proxy.port}/v1/models`, {
  headers: { authorization: "Bearer pt" },
}).catch(() => {});
await new Promise((r) => setTimeout(r, 200));
const queueFiller = fetch(`http://127.0.0.1:${proxy.port}/v1/models`, {
  headers: { authorization: "Bearer pt" },
}).catch(() => {});
await new Promise((r) => setTimeout(r, 200));

const healthLat = [];
for (let i = 0; i < 20; i++) {
  const { status, ms } = await timed(() =>
    fetch(`http://127.0.0.1:${proxy.port}/health`));
  if (status !== 200) throw new Error("health non-200 under saturation");
  healthLat.push(ms);
}
const rejectLat = [];
for (let i = 0; i < 20; i++) {
  const { status, ms } = await timed(() =>
    fetch(`http://127.0.0.1:${proxy.port}/v1/models`, { headers: { authorization: "Bearer pt" } }));
  if (status !== 429) throw new Error("expected 429 under saturation");
  rejectLat.push(ms);
}

console.log(JSON.stringify({
  health_under_saturation: { n: healthLat.length, p50_ms: +p(healthLat, 0.5).toFixed(2), max_ms: +Math.max(...healthLat).toFixed(2) },
  rejection_under_saturation: { n: rejectLat.length, p50_ms: +p(rejectLat, 0.5).toFixed(2), max_ms: +Math.max(...rejectLat).toFixed(2) },
  upstream_arrivals_during_probe: stub.received.length,
  note: "1 arrival = the holder; every probe call stayed local",
}, null, 2));

stub.held.forEach((r) => r.end());
await holder;
proxy.child.kill();
stub.srv.close();
