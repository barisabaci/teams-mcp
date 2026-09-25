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
 * Set a placeholder TEAMS_MCP_CLIENT_ID before any module that imports
 * src/index.ts or src/services/graph.ts is loaded. The production guard
 * (`if (!CLIENT_ID) throw`) runs at module-load time, so without this
 * the CLI/server test suites that import those modules would crash
 * before vitest can register `vi.mock(...)` / `vi.stubEnv(...)` overrides.
 *
 * The `??=` operator only sets the var when it is unset, so tests that
 * exercise the guard itself (see src/__tests__/client-id-guard.test.ts)
 * can delete the env var and use `vi.resetModules()` + dynamic import.
 *
 * The value matches the hardcoded fallback that upstream main used
 * before customization #4 removed it, which keeps the existing
 * src/services/__tests__/graph.test.ts assertion
 * (`clientId: "14d82eec-..."`) green without modifying that test file.
 */
process.env.TEAMS_MCP_CLIENT_ID ??= "14d82eec-204b-4c2f-b7e8-296a70dab67e";