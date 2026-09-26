/**
 * Teams handlers — `GET /me/joinedTeams`, `/teams/{teamId}/channels`,
 * `/teams/{teamId}/members`, and `/teams/{teamId}/channels/{channelId}/messages`.
 *
 * Read endpoints exercised by:
 * - `list_teams`             → /me/joinedTeams
 * - `list_channels`          → /teams/{teamId}/channels
 * - `get_channel_messages`   → /teams/{teamId}/channels/{channelId}/messages
 * - `list_team_members`      → /teams/{teamId}/members
 *
 * Note: `get_channel_messages` is registered here because the URL is
 * namespaced under `/teams` and it shares fixture scoping rules
 * (teamId + channelId must both match `test-team-id` / `test-channel-id`).
 */
import { HttpResponse, http } from "msw";
import type {
  Channel,
  ChatMessage,
  ConversationMember,
  GraphApiResponse,
  Team,
} from "../../../types/graph.js";
import {
  mockChannel,
  mockChannelMessageReply,
  mockChatMessage,
  mockConversationMember,
  mockTeam,
} from "./fixtures.js";

export const teamsHandlers = [
  http.get("https://graph.microsoft.com/v1.0/me/joinedTeams", () => {
    const response: GraphApiResponse<Team> = {
      value: [mockTeam],
    };
    return HttpResponse.json(response);
  }),

  http.get("https://graph.microsoft.com/v1.0/teams/:teamId/channels", ({ params }) => {
    if (params.teamId === mockTeam.id) {
      const response: GraphApiResponse<Channel> = {
        value: [mockChannel],
      };
      return HttpResponse.json(response);
    }
    return new HttpResponse(null, { status: 404 });
  }),

  http.get("https://graph.microsoft.com/v1.0/teams/:teamId/members", ({ params }) => {
    if (params.teamId === mockTeam.id) {
      const response: GraphApiResponse<ConversationMember> = {
        value: [mockConversationMember],
      };
      return HttpResponse.json(response);
    }
    return new HttpResponse(null, { status: 404 });
  }),

  http.get(
    "https://graph.microsoft.com/v1.0/teams/:teamId/channels/:channelId/messages",
    ({ params }) => {
      if (params.teamId === mockTeam.id && params.channelId === mockChannel.id) {
        const response: GraphApiResponse<ChatMessage> = {
          value: [mockChatMessage, mockChannelMessageReply],
        };
        return HttpResponse.json(response);
      }
      return new HttpResponse(null, { status: 404 });
    }
  ),
];
