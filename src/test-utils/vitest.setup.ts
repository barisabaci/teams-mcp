import { afterAll, afterEach, beforeAll } from "vitest";
import { server } from "./setup.js";

// Start MSW server before all tests
beforeAll(() => {
  server.listen({ onUnhandledRequest: "error" });
});

// Reset handlers after each test
afterEach(() => {
  server.resetHandlers();
});

// Clean up after all tests
afterAll(() => {
  server.close();
});

// Global test environment setup
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;

// Mock console methods to reduce noise in tests
const originalError = console.error;
console.error = (...args: unknown[]) => {
  // Suppress specific known warnings/errors during tests
  if (
    typeof args[0] === "string" &&
    (args[0].includes("MSW") ||
      args[0].includes("Warning") ||
      args[0].includes("Failed to initialize"))
  ) {
    return;
  }
  originalError.apply(console, args);
};

/**
 * Set placeholder TEAMS_MCP_CLIENT_ID and TEAMS_MCP_TENANT_ID before any
 * module that imports src/index.ts or src/services/graph.ts is loaded.
 * The production guards (`if (!CLIENT_ID) throw` and
 * `if (!TENANT_ID) throw`) run at module-load time, so without these
 * placeholders the CLI/server test suites that import those modules
 * would crash before vitest can register `vi.mock(...)` / `vi.stubEnv(...)`
 * overrides.
 *
 * The `??=` operator only sets the var when it is unset, so tests that
 * exercise the guards themselves (see src/__tests__/client-id-guard.test.ts
 * and src/__tests__/tenant-id-guard.test.ts) can delete the env vars and
 * use `vi.resetModules()` + dynamic import.
 *
 * The CLIENT_ID value matches the hardcoded fallback that upstream main
 * used before customization #4 removed it, which keeps the existing
 * src/services/__tests__/graph.test.ts assertion
 * (`clientId: "14d82eec-..."`) green without modifying that test file.
 * The TENANT_ID is a placeholder GUID for the same reason — production
 * forbids the `common` fallback (customization #5), so the placeholder
 * is a valid-looking tenant ID rather than a literal "common" string.
 */
process.env.TEAMS_MCP_CLIENT_ID ??= "14d82eec-204b-4c2f-b7e8-296a70dab67e";
process.env.TEAMS_MCP_TENANT_ID ??= "00000000-0000-0000-0000-000000000000";