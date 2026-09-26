import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assertImageHostAllowed,
  DEFAULT_IMAGE_HOST_ALLOWLIST,
  getImageHostAllowlist,
  ImageHostNotAllowedError,
  isImageHostAllowed,
} from "../image-host-allowlist.js";

describe("image-host-allowlist", () => {
  const originalEnv = process.env.TEAMS_MCP_IMAGE_HOST_ALLOWLIST;

  beforeEach(() => {
    delete process.env.TEAMS_MCP_IMAGE_HOST_ALLOWLIST;
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.TEAMS_MCP_IMAGE_HOST_ALLOWLIST;
    } else {
      process.env.TEAMS_MCP_IMAGE_HOST_ALLOWLIST = originalEnv;
    }
  });

  describe("default allowlist", () => {
    it("includes the documented Microsoft Graph and tenant hosts", () => {
      // Frozen at module load — should never gain entries silently.
      expect(Array.isArray(DEFAULT_IMAGE_HOST_ALLOWLIST)).toBe(true);
      expect(DEFAULT_IMAGE_HOST_ALLOWLIST).toContain("graph.microsoft.com");
      expect(DEFAULT_IMAGE_HOST_ALLOWLIST).toContain("*.sharepoint.com");
      expect(DEFAULT_IMAGE_HOST_ALLOWLIST).toContain("*.blob.core.windows.net");
      expect(DEFAULT_IMAGE_HOST_ALLOWLIST).toContain("*.teams.microsoft.com");
      expect(DEFAULT_IMAGE_HOST_ALLOWLIST).toContain("graph.microsoftapis.com");
      // Object.freeze — must reject mutation.
      expect(() => {
        (DEFAULT_IMAGE_HOST_ALLOWLIST as unknown as { push: (h: string) => void }).push("evil.com");
      }).toThrow();
    });

    it("allows the bare Graph API host", () => {
      expect(isImageHostAllowed("https://graph.microsoft.com/v1.0/me/photo/$value")).toBe(true);
    });

    it("allows SharePoint subdomains via wildcard", () => {
      expect(isImageHostAllowed("https://contoso.sharepoint.com/sites/marketing/image.png")).toBe(
        true
      );
      expect(isImageHostAllowed("https://tenant-my.sharepoint.com/personal/foo/image.jpg")).toBe(
        true
      );
    });

    it("allows Azure Blob storage via wildcard", () => {
      expect(isImageHostAllowed("https://mytenant.blob.core.windows.net/teams/image.png")).toBe(
        true
      );
    });

    it("rejects unrelated hosts (deny-by-default)", () => {
      expect(isImageHostAllowed("https://example.com/image.png")).toBe(false);
      expect(isImageHostAllowed("https://evil.com/payload.png")).toBe(false);
      expect(isImageHostAllowed("https://github.com/logo.png")).toBe(false);
    });

    it("rejects the bare apex for wildcard patterns (only subdomains match)", () => {
      // `*.sharepoint.com` must NOT match `sharepoint.com` itself — apex
      // bypass is a common SSRF mistake.
      expect(isImageHostAllowed("https://sharepoint.com/image.png")).toBe(false);
    });

    it("matches by URL host, not by path substring", () => {
      // The URL parser is what decides the host; a hostile input that
      // embeds `graph.microsoft.com` in the path or query must still be
      // rejected.
      expect(isImageHostAllowed("https://evil.com/?redirect=graph.microsoft.com")).toBe(false);
      expect(isImageHostAllowed("https://evil.com/graph.microsoft.com")).toBe(false);
    });

    it("rejects non-http(s) protocols", () => {
      expect(isImageHostAllowed("file:///etc/passwd")).toBe(false);
      expect(isImageHostAllowed("javascript:alert(1)")).toBe(false);
      expect(isImageHostAllowed("data:image/png;base64,AAAA")).toBe(false);
    });
  });

  describe("env override (TEAMS_MCP_IMAGE_HOST_ALLOWLIST)", () => {
    it("replaces the defaults when set", () => {
      process.env.TEAMS_MCP_IMAGE_HOST_ALLOWLIST = "foo.com,bar.com";
      expect(getImageHostAllowlist()).toEqual(["foo.com", "bar.com"]);
      // Defaults are no longer matched.
      expect(isImageHostAllowed("https://graph.microsoft.com/image.png")).toBe(false);
      expect(isImageHostAllowed("https://foo.com/image.png")).toBe(true);
    });

    it("supports wildcards in the override", () => {
      process.env.TEAMS_MCP_IMAGE_HOST_ALLOWLIST = "*.proxy.internal";
      expect(isImageHostAllowed("https://media.proxy.internal/x.png")).toBe(true);
      expect(isImageHostAllowed("https://proxy.internal/x.png")).toBe(false);
    });

    it("treats whitespace, mixed case, and trailing commas as empty entries", () => {
      process.env.TEAMS_MCP_IMAGE_HOST_ALLOWLIST = "  Foo.COM ,, ,*.Bar.COM ";
      // Trimmed, lowercased, empties dropped.
      expect(getImageHostAllowlist()).toEqual(["foo.com", "*.bar.com"]);
    });

    it("falls back to defaults when the env var is the empty string", () => {
      process.env.TEAMS_MCP_IMAGE_HOST_ALLOWLIST = "";
      expect(getImageHostAllowlist()).toEqual([...DEFAULT_IMAGE_HOST_ALLOWLIST]);
      expect(isImageHostAllowed("https://graph.microsoft.com/image.png")).toBe(true);
    });

    it("falls back to defaults when the env var contains only commas / whitespace", () => {
      process.env.TEAMS_MCP_IMAGE_HOST_ALLOWLIST = " , , ";
      expect(getImageHostAllowlist()).toEqual([...DEFAULT_IMAGE_HOST_ALLOWLIST]);
    });
  });

  describe("assertImageHostAllowed", () => {
    it("returns silently for an allowed host", () => {
      expect(() =>
        assertImageHostAllowed("https://graph.microsoft.com/v1.0/me/photo/$value")
      ).not.toThrow();
    });

    it("throws ImageHostNotAllowedError on a disallowed host", () => {
      expect(() => assertImageHostAllowed("https://example.com/image.png")).toThrow(
        ImageHostNotAllowedError
      );
      try {
        assertImageHostAllowed("https://example.com/image.png");
      } catch (err) {
        expect((err as Error).message).toContain("example.com");
        expect((err as Error).message).toContain("TEAMS_MCP_IMAGE_HOST_ALLOWLIST");
      }
    });

    it("throws on a syntactically invalid URL", () => {
      expect(() => assertImageHostAllowed("not a url")).toThrow(ImageHostNotAllowedError);
    });

    it("accepts an explicit allowlist override (test-only escape hatch)", () => {
      expect(() =>
        assertImageHostAllowed("https://example.com/image.png", ["example.com"])
      ).not.toThrow();
    });
  });
});
