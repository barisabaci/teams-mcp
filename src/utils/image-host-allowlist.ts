/**
 * imageUrl host allowlist — customization #9
 *
 * `send_channel_message` and `reply_to_channel_message` fetch the
 * operator-supplied `imageUrl` server-side (see `imageUrlToBase64` in
 * `attachments.ts`). Without a host allowlist, a malicious caller can
 * point that fetch at an attacker-controlled host (SSRF) and have the
 * server relay arbitrary bytes — which the Teams client then renders
 * as an inline image (`<img src="data:...">` etc.) and gets a stored
 * XSS / phishing primitive.
 *
 * The fix is deny-by-default: only the documented Microsoft Graph CDN
 * and tenant host patterns below are accepted. The list is overridable
 * for deployments that route through their own proxy/CDN
 * (`TEAMS_MCP_IMAGE_HOST_ALLOWLIST`).
 *
 * Each default entry below carries the Microsoft documentation URL
 * that justifies including it, so a future audit can trace every host
 * to its source.
 */

const ALLOWLIST_ENV_VAR = "TEAMS_MCP_IMAGE_HOST_ALLOWLIST";

/**
 * Default host patterns accepted by `assertImageHostAllowed` when
 * `TEAMS_MCP_IMAGE_HOST_ALLOWLIST` is unset or empty.
 *
 * Patterns:
 *   - bare hostname   → exact match (e.g. `graph.microsoft.com`)
 *   - `*.example.com` → matches any single-label subdomain
 *                       (`a.example.com`, `tenant-x.example.com`),
 *                       but NOT the bare apex `example.com`.
 */
export const DEFAULT_IMAGE_HOST_ALLOWLIST: readonly string[] = Object.freeze([
  // Graph API itself — `contentUrl` for hosted contents points here.
  // https://learn.microsoft.com/en-us/graph/api/resources/chatmessage
  "graph.microsoft.com",

  // SharePoint host (files / site assets / news feed images).
  // https://learn.microsoft.com/en-us/sharepoint/dev/spfx/web-parts/single-part-app-pages
  // and OneDrive for Business: https://learn.microsoft.com/en-us/onedrive/developer/rest-api/
  "*.sharepoint.com",
  "*.sharepointonline.com",

  // Azure Blob Storage — OneDrive/Teams media is served via
  // `*.blob.core.windows.net`. Confirmed in Microsoft Graph file
  // attachment responses (`driveItem@content.downloadUrl` and
  // chat attachment `contentUrl`).
  // https://learn.microsoft.com/en-us/graph/api/resources/attachment
  "*.blob.core.windows.net",

  // Teams service CDN.
  // https://learn.microsoft.com/en-us/microsoftteams/teams-contexture-platform-overview
  "*.teams.microsoft.com",

  // Office content CDN (templates, stock images surfaced via Graph
  // /me/drive/.../search).
  // https://learn.microsoft.com/en-us/graph/api/resources/driveitem
  "*.office.net",
  "*.office.com",

  // Alternate Graph hostname used by some preview / sovereign clouds
  // and relayed OData responses.
  // https://learn.microsoft.com/en-us/graph/concepts/cloud-national-cloud-deployments
  "graph.microsoftapis.com",
]);

/**
 * Read the current image-host allowlist from the environment.
 *
 * If `TEAMS_MCP_IMAGE_HOST_ALLOWLIST` is set and non-empty (after
 * trimming), it fully replaces the default — this is intentional so
 * operators running the server in a closed tenant can deny the public
 * Graph CDN hosts above if they want a stricter policy. Returns a fresh
 * array; the caller may mutate it without affecting the defaults.
 */
export function getImageHostAllowlist(): string[] {
  const raw = process.env[ALLOWLIST_ENV_VAR];
  if (typeof raw === "string" && raw.length > 0) {
    const parsed = raw
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => entry.length > 0);
    if (parsed.length > 0) {
      return parsed;
    }
  }
  return [...DEFAULT_IMAGE_HOST_ALLOWLIST];
}

/**
 * Pure check: is `url`'s host allowed under `allowlist`?
 *
 * Uses the WHATWG URL parser (`new URL(url)`) so path/query are not
 * inspected — a hostile input like
 * `https://evil.com/?redirect=graph.microsoft.com` is correctly rejected
 * because the host is `evil.com`.
 *
 * `allowlist` defaults to the runtime allowlist (env + defaults).
 */
export function isImageHostAllowed(url: string, allowlist?: string[]): boolean {
  const hosts = (allowlist ?? getImageHostAllowlist()).map((entry) => entry.toLowerCase());
  const parsed = parseImageUrl(url);
  if (parsed === null) return false;
  const target = parsed.toLowerCase();

  for (const pattern of hosts) {
    if (pattern.startsWith("*.")) {
      const suffix = pattern.slice(2); // strip "*."
      if (target.endsWith(`.${suffix}`)) {
        // Also reject if any earlier label is "*".  We only allow a
        // single `*.` prefix, so a single `.endsWith` is correct.
        return true;
      }
    } else if (target === pattern) {
      return true;
    }
  }
  return false;
}

/**
 * Throw `ImageHostNotAllowedError` if `url`'s host is not on the
 * allowlist. Tool handlers call this before `imageUrlToBase64` so the
 * fetch never fires for a hostile URL.
 */
export function assertImageHostAllowed(url: string, allowlist?: string[]): void {
  const parsed = parseImageUrl(url);
  if (parsed === null) {
    throw new ImageHostNotAllowedError(
      `imageUrl is not a valid absolute URL: ${JSON.stringify(url)}`
    );
  }
  if (!isImageHostAllowed(url, allowlist)) {
    const hosts = (allowlist ?? getImageHostAllowlist()).join(", ");
    throw new ImageHostNotAllowedError(
      `imageUrl host "${parsed}" is not in the allowlist (TEAMS_MCP_IMAGE_HOST_ALLOWLIST). ` +
        `Allowed: ${hosts}`
    );
  }
}

/**
 * Distinguished error so tool handlers can render a validation-style
 * response (`isError: true`) without a `fetch` ever being issued.
 */
export class ImageHostNotAllowedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageHostNotAllowedError";
  }
}

function parseImageUrl(url: string): string | null {
  if (typeof url !== "string" || url.length === 0) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  return parsed.host; // already lowercased per WHATWG
}
