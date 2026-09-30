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
  // Bind address, handed straight to server.listen: no URL validation, no DNS
  // resolution, no allowlist. listen() already fails loudly on an address it
  // cannot bind, and rejecting unknown values here would only turn a working
  // deploy into a startup crash. Whitespace-only counts as unset (same
  // ?.trim() convention as the credentials); anything else is passed through
  // verbatim, untrimmed, so no value is silently rewritten.
  const rawHost = env.PROXY_HOST;
  return {
    baseURL: rawBase,
    host: rawHost?.trim() ? rawHost : "0.0.0.0",
    rateLimit: readRateLimit(env),
    apiKey: env.NVIDIA_API_KEY,
    proxyToken: env.PROXY_AUTH_TOKEN,
    unconfigured: !env.NVIDIA_API_KEY?.trim() || !env.PROXY_AUTH_TOKEN?.trim(),
  };
}

// Rate budget pair. One field, not two: a caller must not be able to read one
// half of a pair that was never completed. Both absent or blank means rate
// limiting is disabled (identical to a build without it); exactly one non-blank
// is fatal, because half a budget is a budget that appears to exist and does
// not. The values are stored, not enforced — enforcement is a later slice.
function readRateLimit(env) {
  const rawRpm = env.PROXY_RPM;
  const rawTpm = env.PROXY_TPM;
  // Blank check before any numeric parsing: Number("  ") is 0, so a
  // whitespace-only value that reached the numeric guard would read as a
  // supplied value instead of an absent one.
  const hasRpm = Boolean(rawRpm?.trim());
  const hasTpm = Boolean(rawTpm?.trim());
  if (hasRpm !== hasTpm) {
    const missing = hasRpm ? "PROXY_TPM" : "PROXY_RPM";
    // Both names in the message: an operator reading only the message has to
    // know which pair is incomplete, not just which half they set.
    console.error(`PROXY_RPM and PROXY_TPM must be set together: ${missing} is missing`);
    process.exit(1);
  }
  if (!hasRpm) return null;
  return {
    rpm: readPositiveInteger("PROXY_RPM", rawRpm),
    tpm: readPositiveInteger("PROXY_TPM", rawTpm),
  };
}

// Decimal digits only, never Number() coercion. Number("1e3") is 1000 and
// Number("0x10") is 16, so a coercive check silently reinterprets a ceiling the
// operator wrote — the failure this story names. These are budgets: an operator
// who wants 1000 gets 1000, one who typed 1e3 gets a loud startup crash that is
// one keystroke from correct. Reverse this by loosening the guard and the test
// that pins it.
function readPositiveInteger(name, raw) {
  const trimmed = raw.trim();
  const value = Number(trimmed);
  if (!/^[0-9]+$/.test(trimmed) || !Number.isSafeInteger(value) || value <= 0) {
    console.error(`${name} must be a positive integer, got: ${trimmed}`);
    process.exit(1);
  }
  return value;
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
