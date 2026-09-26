/**
 * Chats handlers — `/me/chats`, `/me/chats/{chatId}/messages`,
 * `/chats`, `/chats/{chatId}/members`.
 *
 * Read endpoints exercised by:
 * - `list_chats`           → /me/chats?$expand=members
 * - `get_chat_messages`    → /me/chats/{chatId}/messages
 *
 * Write endpoints exercised by:
 * - `send_chat_message`    → POST /me/chats/{chatId}/messages
 * - `create_chat`          → POST /chats
 * - `add_chat_member`      → POST /chats/{chatId}/members
 *
 * `get_chat_messages` honours a `$filter=from/user/id eq '...'` query
 * so the tool's `fromUser` argument exercises both branches
 * (with-filter returns []; without returns [mockChatMessage]).
 */
import { HttpResponse, http } from "msw";
import type {
  Chat,
  ChatMessage,
  ConversationMember,
  GraphApiResponse,
} from "../../../types/graph.js";
import { mockChat, mockChatMessage, mockConversationMember, mockUser } from "./fixtures.js";

export const chatsHandlers = [
  http.get("https://graph.microsoft.com/v1.0/me/chats", () => {
    // `$expand=members` is a query hint only; the body shape matches
    // a fully-hydrated chat. Test code that asserts on members reads
    // `chat.members` from the response object.
    const response: GraphApiResponse<Chat & { members?: ConversationMember[] }> = {
      value: [
        {
          ...mockChat,
          members: [mockConversationMember],
        },
      ],
    };
    return HttpResponse.json(response);
  }),

  http.get("https://graph.microsoft.com/v1.0/me/chats/:chatId/messages", ({ params, request }) => {
    if (params.chatId !== mockChat.id) {
      return new HttpResponse(null, { status: 404 });
    }
    const url = new URL(request.url);
    const filter = url.searchParams.get("$filter");
    const fromUser = filter?.includes("from/user/id");

    const response: GraphApiResponse<ChatMessage> = {
      value: fromUser ? [] : [mockChatMessage],
    };
    return HttpResponse.json(response);
  }),

  http.post(
    "https://graph.microsoft.com/v1.0/me/chats/:chatId/messages",
    async ({ params, request }) => {
      if (params.chatId !== mockChat.id) {
        return new HttpResponse(null, { status: 404 });
      }
      const body = (await request.json()) as { body?: { content: string; contentType: string } };
      const response = {
        ...mockChatMessage,
        id: "new-chat-message-id",
        body: body.body ?? mockChatMessage.body,
        createdDateTime: new Date().toISOString(),
      };
      return HttpResponse.json(response);
    }
  ),

  http.post("https://graph.microsoft.com/v1.0/chats", async ({ request }) => {
    const body = (await request.json()) as {
      chatType?: string;
      topic?: string;
      members?: ConversationMember[];
    };
    const response = {
      ...mockChat,
      id: "new-chat-id",
      topic: body.topic,
      chatType: (body.chatType as Chat["chatType"]) ?? mockChat.chatType,
      members: body.members,
    };
    return HttpResponse.json(response);
  }),

  http.post(
    "https://graph.microsoft.com/v1.0/chats/:chatId/members",
    async ({ params, request }) => {
      if (params.chatId !== mockChat.id) {
        return new HttpResponse(null, { status: 404 });
      }
      // add_chat_member iterates /users/{email} first; the user lookup
      // is served by users.ts. We just acknowledge here.
      const body = (await request.json()) as Record<string, unknown>;
      if (!body?.["user@odata.bind"]) {
        return HttpResponse.json(
          { error: { code: "BadRequest", message: "missing bind" } },
          { status: 400 }
        );
      }
      return new HttpResponse(null, { status: 201 });
    }
  ),

  // Used by delete_chat_message to resolve current user id before the
  // /users/{id}/chats/.../messages/.../softDelete call. The /me handler
  // above already covers most flows; this alias exists so handler-driven
  // tests of softDelete that pre-resolve /me still hit a mock.
  http.get("https://graph.microsoft.com/v1.0/me", () => {
    return HttpResponse.json(mockUser);
  }),
];
