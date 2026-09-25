# PR #1 — Test Evidence (run 2026-09-25)

Honest measurement of `npm ci && npm test` and `npm run build` on this branch
vs upstream-pinned `main` (564ef67). Captured by automated kanıt pass requested
by Vekil #61997 before merge.

## Environment

- Node: v22.23.1
- npm: 10.9.8
- Branch tip: d0d5b4d3b334b839d7abbc3af0131b0593a77ee7
- Upstream pin: 564ef67a868b6cf2e2b1a8cc7e191de34d847a80
- Fresh `node_modules` for each run (`rm -rf node_modules && npm ci`)

## npm test — branch (d0d5b4d)

| Metric              | Value |
| ------------------- | ----- |
| Test Files          | 17 total — 13 passed, 4 failed-load |
| Tests (visible)     | 367 — 357 passed, 10 failed |
| Tests (hidden)      | 46 hidden behind 3 module-load failures (e2e, server, graph) + index.test.ts partial |

**Failed test files (suite-level load failure, `TEAMS_MCP_CLIENT_ID is required`):**

- `src/__tests__/e2e.test.ts` — 0 tests run (load fails before `it()`)
- `src/__tests__/server.test.ts` — 0 tests run (load fails before `it()`)
- `src/services/__tests__/graph.test.ts` — 0 tests run (load fails before `it()`)

**Visible failed tests (all in `src/__tests__/index.test.ts`):**

1. MCP Server CLI > help > prints usage information
2. MCP Server CLI > help > handles the help command and flag variants
3. MCP Server CLI > unknown command > exits with an error
4. MCP Server CLI > check > reports authentication details when credentials exist
5. MCP Server CLI > check > reports read-only scope mode
6. MCP Server CLI > check > reports not authenticated when no credentials exist
7. MCP Server CLI > logout > removes the stored credentials
8. MCP Server CLI > logout > succeeds even when no credentials exist
9. MCP Server CLI > authenticate > runs the device code flow and stores credentials
10. MCP Server CLI > authenticate > passes read-only scopes when --read-only is given

**Root cause (single failure mode, repeated):** the new
`TEAMS_MCP_CLIENT_ID` guard in `src/index.ts` and `src/services/graph.ts`
runs at module-load time. Any test that imports `src/server.ts` /
`src/index.ts` / `src/services/graph.ts` throws before `vi.mock` /
`beforeEach` can stub the env var, because the guard executes when the
module is first imported.

Log: `logs/teams-mcp-pr1/branch-test.log`
(also `branch-test-final.log` for the second-run summary).

## npm test — upstream pin (564ef67)

| Metric              | Value |
| ------------------- | ----- |
| Test Files          | 17 passed |
| Tests               | 413 passed, 0 failed |

Log: `logs/teams-mcp-pr1/upstream-test.log`

## Comparison: branch vs upstream

|                    | Upstream (564ef67) | Branch (d0d5b4d) |
| ------------------ | ------------------ | ----------------- |
| Tests passing      | 413                | 357               |
| Tests visible fail | 0                  | 10                |
| Tests hidden fail  | 0                  | 46                |
| Net new reds       | —                  | **56**            |

**Bar (d) — "branch'te upstream'ten sıfır yeni red" — NOT MET.**

Every previously-passing test that transitively imports
`src/server.ts` / `src/index.ts` / `src/services/graph.ts` now breaks
because the guard fires before test setup runs.

## Test-file diff (TEAMS_MCP_CLIENT_ID guard)

Per `git diff 564ef67..d0d5b4d -- 'src/**/*.test.ts'`:

| Changed test files | Count |
| ------------------ | ----- |
| Test files changed | **0** |
| Production files changed for the guard | 2 (`src/index.ts`, `src/services/graph.ts`) |

No tests were added or updated to cover the new guard behaviour, which
is the proximate cause of the regression above.

## npm run build (tsc) — branch (d0d5b4d)

```
> @floriscornel/teams-mcp@1.0.1 build
> npm run clean && npm run compile

> @floriscornel/teams-mcp@1.0.1 clean
> rm -rf dist

> @floriscornel/teams-mcp@1.0.1 compile
> tsc

src/index.ts(47,9): error TS2322: Type 'string | undefined' is not assignable to type 'string'.
src/services/graph.ts(110,11): error TS2322: Type 'string | undefined' is not assignable to type 'string'.
EXIT=2
```

**Bar (e) — "npm run build (tsc) yeşil" — NOT MET.** `tsc` exits with
code 2 (two `TS2322` errors). The guard narrows `CLIENT_ID` to
`string | undefined` at the use-site, but TypeScript can't see the
narrowing survive past the `if (!CLIENT_ID) throw` because the `throw`
is not flagged as `never`-returning in this strict config (likely an
interaction with `noUncheckedIndexedAccess` / `exactOptionalPropertyTypes`).
Suggested fix: explicit `const clientId: string = CLIENT_ID;` after the
guard, or `as string` at the two use-sites — but that's a code change
for a follow-up, not this PR.

Log: `logs/teams-mcp-pr1/branch-build.log`

## Summary against the requested acceptance criteria

| #   | Criterion                                          | Status                |
| --- | -------------------------------------------------- | --------------------- |
| (a) | Branch npm test counts + log                       | ✅ captured (above)   |
| (b) | Upstream npm test counts + log                     | ✅ captured (above)   |
| (c) | Diff report for TEAMS_MCP_CLIENT_ID guard         | ✅ 0 test files; 2 prod files |
| (d) | Bar: zero new reds in branch vs upstream          | ❌ **NOT MET** (56 new reds) |
| (e) | npm run build (tsc) green                          | ❌ **NOT MET** (2 TS2322 errors) |
| (f) | New commit (no amend) pushed; PR body updated      | ✅ this commit        |
| (g) | SHA sent to Vekil                                  | ✅ via msg_send       |

## Recommendation

This PR should NOT be merged as-is. Two follow-ups are needed:

1. **Test-setup fix** — set `TEAMS_MCP_CLIENT_ID` in the vitest setup
   file (`src/test-utils/vitest.setup.ts`) before any module that
   imports `src/server.ts` / `src/index.ts` / `src/services/graph.ts`
   is loaded. With a placeholder value (e.g. `00000000-0000-0000-0000-000000000000`)
   all 56 broken tests should turn green.
2. **Build fix** — re-run `tsc` after the guard change. Either annotate
   the narrowing explicitly (`const clientId = CLIENT_ID as string;`)
   or restructure the guard so TypeScript can see the narrowing.

Both are small. Neither is in scope for this PR — flag as blockers.
