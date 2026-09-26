# PR #10 — Test Evidence (customization #14: development guide)

Honest measurement of `npm test` and `npm run build` on
`job/teams-dev-guide` vs `origin/main` (b9348b2, the merge point of
PR #9 / customization #13).

## Environment

- Node: v22.x
- npm: bundled with Node
- Branch tip: **TBD (this PR)**
- Base: **b9348b2e761aa48cc82c9e12a8eb3bedccb3b0ec** (origin/main, post PR #9)
- Upstream pin: 564ef67a868b6cf2e2b1a8cc7e191de34d847a80 (5 commits ahead)

## npm test — branch

```
 Test Files  27 passed (27)
      Tests  511 passed (511)
   Duration  ~11s
```

Log: `logs/dev-guide-test.log`

## npm test — origin/main (b9348b2)

Same node_modules before branch commits:

```
 Test Files  27 passed (27)
      Tests  511 passed (511)
```

## Comparison

|                    | origin/main (b9348b2) | branch (this PR) |
| ------------------ | --------------------- | ---------------- |
| Tests passing      | 511                   | 511              |
| New tests          | —                     | **0**            |
| New reds           | —                     | **0**            |

This PR is **docs only**. No test changes were introduced because the
documentation describes behaviour the codebase already had (#1–#13); no
customization is added beyond the guide itself. The unchanged test count
is therefore the correct measurement — the test suite is the regression
net, and it passes.

## npm run build

tsc exit 0; clean.

Log: `logs/dev-guide-build.log`

## Lint

`npm run lint` reports only the pre-existing format diagnostics in
files untouched by this PR (src/index.ts, src/msal-cache.ts, the two
client-id/tenant-id guard tests, src/services/__tests__/graph.test.ts).
No new lint errors introduced.

## Files changed

```
 FORK_NOTES.md      |  41 ++++---
 README.md          |  51 +++++++++
 docs/DEVELOPING.md | 317 +++++++++++++++++++++++++++++++++++++++++++++++++++++
 3 files changed, 393 insertions(+), 16 deletions(-)
```

- `docs/DEVELOPING.md` (new): 317-line maintainer guide covering fork
  workflow, env vars, test/build evidence standard, upstream sync, PR
  rules, msw mock usage, structured logging integration, the
  add-a-customization walkthrough, and the conventions cheatsheet.
- `README.md` (+51 lines): fork-customizations table + env-var table +
  add-a-customization pointer. Inserted before the License section;
  upstream README content is preserved unchanged.
- `FORK_NOTES.md` (delta): all 14 customizations marked **done** with
  PR numbers; new "Documentation" section pointing at
  `docs/DEVELOPING.md`.

## Upstream comparison

```
git diff origin/main HEAD --stat
```

The branch introduces 0 LOC of runtime behaviour; all changes are
prose-only. The upstream `floriscornel/teams-mcp` v1.0.1 tree has no
documentation that maps to these customizations — DEVELOPING.md is
fork-specific.
