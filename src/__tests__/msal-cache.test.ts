import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TokenCacheContext } from "@azure/msal-node";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { __resetCacheForTests, cachePlugin } from "../msal-cache.js";

// Real-fs probe directory for the "no fs touch" assertion. We never write
// here from the cache plugin — the directory is empty before and after.
const PROBE_DIR = join(tmpdir(), "teams-mcp-msal-cache-probe");

// Restore the real node:fs module so we can spy on it. The global setup
// replaces it with bare vi.fn() spies which would make the spy below
// observe calls from the wrong module instance.
vi.mock("node:fs", async (importOriginal) => importOriginal());

let consoleLog: ReturnType<typeof vi.spyOn>;
let consoleError: ReturnType<typeof vi.spyOn>;
let consoleWarn: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  __resetCacheForTests();
  await fs.rm(PROBE_DIR, { recursive: true, force: true });
  await fs.mkdir(PROBE_DIR, { recursive: true });
  consoleLog = vi.spyOn(console, "log").mockImplementation(() => undefined);
  consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
  consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(async () => {
  consoleLog.mockRestore();
  consoleError.mockRestore();
  consoleWarn.mockRestore();
  await fs.rm(PROBE_DIR, { recursive: true, force: true });
  __resetCacheForTests();
});

function fakeContext(serialized: string | null): TokenCacheContext {
  const serialize = vi.fn(() => serialized ?? "");
  const deserialize = vi.fn();
  return {
    cacheHasChanged: serialized !== null,
    tokenCache: {
      serialize,
      deserialize,
    },
  } as unknown as TokenCacheContext;
}

describe("MSAL Cache Plugin (in-memory, customization #6)", () => {
  it("does not import homedir or read/write any file on disk", async () => {
    // Sanity: the module loads without ever reading the token-cache file
    // that customization #6 removed.
    const probeBefore = await fs.readdir(PROBE_DIR);
    expect(probeBefore).toEqual([]);

    // Drive a full serialize/deserialize cycle through the plugin.
    const ctx = fakeContext('{"refresh_token":"rt.SECRET-abcdef0123456789"}');
    await cachePlugin.afterCacheAccess(ctx);

    const readCtx = fakeContext(null);
    (readCtx.tokenCache.deserialize as ReturnType<typeof vi.fn>).mockClear();
    await cachePlugin.beforeCacheAccess(readCtx);
    expect(readCtx.tokenCache.deserialize).toHaveBeenCalledWith(
      '{"refresh_token":"rt.SECRET-abcdef0123456789"}'
    );

    // Probe directory must still be empty — no file write happened.
    const probeAfter = await fs.readdir(PROBE_DIR);
    expect(probeAfter).toEqual([]);
  });

  it("beforeCacheAccess is a no-op when the in-memory cache is empty", async () => {
    const ctx = fakeContext(null);
    (ctx.tokenCache.deserialize as ReturnType<typeof vi.fn>).mockClear();
    (ctx.cacheHasChanged as unknown) = false;
    await cachePlugin.beforeCacheAccess(ctx);
    expect(ctx.tokenCache.deserialize).not.toHaveBeenCalled();
  });

  it("afterCacheAccess stores the serialized cache in memory only when cacheHasChanged is true", async () => {
    const ctx = fakeContext('{"access_token":"at.SECRET-XYZ"}');
    await cachePlugin.afterCacheAccess(ctx);
    expect(ctx.tokenCache.serialize).toHaveBeenCalledTimes(1);

    const next = fakeContext(null);
    (next.cacheHasChanged as unknown) = false;
    (next.tokenCache.deserialize as ReturnType<typeof vi.fn>).mockClear();
    await cachePlugin.beforeCacheAccess(next);
    expect(next.tokenCache.deserialize).toHaveBeenCalledWith('{"access_token":"at.SECRET-XYZ"}');
  });

  it("afterCacheAccess does nothing when cacheHasChanged is false", async () => {
    const ctx = fakeContext(null);
    (ctx.cacheHasChanged as unknown) = false;
    await cachePlugin.afterCacheAccess(ctx);
    expect(ctx.tokenCache.serialize).not.toHaveBeenCalled();
  });

  it("recovers gracefully when the deserialize hook throws", async () => {
    // First access: serialize returns garbage and deserialize throws.
    // The plugin must clear the in-memory cache so the next access
    // starts from an empty state.
    const failingDeserialize = vi.fn(() => {
      throw new Error("malformed cache blob");
    });
    const badCtx = {
      cacheHasChanged: true,
      tokenCache: {
        serialize: vi.fn(() => "garbage"),
        deserialize: failingDeserialize,
      },
    } as unknown as TokenCacheContext;
    await cachePlugin.afterCacheAccess(badCtx);

    const firstRead = {
      cacheHasChanged: false,
      tokenCache: {
        serialize: vi.fn(),
        deserialize: failingDeserialize, // still throws on read
      },
    } as unknown as TokenCacheContext;
    await cachePlugin.beforeCacheAccess(firstRead);
    expect(failingDeserialize).toHaveBeenCalledTimes(1);

    // After the failure the in-memory cache was cleared, so the *next*
    // context's beforeCacheAccess is a no-op (no deserialize call).
    const follow = fakeContext(null);
    await cachePlugin.beforeCacheAccess(follow);
    expect(follow.tokenCache.deserialize).not.toHaveBeenCalled();
  });

  it("never logs the token cache contents to console or stderr", async () => {
    // Spy on process.stdout.write too, since MSAL occasionally writes
    // via raw writes rather than console.* helpers.
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation((() => true) as never);
    const stderrWrite = vi.spyOn(process.stderr, "write").mockImplementation((() => true) as never);

    const tokenLikeString = "rt.SECRET-9f8e7d6c5b4a3210";
    const seed = fakeContext(`{"refresh_token":"${tokenLikeString}"}`);
    await cachePlugin.afterCacheAccess(seed);

    const readCtx = fakeContext(null);
    await cachePlugin.beforeCacheAccess(readCtx);

    const allCalls: string[] = [
      ...consoleLog.mock.calls.map((c) => c.map(String).join(" ")),
      ...consoleError.mock.calls.map((c) => c.map(String).join(" ")),
      ...consoleWarn.mock.calls.map((c) => c.map(String).join(" ")),
      ...stdoutWrite.mock.calls.map((c) => c.map(String).join(" ")),
      ...stderrWrite.mock.calls.map((c) => c.map(String).join(" ")),
    ];
    const leaked = allCalls.filter((line) => line.includes(tokenLikeString));
    expect(leaked).toEqual([]);

    stdoutWrite.mockRestore();
    stderrWrite.mockRestore();
  });
});
