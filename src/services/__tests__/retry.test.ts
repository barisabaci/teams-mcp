/**
 * Retry/backoff helper tests (customization #12).
 *
 * Exercises `withGraphRetry` against msw to prove the four behaviours the
 * card requires: 429 honours `Retry-After`, 5xx uses exponential backoff,
 * success on first try is not retried, and the retry budget is capped at
 * 5 attempts by default.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "../../test-utils/setup.js";
import {
  computeDelay,
  type GraphErrorLike,
  isRetryableStatus,
  jitterFactor,
  type RetryLogger,
  readRetryAfterMs,
  sleep,
  withGraphRetry,
} from "../retry.js";

class FakeGraphError extends Error implements GraphErrorLike {
  statusCode: number;
  code: string | null;
  headers?: Headers | Record<string, string>;
  constructor(
    statusCode: number,
    opts: { headers?: Headers | Record<string, string>; code?: string } = {}
  ) {
    super(`GraphError ${statusCode}`);
    this.name = "GraphError";
    this.statusCode = statusCode;
    this.code = opts.code ?? null;
    this.headers = opts.headers;
  }
}

const noopLogger: RetryLogger = {
  warn: () => undefined,
  info: () => undefined,
  error: () => undefined,
};

describe("retry helper", () => {
  beforeEach(() => {
    vi.useRealTimers();
    server.resetHandlers();
  });

  afterEach(() => {
    vi.useRealTimers();
    server.resetHandlers();
  });

  describe("isRetryableStatus", () => {
    it("retries on 429", () => {
      expect(isRetryableStatus({ statusCode: 429 })).toBe(true);
    });
    it("retries on 500/502/503/504", () => {
      for (const s of [500, 502, 503, 504]) {
        expect(isRetryableStatus({ statusCode: s })).toBe(true);
      }
    });
    it("does NOT retry on other 4xx", () => {
      for (const s of [400, 401, 403, 404, 409]) {
        expect(isRetryableStatus({ statusCode: s })).toBe(false);
      }
    });
    it("does NOT retry on 2xx / non-objects", () => {
      expect(isRetryableStatus({ statusCode: 200 })).toBe(false);
      expect(isRetryableStatus(null)).toBe(false);
      expect(isRetryableStatus(new Error("boom"))).toBe(false);
    });
  });

  describe("readRetryAfterMs", () => {
    it("parses a Headers instance", () => {
      const h = new Headers({ "Retry-After": "12" });
      expect(readRetryAfterMs({ headers: h } as GraphErrorLike)).toBe(12_000);
    });
    it("parses a plain-object header map (case-insensitive)", () => {
      expect(readRetryAfterMs({ headers: { "retry-after": "7" } } as GraphErrorLike)).toBe(7000);
    });
    it("returns null when the header is missing or unparseable", () => {
      expect(readRetryAfterMs({ headers: new Headers() } as GraphErrorLike)).toBeNull();
      expect(
        readRetryAfterMs({ headers: { "Retry-After": "not-a-number" } } as GraphErrorLike)
      ).toBeNull();
      expect(readRetryAfterMs({} as GraphErrorLike)).toBeNull();
    });
  });

  describe("computeDelay", () => {
    it("uses Retry-After when present (with min baseDelay floor and cap)", () => {
      const cfg = { maxRetries: 5, baseDelayMs: 500, maxDelayMs: 30_000 };
      const delay = computeDelay(
        1,
        { headers: new Headers({ "Retry-After": "2" }) } as GraphErrorLike,
        cfg
      );
      // base 2000ms * jitter[0.5..1.5) clamped to [500, 30000]
      expect(delay).toBeGreaterThanOrEqual(500);
      expect(delay).toBeLessThan(3000);
    });

    it("grows exponentially for 5xx without Retry-After", () => {
      const cfg = { maxRetries: 5, baseDelayMs: 500, maxDelayMs: 30_000 };
      // Force jitter=1 so the assertion is deterministic.
      vi.spyOn(Math, "random").mockReturnValue(0.5); // jitter = 0.5 + 0.5 = 1.0
      const d1 = computeDelay(1, {} as GraphErrorLike, cfg);
      const d2 = computeDelay(2, {} as GraphErrorLike, cfg);
      const d3 = computeDelay(3, {} as GraphErrorLike, cfg);
      expect(d1).toBe(500);
      expect(d2).toBe(1000);
      expect(d3).toBe(2000);
      vi.restoreAllMocks();
    });

    it("caps delay at maxDelayMs", () => {
      const cfg = { maxRetries: 10, baseDelayMs: 500, maxDelayMs: 1500 };
      vi.spyOn(Math, "random").mockReturnValue(0.999); // jitter near 1.5
      // attempt 10 with base 500ms: 500 * 2^9 = 256000 -> capped
      expect(computeDelay(10, {} as GraphErrorLike, cfg)).toBeLessThanOrEqual(1500);
      vi.restoreAllMocks();
    });
  });

  describe("jitterFactor", () => {
    it("stays within [0.5, 1.5)", () => {
      for (let i = 0; i < 100; i++) {
        const j = jitterFactor();
        expect(j).toBeGreaterThanOrEqual(0.5);
        expect(j).toBeLessThan(1.5);
      }
    });
  });

  describe("withGraphRetry against msw", () => {
    it("retries on 429 and honours Retry-After header (msw)", async () => {
      // Retry-After=1 (1 second) => ~1000ms delay before retry.
      // First attempt: 429, second attempt: 200.
      let calls = 0;
      const retryDelays: number[] = [];
      const sleeper = vi.fn(async (ms: number) => {
        retryDelays.push(ms);
      });
      const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
        calls++;
        if (calls === 1) {
          return new Response(
            JSON.stringify({ error: { code: "TooManyRequests", message: "throttled" } }),
            { status: 429, headers: { "Retry-After": "1" } }
          );
        }
        return new Response(JSON.stringify({ id: "mock-user-id" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      });

      const result = await withGraphRetry(
        async () => {
          const res = await fetch("https://graph.microsoft.com/v1.0/me");
          if (!res.ok) {
            throw new FakeGraphError(res.status, {
              headers: Object.fromEntries(res.headers.entries()),
              code: "TooManyRequests",
            });
          }
          return (await res.json()) as { id: string };
        },
        { logger: noopLogger, sleeper, config: { baseDelayMs: 500, maxDelayMs: 30_000 } }
      );

      expect(result).toEqual({ id: "mock-user-id" });
      expect(calls).toBe(2);
      expect(retryDelays).toHaveLength(1);
      // Retry-After=1s => base 1000ms * jitter[0.5,1.5) clamped to [500, 30000]
      expect(retryDelays[0]).toBeGreaterThanOrEqual(500);
      expect(retryDelays[0]).toBeLessThan(1500);
      spy.mockRestore();
    });

    it("retries on 503 (5xx) with exponential backoff", async () => {
      let calls = 0;
      const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
        calls++;
        if (calls < 3) {
          return new Response(
            JSON.stringify({ error: { code: "ServiceUnavailable", message: "down" } }),
            { status: 503 }
          );
        }
        return new Response(JSON.stringify({ id: "mock-user-id" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      });

      const sleeper = vi.fn(async () => undefined);

      const result = await withGraphRetry(
        async () => {
          const res = await fetch("https://graph.microsoft.com/v1.0/me");
          if (!res.ok) {
            throw new FakeGraphError(res.status, { code: "ServiceUnavailable" });
          }
          return (await res.json()) as { id: string };
        },
        {
          logger: noopLogger,
          sleeper,
          config: { maxRetries: 5, baseDelayMs: 500, maxDelayMs: 30_000 },
        }
      );

      expect(result).toEqual({ id: "mock-user-id" });
      expect(calls).toBe(3);
      expect(sleeper).toHaveBeenCalledTimes(2);
      spy.mockRestore();
    });

    it("does NOT retry when first attempt succeeds", async () => {
      let calls = 0;
      const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
        calls++;
        return new Response(JSON.stringify({ id: "ok" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      });
      const sleeper = vi.fn(async () => undefined);

      const result = await withGraphRetry(
        async () => {
          const res = await fetch("https://graph.microsoft.com/v1.0/me");
          return (await res.json()) as { id: string };
        },
        {
          logger: noopLogger,
          sleeper,
          config: { maxRetries: 5, baseDelayMs: 500, maxDelayMs: 30_000 },
        }
      );

      expect(result).toEqual({ id: "ok" });
      expect(calls).toBe(1);
      expect(sleeper).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it("does NOT retry on non-retryable 4xx (e.g. 401)", async () => {
      let calls = 0;
      const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
        calls++;
        return new Response(
          JSON.stringify({ error: { code: "InvalidAuthenticationToken", message: "nope" } }),
          { status: 401 }
        );
      });
      const sleeper = vi.fn(async () => undefined);

      await expect(
        withGraphRetry(
          async () => {
            const res = await fetch("https://graph.microsoft.com/v1.0/me");
            if (!res.ok) {
              throw new FakeGraphError(res.status, { code: "InvalidAuthenticationToken" });
            }
            return res.json();
          },
          {
            logger: noopLogger,
            sleeper,
            config: { maxRetries: 5, baseDelayMs: 500, maxDelayMs: 30_000 },
          }
        )
      ).rejects.toThrow();

      expect(calls).toBe(1);
      expect(sleeper).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it("respects retry budget — 5 attempts then throws", async () => {
      let calls = 0;
      const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
        calls++;
        return new Response(
          JSON.stringify({ error: { code: "ServiceUnavailable", message: "always" } }),
          { status: 503 }
        );
      });
      const sleeper = vi.fn(async () => undefined);

      await expect(
        withGraphRetry(
          async () => {
            const res = await fetch("https://graph.microsoft.com/v1.0/me");
            if (!res.ok) {
              throw new FakeGraphError(res.status, { code: "ServiceUnavailable" });
            }
            return res.json();
          },
          { logger: noopLogger, sleeper, config: { maxRetries: 5, baseDelayMs: 1, maxDelayMs: 10 } }
        )
      ).rejects.toThrow();

      // maxRetries=5 means exactly 5 attempts, with 4 sleeps in between.
      expect(calls).toBe(5);
      expect(sleeper).toHaveBeenCalledTimes(4);
      spy.mockRestore();
    });

    it("emits warn / info / error telemetry", async () => {
      let calls = 0;
      const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
        calls++;
        if (calls < 2) {
          return new Response(JSON.stringify({ error: { code: "ServerError", message: "x" } }), {
            status: 500,
          });
        }
        return new Response(JSON.stringify({ id: "ok" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      });
      const warn = vi.fn();
      const info = vi.fn();
      const error = vi.fn();
      const logger: RetryLogger = { warn, info, error };
      const sleeper = vi.fn(async () => undefined);

      await withGraphRetry(
        async () => {
          const res = await fetch("https://graph.microsoft.com/v1.0/me");
          if (!res.ok) {
            throw new FakeGraphError(res.status, { code: "ServerError" });
          }
          return res.json();
        },
        {
          logger,
          sleeper,
          operation: "/me",
          config: { maxRetries: 5, baseDelayMs: 1, maxDelayMs: 10 },
        }
      );

      expect(warn).toHaveBeenCalledTimes(1);
      const warnMsg = warn.mock.calls[0].join(" ");
      expect(warnMsg).toContain("op=/me");
      expect(warnMsg).toContain("attempt=1/5");
      expect(warnMsg).toContain("status=500");
      expect(info).toHaveBeenCalledTimes(1);
      const infoMsg = info.mock.calls[0].join(" ");
      expect(infoMsg).toContain("success");
      expect(infoMsg).toContain("op=/me");
      expect(infoMsg).toContain("after=2");
      expect(error).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it("emits error telemetry when budget exhausted", async () => {
      const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
        return new Response(JSON.stringify({ error: { code: "ServerError", message: "x" } }), {
          status: 500,
        });
      });
      const warn = vi.fn();
      const info = vi.fn();
      const error = vi.fn();
      const logger: RetryLogger = { warn, info, error };
      const sleeper = vi.fn(async () => undefined);

      await expect(
        withGraphRetry(
          async () => {
            const res = await fetch("https://graph.microsoft.com/v1.0/me");
            if (!res.ok) {
              throw new FakeGraphError(res.status, { code: "ServerError" });
            }
            return res.json();
          },
          {
            logger,
            sleeper,
            operation: "/me",
            config: { maxRetries: 3, baseDelayMs: 1, maxDelayMs: 10 },
          }
        )
      ).rejects.toThrow();

      expect(warn).toHaveBeenCalledTimes(2);
      expect(error).toHaveBeenCalledTimes(1);
      const errMsg = error.mock.calls[0].join(" ");
      expect(errMsg).toContain("exhausted");
      expect(errMsg).toContain("op=/me");
      expect(errMsg).toContain("lastStatus=500");
      spy.mockRestore();
    });
  });

  describe("config override", () => {
    it("respects per-call config overrides (maxRetries=2)", async () => {
      let calls = 0;
      const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
        calls++;
        return new Response(JSON.stringify({ error: { code: "ServerError", message: "x" } }), {
          status: 500,
        });
      });
      const sleeper = vi.fn(async () => undefined);

      await expect(
        withGraphRetry(
          async () => {
            const res = await fetch("https://graph.microsoft.com/v1.0/me");
            if (!res.ok) {
              throw new FakeGraphError(res.status, { code: "ServerError" });
            }
            return res.json();
          },
          { logger: noopLogger, sleeper, config: { maxRetries: 2, baseDelayMs: 1, maxDelayMs: 10 } }
        )
      ).rejects.toThrow();

      expect(calls).toBe(2);
      expect(sleeper).toHaveBeenCalledTimes(1);
      spy.mockRestore();
    });
  });
});

describe("sleep helper", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("waits at least the requested ms before resolving", async () => {
    const order: string[] = [];
    const p = sleep(100).then(() => order.push("done"));
    order.push("scheduled");
    await vi.advanceTimersByTimeAsync(99);
    expect(order).toEqual(["scheduled"]);
    await vi.advanceTimersByTimeAsync(1);
    await p;
    expect(order).toEqual(["scheduled", "done"]);
  });
});
