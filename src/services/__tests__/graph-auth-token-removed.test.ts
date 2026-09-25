import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

// Customization #3: AUTH_TOKEN direct-injection bypass removed.
//
// Two complementary tests prove the bypass is gone:
//
// (1) Source-level: scan graph.ts and confirm no production code path
//     reads `process.env.AUTH_TOKEN`. The bypass previously lived in
//     `GraphService.initializeClient` as "Priority 1: AUTH_TOKEN
//     environment variable (direct token injection)" — that block
//     must be absent from the shipped source.
//
// (2) Behavioural: even if AUTH_TOKEN is set in the environment, the
//     Graph client must NOT initialize through that path. The only
//     remaining init path is via MSAL. With no MSAL accounts (the
//     realistic scenario for a misconfigured deploy that still
//     exports AUTH_TOKEN out of habit), `getClient()` must throw
//     "Not authenticated" — proving the bypass can no longer grant
//     access without going through the configured app registration.

const GRAPH_TS_PATH = resolve(__dirname, "..", "graph.ts");

vi.mock("@azure/msal-node", () => ({
  PublicClientApplication: vi.fn(),
}));

vi.mock("@microsoft/microsoft-graph-client", () => ({
  Client: { initWithMiddleware: vi.fn() },
}));

vi.mock("../../msal-cache.js", () => ({
  cachePlugin: {
    beforeCacheAccess: vi.fn(),
    afterCacheAccess: vi.fn(),
  },
}));

// Read synchronously at module load — vi.mock factories hoist above this
// line so the import order stays safe, and a sync read sidesteps the
// async beforeEach races that surface when the test file imports a
// module whose side-effects interfere with vitest's setup phase.
const graphSource = readFileSync(GRAPH_TS_PATH, "utf8");

describe("AUTH_TOKEN direct-injection bypass — removed", () => {
  it("graph.ts contains no reference to process.env.AUTH_TOKEN", () => {
    // The bypass previously read AUTH_TOKEN at module-load and at
    // initializeClient() time. The only remaining AUTH_TOKEN mentions
    // should be in comments explaining the removal.
    const matches = graphSource.match(/process\.env\.AUTH_TOKEN/g) ?? [];
    expect(matches).toEqual([]);
  });

  it("graph.ts no longer contains the 'Priority 1' AUTH_TOKEN block comment", () => {
    expect(graphSource).not.toMatch(/Priority 1.*AUTH_TOKEN/i);
    expect(graphSource).not.toMatch(/direct token injection/i);
  });

  it("graph.ts no longer exposes validateToken()", () => {
    // validateToken was the JWT sanity check used exclusively by the
    // AUTH_TOKEN bypass. Once the bypass is gone, the helper must go too.
    expect(graphSource).not.toMatch(/validateToken\s*\(/);
  });

  it("getClient() does not authenticate when only AUTH_TOKEN is set", async () => {
    // Behavioural proof: the bypass previously used AUTH_TOKEN alone to
    // build a Graph client without MSAL. With the bypass removed, setting
    // AUTH_TOKEN without an MSAL account must yield an unauthenticated
    // GraphService.
    vi.stubEnv("AUTH_TOKEN", "e30.eyJhdWQiOiJodHRwczovL2dyYXBoLm1pY3Jvc29mdC5jb20ifQ.sig");

    const { PublicClientApplication } = await import("@azure/msal-node");
    // MSAL returns no cached accounts → acquireTokenSilent never runs →
    // initializeClient must not build a client from AUTH_TOKEN.
    vi.mocked(PublicClientApplication).mockImplementation(function () {
      return {
        getTokenCache: vi.fn().mockReturnValue({
          getAllAccounts: vi.fn().mockResolvedValue([]),
        }),
        acquireTokenSilent: vi.fn(),
      };
    } as never);

    const { GraphService } = await import("../graph.js");
    (GraphService as unknown as { instance: undefined }).instance = undefined;
    const service = GraphService.getInstance();
    service.readOnlyMode = false;

    await expect(service.getClient()).rejects.toThrow(/Not authenticated/);
    expect(service.isAuthenticated()).toBe(false);

    vi.unstubAllEnvs();
  });
});
