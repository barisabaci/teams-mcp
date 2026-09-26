# Developing teams-mcp (this fork)

> Audience: maintainers of `barisabaci/teams-mcp`. If you only want to *use*
> the server, see [`README.md`](../README.md). For the rationale behind this
> fork, see [`../FORK_NOTES.md`](../FORK_NOTES.md). For the McpHub-side
> tracker, see [`teams_mcp/SYNC_STATE.md`](../../teams_mcp/SYNC_STATE.md).

This guide is **customization #14** — the final piece of the 14-PR plan that
moved the upstream `floriscornel/teams-mcp` v1.0.1 tree into a form that
fits the McpHub deployment rules.

## 1. Fork workflow

### 1.1 Clone + remotes

```bash
git clone git@github.com:barisabaci/teams-mcp.git
cd teams-mcp
# upstream is pre-set in this clone; verify with:
git remote -v
#   origin    git@github.com:barisabaci/teams-mcp.git  (fetch/push)
#   upstream  https://github.com/floriscornel/teams-mcp.git  (fetch)
```

If `upstream` is missing, add it:

```bash
git remote add upstream https://github.com/floriscornel/teams-mcp.git
git fetch upstream
```

### 1.2 Install + verify

```bash
npm ci                    # reproducible install from package-lock.json
npm test                  # vitest run — must pass with no new reds
npm run build             # tsc — exit 0
npm run lint              # biome check src/ — pre-existing format diagnostics only
```

### 1.3 Branch naming

| Pattern                  | Use                                    |
| ------------------------ | -------------------------------------- |
| `job/<short-topic>`      | new customization work or investigation |
| `fix/<short-topic>`      | upstream cherry-pick or bug fix        |
| `feat/<short-topic>`     | larger feature branch                  |

A single customization = a single branch = a single PR. Do not stack
unrelated work on the same branch.

## 2. Customizations (1–14)

All 14 customizations in the fork plan are **done**. The last one is this
document.

| #   | Title                                                | PR    | Source                                                                                              |
| --- | ---------------------------------------------------- | ----- | --------------------------------------------------------------------------------------------------- |
| 1   | Sending default OFF                                  | #4    | `src/index.ts` (CLI flags)                                                                          |
| 2   | Read-only mode default                               | #4    | `src/index.ts`, `src/services/graph.ts`                                                             |
| 3   | Remove `AUTH_TOKEN` direct-injection bypass          | #4    | `src/index.ts`                                                                                      |
| 4   | Drop hardcoded `CLIENT_ID` fallback                  | #1    | `src/services/graph.ts` (CLIENT_ID guard)                                                           |
| 5   | Remove tenant `common` fallback                      | #4    | `src/services/graph.ts` (TENANT_ID guard)                                                           |
| 6   | Secrets via `settings_env`                           | #5    | deployment-side; fork ships no plaintext home-dir files                                             |
| 7   | File mode `0600` for cache/auth metadata             | #5    | `src/utils/file-mode.ts`                                                                            |
| 8   | Drop unused `@azure/identity-cache-persistence` dep  | #5    | `package.json`                                                                                      |
| 9   | `imageUrl` host allowlist (SSRF hardening)           | #6    | `src/utils/image-host-allowlist.ts`                                                                 |
| 10  | msw mock Graph fixture                               | #7    | `src/test-utils/setup.ts` (`graphApiHandlers`, `graphErrorHandlers`)                                |
| 11  | Stop tracking `test-results.xml`                     | #1    | `.gitignore`                                                                                        |
| 12  | Retry / backoff for Graph 429/5xx                    | #8    | `src/services/retry.ts` (`withGraphRetry`), `src/services/graph.ts` (`GraphService.request<T>`)     |
| 13  | Structured logging                                   | #9    | `src/utils/logger.ts` (`logger`, `withOperation`, `redact`)                                          |
| 14  | **This document**                                    | #10   | `docs/DEVELOPING.md`, `README.md` fork section, `FORK_NOTES.md`                                     |

The full McpHub-side roadmap lives in
[`teams_mcp/SYNC_STATE.md`](../../teams_mcp/SYNC_STATE.md); the design
analysis is in McpHub at `docs/teams-mcp-kod-incelemesi.md`.

## 3. Environment variables

| Variable                          | Required | Default | Read at                                                | Purpose                                                      |
| --------------------------------- | -------- | ------- | ------------------------------------------------------ | ------------------------------------------------------------ |
| `TEAMS_MCP_CLIENT_ID`             | yes      | —       | module load (`src/services/graph.ts:12`)               | Microsoft Entra public client app ID                         |
| `TEAMS_MCP_TENANT_ID`             | yes      | —       | module load (`src/services/graph.ts:18`)               | Microsoft Entra tenant ID (GUID or verified domain)          |
| `TEAMS_MCP_READ_ONLY`             | no       | `true`  | module load (`src/index.ts`)                           | Restrict the tool set to read-only scopes (#1, #2)           |
| `TEAMS_MCP_RETRY_MAX_RETRIES`     | no       | `5`     | every retry call (`src/services/retry.ts:48`)          | Total attempts per call (#12)                                |
| `TEAMS_MCP_RETRY_BASE_DELAY_MS`   | no       | `500`   | every retry call                                       | Base for exponential backoff (#12)                           |
| `TEAMS_MCP_RETRY_MAX_DELAY_MS`    | no       | `30000` | every retry call                                       | Cap on any single delay (#12)                                |
| `LOG_LEVEL`                       | no       | `info`  | every emit (`src/utils/logger.ts:158`)                 | `debug` / `info` / `warn` / `error` (#13)                    |
| `LOG_FILE`                        | no       | —       | every emit                                             | Append JSON lines to this path in addition to stderr (#13)   |

Variables are read at module load (`TEAMS_MCP_*`) or per call (retry
config and `LOG_LEVEL`) so tests and operators can adjust without
restarting the process. Negative numbers in retry env vars are ignored
and fall back to defaults.

### Kill-switches

There are no kill-switches inside the fork itself — all environment
behaviour is opt-in. The McpHub supervisor sets the required vars via
the `settings_env` channel (#6) so secrets never appear in plaintext
files or process listings.

## 4. Test + build evidence

Every PR must include a **before/after measurement** of the test suite,
plus the build exit code. PRs without this evidence are rejected at
review.

| Check          | Command         | Expected                                          |
| -------------- | --------------- | ------------------------------------------------- |
| Unit + msw     | `npm test`      | `Test Files <N> passed`, `Tests <M> passed`       |
| Compile        | `npm run build` | `tsc` exits 0                                     |
| Format / lint  | `npm run lint`  | no **new** diagnostics in changed files           |

Conventions (see PR #8 / PR #9 for examples):

- Capture the full vitest output to `logs/<topic>-test.log`.
- Capture the build output to `logs/<topic>-build.log` (logs are gitignored;
  the canonical evidence is in the PR body and `TEST_EVIDENCE_PR<n>.md`).
- Commit `TEST_EVIDENCE_PR<n>.md` at the repo root in the same PR — this
  is the persistent, grep-able record.
- Quote the upstream SHA pin in the PR body so the rebase state is
  visible without leaving GitHub.

A passing test count alone is not enough; reviewers verify the **diff**
between base and branch tip. The new reds must be zero.

## 5. Upstream synchronization

```bash
git fetch upstream
git checkout main
git merge --ff-only upstream/main     # fast-forward is the goal
# OR, when fast-forward isn't possible:
git rebase upstream/main              # resolve against src/index.ts and src/services/graph.ts first
```

Then push the rebased `main`:

```bash
git push origin main
```

`gh repo sync` is **not** preferred: it does not surface conflicts the way
a local rebase does, and our customizations sit as a clear commit on top
of an upstream snapshot — losing that ordering hurts bisect-ability.

### Cherry-pick path

For urgent upstream fixes (security advisories, blocking bugs) where a
full rebase is too noisy:

1. Branch from main: `git checkout -b fix/<topic> origin/upstream/<sha>`
2. Cherry-pick the fix commit(s).
3. Re-apply only the customization files that conflict.
4. Open a PR with `cherry-pick` in the title; **do not** fast-forward
   main until the rebase path has been tried and proven too painful.

## 6. PR rules

- **One commit per PR.** Don't squash multiple unrelated changes.
- **No amend.** Once a commit is on a shared branch, add a new commit.
- **No force-push** (`--force` and `--force-with-lease` are blocked by
  the pre-push hook). If history is wrong, push a new branch and merge
  master into it instead.
- **Title format**: `<scope>(teams-mcp): <imperative summary> (#N)`
  where `#N` is the customization number from `SYNC_STATE.md`.
- **Body must include**: before/after test counts, build exit code,
  upstream pin SHA, and a one-line "behaviour delta" sentence.

### Merge flow

1. PR opened by a worker.
2. Vekil (`Vekil` session in SessionHub) merges.
3. McpHub worker updates
   [`teams_mcp/SYNC_STATE.md`](../../teams_mcp/SYNC_STATE.md) with the
   merge SHA + PR number + customization id, commits, pushes. The commit
   message follows the pattern
   `chore(teams-mcp): sync tracker for PR #N merge (kart <id> #M <title>)`.
4. One-line report to Barış via the channel supervisor.

`deploy` is **never** part of this flow — that's Barış's call, separate
from the merge.

## 7. msw mocks in tests

The `src/test-utils/setup.ts` file exports a shared `server` built from
`graphApiHandlers` and `graphErrorHandlers`. Both ship in PR #7
(customization #10). Production code never imports `msw`.

### Default handler usage

```ts
import { server } from "../test-utils/setup.js";
import { http, HttpResponse } from "msw";

it("returns the user", async () => {
  server.use(
    http.get("https://graph.microsoft.com/v1.0/me", () =>
      HttpResponse.json({ id: "u1", displayName: "Test" })
    )
  );
  // ... call the code under test
});
```

### Error fixtures

`graphErrorHandlers({ throttled: true, serverError: true })` produces 429
and 5xx responses that exercise the retry/backoff path. Production retry
behaviour lives in `src/services/retry.ts:168` (`withGraphRetry`); the
22 tool call sites can migrate to `GraphService.request<T>` incrementally
— only some currently use it.

### Retry injection

```ts
import { withGraphRetry } from "../services/retry.js";

await withGraphRetry(() => callGraph(), {
  config: { maxRetries: 3 },
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
  sleeper: vi.fn(async () => undefined),   // skip real setTimeout
  operation: "/me",
});
```

## 8. Structured logging integration

`src/utils/logger.ts` is the single emission point for telemetry
(customization #13). New code must use `logger` instead of `console.*`:

```ts
import { logger, withOperation } from "../utils/logger.js";

// One-off emit
logger.warn("createLink (organization) failed; trying users scope", {
  module: "teams-mcp-file-upload",
  itemId: uploadResult.id,
  error: errorPayload(err),
});

// Wrapped operation — emits one line with operation, request_id, latency_ms, status
const result = await withOperation("graph_call", async () => {
  return await svc.request((c) => c.api("/me").get());
});
```

Conventions:

- `module` is a dotted kebab identifier (e.g. `teams-mcp-retry`,
  `teams-mcp-chats`).
- `errorPayload(err)` returns `{ message, stack? }` — `stack` is omitted
  when undefined so the JSON doesn't carry a noisy `"stack": null`.
- The legacy `[teams-mcp-retry]` free-text prefix remains inside the
  `message` field for backward-compatible `grep`; the structured
  `module` field is the canonical handle.
- `console.*` is reserved for `src/index.ts` CLI user prompts (the
  `authenticate` / `check` / `logout` / `--help` commands), where a
  JSON line would break the human UX.

## 9. Adding a new customization

End-to-end example for a hypothetical customization #15:

```bash
# 1. Branch from current main (which already has #1-#14)
git fetch origin
git checkout -b job/teams-hypothetical origin/main

# 2. Make the change. Add tests under src/<area>/__tests__/ — never
#    outside tests/.
$EDITOR src/utils/hypothetical.ts
$EDITOR src/utils/__tests__/hypothetical.test.ts

# 3. Verify
npm test
npm run build
npm run lint

# 4. Capture evidence
mkdir -p logs
npm test > logs/hypothetical-test.log 2>&1
npm run build > logs/hypothetical-build.log 2>&1
# Write TEST_EVIDENCE_PR<n>.md with the before/after numbers and the
# upstream pin SHA.

# 5. Commit + push
git add -A
git commit -m "feat(teams-mcp): hypothetical (#15) - <one-line summary>"
git push -u origin job/teams-hypothetical

# 6. Open the PR (no approval needed to open)
gh pr create --repo barisabaci/teams-mcp \
  --base main --head job/teams-hypothetical \
  --title "teams-mcp: hypothetical (#15)"

# 7. Report to Vekil with SHA, PR number, test result, build exit.
```

Vekil merges; McpHub worker updates
[`teams_mcp/SYNC_STATE.md`](../../teams_mcp/SYNC_STATE.md); one-line
report to Barış.

## 10. Conventions cheatsheet

| Topic               | Convention                                                                 |
| ------------------- | -------------------------------------------------------------------------- |
| Imports             | `.js` extensions on relative paths (ESM strict)                            |
| Indent             | 2 spaces; biome owns formatting                                            |
| Test files          | `<subject>.test.ts` next to the subject under `__tests__/`                  |
| Test framework      | vitest, with msw for HTTP fixtures                                         |
| Structured logging  | `src/utils/logger.ts` only; `console.*` for CLI user prompts in index.ts    |
| Sensitive data      | rely on `redact()` — never hand-roll a "safe" logger that skips fields      |
| Commit trailers     | `Co-Authored-By: Claude Code <noreply@anthropic.com>` when applicable       |
| Force-push          | never (mechanical block in pre-push hook)                                  |
| `--amend` on shared branch | never                                                                  |
