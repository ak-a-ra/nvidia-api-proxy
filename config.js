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
    limits: readLimits(env),
    // Its own field, parallel to rateLimit: limits holds scalar ceilings, this
    // holds a map of budgets. A caller must not be able to read a per-model
    // budget map beside a half-configured global rate pair.
    modelLimits: readModelLimits(env),
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

// Operational ceilings, one object: a caller must not be able to read three
// defaults beside a half-configured concurrency ceiling. Validated and stored
// only — admission control, queueing, and budget enforcement are later slices.
// `0` is a meaningful value for PROXY_MAX_CONCURRENT_REQUESTS alone, where it
// disables the ceiling; a zero queue size or a zero-second wait would turn
// queueing into immediate rejection, a limit that appears to exist and does
// not.
function readLimits(env) {
  const rawConcurrency = env.PROXY_MAX_CONCURRENT_REQUESTS;
  const rawQueueSize = env.PROXY_MAX_QUEUE_SIZE;
  const rawQueueTimeout = env.PROXY_QUEUE_TIMEOUT_SECONDS;
  const rawMargin = env.PROXY_SAFETY_MARGIN_PCT;
  const rawMaxBodyBytes = env.PROXY_MAX_BUFFERED_BODY_BYTES;
  // Blank check before any numeric parsing: Number("  ") is 0, so a
  // whitespace-only value that reached the numeric guard would read as a
  // supplied value instead of an absent one.
  const hasConcurrency = Boolean(rawConcurrency?.trim());
  const hasQueueSize = Boolean(rawQueueSize?.trim());
  const hasQueueTimeout = Boolean(rawQueueTimeout?.trim());
  const hasMargin = Boolean(rawMargin?.trim());
  const hasMaxBodyBytes = Boolean(rawMaxBodyBytes?.trim());
  const concurrency = hasConcurrency
    ? readPositiveInteger("PROXY_MAX_CONCURRENT_REQUESTS", rawConcurrency, {
        min: 0,
        zeroDisables: true,
      })
    : null;
  return {
    // null is the only nullable member: absent, blank, or 0 all disable.
    maxConcurrentRequests: concurrency === 0 ? null : concurrency,
    maxQueueSize: hasQueueSize
      ? readPositiveInteger("PROXY_MAX_QUEUE_SIZE", rawQueueSize)
      : 32,
    queueTimeoutSeconds: hasQueueTimeout
      ? readPositiveInteger("PROXY_QUEUE_TIMEOUT_SECONDS", rawQueueTimeout)
      : 30,
    // 0 is a valid margin (no headroom reserved); 51 is a quarter of the
    // budget, which the story names as the fatal end of the range.
    safetyMarginPct: hasMargin
      ? readPositiveInteger("PROXY_SAFETY_MARGIN_PCT", rawMargin, { min: 0, max: 50 })
      : 5,
    // 8 MiB, the plain positive-integer rule like every other ceiling here.
    // 0 is fatal, not a disable: a zero-byte buffer rejects every request body,
    // a limit that appears to exist and does not.
    maxBufferedBodyBytes: hasMaxBodyBytes
      ? readPositiveInteger("PROXY_MAX_BUFFERED_BODY_BYTES", rawMaxBodyBytes)
      : 8388608,
  };
}

// Per-model budgets, keyed by exact case-sensitive model ID. One rejection, not
// a per-row report: the first malformed entry ends the process, so no invalid
// entry can be adopted alongside a valid one. A partially applied value fails
// open, and a silently dropped model limit is a budget that appears to exist
// and does not — hence the empty entry and the unknown-key checks below, which
// the story's enumerated list does not spell out. Validated and stored only:
// enforcement is a later slice.
function readModelLimits(env) {
  const raw = env.PROXY_MODEL_LIMITS_JSON;
  // Blank check before any JSON.parse: JSON.parse("  ") throws, so a
  // whitespace-only value that reached the parser would crash startup. Blank
  // means unset, the same convention every other group uses.
  if (!raw?.trim()) return null;
  // Only the parse failure is caught, and only to name the variable: Node's
  // uncaught SyntaxError names a position the operator can act on but not the
  // setting that produced it. The catch is never empty and never swallows —
  // the exit below is unconditional, so a malformed document still fails closed.
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    fatal("PROXY_MODEL_LIMITS_JSON", `is not valid JSON: ${error.message}`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    fatal("PROXY_MODEL_LIMITS_JSON", `must be a JSON object, got: ${typeName(parsed)}`);
  }
  // Null prototype: a model ID is operator-supplied text, and on a normal
  // object a key like "__proto__" would be swallowed by the prototype setter
  // (or shadow Object.prototype for a later slice's lookup) — an entry that
  // silently disappears. The map still stores every key byte for byte.
  const limits = Object.create(null);
  for (const [model, entry] of Object.entries(parsed)) {
    // Keys are stored exactly as written, never trimmed, lowercased, or
    // otherwise normalized. A key that can never match a model ID is a budget
    // that appears to exist and does not, so an empty key, a padded one, and one
    // carrying a control character are all fatal rather than silently repaired.
    if (!model.trim()) {
      fatal("PROXY_MODEL_LIMITS_JSON", "has a blank model key");
    }
    if (model !== model.trim()) {
      fatal("PROXY_MODEL_LIMITS_JSON", `model key ${describeKey(model)} has surrounding spaces`);
    }
    // The offending byte is named in code-point form, and describeKey prints
    // the key with it escaped, so the message stays on one line and carries
    // nothing a terminal would interpret.
    const control = CONTROL_CHAR.exec(model);
    if (control) {
      const point = control[0].codePointAt(0).toString(16).toUpperCase().padStart(4, "0");
      fatal("PROXY_MODEL_LIMITS_JSON", `model key ${describeKey(model)} contains a control character: U+${point}`);
    }
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      fatal(`PROXY_MODEL_LIMITS_JSON["${model}"]`, `must be a JSON object, got: ${typeName(entry)}`);
    }
    // An entry has to supply a budget and may not carry a field nobody reads:
    // "rps" would vanish and leave the operator believing the model is capped.
    const fields = Object.keys(entry);
    if (fields.length === 0) {
      fatal(`PROXY_MODEL_LIMITS_JSON["${model}"]`, "must supply rpm or tpm, got: an empty object");
    }
    const budget = {};
    for (const field of fields) {
      if (field !== "rpm" && field !== "tpm") {
        fatal(`PROXY_MODEL_LIMITS_JSON["${model}"]`, `has an unknown field: ${field} (only rpm and tpm are read)`);
      }
      const value = entry[field];
      // Type first, then the one integer guard. JSON.parse has already turned
      // the operator's text into a number, so String() below cannot reintroduce
      // a coercion problem — but the typeof check has to come first or a quoted
      // "60" would pass, because String("60") is "60". The guard's
      // Number.isSafeInteger then rejects 1e30. Honest asymmetry: scientific
      // notation is rejected for env scalars only, because JSON's numeric
      // grammar accepts 1e3 and yields 1000, so by the time the value exists
      // there is no textual evidence left of what was written.
      if (typeof value !== "number") {
        fatal(`PROXY_MODEL_LIMITS_JSON["${model}"].${field}`, `must be a positive integer, got: ${describeValue(value)}`);
      }
      budget[field] = readPositiveInteger(`PROXY_MODEL_LIMITS_JSON["${model}"].${field}`, String(value));
    }
    limits[model] = budget;
  }
  return limits;
}

// What the offending value is, in the words an operator reading stderr needs:
// its type rather than its text, because an entry can be an arbitrarily large
// document. The key and field are already in the name this is appended to.
function typeName(value) {
  if (Array.isArray(value)) return "an array";
  if (value === null) return "null";
  if (typeof value === "object") return "an object";
  return `a ${typeof value}`;
}

// C0 and DEL. No model ID contains one, so a key that carries one can never
// match, exactly like the padded key above it.
const CONTROL_CHAR = /[\u0000-\u001f\u007f]/;

// The value's shape in a message, never its text. The offending value can be a
// 42 KB subtree and JSON.stringify recurses into it without bound, so deep
// nesting used to throw RangeError inside the fatal path — the message meant to
// explain the rejection was what crashed. Primitives still echo their text,
// bounded so one long value cannot fill a terminal, and JSON.stringify escapes
// control characters so a string cannot break the line either.
function describeValue(value) {
  if (value !== null && typeof value === "object") return typeName(value);
  const text = String(JSON.stringify(value));
  return text.length > 60 ? `${text.slice(0, 60)}…` : text;
}

// A key as it may be printed. JSON.stringify escapes the C0 range but leaves
// DEL raw, so escape that too: the message names the key so the operator can
// find it in the document, and never carries a byte that could garble a
// terminal or break the line.
function describeKey(key) {
  return JSON.stringify(key).replace(
    CONTROL_CHAR,
    (char) => `\\u${char.codePointAt(0).toString(16).padStart(4, "0")}`
  );
}

function fatal(name, problem) {
  console.error(`${name} ${problem}`);
  process.exit(1);
}

// Decimal digits only, never Number() coercion. Number("1e3") is 1000 and
// Number("0x10") is 16, so a coercive check silently reinterprets a ceiling the
// operator wrote — the failure this story names. These are budgets: an operator
// who wants 1000 gets 1000, one who typed 1e3 gets a loud startup crash that is
// one keystroke from correct. Reverse this by loosening the guard and the test
// that pins it.
// min/max exist so the two variables whose story rules differ — the
// concurrency ceiling, where 0 disables, and the margin, which is 0-50 —
// reuse this one guard instead of a near-copy that could drift. The defaults
// reproduce the original positive-integer rule exactly, so the rate pair is
// unaffected.
function readPositiveInteger(
  name,
  raw,
  { min = 1, max = Number.MAX_SAFE_INTEGER, zeroDisables = false } = {}
) {
  const trimmed = raw.trim();
  const value = Number(trimmed);
  if (!/^[0-9]+$/.test(trimmed) || !Number.isSafeInteger(value) || value < min || value > max) {
    console.error(`${name} must be ${integerRule(min, max, zeroDisables)}, got: ${trimmed}`);
    process.exit(1);
  }
  return value;
}

// The rule the guard enforced, phrased for stderr: an operator reading only the
// message has to know which end of the range was violated. zeroDisables gets
// its own wording because 0 there is a disable, not a limit of zero, and the
// generic "non-negative integer" reads as if 0 were a usable value.
function integerRule(min, max, zeroDisables) {
  if (max !== Number.MAX_SAFE_INTEGER) return `an integer between ${min} and ${max}`;
  if (min === 1) return "a positive integer";
  return zeroDisables ? "a positive integer (0 disables)" : "a non-negative integer";
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
