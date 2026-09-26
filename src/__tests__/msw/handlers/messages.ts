/**
 * Messages handlers — channel and chat message write paths plus hosted
 * contents. Read paths for `/teams/.../messages`, `/me/chats/.../messages`
 * and `/chats/.../messages/.../replies` are registered in their namespaced
 * modules (`teams.ts`, `chats.ts`) so this file focuses on the write
 * paths and hosted-content download.
 *
 * Read endpoints (download paths) exercised by:
 * - `download_chat_hosted_content`   → /chats/{chatId}/messages/{messageId}/hostedContents/{hostedContentId}/$value
 * - `download_message_hosted_content` → /teams/{teamId}/channels/{channelId}/messages/{messageId}/hostedContents/{hostedContentId}/$value
 * - `get_channel_message_replies`     → /teams/.../channels/.../messages/{messageId}/replies
 *
 * Write endpoints exercised by:
 * - `send_channel_message`            → POST /teams/{teamId}/channels/{channelId}/messages
 * - `reply_to_channel_message`        → POST /teams/.../messages/{messageId}/replies
 * - `delete_channel_message`          → POST /teams/.../messages/{messageId}/softDelete
 *                                       (also /replies/{replyId}/softDelete)
 * - `delete_chat_message`             → POST /users/{userId}/chats/{chatId}/messages/{messageId}/softDelete
 * - `update_chat_message`             → PATCH /me/chats/{chatId}/messages/{messageId}
 * - `update_channel_message`          → PATCH /teams/.../channels/.../messages/{messageId}
 *                                       (also /replies/{replyId})
 * - `set_chat_message_reaction`       → POST /chats/{chatId}/messages/{messageId}/setReaction
 * - `unset_chat_message_reaction`     → POST /chats/{chatId}/messages/{messageId}/unsetReaction
 * - `set_channel_message_reaction`    → POST /teams/.../messages/{messageId}/setReaction (and /replies/{replyId})
 * - `unset_channel_message_reaction`  → POST /teams/.../messages/{messageId}/unsetReaction (and /replies/{replyId})
 */
import { HttpResponse, http } from "msw";
import type { ChatMessage, GraphApiResponse } from "../../../types/graph.js";
import {
  mockChannel,
  mockChannelMessageReply,
  mockChat,
  mockChatMessage,
  mockTeam,
  TINY_PNG_BYTES,
} from "./fixtures.js";

/** Standard 1×1 PNG octet-stream response for hosted-content downloads. */
function tinyPngResponse() {
  return new HttpResponse(TINY_PNG_BYTES, {
    status: 200,
    headers: { "content-type": "image/png" },
  });
}

export const messagesHandlers = [
  // --- Channel message write paths ---

  http.post(
    "https://graph.microsoft.com/v1.0/teams/:teamId/channels/:channelId/messages",
    async ({ params, request }) => {
      if (params.teamId === mockTeam.id && params.channelId === mockChannel.id) {
        const body = (await request.json()) as {
          body?: { content: string; contentType: string };
        };
        const response = {
          ...mockChatMessage,
          id: "new-channel-message-id",
          body: body.body ?? mockChatMessage.body,
          createdDateTime: new Date().toISOString(),
        };
        return HttpResponse.json(response);
      }
      return new HttpResponse(null, { status: 404 });
    }
  ),

  http.post(
    "https://graph.microsoft.com/v1.0/teams/:teamId/channels/:channelId/messages/:messageId/replies",
    async ({ params, request }) => {
      if (params.teamId === mockTeam.id && params.channelId === mockChannel.id) {
        const body = (await request.json()) as {
          body?: { content: string; contentType: string };
        };
        const response = {
          ...mockChannelMessageReply,
          id: "new-channel-reply-id",
          body: body.body ?? mockChannelMessageReply.body,
          createdDateTime: new Date().toISOString(),
        };
        return HttpResponse.json(response);
      }
      return new HttpResponse(null, { status: 404 });
    }
  ),

  http.get(
    "https://graph.microsoft.com/v1.0/teams/:teamId/channels/:channelId/messages/:messageId/replies",
    ({ params }) => {
      if (params.teamId === mockTeam.id && params.channelId === mockChannel.id) {
        const response: GraphApiResponse<ChatMessage> = {
          value: [mockChannelMessageReply],
        };
        return HttpResponse.json(response);
      }
      return new HttpResponse(null, { status: 404 });
    }
  ),

  http.post(
    "https://graph.microsoft.com/v1.0/teams/:teamId/channels/:channelId/messages/:messageId/softDelete",
    ({ params }) => {
      if (params.teamId === mockTeam.id && params.channelId === mockChannel.id) {
        return new HttpResponse(null, { status: 204 });
      }
      return new HttpResponse(null, { status: 404 });
    }
  ),

  http.post(
    "https://graph.microsoft.com/v1.0/teams/:teamId/channels/:channelId/messages/:messageId/replies/:replyId/softDelete",
    ({ params }) => {
      if (params.teamId === mockTeam.id && params.channelId === mockChannel.id) {
        return new HttpResponse(null, { status: 204 });
      }
      return new HttpResponse(null, { status: 404 });
    }
  ),

  http.patch(
    "https://graph.microsoft.com/v1.0/teams/:teamId/channels/:channelId/messages/:messageId",
    async ({ params, request }) => {
      if (params.teamId === mockTeam.id && params.channelId === mockChannel.id) {
        const body = (await request.json()) as { body?: { content: string; contentType: string } };
        return HttpResponse.json({
          ...mockChatMessage,
          body: body.body ?? mockChatMessage.body,
        });
      }
      return new HttpResponse(null, { status: 404 });
    }
  ),

  http.patch(
    "https://graph.microsoft.com/v1.0/teams/:teamId/channels/:channelId/messages/:messageId/replies/:replyId",
    async ({ params, request }) => {
      if (params.teamId === mockTeam.id && params.channelId === mockChannel.id) {
        const body = (await request.json()) as { body?: { content: string; contentType: string } };
        return HttpResponse.json({
          ...mockChannelMessageReply,
          body: body.body ?? mockChannelMessageReply.body,
        });
      }
      return new HttpResponse(null, { status: 404 });
    }
  ),

  http.post(
    "https://graph.microsoft.com/v1.0/teams/:teamId/channels/:channelId/messages/:messageId/setReaction",
    ({ params }) => {
      if (params.teamId === mockTeam.id && params.channelId === mockChannel.id) {
        return new HttpResponse(null, { status: 204 });
      }
      return new HttpResponse(null, { status: 404 });
    }
  ),

  http.post(
    "https://graph.microsoft.com/v1.0/teams/:teamId/channels/:channelId/messages/:messageId/unsetReaction",
    ({ params }) => {
      if (params.teamId === mockTeam.id && params.channelId === mockChannel.id) {
        return new HttpResponse(null, { status: 204 });
      }
      return new HttpResponse(null, { status: 404 });
    }
  ),

  http.post(
    "https://graph.microsoft.com/v1.0/teams/:teamId/channels/:channelId/messages/:messageId/replies/:replyId/setReaction",
    ({ params }) => {
      if (params.teamId === mockTeam.id && params.channelId === mockChannel.id) {
        return new HttpResponse(null, { status: 204 });
      }
      return new HttpResponse(null, { status: 404 });
    }
  ),

  http.post(
    "https://graph.microsoft.com/v1.0/teams/:teamId/channels/:channelId/messages/:messageId/replies/:replyId/unsetReaction",
    ({ params }) => {
      if (params.teamId === mockTeam.id && params.channelId === mockChannel.id) {
        return new HttpResponse(null, { status: 204 });
      }
      return new HttpResponse(null, { status: 404 });
    }
  ),

  // --- Chat message write paths ---

  http.patch(
    "https://graph.microsoft.com/v1.0/me/chats/:chatId/messages/:messageId",
    async ({ params, request }) => {
      if (params.chatId === mockChat.id) {
        const body = (await request.json()) as { body?: { content: string; contentType: string } };
        return HttpResponse.json({
          ...mockChatMessage,
          body: body.body ?? mockChatMessage.body,
        });
      }
      return new HttpResponse(null, { status: 404 });
    }
  ),

  http.post(
    "https://graph.microsoft.com/v1.0/users/:userId/chats/:chatId/messages/:messageId/softDelete",
    ({ params }) => {
      if (params.chatId === mockChat.id && params.messageId === mockChatMessage.id) {
        return new HttpResponse(null, { status: 204 });
      }
      return new HttpResponse(null, { status: 404 });
    }
  ),

  http.post(
    "https://graph.microsoft.com/v1.0/chats/:chatId/messages/:messageId/setReaction",
    ({ params }) => {
      if (params.chatId === mockChat.id) {
        return new HttpResponse(null, { status: 204 });
      }
      return new HttpResponse(null, { status: 404 });
    }
  ),

  http.post(
    "https://graph.microsoft.com/v1.0/chats/:chatId/messages/:messageId/unsetReaction",
    ({ params }) => {
      if (params.chatId === mockChat.id) {
        return new HttpResponse(null, { status: 204 });
      }
      return new HttpResponse(null, { status: 404 });
    }
  ),

  // --- Hosted contents (download paths) ---

  http.get(
    "https://graph.microsoft.com/v1.0/chats/:chatId/messages/:messageId/hostedContents/:hostedContentId/$value",
    ({ params }) => {
      if (params.chatId === mockChat.id && params.messageId === mockChatMessage.id) {
        return tinyPngResponse();
      }
      return new HttpResponse(null, { status: 404 });
    }
  ),

  http.get(
    "https://graph.microsoft.com/v1.0/teams/:teamId/channels/:channelId/messages/:messageId/hostedContents/:hostedContentId/$value",
    ({ params }) => {
      if (params.teamId === mockTeam.id && params.channelId === mockChannel.id) {
        return tinyPngResponse();
      }
      return new HttpResponse(null, { status: 404 });
    }
  ),

  http.get(
    "https://graph.microsoft.com/v1.0/teams/:teamId/channels/:channelId/messages/:messageId/replies/:replyId/hostedContents/:hostedContentId/$value",
    ({ params }) => {
      if (params.teamId === mockTeam.id && params.channelId === mockChannel.id) {
        return tinyPngResponse();
      }
      return new HttpResponse(null, { status: 404 });
    }
  ),
];
