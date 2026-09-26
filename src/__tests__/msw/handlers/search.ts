/**
 * Search handlers — `POST /search/query`.
 *
 * Read endpoints exercised by:
 * - `search_messages`     → POST /search/query (KQL `queryString`)
 * - `get_my_mentions`     → POST /search/query (`IsMentioned:true sent>=...`)
 *
 * The handler returns a single hit scoped to `mockChat.id` /
 * `mockChatMessage.id` when the request body parses cleanly, otherwise
 * an empty hits container. The tool layer never inspects more than the
 * first hit for these read flows, so a single canned hit is enough to
 * keep both call sites exercised.
 */
import { HttpResponse, http } from "msw";
import type { SearchRequest, SearchResponse } from "../../../types/graph.js";
import { mockChatMessage } from "./fixtures.js";

export const searchHandlers = [
  http.post("https://graph.microsoft.com/v1.0/search/query", async ({ request }) => {
    const body = (await request.json()) as { requests?: SearchRequest[] };
    const searchRequest = body.requests?.[0];

    if (!searchRequest?.query?.queryString) {
      const empty: SearchResponse = {
        value: [
          {
            searchTerms: [],
            hitsContainers: [
              {
                hits: [],
                total: 0,
                moreResultsAvailable: false,
              },
            ],
          },
        ],
      };
      return HttpResponse.json(empty);
    }

    const response: SearchResponse = {
      value: [
        {
          searchTerms: [searchRequest.query.queryString],
          hitsContainers: [
            {
              hits: [
                {
                  hitId: "search-hit-1",
                  rank: 1,
                  summary: "Test message found in search",
                  resource: {
                    "@odata.type": "#microsoft.graph.chatMessage",
                    id: mockChatMessage.id ?? "test-message-id",
                    createdDateTime: mockChatMessage.createdDateTime ?? "2024-01-01T12:00:00Z",
                    from: {
                      user: {
                        displayName: mockChatMessage.from?.user?.displayName ?? "Test User",
                        id: mockChatMessage.from?.user?.id ?? "test-user-id",
                      },
                    },
                    body: {
                      content: mockChatMessage.body?.content ?? "Test message content",
                      contentType: mockChatMessage.body?.contentType ?? "text",
                    },
                    chatId: "test-chat-id",
                  },
                },
              ],
              total: 1,
              moreResultsAvailable: false,
            },
          ],
        },
      ],
    };
    return HttpResponse.json(response);
  }),
];
