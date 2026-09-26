/**
 * GraphService.request() — retry/backoff integration tests (customization #12).
 *
 * Proves the production wiring: GraphService.request<T>() retries on 429/5xx
 * using the same policy as the unit-tested `withGraphRetry` helper, and
 * stops after the configured budget.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "../../test-utils/setup.js";

// Mock MSAL/cache first — graph.ts reads process.env at module load and
// needs the placeholders set by vitest.setup.ts (which runs before the
// module is imported here because vi.mock factories hoist).
vi.mock("../../msal-cache.js", () => ({
  cachePlugin: {
    beforeCacheAccess: vi.fn(),
    afterCacheAccess: vi.fn(),
  },
  CACHE_PATH: "/mock/cache/path",
}));

vi.mock("@azure/msal-node", () => ({
  PublicClientApplication: vi.fn(),
}));

vi.mock("@microsoft/microsoft-graph-client", () => ({
  Client: { initWithMiddleware: vi.fn() },
}));

import { PublicClientApplication } from "@azure/msal-node";
import { Client } from "@microsoft/microsoft-graph-client";
import { GraphService } from "../graph.js";
import type { RetryLogger } from "../retry.js";

class FakeGraphError extends Error {
  statusCode: number;
  code: string | null;
  headers?: Record<string, string>;
  constructor(statusCode: number, opts: { headers?: Record<string, string>; code?: string } = {}) {
    super(`GraphError ${statusCode}`);
    this.name = "GraphError";
    this.statusCode = statusCode;
    this.code = opts.code ?? null;
    this.headers = opts.headers;
  }
}

function setupDefaultMsalMock() {
  vi.mocked(PublicClientApplication).mockImplementation(function () {
    return {
      getTokenCache: vi.fn().mockReturnValue({
        getAllAccounts: vi.fn().mockResolvedValue([{ username: "test@example.com" }]),
      }),
      acquireTokenSilent: vi.fn().mockResolvedValue({
        accessToken: "mock-access-token",
        expiresOn: new Date(Date.now() + 3600000),
      }),
    };
  } as any);
}

function setupGraphClient(getImpl: (path: string) => Promise<unknown>) {
  const mockClient = {
    api: vi.fn().mockImplementation((path: string) => ({
      get: () => getImpl(path),
    })),
  };
  vi.mocked(Client.initWithMiddleware).mockReturnValue(mockClient as any);
  return mockClient;
}

describe("GraphService.request retry integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMsalMock();
    (GraphService as any).instance = undefined;
  });

  afterEach(() => {
    server.resetHandlers();
    vi.unstubAllEnvs();
  });

  it("retries 429 → 200 via GraphService.request()", async () => {
    let calls = 0;
    setupGraphClient(async () => {
      calls++;
      if (calls < 2) {
        throw new FakeGraphError(429, {
          headers: { "Retry-After": "1" },
          code: "TooManyRequests",
        });
      }
      return { id: "u1" };
    });
    const warn = vi.fn();
    const info = vi.fn();
    const error = vi.fn();
    const _logger: RetryLogger = { warn, info, error };
    const sleeper = vi.fn(async () => undefined);

    const svc = GraphService.getInstance();
    // Inject test-only overrides via the helper module's options path:
    // we patch the retry default sleeper by passing a custom sleeper
    // through withGraphRetry. GraphService.request does not expose those,
    // so we use the env-overridable config + the default sleeper.
    const result = await svc.request(async (c) => (await c.api("/me").get()) as { id: string });
    expect(result).toEqual({ id: "u1" });
    expect(calls).toBe(2);

    // Telemetry comes through console.warn/info by default — we just
    // assert that GraphService.request() succeeded after a retry rather
    // than asserting the log sink (covered in retry.test.ts).
    void warn;
    void info;
    void error;
    void sleeper;
  });

  it("retries 503 (5xx) → 200 via GraphService.request()", async () => {
    let calls = 0;
    setupGraphClient(async () => {
      calls++;
      if (calls < 3) {
        throw new FakeGraphError(503, { code: "ServiceUnavailable" });
      }
      return { id: "u1" };
    });

    const svc = GraphService.getInstance();
    const result = await svc.request(async (c) => (await c.api("/me").get()) as { id: string });
    expect(result).toEqual({ id: "u1" });
    expect(calls).toBe(3);
  });

  it("surfaces the last error when the retry budget is exhausted", async () => {
    let calls = 0;
    setupGraphClient(async () => {
      calls++;
      throw new FakeGraphError(503, { code: "ServiceUnavailable" });
    });

    const svc = GraphService.getInstance();
    await expect(
      svc.request(async (c) => (await c.api("/me").get()) as { id: string })
    ).rejects.toThrow(/GraphError 503/);

    // Default maxRetries = 5 (TEAMS_MCP_RETRY_MAX_RETRIES is unset).
    expect(calls).toBe(5);
  });

  it("does NOT retry on non-retryable 4xx (e.g. 401)", async () => {
    let calls = 0;
    setupGraphClient(async () => {
      calls++;
      throw new FakeGraphError(401, { code: "InvalidAuthenticationToken" });
    });

    const svc = GraphService.getInstance();
    await expect(
      svc.request(async (c) => (await c.api("/me").get()) as { id: string })
    ).rejects.toThrow(/GraphError 401/);

    expect(calls).toBe(1);
  });

  it("respects TEAMS_MCP_RETRY_MAX_RETRIES=3 override (read on each call)", async () => {
    // DEFAULT_RETRY_CONFIG is read once at module load. To honour the
    // env at runtime we re-read on each call to withGraphRetry; verify
    // by stubbing the env BEFORE the call.
    vi.stubEnv("TEAMS_MCP_RETRY_MAX_RETRIES", "3");
    let calls = 0;
    setupGraphClient(async () => {
      calls++;
      throw new FakeGraphError(500, { code: "InternalServerError" });
    });

    const svc = GraphService.getInstance();
    await expect(
      svc.request(async (c) => (await c.api("/me").get()) as { id: string })
    ).rejects.toThrow();

    expect(calls).toBe(3);
  });
});
