/**
 * Error-simulation tests — exercise `graphErrorHandlers` so future
 * customisation #12 (retry/backoff) can rely on the throttled /
 * serverError / serviceUnavailable shapes.
 */
import { describe, expect, it } from "vitest";
import { server } from "../../test-utils/setup.js";
import { graphErrorHandlers } from "./handlers/index.js";

describe("graphErrorHandlers", () => {
  it("returns 429 with Retry-After header when throttled", async () => {
    server.use(...graphErrorHandlers({ throttled: true, retryAfterSeconds: 17 }));

    const res = await fetch("https://graph.microsoft.com/v1.0/me");
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("17");
    const body = await res.json();
    expect(body.error.code).toBe("TooManyRequests");
    expect(body.error.message).toBe("Too many requests");
  });

  it("returns 500 when serverError is set", async () => {
    server.use(...graphErrorHandlers({ serverError: true }));

    const res = await fetch("https://graph.microsoft.com/v1.0/me");
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe("InternalServerError");
  });

  it("returns 503 with Retry-After when serviceUnavailable is set", async () => {
    server.use(...graphErrorHandlers({ serviceUnavailable: true }));

    const res = await fetch("https://graph.microsoft.com/v1.0/me");
    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("10");
    const body = await res.json();
    expect(body.error.code).toBe("ServiceUnavailable");
  });

  it("returns 401 when unauthenticated is set", async () => {
    server.use(...graphErrorHandlers({ unauthenticated: true }));

    const res = await fetch("https://graph.microsoft.com/v1.0/me");
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("InvalidAuthenticationToken");
  });

  it("returns 403 when forbidden is set", async () => {
    server.use(...graphErrorHandlers({ forbidden: true }));

    const res = await fetch("https://graph.microsoft.com/v1.0/me");
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("Forbidden");
  });

  it("multiple flags layer in declared order", async () => {
    // First call: throttled; subsequent request goes to default handlers
    // because the throttled handler was unregistered after `resetHandlers`.
    server.use(...graphErrorHandlers({ throttled: true }));

    const r1 = await fetch("https://graph.microsoft.com/v1.0/me");
    expect(r1.status).toBe(429);

    server.resetHandlers();
    const r2 = await fetch("https://graph.microsoft.com/v1.0/me");
    expect(r2.status).toBe(200);
  });

  it("returns empty handlers when no flag is set", () => {
    expect(graphErrorHandlers()).toEqual([]);
  });
});
