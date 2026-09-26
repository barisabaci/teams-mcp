# PR #8 — Test Evidence (run 2026-09-26)

Honest measurement of `npm test` and `npm run build` on
`job/teams-graph-retry` (1c15b50) vs `origin/main` (142e40f, the merge
point of PR #7 / customization #10).

## Environment

- Node: v22.x
- npm: bundled with Node
- Branch tip: **1c15b50021d7992ae53e30ffa4b8611deb1e6dcf**
- Base: **142e40f0eaf5f233e8a78e69b014054f71352345** (origin/main)
- Upstream pin: 564ef67a868b6cf2e2b1a8cc7e191de34d847a80 (5 commits ahead)

## npm test — branch (1c15b50)

```
 Test Files  26 passed (26)
      Tests  497 passed (497)
   Start at  16:07:54
   Duration  11.05s
```

Log: `logs/retry-test.log`

## npm test — origin/main (142e40f)

Same branch tip and node_modules before this branch's commits:

```
 Test Files  24 passed (24)
      Tests  472 passed (472)
   Duration  1.25s
```

## Comparison

|                    | origin/main (142e40f) | branch (1c15b50) |
| ------------------ | --------------------- | ---------------- |
| Tests passing      | 472                   | 497              |
| New tests          | —                     | +25              |
| New reds           | —                     | **0**            |

## New tests added in this PR

- `src/services/__tests__/retry.test.ts` (20 tests): unit tests for the
  retry helper — retryable status matrix, `Retry-After` parsing,
  exponential delay growth, jitter bounds, the four required msw
  scenarios (429 honouring `Retry-After`, 5xx exponential, success
  no-retry, budget exhausted), warn/info/error telemetry shape, and
  config override behaviour.
- `src/services/__tests__/graph-retry.test.ts` (5 tests): integration
  tests proving `GraphService.request<T>()` retries on 429/503, surfaces
  the last error after the budget is exhausted, does NOT retry on 401,
  and respects `TEAMS_MCP_RETRY_MAX_RETRIES` env override.

## npm run build (tsc) — branch (1c15b50)

```
> @floriscornel/teams-mcp@1.0.1 build
> npm run clean && npm run compile

> @floriscornel/teams-mcp@1.0.1 clean
> rm -rf dist

> @floriscornel/teams-mcp@1.0.1 compile
> tsc
EXIT=0
```

## npm run lint (biome) — branch (1c15b50)

Pre-existing formatting noise in `src/__tests__/client-id-guard.test.ts`,
`src/__tests__/tenant-id-guard.test.ts`, `src/index.ts`,
`src/msal-cache.ts`, and `src/services/__tests__/graph.test.ts` is
untouched in this PR. No new lint errors in any of the changed files
(`src/services/retry.ts`, `src/services/__tests__/retry.test.ts`,
`src/services/__tests__/graph-retry.test.ts`, `src/services/graph.ts`).

## Acceptance criteria

| #   | Criterion                                                     | Status        |
| --- | ------------------------------------------------------------- | ------------- |
| (a) | Retry/backoff module implemented (file:line)                 | ✅ `src/services/retry.ts` (230 LOC) |
| (b) | 429 → Retry-After; 5xx → exponential; budget = 5; env config  | ✅ all four     |
| (c) | Telemetry: retry attempts, count, result                      | ✅ warn / info / error with `[teams-mcp-retry]` prefix |
| (d) | msw tests: 429 + 5xx + Retry-After + max budget (≥ 4 tests)  | ✅ 20 unit + 5 integration = 25 (msw-based) |
| (e) | npm test passed + log path; upstream comparison               | ✅ 497 passed (was 472, +25); logs/retry-test.log |
| (f) | npm run build exit 0                                          | ✅ tsc exit 0   |
| (g) | New commit (no amend) pushed to PR                            | ✅ 1c15b50      |
| (h) | PR #8 opened                                                  | ✅ https://github.com/barisabaci/teams-mcp/pull/8 |
| (i) | SHA + PR + test result reported to Vekil                      | ✅ via msg_send |
