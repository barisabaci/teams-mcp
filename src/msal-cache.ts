import type { ICachePlugin, TokenCacheContext } from "@azure/msal-node";

/**
 * In-memory MSAL token cache plugin, seeded from `TEAMS_MCP_MSAL_CACHE`
 * at module load and on every read.
 *
 * Customization #6: the previous file-based implementation persisted the
 * serialized token cache (including refresh tokens) to
 * `~/.teams-mcp-token-cache.json` in plaintext. That file is gone.
 *
 * Cold-start path (customization #6 fix):
 *   1. The auth CLI writes the serialized MSAL cache to a 0o600 file
 *      under `${XDG_RUNTIME_DIR:-${TMPDIR:-/tmp}}/teams-mcp/msal-cache.json`.
 *   2. The operator copies the file contents into their encrypted
 *      settings store (SessionHub Settings or equivalent).
 *   3. Each subsequent server launch receives the cache via
 *      `settings_env` → child env var `TEAMS_MCP_MSAL_CACHE`.
 *   4. This plugin reads that env var on first access and seeds the
 *      in-memory cache. No plaintext home-dir files, no persistent
 *      on-disk state owned by this server.
 *
 * The plugin still implements `ICachePlugin` because MSAL's
 * PublicClientApplication requires it; reads/writes are served from a
 * single module-scoped string.
 */
const memoryCache: { data: string | null } = { data: null };

const SEED_ENV_VAR = "TEAMS_MCP_MSAL_CACHE";

function seedFromEnv(): void {
  if (memoryCache.data !== null) return;
  const seed = process.env[SEED_ENV_VAR];
  if (seed && seed.length > 0) {
    memoryCache.data = seed;
  }
}

// Cold-start seed. process.env is captured at import time; tests that
// want to simulate a fresh process must call __seedFromEnvForTests()
// (which re-reads env under the current value).
seedFromEnv();

export const cachePlugin: ICachePlugin = {
  async beforeCacheAccess(cacheContext: TokenCacheContext): Promise<void> {
    seedFromEnv();
    if (memoryCache.data !== null) {
      try {
        cacheContext.tokenCache.deserialize(memoryCache.data);
      } catch {
        // Treat malformed cache as empty rather than crashing the auth
        // flow; the operator will be prompted to re-authenticate.
        memoryCache.data = null;
      }
    }
  },

  async afterCacheAccess(cacheContext: TokenCacheContext): Promise<void> {
    if (cacheContext.cacheHasChanged) {
      memoryCache.data = cacheContext.tokenCache.serialize();
    }
  },
};

/** Return the current serialized cache, or null if empty. The auth CLI
 *  uses this to surface the value that the server will need in
 *  `TEAMS_MCP_MSAL_CACHE` on subsequent launches. */
export function exportCache(): string | null {
  return memoryCache.data;
}

/** Test-only: clear the in-memory cache. */
export function __resetCacheForTests(): void {
  memoryCache.data = null;
}

/** Test-only: re-seed from current process.env. Simulates a fresh
 *  process boot with the env var set. */
export function __seedFromEnvForTests(): void {
  memoryCache.data = null;
  seedFromEnv();
}