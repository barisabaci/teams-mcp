/**
 * Users handlers — `GET /me`, `GET /users`, `GET /users/{userId}`.
 *
 * Read endpoints exercised by the read-only MCP tools:
 * - `get_current_user`      → /me
 * - `auth_status`           → /me
 * - `search_users`          → /users
 * - `search_users_for_mentions` → /users (with $filter)
 * - `get_user`              → /users/{userId}
 *
 * All handlers return 404 for unknown IDs so tests of the negative path
 * (`get_user` with a typo'd userId, etc.) can rely on the Graph client
 * surfacing an HTTP 4xx.
 */
import { HttpResponse, http } from "msw";
import type { GraphApiResponse, User } from "../../../types/graph.js";
import { mockUser } from "./fixtures.js";

export const usersHandlers = [
  http.get("https://graph.microsoft.com/v1.0/me", () => {
    return HttpResponse.json(mockUser);
  }),

  http.get("https://graph.microsoft.com/v1.0/users", ({ request }) => {
    const url = new URL(request.url);
    const filter = url.searchParams.get("$filter");
    const search = url.searchParams.get("$search");

    // Both /users and /users?$filter=... are matched by this single
    // handler. `search_users` uses startswith() filter; `search_users_for_mentions`
    // uses a $search query string. Return mockUser when the query looks
    // like it could match the fixture's displayName / UPN; empty otherwise.
    const queryBlob = `${filter ?? ""} ${search ?? ""}`.toLowerCase();
    const matches =
      queryBlob.length > 0 && (queryBlob.includes("test") || queryBlob.includes("test.user"));

    const response: GraphApiResponse<User> = {
      value: matches ? [mockUser] : [],
    };
    return HttpResponse.json(response);
  }),

  http.get("https://graph.microsoft.com/v1.0/users/:userId", ({ params }) => {
    if (
      params.userId === mockUser.id ||
      params.userId === mockUser.userPrincipalName ||
      params.userId === mockUser.mail
    ) {
      return HttpResponse.json(mockUser);
    }
    return new HttpResponse(null, { status: 404 });
  }),
];
