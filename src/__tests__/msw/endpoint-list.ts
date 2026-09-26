/**
 * msw mock foundation: read-tool endpoint list.
 *
 * This file lists the Microsoft Graph v1.0 endpoints exercised by the
 * read-only MCP tools in this fork. Handlers for these endpoints will be
 * added in PR-4 (mock Graph fixture, customization #10). Until then this
 * module is the single source of truth for "which endpoints the read
 * tools actually hit" so test authors and reviewers can see coverage at a
 * glance.
 *
 * Sources: docs/teams-mcp-kod-incelemesi.md §6 (read tools enumeration).
 * Tool → endpoint mapping is derived from src/tools/*.ts (read paths only).
 */

export type GraphMethod = "GET" | "POST";

export interface EndpointSpec {
  readonly method: GraphMethod;
  readonly path: string; // path template; {param} substituted at handler time
  readonly tool: string; // MCP tool name that calls this endpoint
  readonly notes?: string;
}

export const READ_TOOL_ENDPOINTS: readonly EndpointSpec[] = [
  { method: "GET", path: "/me", tool: "get_current_user" },
  { method: "GET", path: "/me", tool: "auth_status" },

  { method: "GET", path: "/users", tool: "search_users" },
  { method: "GET", path: "/users/{userId}", tool: "get_user" },

  { method: "GET", path: "/me/chats", tool: "list_chats" },
  { method: "GET", path: "/chats/{chatId}/messages", tool: "get_chat_messages" },
  {
    method: "GET",
    path: "/chats/{chatId}/messages/{messageId}/hostedContents/{hostedContentId}/$value",
    tool: "download_chat_hosted_content",
  },

  { method: "GET", path: "/me/joinedTeams", tool: "list_teams" },
  { method: "GET", path: "/teams/{teamId}/channels", tool: "list_channels" },
  {
    method: "GET",
    path: "/teams/{teamId}/channels/{channelId}/messages",
    tool: "get_channel_messages",
  },
  {
    method: "GET",
    path: "/teams/{teamId}/channels/{channelId}/messages/{messageId}/replies",
    tool: "get_channel_message_replies",
  },
  { method: "GET", path: "/teams/{teamId}/members", tool: "list_team_members" },

  { method: "GET", path: "/search/query", tool: "search_messages" },
  { method: "GET", path: "/me/mentions", tool: "get_my_mentions" },
  {
    method: "GET",
    path: "/users?$filter=...",
    tool: "search_users_for_mentions",
    notes: "uses $search/$filter; handler will return fixture subset",
  },

  {
    method: "GET",
    path: "/teams/{teamId}/channels/{channelId}/messages/{messageId}/hostedContents/{hostedContentId}/$value",
    tool: "download_message_hosted_content",
  },
] as const;

/** Endpoints reachable from read tools, grouped by tool for fixture wiring. */
export function endpointsByTool(tool: string): readonly EndpointSpec[] {
  return READ_TOOL_ENDPOINTS.filter((e) => e.tool === tool);
}
