// Single source of truth for configuration: one function validates every
// required variable. NVIDIA_BASE_URL problems are fatal at startup — the
// proxy must never come up half-configured or doomed. Missing key/token are
// runtime problems instead: /health and proxied requests report 503 until
// they are set.
export function parseConfig(env) {
  const rawBase = env.NVIDIA_BASE_URL;
  if (!rawBase?.trim()) {
    console.error("NVIDIA_BASE_URL is required");
    process.exit(1);
  }
  try {
    const parsed = new URL(rawBase);
    // Only http(s) can be an upstream: other schemes are structurally
    // unusable (file: has no origin, data: is inline), so they are a
    // doomed config — same fatal regime as an unparseable URL.
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      console.error(`NVIDIA_BASE_URL must use http or https, got: ${rawBase}`);
      process.exit(1);
    }
  } catch {
    console.error(`NVIDIA_BASE_URL is not a valid URL: ${rawBase}`);
    process.exit(1);
  }
  return {
    baseURL: rawBase,
    apiKey: env.NVIDIA_API_KEY,
    proxyToken: env.PROXY_AUTH_TOKEN,
    unconfigured: !env.NVIDIA_API_KEY?.trim() || !env.PROXY_AUTH_TOKEN?.trim(),
  };
}

// Upstream timeout windows (seconds). CONNECT bounds the pre-response phase:
// how long the upstream may take to deliver response headers. IDLE bounds the
// streaming phase: how long the pass-through may go without receiving a byte
// (the timer resets on every chunk, so long-lived SSE streams are never cut
// off while they keep producing). Both are env-tunable; 0 disables.
function readSeconds(name, fallback) {
  const val = process.env[name];
  if (!val?.trim()) return fallback;
  const raw = Number(val);
  return Number.isFinite(raw) && raw >= 0 ? raw : fallback;
}

export const CONNECT_TIMEOUT_SECONDS = readSeconds(
  "UPSTREAM_CONNECT_TIMEOUT_SECONDS",
  30
);
export const IDLE_TIMEOUT_SECONDS = readSeconds(
  "UPSTREAM_IDLE_TIMEOUT_SECONDS",
  120
);
