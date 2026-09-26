import { setupServer } from "msw/node";
import { afterEach, beforeEach, expect, type Mock, vi } from "vitest";

// Re-export the entire fixtures namespace so existing test files
// (which import `{ mockUser, mockTeam, ... }` from this module) keep
// working without per-symbol re-export (vitest has a quirk where named
// re-exports of named imports can be undefined at the importer side).
export * from "../__tests__/msw/handlers/fixtures.js";

import { chatsHandlers } from "../__tests__/msw/handlers/chats.js";
import { messagesHandlers } from "../__tests__/msw/handlers/messages.js";
import { searchHandlers } from "../__tests__/msw/handlers/search.js";
import { teamsHandlers } from "../__tests__/msw/handlers/teams.js";
import { usersHandlers } from "../__tests__/msw/handlers/users.js";

export const graphApiHandlers = [
  ...usersHandlers,
  ...teamsHandlers,
  ...chatsHandlers,
  ...messagesHandlers,
  ...searchHandlers,
];

export const server = setupServer(...graphApiHandlers);

vi.mock("node:fs", async () => {
  const actual = (await vi.importActual("node:fs")) as any;
  return {
    ...actual,
    promises: {
      ...(actual.promises || {}),
      readFile: vi.fn(),
      writeFile: vi.fn(),
      unlink: vi.fn(),
      access: vi.fn(),
    },
  };
});

vi.mock("@azure/identity", () => ({
  DeviceCodeCredential: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.resetAllMocks();
});

export function createMockGraphService(): {
  getInstance: Mock;
  getAuthStatus: Mock;
  getClient: Mock;
  isAuthenticated: Mock;
} {
  return {
    getInstance: vi.fn().mockReturnThis(),
    getAuthStatus: vi.fn().mockResolvedValue({
      isAuthenticated: true,
      userPrincipalName: "test.user@example.com",
      displayName: "Test User",
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
    }),
    getClient: vi.fn().mockResolvedValue({
      api: vi.fn().mockReturnValue({
        get: vi.fn(),
        post: vi.fn(),
        filter: vi.fn().mockReturnThis(),
      }),
    }),
    isAuthenticated: vi.fn().mockReturnValue(true),
  };
}

export function createMockUnauthenticatedGraphService(): {
  getInstance: Mock;
  getAuthStatus: Mock;
  getClient: Mock;
  isAuthenticated: Mock;
} {
  return {
    getInstance: vi.fn().mockReturnThis(),
    getAuthStatus: vi.fn().mockResolvedValue({
      isAuthenticated: false,
    }),
    getClient: vi.fn().mockRejectedValue(new Error("Not authenticated")),
    isAuthenticated: vi.fn().mockReturnValue(false),
  };
}

export function createMockMcpServer(): {
  tool: Mock;
  registerTool: Mock;
  connect: Mock;
  getTool: (name: string) =>
    | {
        description: unknown;
        schema: unknown;
        handler: (...args: unknown[]) => unknown;
        title?: unknown;
        annotations?: unknown;
      }
    | undefined;
  getAllTools: () => string[];
} {
  const tools = new Map<
    string,
    {
      description: unknown;
      schema: unknown;
      handler: (...args: unknown[]) => unknown;
      title?: unknown;
      annotations?: unknown;
    }
  >();

  return {
    tool: vi.fn().mockImplementation((name, description, schema, handler) => {
      tools.set(name, { description, schema, handler });
    }),
    registerTool: vi.fn().mockImplementation((name, config, handler) => {
      tools.set(name, {
        description: config.description,
        schema: config.inputSchema,
        handler,
        title: config.title,
        annotations: config.annotations,
      });
    }),
    connect: vi.fn(),
    getTool: (name: string) => tools.get(name),
    getAllTools: () => Array.from(tools.keys()),
  };
}

export async function testMcpTool(
  toolName: string,
  parameters: any,
  mockServer: any,
  expectedResult?: any
) {
  const tool = mockServer.getTool(toolName);
  if (!tool) {
    throw new Error(`Tool ${toolName} not found`);
  }

  const result = await tool.handler(parameters);

  if (expectedResult) {
    expect(result).toEqual(expectedResult);
  }

  return result;
}
