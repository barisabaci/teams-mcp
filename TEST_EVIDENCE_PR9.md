# PR #9 — Test Evidence (customization #13: structured logging)

Honest measurement of `npm test` and `npm run build` on
`job/teams-structured-logging` vs `origin/main` (be40017, the merge point
of PR #8 / customization #12).

## Environment

- Node: v22.x
- npm: bundled with Node
- Branch tip: **TBD (this PR)**
- Base: **be4001727986badc0fbfc25351aade8bb970446f** (origin/main, post PR #8)
- Upstream pin: 564ef67a868b6cf2e2b1a8cc7e191de34d847a80 (5 commits ahead)

## npm test — branch

```
 Test Files  27 passed (27)
      Tests  511 passed (511)
   Start at  16:33:20
   Duration  10.57s
```

Log: `logs/structured-logging-test.log`

## npm test — origin/main (be40017)

Same node_modules before branch commits:

```
 Test Files  26 passed (26)
      Tests  497 passed (497)
   Duration  ~11s
```

## Comparison

|                    | origin/main (be40017) | branch (this PR) |
| ------------------ | --------------------- | ---------------- |
| Tests passing      | 497                   | 511              |
| New tests          | —                     | +14              |
| New reds           | —                     | **0**            |

## New tests added in this PR

- `src/utils/__tests__/logger.test.ts` (14 tests): unit tests for the
  structured logger — JSON parseability of every emitted line, deny-list
  redaction (key-based token/password/secret/etc., value-based email
  and phone-shaped substring scanning, ≥7-digit threshold to avoid
  misreading short numeric IDs), `LOG_LEVEL` env filter (default info;
  debug/info/warn/error and invalid fallback), operation context
  (`request_id` UUID v4, `latency_ms`, `status` ok/error with re-throw),
  and `[teams-mcp-retry]` module tag carrying the structured `module`
  field alongside the legacy free-text prefix in `message`.

## Updated existing tests (no behaviour change, log sink moved)

- `src/utils/__tests__/attachments.test.ts` — switched console.error
  spies to `process.stderr.write` spies; assertions now parse the JSON
  line and check the structured `module` field.
- `src/utils/__tests__/users.test.ts` — same pattern.
- `src/tools/__tests__/chats.test.ts` — same pattern for the
  "Could not resolve user" warn emit.
- `src/tools/__tests__/teams.test.ts` — same pattern.

## npm run build

tsc exit 0; clean.

Log: `logs/structured-logging-build.log`

## Lint

`npm run lint` reports only pre-existing format diagnostics in files
untouched by this PR (src/index.ts, src/msal-cache.ts, the two
client-id/tenant-id guard tests, src/services/__tests__/graph.test.ts).
No new lint errors introduced; the structured logger module and its
tests pass `biome check` clean.

## Upstream comparison

```
git diff origin/main HEAD --stat
```

See commit body. The structural-logging customization is unique to this
fork — the upstream `floriscornel/teams-mcp` v1.0.1 tree still uses
`console.warn/info/error` calls.
