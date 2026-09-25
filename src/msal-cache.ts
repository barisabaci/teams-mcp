import type { ICachePlugin, TokenCacheContext } from "@azure/msal-node";

/**
 * In-memory MSAL token cache plugin.
 *
 * Customization #6: the previous file-based implementation persisted the
 * serialized token cache (including refresh tokens) to
 * `~/.teams-mcp-token-cache.json` in plaintext. That file is gone — the
 * cache lives only in this module's memory and is lost when the process
 * exits. Secrets reach the process through `settings_env` (SessionHub MCP)
 * as child env vars; they are never written to disk by this code.
 *
 * The plugin is still required by MSAL's PublicClientApplication, so we
 * keep the ICachePlugin shape and serve reads/writes from a single
 * module-scoped string.
 */
const memoryCache: { data: string | null } = { data: null };

export const cachePlugin: ICachePlugin = {
  async beforeCacheAccess(cacheContext: TokenCacheContext): Promise<void> {
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

/** Test-only: reset the in-memory cache. Not part of the public API. */
export function __resetCacheForTests(): void {
  memoryCache.data = null;
}
