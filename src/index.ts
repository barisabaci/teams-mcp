#!/usr/bin/env node

import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  type AuthenticationResult,
  type Configuration,
  PublicClientApplication,
} from "@azure/msal-node";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { cachePlugin } from "./msal-cache.js";
import { AUTH_INFO_PATH, createMcpServer } from "./server.js";
import { resolveScopes } from "./services/graph.js";

// Microsoft Graph tenant app registration. Both env vars are required —
// we no longer fall back to a hardcoded public client app (customization
// #4) and no longer fall back to the `common` tenant (customization #5).
// See FORK_NOTES.md for rationale.
const CLIENT_ID = process.env.TEAMS_MCP_CLIENT_ID;
if (!CLIENT_ID) {
  throw new Error(
    "TEAMS_MCP_CLIENT_ID is required. Register your own app in Microsoft Entra and set the client ID before starting the server.",
  );
}
const TENANT_ID = process.env.TEAMS_MCP_TENANT_ID;
if (!TENANT_ID) {
  throw new Error(
    "TEAMS_MCP_TENANT_ID is required. Set the Microsoft Entra tenant ID (GUID or verified domain) you registered the app in.",
  );
}
const AUTHORITY = `https://login.microsoftonline.com/${TENANT_ID}`;

/** Check whether CLI args contain --read-only. */
function hasReadOnlyFlag(args: string[]): boolean {
  return args.includes("--read-only");
}

// Authentication functions
async function authenticate(readOnly: boolean) {
  const scopes = resolveScopes(readOnly);
  const modeLabel = readOnly ? "read-only" : "full access";

  console.log("🔐 Microsoft Graph Authentication for MCP Server");
  console.log("=".repeat(50));
  console.log(`Using Microsoft Graph CLI app (${modeLabel})`);

  try {
    console.log("\n📱 Using device code flow...");

    const msalConfig: Configuration = {
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
        cachePlugin, // Use our custom file-based cache for refresh tokens
      },
    };

    const client = new PublicClientApplication(msalConfig);

    const result: AuthenticationResult | null = await client.acquireTokenByDeviceCode({
      scopes,
      deviceCodeCallback: (response) => {
        console.log("\n📱 Please complete authentication:");
        console.log(`🌐 Visit: ${response.verificationUri}`);
        console.log(`🔑 Enter code: ${response.userCode}`);
        console.log("\n⏳ Waiting for you to complete authentication...");
      },
    });

    if (result) {
      // Save authentication info (for quick status checks via CLI)
      const authInfo = {
        clientId: CLIENT_ID,
        authenticated: true,
        timestamp: new Date().toISOString(),
        expiresAt: result.expiresOn?.toISOString(),
        account: result.account?.username,
        grantedScopes: result.scopes,
      };

      await fs.writeFile(AUTH_INFO_PATH, JSON.stringify(authInfo, null, 2));

      console.log("\n✅ Authentication successful!");
      console.log(`👤 Signed in as: ${result.account?.username || "Unknown"}`);
      console.log(`🔒 Mode: ${modeLabel}`);
      console.log(`💾 Credentials saved to: ${AUTH_INFO_PATH}`);
      console.log("🔄 Refresh token cached for automatic renewal");
      console.log("\n🚀 You can now use the MCP server in Cursor!");
      console.log("   The server will automatically use these credentials.");
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Provide helpful error messages for common issues
    if (errorMessage.includes("AADSTS50020")) {
      console.error("\n❌ Authentication failed: User account not in tenant");
    } else if (errorMessage.includes("AADSTS65001")) {
      console.error("\n❌ Authentication failed: Admin consent required");
      console.error("   Grant admin consent for the required permissions in Azure Portal");
    } else {
      console.error("\n❌ Authentication failed:", errorMessage);
    }
    process.exit(1);
  }
}

async function checkAuth() {
  try {
    const data = await fs.readFile(AUTH_INFO_PATH, "utf8");
    const authInfo = JSON.parse(data);

    if (authInfo.authenticated && authInfo.clientId) {
      console.log("✅ Authentication found");
      console.log(`👤 Account: ${authInfo.account || "Unknown"}`);
      console.log(`📅 Authenticated on: ${authInfo.timestamp}`);

      // Show granted scope mode
      const grantedScopes = authInfo.grantedScopes as string[] | undefined;
      if (grantedScopes) {
        const hasWriteScopes = grantedScopes.some(
          (s: string) =>
            s === "ChannelMessage.Send" ||
            s === "ChannelMessage.ReadWrite" ||
            s === "Chat.ReadWrite" ||
            s === "Files.ReadWrite.All"
        );
        console.log(`🔒 Scope mode: ${hasWriteScopes ? "full access" : "read-only"}`);
      } else {
        console.log("⚠️  Scope mode: unknown (authenticated before read-only support)");
      }

      // Check if we have expiration info
      if (authInfo.expiresAt) {
        const expiresAt = new Date(authInfo.expiresAt);
        const now = new Date();

        if (expiresAt > now) {
          console.log(`⏰ Access token expires: ${expiresAt.toLocaleString()}`);
          console.log("🔄 Refresh token will automatically renew access");
          console.log("🎯 Ready to use with MCP server!");
        } else {
          console.log("⏰ Access token expired - will use refresh token");
          console.log("🎯 Ready to use with MCP server!");
        }
      } else {
        console.log("🎯 Ready to use with MCP server!");
      }
      return true;
    }
  } catch (_error) {
    console.log("❌ No authentication found");
    return false;
  }
  return false;
}

async function logout() {
  const CACHE_PATH = join(homedir(), ".teams-mcp-token-cache.json");

  try {
    await fs.unlink(AUTH_INFO_PATH);
  } catch (_error) {
    // Ignore if file doesn't exist
  }

  try {
    await fs.unlink(CACHE_PATH);
  } catch (_error) {
    // Ignore if file doesn't exist
  }

  console.log("✅ Successfully logged out");
  console.log("🔄 Run 'npx @floriscornel/teams-mcp@latest authenticate' to re-authenticate");
}

// MCP Server setup
async function startMcpServer(readOnly: boolean) {
  const server = await createMcpServer(readOnly);

  // Start server
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`Microsoft Graph MCP Server started${readOnly ? " (read-only mode)" : ""}`);
}

// Main function to handle both CLI and MCP server modes
async function main() {
  const args = process.argv.slice(2);
  const command = args.find((arg) => arg !== "--read-only");

  // Read-only is the safe default (customization #2). Set
  // TEAMS_MCP_READ_ONLY=false to opt in to write access, or pass
  // --read-only explicitly to force read-only regardless of env.
  const readOnly = hasReadOnlyFlag(args) || process.env.TEAMS_MCP_READ_ONLY !== "false";

  // CLI commands
  switch (command) {
    case "authenticate":
    case "auth":
      await authenticate(readOnly);
      return;
    case "check":
      await checkAuth();
      return;
    case "logout":
      await logout();
      return;
    case "help":
    case "--help":
    case "-h":
      console.log("Microsoft Graph MCP Server");
      console.log("");
      console.log("Usage:");
      console.log(
        "  npx @floriscornel/teams-mcp@latest authenticate              # Authenticate with full scopes"
      );
      console.log(
        "  npx @floriscornel/teams-mcp@latest authenticate --read-only  # Authenticate with read-only scopes"
      );
      console.log(
        "  npx @floriscornel/teams-mcp@latest check                     # Check authentication status"
      );
      console.log(
        "  npx @floriscornel/teams-mcp@latest logout                    # Clear authentication"
      );
      console.log(
        "  npx @floriscornel/teams-mcp@latest                           # Start MCP server (default: read-only)"
      );
      console.log("");
      console.log("Environment variables:");
      console.log("  TEAMS_MCP_READ_ONLY=false  # Start MCP server in full mode (default: read-only)");
      return;
    case undefined:
      // No command = start MCP server
      await startMcpServer(readOnly);
      return;
    default:
      console.error(`Unknown command: ${command}`);
      console.error("Use --help to see available commands");
      process.exit(1);
  }
}

// Handle uncaught errors
process.on("uncaughtException", (error) => {
  console.error("Uncaught exception:", error);
  process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled rejection at:", promise, "reason:", reason);
  process.exit(1);
});

// Exposed for tests so they can await full CLI startup deterministically.
export const mainPromise = main().catch((error) => {
  console.error("Failed to start:", error);
  process.exit(1);
});
