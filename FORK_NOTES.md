# Fork Notes — barisabaci/teams-mcp

This repository is a fork of [`floriscornel/teams-mcp`](https://github.com/floriscornel/teams-mcp),
maintained for use inside the McpHub project (Ceo Agent, stdio-based). It exists
because the upstream default behaviour around secrets, default scopes and the
hardcoded public client app ID is incompatible with our deployment rules.

## Upstream

- Repository: <https://github.com/floriscornel/teams-mcp>
- Pinned upstream commit: **`564ef67a868b6cf2e2b1a8cc7e191de34d847a80`**
  (tag `v1.0.1`; same SHA as `1.0.0` + jsdom runtime dep fix)
- License: **MIT** — see `LICENSE`. Copyright (c) Floris Cornel, 2025.
- Original author credit retained in `package.json` (`author`, `repository`,
  `homepage`).

## Sync policy

We track `floriscornel/main` and rebase this fork onto upstream periodically.
The workflow is **prefer `upstream` remote + `git pull --rebase`** over
`gh repo sync` so the history stays linear and our customizations land as a
clear commit on top of an upstream snapshot.

```bash
# One-time setup (already done in this clone):
git remote add upstream https://github.com/floriscornel/teams-mcp.git
git fetch upstream

# Periodic rebase (run from a clean working tree on a branch cut from main):
git fetch upstream
git rebase upstream/main
# resolve any conflicts against src/index.ts and src/services/graph.ts,
# then push the rebased branch and let CI run.
```

Cherry-picking specific upstream fixes (security advisories, blocking bugs)
is fine when a full rebase is too noisy; do that on a dedicated branch and
fast-forward `main` only after the rebase path proves too painful.

## Documentation

The end-to-end maintainer guide lives at
[`docs/DEVELOPING.md`](./docs/DEVELOPING.md) (customization #14, PR #10).
It covers fork workflow, env vars, the test/build evidence standard,
upstream sync, PR rules, msw mock usage, and structured-logging
integration. New maintainers should start there before opening a PR.

## Customizations applied in this fork

14 customizations are planned; all 14 are **done**. This fork-setup
PR was the foundation; the baraj rules (#1–#13) ship in PRs #4–#9; the
documentation PR is #10.

| #   | Change                                                                                          | Status        |
| --- | ----------------------------------------------------------------------------------------------- | ------------- |
| 1   | Sending default OFF                                                                            | **done** (PR #4) |
| 2   | Read-only mode default                                                                          | **done** (PR #4) |
| 3   | Remove `AUTH_TOKEN` direct-injection bypass                                                     | **done** (PR #4) |
| **4** | **Remove `CLIENT_ID` hardcoded fallback** (this PR)                                           | **done** (PR #1) |
| 5   | Remove tenant `common` fallback                                                                 | **done** (PR #4) |
| 6   | Secrets via `settings_env` (no plaintext home-dir files)                                        | **done** (PR #5) |
| 7   | File mode `0600` for cache/auth metadata                                                        | **done** (PR #5) |
| 8   | Drop unused `@azure/identity-cache-persistence` dependency                                      | **done** (PR #5) |
| 9   | `imageUrl` host allowlist (SSRF hardening)                                                      | **done** (PR #6) |
| 10  | msw mock Graph fixture for tests                                                                | **done** (PR #7) |
| **11** | **Remove `test-results.xml` from git** (this PR)                                              | **done** (PR #1) |
| 12  | Retry / backoff for Graph 429/5xx                                                              | **done** (PR #8) |
| 13  | Structured logging                                                                              | **done** (PR #9) |
| 14  | Development guide (`docs/DEVELOPING.md`)                                                        | **done** (PR #10) |

Full analysis: see the design doc this fork was derived from
(commit `17d2d7c` in the McpHub repo, `docs/teams-mcp-kod-incelemesi.md`).

## Why a fork rather than vendoring

The upstream skeleton — device-code MSAL flow, `if (!readOnly)` write-tool
gate, DOMPurify sanitization chain, MSAL cache plugin — maps onto our
requirements with small, targeted policy changes (defaults flipped, secrets
re-routed, two dependency trims). The four changes in the previous paragraph
are all <10 lines combined; reimplementing them would cost ~3500 LOC and
require re-deriving the 238-test upstream suite.
