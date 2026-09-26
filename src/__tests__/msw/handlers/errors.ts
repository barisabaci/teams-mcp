/**
 * Error / rate-limit handlers — opt-in error simulation for retry/backoff
 * tests.
 *
 * Usage from a test:
 * ```ts
 * import { graphErrorHandlers } from "../../__tests__/msw/handlers/errors.js";
 * import { server } from "../../test-utils/setup.js";
 *
 * server.use(...graphErrorHandlers({ throttled: true, serverError: false }));
 * ```
 *
 * These handlers are NOT registered by default. They live behind a
 * factory so that production-shape test suites (which expect 200/JSON)
 * keep working and only tests that explicitly opt-in observe 4xx/5xx.
 *
 * The 429 response body matches the Graph rate-limit envelope that
 * upstream returns when the tenant throttles a client:
 *   { "error": { "code": "TooManyRequests", "message": "..." } }
 * plus a `Retry-After` header in seconds. Retry/backoff code (#12)
 * reads both fields.
 */
import { HttpResponse, http } from "msw";

/** Path glob that matches every Graph v1.0 request, including the bare
 *  `/v1.0/me` segment (msw's `*` does not match the empty path after a
 *  segment, so we use a regex-based `http.all` for full coverage). */
const ANY_GRAPH = "https://graph.microsoft.com/v1.0/**";

export interface GraphErrorOptions {
  /** When true, every handled request returns 429 with `Retry-After`. */
  throttled?: boolean;
  /** When true, every handled request returns 500 (generic server error). */
  serverError?: boolean;
  /** When true, every handled request returns 503 (service unavailable). */
  serviceUnavailable?: boolean;
  /** When true, every handled request returns 401 (token missing/expired). */
  unauthenticated?: boolean;
  /** When true, every handled request returns 403 (insufficient scopes). */
  forbidden?: boolean;
  /** Optional override for the `Retry-After` header (seconds). */
  retryAfterSeconds?: number;
}

const graphErrorBody = (code: string, message: string) => ({
  error: {
    code,
    message,
  },
});

/**
 * Build a set of msw RequestHandler instances that short-circuit every
 * 1.0 Graph request with the configured error.
 *
 * Only the flags that are `true` produce handlers; multiple flags compose
 * so e.g. `graphErrorHandlers({ throttled: true, serverError: true })`
 * returns a 429 on the first request and a 500 on the second.
 *
 * Handlers use `http.all` on a `**` glob so they match every request —
 * including paths like `/v1.0/me` (no further segments) — and override
 * the specific path handlers registered as defaults. `server.use(...)`
 * is the supported way to layer these; msw processes override handlers
 * before the default set.
 */
export function graphErrorHandlers(opts: GraphErrorOptions = {}): ReturnType<typeof http.get>[] {
  const handlers: ReturnType<typeof http.get>[] = [];

  if (opts.unauthenticated) {
    handlers.push(
      http.all(ANY_GRAPH, () =>
        HttpResponse.json(graphErrorBody("InvalidAuthenticationToken", "Access token is empty."), {
          status: 401,
        })
      )
    );
  }

  if (opts.forbidden) {
    handlers.push(
      http.all(ANY_GRAPH, () =>
        HttpResponse.json(
          graphErrorBody("Forbidden", "Insufficient privileges to complete the operation."),
          { status: 403 }
        )
      )
    );
  }

  if (opts.throttled) {
    const retryAfter = opts.retryAfterSeconds ?? 30;
    handlers.push(
      http.all(ANY_GRAPH, () =>
        HttpResponse.json(graphErrorBody("TooManyRequests", "Too many requests"), {
          status: 429,
          headers: { "Retry-After": String(retryAfter) },
        })
      )
    );
  }

  if (opts.serverError) {
    handlers.push(
      http.all(ANY_GRAPH, () =>
        HttpResponse.json(
          graphErrorBody("InternalServerError", "An internal server error occurred."),
          { status: 500 }
        )
      )
    );
  }

  if (opts.serviceUnavailable) {
    handlers.push(
      http.all(ANY_GRAPH, () =>
        HttpResponse.json(
          graphErrorBody("ServiceUnavailable", "Service is temporarily unavailable."),
          { status: 503, headers: { "Retry-After": "10" } }
        )
      )
    );
  }

  return handlers;
}
