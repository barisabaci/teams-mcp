import { type AccountInfo, PublicClientApplication } from "@azure/msal-node";
import { Client } from "@microsoft/microsoft-graph-client";
import { cachePlugin } from "../msal-cache.js";
import { errorPayload, logger } from "../utils/logger.js";
import { withGraphRetry } from "./retry.js";

// Microsoft Graph tenant app registration. Both TEAMS_MCP_CLIENT_ID and
// TEAMS_MCP_TENANT_ID are required. The previous hardcoded fallback to
// Microsoft Graph CLI's public client is removed in this fork
// (customization #4); the `|| "common"` tenant fallback is removed in
// customization #5 so the operator must pin the tenant they registered
// the app in. See FORK_NOTES.md for rationale.
const CLIENT_ID = process.env.TEAMS_MCP_CLIENT_ID;
if (!CLIENT_ID) {
  throw new Error(
    "TEAMS_MCP_CLIENT_ID is required. Register your own app in Microsoft Entra and set the client ID before starting the server."
  );
}
const TENANT_ID = process.env.TEAMS_MCP_TENANT_ID;
if (!TENANT_ID) {
  throw new Error(
    "TEAMS_MCP_TENANT_ID is required. Set the Microsoft Entra tenant ID (GUID or verified domain) you registered the app in."
  );
}
const AUTHORITY = `https://login.microsoftonline.com/${TENANT_ID}`;

/** Scopes sufficient for read-only operations (no message sending, no file uploads). */
export const READ_ONLY_SCOPES = [
  "User.Read",
  "User.ReadBasic.All",
  "Team.ReadBasic.All",
  "Channel.ReadBasic.All",
  "ChannelMessage.Read.All",
  "TeamMember.Read.All",
  "Chat.Read",
];

/** Full scopes including write operations. */
export const FULL_SCOPES = [
  ...READ_ONLY_SCOPES,
  "ChannelMessage.Send",
  "ChannelMessage.ReadWrite",
  "Chat.ReadWrite",
  "Files.ReadWrite.All",
];

/**
 * Resolve the scopes to request: TEAMS_MCP_SCOPES (comma/space separated)
 * takes precedence, otherwise the read-only or full default set.
 */
export function resolveScopes(readOnly: boolean): string[] {
  const envScopes = process.env.TEAMS_MCP_SCOPES;
  if (envScopes) {
    return envScopes
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return readOnly ? READ_ONLY_SCOPES : FULL_SCOPES;
}

export interface AuthStatus {
  isAuthenticated: boolean;
  userPrincipalName?: string | undefined;
  displayName?: string | undefined;
  expiresAt?: string | undefined;
}

export class GraphService {
  private static instance: GraphService;
  private client: Client | undefined;
  private isInitialized = false;
  private tokenExpiresAt: Date | undefined;
  private msalApp: PublicClientApplication | undefined;
  private msalAccount: AccountInfo | undefined;
  private _readOnlyMode = false;

  static getInstance(): GraphService {
    if (!GraphService.instance) {
      GraphService.instance = new GraphService();
    }
    return GraphService.instance;
  }

  /** Whether the service operates in read-only mode (reduced permission scopes). */
  get readOnlyMode(): boolean {
    return this._readOnlyMode;
  }

  set readOnlyMode(value: boolean) {
    this._readOnlyMode = value;
  }

  /** Returns the scopes to request based on the current mode. */
  get scopes(): string[] {
    return resolveScopes(this._readOnlyMode);
  }

  private async initializeClient(): Promise<void> {
    if (this.isInitialized) return;

    try {
      // AUTH_TOKEN direct-injection bypass was removed (customization #3).
      // The Graph client now only initializes through MSAL with a cached
      // refresh token, eliminating the silent backdoor where a pre-existing
      // access token could grant full Graph access without going through the
      // configured app registration.
      this.msalApp = new PublicClientApplication({
        auth: {
          // The module-level guards throw when TEAMS_MCP_CLIENT_ID or
          // TEAMS_MCP_TENANT_ID is missing, but TypeScript doesn't carry
          // that narrowing across the function boundary, so narrow
          // explicitly at the use site.
          clientId:
            typeof CLIENT_ID === "string"
              ? CLIENT_ID
              : (() => {
                  throw new Error("TEAMS_MCP_CLIENT_ID is required");
                })(),
          authority: AUTHORITY,
        },
        cache: {
          cachePlugin,
        },
      });

      const accounts = await this.msalApp.getTokenCache().getAllAccounts();
      if (accounts.length === 0) {
        return;
      }

      this.msalAccount = accounts[0];

      // Verify we can acquire a token
      const result = await this.msalApp.acquireTokenSilent({
        scopes: this.scopes,
        account: this.msalAccount,
      });

      if (!result) {
        return;
      }

      this.tokenExpiresAt = result.expiresOn ?? undefined;

      // Create Graph client with MSAL-backed auth provider for automatic token refresh
      this.client = Client.initWithMiddleware({
        authProvider: {
          getAccessToken: () => this.acquireToken(),
        },
      });

      this.isInitialized = true;
    } catch (error) {
      logger.error("Failed to initialize Graph client", {
        module: "teams-mcp-graph",
        error: errorPayload(error),
      });
    }
  }

  private async acquireToken(): Promise<string> {
    if (!this.msalApp || !this.msalAccount) {
      throw new Error("MSAL not initialized");
    }

    const result = await this.msalApp.acquireTokenSilent({
      scopes: this.scopes,
      account: this.msalAccount,
    });

    if (!result) {
      throw new Error(
        "Failed to acquire access token. Please re-authenticate: npx @floriscornel/teams-mcp@latest authenticate"
      );
    }

    this.tokenExpiresAt = result.expiresOn ?? undefined;
    return result.accessToken;
  }

  async getAuthStatus(): Promise<AuthStatus> {
    await this.initializeClient();

    if (!this.client) {
      return { isAuthenticated: false };
    }

    try {
      const me = await this.client.api("/me").get();
      return {
        isAuthenticated: true,
        userPrincipalName: me?.userPrincipalName ?? undefined,
        displayName: me?.displayName ?? undefined,
        expiresAt: this.tokenExpiresAt?.toISOString(),
      };
    } catch (error) {
      logger.error("Error getting user info", {
        module: "teams-mcp-graph",
        error: errorPayload(error),
      });
      return { isAuthenticated: false };
    }
  }

  async getClient(): Promise<Client> {
    await this.initializeClient();

    if (!this.client) {
      throw new Error(
        "Not authenticated. Please run the authentication CLI tool first: npx @floriscornel/teams-mcp@latest authenticate"
      );
    }
    return this.client;
  }

  isAuthenticated(): boolean {
    return !!this.client && this.isInitialized;
  }

  /**
   * Execute a Graph request with retry/backoff (customization #12).
   *
   * Use this instead of `client.api(path).get()` directly when the call is
   * a regular Graph read/write that may transiently hit 429 (rate-limit)
   * or 5xx (server error). The thunk receives the underlying
   * `microsoft-graph-client` Client so callers can keep using the chainable
   * query builder (`api(path).filter(...).get()`, etc.).
   *
   * The retry helper honours `Retry-After` headers, applies exponential
   * backoff with jitter for 5xx, caps total attempts at 5 by default, and
   * emits `[teams-mcp-retry]` telemetry on every attempt and final outcome.
   * Configuration is overridable via `TEAMS_MCP_RETRY_*` env vars.
   */
  async request<T>(buildRequest: (client: Client) => Promise<T>, operation?: string): Promise<T> {
    const client = await this.getClient();
    return withGraphRetry(() => buildRequest(client), operation ? { operation } : undefined);
  }
}
