/**
 * Graph mock fixtures — shared across handler modules.
 *
 * Single source of truth for the mock data that msw handlers return.
 * Each constant matches the Graph v1.0 shape declared in
 * `src/types/graph.ts`. Tests should import fixtures from here so that
 * changing an identifier (e.g. userId) propagates to every handler that
 * references it.
 *
 * Conventions:
 * - Strings prefixed `mock-` are used as the canonical IDs the tools
 *   search for. Non-matching IDs return 404 in the handler modules.
 * - Timestamps are ISO-8601 UTC.
 */

import type {
  Channel,
  Chat,
  ChatMessage,
  ConversationMember,
  Team,
  User,
} from "../../../types/graph.js";

export const mockUser: User = {
  id: "test-user-id",
  displayName: "Test User",
  userPrincipalName: "test.user@example.com",
  mail: "test.user@example.com",
  jobTitle: "Test Engineer",
  department: "Engineering",
  officeLocation: "Remote",
};

export const mockOtherUser: User = {
  id: "other-user-id",
  displayName: "Other User",
  userPrincipalName: "other.user@example.com",
  mail: "other.user@example.com",
  jobTitle: "Other Engineer",
  department: "Engineering",
};

export const mockTeam: Team = {
  id: "test-team-id",
  displayName: "Test Team",
  description: "A test team for unit tests",
  isArchived: false,
};

export const mockChannel: Channel = {
  id: "test-channel-id",
  displayName: "General",
  description: "General discussion channel",
  membershipType: "standard",
};

export const mockChat: Chat = {
  id: "test-chat-id",
  topic: "Test Chat",
  chatType: "group",
};

export const mockChatMessage: ChatMessage = {
  id: "test-message-id",
  createdDateTime: "2024-01-01T12:00:00Z",
  body: {
    content: "Test message content",
    contentType: "text",
  },
  from: {
    user: {
      id: "test-user-id",
      displayName: "Test User",
    },
  },
  importance: "normal",
};

export const mockChannelMessageReply: ChatMessage = {
  id: "test-reply-id",
  createdDateTime: "2024-01-01T13:00:00Z",
  body: {
    content: "Test reply content",
    contentType: "text",
  },
  from: {
    user: {
      id: "other-user-id",
      displayName: "Other User",
    },
  },
  importance: "normal",
};

export const mockConversationMember: ConversationMember = {
  id: "test-member-id",
  displayName: "Test Member",
  roles: ["owner"],
};

/** 1x1 transparent PNG (the smallest valid PNG file). */
export const TINY_PNG_BYTES = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);
