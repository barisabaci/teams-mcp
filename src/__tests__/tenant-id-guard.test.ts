import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Regression guard: the production code in src/index.ts and
 * src/services/graph.ts throws at module-load time when
 * TEAMS_MCP_TENANT_ID is not set (customization #5: the previous
 * `|| "common"` tenant fallback was removed). These tests prove the
 * guard fires by spawning a `tsx` child process with the env var
 * unset and asserting the child exits non-zero with the expected
 * error message in stderr.
 *
 * Mirrors the client-id-guard.test.ts pattern. The placeholder value
 * set by the global vitest setup keeps the env var populated during
 * normal tests; this file deliberately clears it for the child.
 */
const FORK_ROOT = resolve(__dirname, "..", "..");
const TSX_BIN = resolve(FORK_ROOT, "node_modules", ".bin", "tsx");

function runWithoutTenantId(script: string): {
  status: number;
  stderr: string;
  stdout: string;
} {
  return spawnSync(TSX_BIN, ["-e", script], {
    cwd: FORK_ROOT,
    encoding: "utf8",
    env: { ...process.env, TEAMS_MCP_TENANT_ID: "" },
    timeout: 15000,
  });
}

describe("TEAMS_MCP_TENANT_ID module-load guard", () => {
  it("src/index.ts throws when TEAMS_MCP_TENANT_ID is unset", () => {
    const result = runWithoutTenantId(
      `import("./src/index.ts").then(() => process.exit(0), (e) => { process.stderr.write(String(e?.message ?? e)); process.exit(1); });`,
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/TEAMS_MCP_TENANT_ID is required/);
  });

  it("src/services/graph.ts throws when TEAMS_MCP_TENANT_ID is unset", () => {
    const result = runWithoutTenantId(
      `import("./src/services/graph.ts").then(() => process.exit(0), (e) => { process.stderr.write(String(e?.message ?? e)); process.exit(1); });`,
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/TEAMS_MCP_TENANT_ID is required/);
  });
});
