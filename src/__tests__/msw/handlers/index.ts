/**
 * Aggregated default Graph handlers for msw.
 *
 * Tests that want a working Graph surface without opting into error
 * simulation import `defaultGraphHandlers` (or `server` from
 * `../../test-utils/setup.js`) and call:
 *
 * ```ts
 * import { defaultGraphHandlers } from "../../__tests__/msw/handlers/index.js";
 * import { setupServer } from "msw/node";
 *
 * const server = setupServer(...defaultGraphHandlers);
 * ```
 *
 * The composition order matters only for ambiguity; msw picks the first
 * matching handler, so error/specialty handlers should come first when
 * layered with `server.use(...)`.
 */
import type { RequestHandler } from "msw";
import { chatsHandlers } from "./chats.js";
import { messagesHandlers } from "./messages.js";
import { searchHandlers } from "./search.js";
import { teamsHandlers } from "./teams.js";
import { usersHandlers } from "./users.js";

export { chatsHandlers } from "./chats.js";
export type { GraphErrorOptions } from "./errors.js";
export { graphErrorHandlers } from "./errors.js";
export { messagesHandlers } from "./messages.js";
export { searchHandlers } from "./search.js";
export { teamsHandlers } from "./teams.js";
export { usersHandlers } from "./users.js";

export const defaultGraphHandlers: RequestHandler[] = [
  ...usersHandlers,
  ...teamsHandlers,
  ...chatsHandlers,
  ...messagesHandlers,
  ...searchHandlers,
];

export * from "./fixtures.js";
