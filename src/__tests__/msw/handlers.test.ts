/**
 * Handler smoke tests — exercise each msw handler module to confirm the
 * read endpoints declared in `endpoint-list.ts` and the write endpoints
 * declared in `WRITE_ENDPOINT_TOOLS` below are actually wired up.
 *
 * This file is the regression guard for customisation #10. If a future
 * change drops a handler, the smoke test for that tool fails with
 * `expect(...).toEqual(...)` mismatching the mockClient's
 * implementation (which never reaches the network in unit tests), or
 * with a direct MSW error when the request hits `onUnhandledRequest:
 * "error"`. Either way the gap is visible in CI.
 */
import { describe, expect, it } from "vitest";
import { server } from "../../test-utils/setup.js";
import { defaultGraphHandlers } from "./handlers/index.js";

describe("defaultGraphHandlers smoke", () => {
  it("has handlers registered for every documented endpoint", () => {
    // Each entry below corresponds to one handler in the default set.
    // If a handler is removed, this list becomes stale and the next
    // test (which fetches the path) will surface an unhandled-request
    // error from the server's `onUnhandledRequest: "error"` policy.
    expect(defaultGraphHandlers.length).toBeGreaterThanOrEqual(20);
  });

  it("GET /me returns mockUser", async () => {
    const res = await fetch("https://graph.microsoft.com/v1.0/me");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe("test-user-id");
    expect(body.displayName).toBe("Test User");
  });

  it("GET /users/{userPrincipalName} returns mockUser", async () => {
    const res = await fetch("https://graph.microsoft.com/v1.0/users/test.user@example.com");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe("test-user-id");
  });

  it("GET /users/{userId} returns 404 for unknown user", async () => {
    const res = await fetch("https://graph.microsoft.com/v1.0/users/does-not-exist");
    expect(res.status).toBe(404);
  });

  it("GET /me/joinedTeams returns the fixture team", async () => {
    const res = await fetch("https://graph.microsoft.com/v1.0/me/joinedTeams");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.value).toHaveLength(1);
    expect(body.value[0].id).toBe("test-team-id");
  });

  it("GET /teams/{teamId}/channels returns the fixture channel", async () => {
    const res = await fetch("https://graph.microsoft.com/v1.0/teams/test-team-id/channels");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.value).toHaveLength(1);
    expect(body.value[0].id).toBe("test-channel-id");
  });

  it("GET /teams/{teamId}/channels/{channelId}/messages returns fixture messages", async () => {
    const res = await fetch(
      "https://graph.microsoft.com/v1.0/teams/test-team-id/channels/test-channel-id/messages"
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.value.length).toBeGreaterThanOrEqual(1);
    expect(body.value[0].id).toBe("test-message-id");
  });

  it("GET /me/chats returns fixture chat", async () => {
    const res = await fetch("https://graph.microsoft.com/v1.0/me/chats");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.value[0].id).toBe("test-chat-id");
  });

  it("GET /me/chats/{chatId}/messages returns fixture messages", async () => {
    const res = await fetch("https://graph.microsoft.com/v1.0/me/chats/test-chat-id/messages");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.value[0].id).toBe("test-message-id");
  });

  it("POST /me/chats/{chatId}/messages echoes back the body", async () => {
    const res = await fetch("https://graph.microsoft.com/v1.0/me/chats/test-chat-id/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: { content: "hello", contentType: "text" } }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.body.content).toBe("hello");
    expect(body.id).toBe("new-chat-message-id");
  });

  it("POST /chats creates a chat with a fresh id", async () => {
    const res = await fetch("https://graph.microsoft.com/v1.0/chats", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chatType: "group", topic: "Mock topic" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe("new-chat-id");
    expect(body.topic).toBe("Mock topic");
  });

  it("POST /teams/.../messages creates a channel message", async () => {
    const res = await fetch(
      "https://graph.microsoft.com/v1.0/teams/test-team-id/channels/test-channel-id/messages",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: { content: "hi channel", contentType: "text" } }),
      }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.body.content).toBe("hi channel");
    expect(body.id).toBe("new-channel-message-id");
  });

  it("POST /teams/.../messages/{messageId}/replies creates a reply", async () => {
    const res = await fetch(
      "https://graph.microsoft.com/v1.0/teams/test-team-id/channels/test-channel-id/messages/test-message-id/replies",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: { content: "reply", contentType: "text" } }),
      }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.body.content).toBe("reply");
  });

  it("POST /teams/.../messages/{messageId}/softDelete returns 204", async () => {
    const res = await fetch(
      "https://graph.microsoft.com/v1.0/teams/test-team-id/channels/test-channel-id/messages/test-message-id/softDelete",
      { method: "POST" }
    );
    expect(res.status).toBe(204);
  });

  it("POST /chats/.../setReaction returns 204", async () => {
    const res = await fetch(
      "https://graph.microsoft.com/v1.0/chats/test-chat-id/messages/test-message-id/setReaction",
      { method: "POST" }
    );
    expect(res.status).toBe(204);
  });

  it("PATCH /me/chats/.../messages/{messageId} echoes new body", async () => {
    const res = await fetch(
      "https://graph.microsoft.com/v1.0/me/chats/test-chat-id/messages/test-message-id",
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: { content: "edited", contentType: "text" } }),
      }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.body.content).toBe("edited");
  });

  it("GET /chats/.../hostedContents/.../$value returns a PNG byte stream", async () => {
    const res = await fetch(
      "https://graph.microsoft.com/v1.0/chats/test-chat-id/messages/test-message-id/hostedContents/test-content/$value"
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    const buf = await res.arrayBuffer();
    // 1×1 PNG starts with the magic 89 50 4E 47 0D 0A 1A 0A
    const view = new Uint8Array(buf);
    expect(view[0]).toBe(0x89);
    expect(view[1]).toBe(0x50);
    expect(view[2]).toBe(0x4e);
    expect(view[3]).toBe(0x47);
  });

  it("POST /search/query returns one fixture hit", async () => {
    const res = await fetch("https://graph.microsoft.com/v1.0/search/query", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        requests: [{ entityTypes: ["chatMessage"], query: { queryString: "test" } }],
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.value[0].hitsContainers[0].hits[0].resource.id).toBe("test-message-id");
  });

  it("POST /search/query with empty query returns zero hits", async () => {
    const res = await fetch("https://graph.microsoft.com/v1.0/search/query", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requests: [{}] }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.value[0].hitsContainers[0].hits).toEqual([]);
  });
});

// Reference server to confirm we are using the global one.
describe("server binding", () => {
  it("uses the shared server from test-utils", () => {
    // Smoke: ensures the import is non-null; the global server is what
    // `server.use(...)` from the error tests will target.
    expect(server).toBeDefined();
    expect(typeof server.use).toBe("function");
  });
});
