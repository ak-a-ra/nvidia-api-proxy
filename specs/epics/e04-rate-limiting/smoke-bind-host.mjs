#!/usr/bin/env node
// Manual smoke for e04s01: PROXY_HOST binding must be the only thing that changes
// about network exposure. Starts a stub upstream and a real proxy child, then
// checks loopback reachability, /health, and one pass-through request.
//
// Fails today (PROXY_HOST is not implemented), which is the point: this is the
// verification script for the story, not a passing baseline.

import { spawn } from "node:child_process";
import http from "node:http";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// This file sits three levels below the repo root (specs/epics/e04-rate-limiting),
// so server.js is three joins up, not two.
const SERVER = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "server.js");

const stub = http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "application/json" });
  res.end('{"ok":true}');
});
stub.listen(0, "127.0.0.1");
await once(stub, "listening");
const base = `http://127.0.0.1:${stub.address().port}/v1`;

const child = spawn(
  process.execPath,
  ["--input-type=module", "-e",
    `import s from ${JSON.stringify(SERVER)}; s.on("listening", () => process.send({ port: s.address().port }));`],
  {
    env: {
      ...process.env,
      NVIDIA_BASE_URL: base,
      NVIDIA_API_KEY: "sk",
      PROXY_AUTH_TOKEN: "pt",
      PORT: "0",
      PROXY_HOST: "127.0.0.1",
    },
    stdio: ["ignore", "ignore", "inherit", "ipc"],
  }
);

const fail = (msg) => { console.error(`SMOKE FAIL: ${msg}`); child.kill(); stub.close(); process.exit(1); };

const port = await new Promise((resolve) => child.on("message", (m) => resolve(m.port)));

const health = await fetch(`http://127.0.0.1:${port}/health`);
if (health.status !== 200) fail(`/health returned ${health.status}`);
console.log("health:", health.status, await health.text());

const proxied = await fetch(`http://127.0.0.1:${port}/v1/models`, {
  headers: { authorization: "Bearer pt" },
});
if (proxied.status !== 200) fail(`pass-through returned ${proxied.status}`);
console.log("pass-through:", proxied.status, await proxied.text());

child.kill();
stub.close();
console.log("SMOKE OK: loopback bind, health, and pass-through all reachable");
