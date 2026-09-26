/**
 * Retry / backoff helper for Microsoft Graph calls — customization #12.
 *
 * Graph returns 429 (rate-limit) and 5xx (server error) responses that are
 * transient: the right thing to do is back off and retry rather than fail
 * the caller outright. Foundation #10 ships msw handlers
 * (`graphErrorHandlers({ throttled: true, serverError: true })`) that
 * produce those exact shapes; this module wires that foundation to a
 * production retry policy.
 *
 * Behaviour:
 *  - 429 → honour `Retry-After` header when present (Graph sometimes sends
 *    it). When the header is missing, fall back to exponential backoff.
 *  - 5xx (500/502/503/504) → exponential backoff with jitter, capped at
 *    `maxDelayMs`.
 *  - Other 4xx (400/401/403/404/...) → no retry; surface the error.
 *  - Total attempts are bounded by `maxRetries` (default 5). Exhausting the
 *    budget throws the last observed error so the caller sees the cause.
 *  - Each retry attempt and the final outcome are emitted through the
 *    structured logger (customization #13) with `module: "teams-mcp-retry"`
 *    so operators can filter telemetry without parsing free-text prefixes.
 *
 * Env overrides (TEAMS_MCP_RETRY_*) are read once at module load. Tests can
 * pass an explicit `RetryConfig` to `withGraphRetry` to avoid touching env.
 */

import { logger as structuredLogger } from "../utils/logger.js";

export interface RetryConfig {
  /** Max number of attempts per call (1 = no retry). Default 5. */
  maxRetries: number;
  /** Base delay for exponential backoff (ms). Default 500. */
  baseDelayMs: number;
  /** Upper bound for any single delay (ms). Default 30_000. */
  maxDelayMs: number;
}

/** Default config read from env (TEAMS_MCP_RETRY_*) at call time. */
export const DEFAULT_RETRY_CONFIG: RetryConfig = readConfigFromEnv();

/** Re-read the retry config from env. Called once at module load and again
 *  on every `withGraphRetry` invocation so test suites (and operators) can
 *  change the budget without restarting the process. */
export function readConfigFromEnv(): RetryConfig {
  return {
    maxRetries: readPositiveIntEnv("TEAMS_MCP_RETRY_MAX_RETRIES", 5),
    baseDelayMs: readPositiveIntEnv("TEAMS_MCP_RETRY_BASE_DELAY_MS", 500),
    maxDelayMs: readPositiveIntEnv("TEAMS_MCP_RETRY_MAX_DELAY_MS", 30_000),
  };
}

/** Status codes that trigger a retry. 5xx is "any"; 429 is the rate-limit. */
const RETRYABLE_5XX = new Set([500, 502, 503, 504]);

/**
 * Minimal GraphError shape we depend on. The real type is exported from
 * `@microsoft/microsoft-graph-client` but we keep the surface narrow so the
 * retry helper stays unit-testable without importing the SDK.
 */
export interface GraphErrorLike extends Error {
  statusCode?: number;
  code?: string | null;
  headers?: Headers | Record<string, string>;
}

/** Sleep helper that resolves after `ms`. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Pseudo-random multiplier in `[0.5, 1.5)` used to spread retries across
 * clients. Pulled out so tests can stub it deterministically.
 */
export function jitterFactor(): number {
  return 0.5 + Math.random();
}

/**
 * Extract the `Retry-After` value from a GraphError. The header may be a
 * delta-seconds (number) per RFC 7231 or an HTTP-date; Graph historically
 * sends seconds. Returns `null` when missing or unparseable.
 */
export function readRetryAfterMs(err: GraphErrorLike): number | null {
  const headers = err.headers;
  if (!headers) return null;

  let raw: string | null = null;
  if (typeof (headers as Headers).get === "function") {
    raw = (headers as Headers).get("Retry-After");
  } else {
    const found = Object.entries(headers as Record<string, string>).find(
      ([k]) => k.toLowerCase() === "retry-after"
    );
    raw = found ? found[1] : null;
  }
  if (!raw) return null;

  const seconds = Number.parseInt(raw, 10);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  return null;
}

/**
 * Decide whether a thrown error is retryable. `GraphError` instances carry
 * `statusCode`; other errors (network, aborts, programmer mistakes) are
 * surfaced unchanged.
 */
export function isRetryableStatus(err: unknown): err is GraphErrorLike {
  if (!err || typeof err !== "object") return false;
  const status = (err as GraphErrorLike).statusCode;
  if (typeof status !== "number") return false;
  if (status === 429) return true;
  return RETRYABLE_5XX.has(status);
}

/**
 * Compute the delay (ms) before the next attempt for a given attempt index
 * (1-based) and source error. Exported for tests.
 *
 *  - 429 with Retry-After: use that value (capped at maxDelayMs, with a
 *    small jitter on top so synchronised clients don't collide).
 *  - 429 without Retry-After or 5xx: exponential `base * 2^(attempt-1)`
 *    multiplied by jitter, capped at `maxDelayMs`.
 */
export function computeDelay(attempt: number, err: GraphErrorLike, cfg: RetryConfig): number {
  const headerMs = readRetryAfterMs(err);
  let base: number;
  if (headerMs !== null) {
    base = headerMs;
  } else {
    base = cfg.baseDelayMs * 2 ** (attempt - 1);
  }
  const jittered = Math.floor(base * jitterFactor());
  // Always wait at least baseDelayMs so a missing/wrong Retry-After: 0
  // header doesn't busy-loop the server.
  return Math.min(Math.max(jittered, cfg.baseDelayMs), cfg.maxDelayMs);
}

/** Telemetry sink — overridable for tests. */
export interface RetryLogger {
  warn: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

/**
 * Production telemetry sink — routes warn/info/error through the structured
 * logger (customization #13). The legacy `[teams-mcp-retry]` free-text
 * prefix is preserved inside the `message` field for backward-compatible
 * grep, and the canonical `module: "teams-mcp-retry"` field is added so
 * structured log shippers can filter without parsing the message body.
 *
 * Tests that need to capture emits inject a `RetryLogger` directly via
 * `withGraphRetry(fn, { logger })` — they bypass this default entirely.
 */
const defaultLogger: RetryLogger = {
  warn: (msg) =>
    structuredLogger.warn(typeof msg === "string" ? msg : String(msg), {
      module: "teams-mcp-retry",
    }),
  info: (msg) =>
    structuredLogger.info(typeof msg === "string" ? msg : String(msg), {
      module: "teams-mcp-retry",
    }),
  error: (msg) =>
    structuredLogger.error(typeof msg === "string" ? msg : String(msg), {
      module: "teams-mcp-retry",
    }),
};

export interface WithGraphRetryOptions {
  config?: Partial<RetryConfig>;
  logger?: RetryLogger;
  /** Operation label used in telemetry (e.g. the Graph path). */
  operation?: string;
  /** Injectable sleep for tests; defaults to setTimeout-based `sleep`. */
  sleeper?: (ms: number) => Promise<void>;
}

/**
 * Invoke `fn` and retry on transient Graph failures. Returns the resolved
 * value of the first successful attempt, or throws the last observed error
 * after `maxRetries` attempts.
 *
 * `fn` should throw a `GraphError` (or anything with `statusCode`) on
 * failure; non-throwing returns are treated as success.
 */
export async function withGraphRetry<T>(
  fn: () => Promise<T>,
  opts: WithGraphRetryOptions = {}
): Promise<T> {
  const cfg: RetryConfig = { ...readConfigFromEnv(), ...(opts.config ?? {}) };
  const logger = opts.logger ?? defaultLogger;
  const sleepFn = opts.sleeper ?? sleep;
  const op = opts.operation ?? "<graph>";

  let lastError: unknown;
  for (let attempt = 1; attempt <= cfg.maxRetries; attempt++) {
    try {
      const result = await fn();
      if (attempt > 1) {
        logger.info(`[teams-mcp-retry] success op=${op} after=${attempt}`);
      }
      return result;
    } catch (err) {
      lastError = err;
      if (!isRetryableStatus(err)) {
        throw err;
      }
      if (attempt >= cfg.maxRetries) {
        const status = (err as GraphErrorLike).statusCode;
        logger.error(
          `[teams-mcp-retry] exhausted op=${op} attempts=${attempt} lastStatus=${status}`
        );
        break;
      }
      const delay = computeDelay(attempt, err as GraphErrorLike, cfg);
      const status = (err as GraphErrorLike).statusCode;
      logger.warn(
        `[teams-mcp-retry] retry op=${op} attempt=${attempt}/${cfg.maxRetries} status=${status} delayMs=${delay}`
      );
      await sleepFn(delay);
    }
  }
  throw lastError;
}

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
