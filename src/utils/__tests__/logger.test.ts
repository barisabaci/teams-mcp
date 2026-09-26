/**
 * Structured logger tests — customization #13.
 *
 * Verifies the four behaviours the card requires plus two safety nets:
 *   - JSON parseable (every emitted line is valid JSON)
 *   - Sensitive redaction (token, email, phone all become REDACTED)
 *   - Log level filter (LOG_LEVEL env suppresses lower-severity emits)
 *   - Operation context (request_id, latency_ms, status fields)
 *   - Error re-throw (withOperation logs but does not swallow)
 *   - Retry module tag ([teams-mcp-retry] telemetry carries module field)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type LogFields, logger, redact, withOperation } from "../logger.js";

describe("logger", () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    vi.unstubAllEnvs();
  });

  /** Collect the structured lines emitted during a test. */
  function collectLines(): LogFields[] {
    const lines: LogFields[] = [];
    for (const call of stderrSpy.mock.calls) {
      const arg = call[0];
      const text = typeof arg === "string" ? arg : (arg?.toString?.() ?? "");
      for (const raw of text.split("\n")) {
        if (!raw) continue;
        try {
          lines.push(JSON.parse(raw));
        } catch {
          // ignore non-JSON noise
        }
      }
    }
    return lines;
  }

  describe("JSON parseable", () => {
    it("emits a single valid JSON object per call", () => {
      logger.info("hello world", { foo: 1, bar: "baz" });
      const lines = collectLines();
      expect(lines).toHaveLength(1);
      const [entry] = lines;
      expect(entry).toMatchObject({
        ts: expect.any(String),
        level: "info",
        message: "hello world",
        foo: 1,
        bar: "baz",
      });
      // ts is an ISO timestamp
      expect(() => new Date(entry.ts as string).toISOString()).not.toThrow();
    });
  });

  describe("sensitive redaction (deny-list)", () => {
    it("redacts key-based credentials (token/password/secret/etc.)", () => {
      logger.info("creds", {
        token: "abc.def.ghi",
        access_token: "ya29.x",
        refresh_token: "1//0gX",
        password: "hunter2",
        secret: "shhh",
        api_key: "AKIAIOSFODNN7EXAMPLE",
        authorization: "Bearer xyz",
        cookie: "sid=abc",
        nested: { password: "deep", ok: "leave-me-alone" },
        list: [{ token: "t1" }, { token: "t2" }],
      });
      const [entry] = collectLines();
      expect(entry?.token).toBe("REDACTED");
      expect(entry?.access_token).toBe("REDACTED");
      expect(entry?.refresh_token).toBe("REDACTED");
      expect(entry?.password).toBe("REDACTED");
      expect(entry?.secret).toBe("REDACTED");
      expect(entry?.api_key).toBe("REDACTED");
      expect(entry?.authorization).toBe("REDACTED");
      expect(entry?.cookie).toBe("REDACTED");
      // Nested redaction works.
      const nested = entry?.nested as { password: string; ok: string };
      expect(nested?.password).toBe("REDACTED");
      expect(nested?.ok).toBe("leave-me-alone");
      // Arrays are walked.
      const list = entry?.list as Array<{ token: string }>;
      expect(list?.[0]?.token).toBe("REDACTED");
      expect(list?.[1]?.token).toBe("REDACTED");
    });

    it("redacts email and phone-shaped values inside any string", () => {
      logger.info("msg", {
        body: "ping alice@example.com about +1 415-555-1212 or 4155551212",
        message: "Reach me at bob+filter@example.co.uk tomorrow",
      });
      const [entry] = collectLines();
      const body = entry?.body as string;
      const message = entry?.message as string;
      expect(body).toContain("REDACTED");
      expect(body).not.toContain("alice@example.com");
      expect(body).not.toContain("415-555-1212");
      // 4155551212 (10 digits) matches the phone regex
      expect(body).not.toMatch(/\b4155551212\b/);
      expect(message).not.toContain("bob+filter@example.co.uk");
      expect(message).toContain("REDACTED");
    });

    it("does NOT redact short numeric IDs (<7 digits)", () => {
      // 6-digit id should not be misread as a phone.
      logger.info("id", { ticketId: "654321", code: "1234" });
      const [entry] = collectLines();
      expect(entry?.ticketId).toBe("654321");
      expect(entry?.code).toBe("1234");
    });

    it("redact() helper handles circular references without throwing", () => {
      const a: Record<string, unknown> = { name: "x" };
      a.self = a;
      expect(() => redact(a)).not.toThrow();
      const out = redact(a) as { name: string; self: unknown };
      expect(out.name).toBe("x");
      expect(out.self).toBe("[Circular]");
    });
  });

  describe("log level filter (LOG_LEVEL env)", () => {
    it("default level (no LOG_LEVEL set) is info — suppresses debug", () => {
      delete process.env.LOG_LEVEL;
      logger.debug("d");
      logger.info("i");
      logger.warn("w");
      logger.error("e");
      const lines = collectLines();
      const levels = lines.map((l) => l.level);
      expect(levels).toEqual(["info", "warn", "error"]);
    });

    it("LOG_LEVEL=warn suppresses info and debug", () => {
      vi.stubEnv("LOG_LEVEL", "warn");
      logger.debug("d");
      logger.info("i");
      logger.warn("w");
      logger.error("e");
      const lines = collectLines();
      const levels = lines.map((l) => l.level);
      expect(levels).toEqual(["warn", "error"]);
    });

    it("LOG_LEVEL=debug emits every level", () => {
      vi.stubEnv("LOG_LEVEL", "debug");
      logger.debug("d");
      logger.info("i");
      logger.warn("w");
      logger.error("e");
      const lines = collectLines();
      expect(lines.map((l) => l.level)).toEqual(["debug", "info", "warn", "error"]);
    });

    it("LOG_LEVEL=error emits only error", () => {
      vi.stubEnv("LOG_LEVEL", "error");
      logger.debug("d");
      logger.info("i");
      logger.warn("w");
      logger.error("e");
      const lines = collectLines();
      expect(lines.map((l) => l.level)).toEqual(["error"]);
    });

    it("invalid LOG_LEVEL falls back to info", () => {
      vi.stubEnv("LOG_LEVEL", "bogus");
      logger.debug("d");
      logger.info("i");
      const lines = collectLines();
      expect(lines.map((l) => l.level)).toEqual(["info"]);
    });
  });

  describe("operation context (withOperation)", () => {
    it("attaches request_id, latency_ms, status=ok on success", async () => {
      await withOperation("graph_call", async () => {
        await new Promise((r) => setTimeout(r, 5));
      });
      const [entry] = collectLines();
      expect(entry).toMatchObject({
        level: "info",
        message: "graph_call ok",
        operation: "graph_call",
        status: "ok",
        module: "teams-mcp",
      });
      expect(entry?.request_id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
      );
      expect(typeof entry?.latency_ms).toBe("number");
      expect(entry?.latency_ms as number).toBeGreaterThanOrEqual(0);
    });

    it("emits error level with stack and re-throws on failure", async () => {
      const boom = new Error("kaboom");
      await expect(
        withOperation("graph_call", async () => {
          throw boom;
        })
      ).rejects.toBe(boom);
      const [entry] = collectLines();
      expect(entry?.level).toBe("error");
      expect(entry?.status).toBe("error");
      expect(entry?.operation).toBe("graph_call");
      const err = entry?.error as { message: string; stack?: string };
      expect(err.message).toBe("kaboom");
      expect(err.stack).toContain("kaboom");
    });

    it("each call gets a unique request_id", async () => {
      await withOperation("op1", async () => undefined);
      await withOperation("op2", async () => undefined);
      const lines = collectLines();
      const ids = lines.map((l) => l.request_id);
      expect(ids[0]).not.toBe(ids[1]);
    });
  });

  describe("retry module tag", () => {
    it("accepts a module field that downstream parsers can key off", () => {
      // The retry helper tags its emits with module: "teams-mcp-retry".
      // We don't import retry.ts here (covered by retry.test.ts), but we
      // verify the field passes through the structured logger.
      logger.warn("[teams-mcp-retry] retry op=/me attempt=1/5 status=429 delayMs=500", {
        module: "teams-mcp-retry",
        attempt: 1,
        maxAttempts: 5,
        status: 429,
        delayMs: 500,
      });
      const [entry] = collectLines();
      expect(entry?.module).toBe("teams-mcp-retry");
      expect(entry?.level).toBe("warn");
      expect(entry?.attempt).toBe(1);
      expect(entry?.status).toBe(429);
      // Backward-compat: the legacy free-text prefix remains in the message.
      expect(entry?.message).toMatch(/^\[teams-mcp-retry\] /);
    });
  });
});
