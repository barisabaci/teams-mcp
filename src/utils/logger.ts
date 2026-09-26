/**
 * Structured logger for teams-mcp — customization #13.
 *
 * Goals:
 *  - One-line JSON records that downstream log shippers can parse without a
 *    custom regex. Each `emit()` writes a single `JSON.stringify`'d object
 *    followed by a newline to **stderr**. stderr (not stdout) is deliberate:
 *    MCP stdio mode uses stdout for the JSON-RPC protocol stream, so any
 *    informational output there would corrupt the wire format.
 *  - Level filter driven by `LOG_LEVEL` env (`debug` | `info` | `warn` |
 *    `error`; default `info`). Read at every emit so tests/operators can
 *    change it without restarting the process.
 *  - **Deny-list** sensitive-data redaction. The default policy is to redact
 *    — operators opt OUT of a field, never opt IN. We do not maintain a
 *    key allowlist; the deny-list is the safe path. Two layers:
 *      (a) **key-based**: if a key matches `token`, `access_token`,
 *          `refresh_token`, `password`, `secret`, `api_key`, `authorization`,
 *          `cookie` (case-insensitive) → value becomes `"REDACTED"`.
 *      (b) **value-based**: every string value is scanned for email-shaped
 *          or phone-shaped substrings; matches become `"REDACTED"`.
 *  - Operation context. `withOperation(name, fn)` runs `fn`, measures
 *    latency, attaches a fresh `request_id` (uuid v4), and emits a single
 *    log line with `operation`, `request_id`, `latency_ms`, `status`
 *    (`ok` | `error`). On throw it logs at `error` level with the message
 *    and stack, then re-throws so the caller still sees the failure.
 *  - Optional file sink: when `LOG_FILE` env is set, JSON lines are
 *    appended to that path in addition to stderr. Failures to write to the
 *    file are reported once on stderr but do not throw — telemetry must
 *    never crash a request.
 *
 * Pre-existing telemetry (`[teams-mcp-retry]` warn/info/error from
 * customization #12) is preserved by routing through this module with
 * `module: "teams-mcp-retry"`. The prefix stays in the `message` field for
 * backward-compat grep, and the structured `module` field replaces the
 * free-text prefix as the canonical handle.
 */

import { randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

/**
 * Key-based deny-list. Match is case-insensitive and uses a whole-word check
 * so `userTokenCount` is NOT redacted (different concept; users have many
 * "tokens" that aren't credentials). Hyphens and underscores are separators
 * (so `auth-token`, `auth_token`, `auth.token` all match `auth`).
 */
const DENY_KEYS = [
  "token",
  "access_token",
  "refresh_token",
  "password",
  "secret",
  "api_key",
  "apikey",
  "authorization",
  "cookie",
  "set-cookie",
];

function keyMatchesDeny(key: string): boolean {
  const lower = key.toLowerCase();
  return DENY_KEYS.some((deny) => {
    // word-boundary style match against `[_-]` separators
    const re = new RegExp(`(^|[._-])${deny.replace(/_/g, "[-_]")}([._-]|$)`);
    return re.test(lower);
  });
}

// Email regex — RFC 5322 is enormous; this captures "looks like an email"
// without false-positive cost. Allows `+` aliases and dots in local part.
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

// Phone regex — 7+ consecutive digits, optionally preceded by + or wrapped in
// common separators. Avoids matching short numeric IDs by requiring ≥7.
// Anchored lookbehind/lookahead aren't supported in Node 18's regex engine
// for the older ES spec, so we use capture-and-restore.
const PHONE_RE = /(?:\+?\d{1,3}[ .-]?)?(?:\d{3}[ .-]?\d{3,4}[ .-]?\d{4}|\d{7,})/g;

const REDACTED = "REDACTED";

/**
 * Recursively redact sensitive substrings from a value. Strings are scanned
 * for email/phone-shaped matches; objects/arrays are walked. Keys matching
 * the deny-list short-circuit to `"REDACTED"` without scanning the value.
 *
 * The function never throws — a value with a circular reference will simply
 * stop recursing at that depth.
 */
export function redact(value: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    return value.replace(EMAIL_RE, REDACTED).replace(PHONE_RE, (match) => {
      // Phone regex also matches long digit runs (e.g. "1234567890123").
      // Require ≥7 digits OR a clear phone-shape with separators.
      const digits = match.replace(/\D/g, "");
      if (digits.length >= 7) return REDACTED;
      return match;
    });
  }
  if (typeof value !== "object") return value;
  if (seen.has(value as object)) return "[Circular]";
  seen.add(value as object);

  if (Array.isArray(value)) {
    return value.map((v) => redact(v, seen));
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (keyMatchesDeny(k)) {
      out[k] = REDACTED;
    } else {
      out[k] = redact(v, seen);
    }
  }
  return out;
}

function readLevel(): LogLevel {
  const raw = (process.env.LOG_LEVEL ?? "info").toLowerCase().trim();
  if (raw === "debug" || raw === "info" || raw === "warn" || raw === "error") {
    return raw;
  }
  return "info";
}

/**
 * Build a structured `{ message, stack? }` payload from any thrown value.
 * `stack` is only included when present so the JSON doesn't carry a noisy
 * `"stack": undefined` field — and so this satisfies
 * `exactOptionalPropertyTypes` at the call site.
 */
export function errorPayload(err: unknown): { message: string; stack?: string } {
  if (err instanceof Error) {
    const out: { message: string; stack?: string } = { message: err.message };
    if (err.stack) out.stack = err.stack;
    return out;
  }
  return { message: String(err) };
}

function shouldEmit(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[readLevel()];
}

function nowIso(): string {
  return new Date().toISOString();
}

export interface LogFields {
  [key: string]: unknown;
  module?: string;
  operation?: string;
  request_id?: string;
  latency_ms?: number;
  status?: "ok" | "error";
  error?: { message: string; stack?: string | undefined };
}

interface EmitOptions {
  /** Optional override for the file sink (used by tests). */
  fileSink?: string;
  /** Test hook: capture the structured payload instead of writing it. */
  capture?: (line: string, fields: LogFields) => void;
}

let lastFileWriteError: string | null = null;

function writeToFile(path: string, line: string): void {
  try {
    appendFileSync(path, `${line}\n`, { encoding: "utf8" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg !== lastFileWriteError) {
      lastFileWriteError = msg;
      // File sink failure should never crash the process. Report on stderr
      // once per distinct error.
      process.stderr.write(
        `${JSON.stringify({
          ts: nowIso(),
          level: "warn",
          module: "teams-mcp-logger",
          message: "LOG_FILE write failed",
          error: { message: msg },
        })}\n`
      );
    }
  }
}

/**
 * Internal core. Public methods below wrap this with the right level.
 */
function emit(
  level: LogLevel,
  message: string,
  fields: LogFields = {},
  opts: EmitOptions = {}
): void {
  if (!shouldEmit(level)) return;

  const payload: LogFields = {
    ts: nowIso(),
    level,
    message,
    ...fields,
  };
  const redacted = redact(payload) as LogFields;
  const line = JSON.stringify(redacted);

  if (opts.capture) {
    opts.capture(line, redacted);
    return;
  }

  // stderr — keeps stdout free for the MCP JSON-RPC stream.
  process.stderr.write(`${line}\n`);

  const filePath = opts.fileSink ?? process.env.LOG_FILE;
  if (filePath) {
    writeToFile(filePath, line);
  }
}

export const logger = {
  debug(message: string, fields?: LogFields, opts?: EmitOptions): void {
    emit("debug", message, fields, opts);
  },
  info(message: string, fields?: LogFields, opts?: EmitOptions): void {
    emit("info", message, fields, opts);
  },
  warn(message: string, fields?: LogFields, opts?: EmitOptions): void {
    emit("warn", message, fields, opts);
  },
  error(message: string, fields?: LogFields, opts?: EmitOptions): void {
    emit("error", message, fields, opts);
  },
} as const;

/**
 * Operation context. Wraps an async function so each invocation gets:
 *   - a fresh `request_id`
 *   - measured `latency_ms`
 *   - emitted log line with `operation`, `request_id`, `latency_ms`, `status`
 *
 * On success: `level=info`, `status="ok"`. On throw: `level=error`,
 * `status="error"`, plus `error.message` and `error.stack`, then re-throws.
 */
export async function withOperation<T>(
  operation: string,
  fn: () => Promise<T>,
  fields: LogFields = {},
  opts: EmitOptions = {}
): Promise<T> {
  const request_id = randomUUID();
  const start = Date.now();
  try {
    const result = await fn();
    emit(
      "info",
      `${operation} ok`,
      {
        ...fields,
        module: fields.module ?? "teams-mcp",
        operation,
        request_id,
        latency_ms: Date.now() - start,
        status: "ok",
      },
      opts
    );
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    const errorPayload: { message: string; stack?: string } = { message };
    if (stack) errorPayload.stack = stack;
    emit(
      "error",
      `${operation} error: ${message}`,
      {
        ...fields,
        module: fields.module ?? "teams-mcp",
        operation,
        request_id,
        latency_ms: Date.now() - start,
        status: "error",
        error: errorPayload,
      },
      opts
    );
    throw err;
  }
}
