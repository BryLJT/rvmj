# Task 4 — Inline multi-label notable-win logger

## Delivered

- Replaced the logger's one-value select with real checkbox controls for the full catalogue.
- Rendered the groups in the approved order: **Uncommon**, **Rare**, then **Legendary**. Each labelled checkbox has a `min-h-11` (44px) touch target.
- Renamed the active-game launcher, panel, action, and busy state to **Log notable win** / **Logging…**.
- Kept selections in click order, removed only the clicked ID on a second click, and submit once with the complete selected ID array.
- Preserved the selected winner and every selected hand through returned request failures, thrown failures, upload-failure recovery, and the no-photo escape.
- Kept the prior photo capture/library, preparation, replacement/removal, preview cleanup, failure escape, duplicate-submit guard, and live-sync blocking flow intact.
- Added `rarity` to the server catalogue read and the `GameLive`, `ChipLive`, and `NotableLogger` catalogue contracts. `ChipLive` remains on its existing single-label live read/render path; Task 5 owns that change.

## TDD record

1. Updated `tests/components/NotableLogger.test.tsx` first with checkbox/grouping, disabled-state, ordered multi-ID submission, deselection, and selection-retention assertions.
2. Ran `npx vitest run tests/components/NotableLogger.test.tsx` against the unchanged logger: **RED** — 16 failures, caused by the old `Log notable hand` dialog and single combobox.
3. Implemented the smallest state/UI/type changes needed.
4. Updated the adjacent `ChipLive` fixture and existing launcher/draft assertions because the required public launcher rename and checkbox control superseded those old expectations.

## Next.js references read before production edits

- `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/page.md`
- `node_modules/next/dist/docs/01-app/03-api-reference/02-components/link.md`
- `node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md`

The page remains a Server Component that reads the rarity-aware catalogue and passes serializable data into the existing client logger/live components.

## Verification

| Check | Result |
| --- | --- |
| `npx vitest run tests/components/NotableLogger.test.tsx` (RED) | 16 expected failures before implementation |
| `npx vitest run tests/components/NotableLogger.test.tsx tests/components/ChipLive.test.tsx tests/components/AppStates.test.tsx` | 54 passed |
| `npm test -- --run` | 49 files, 494 tests passed |
| `npm run typecheck` | Passed after one sandbox retry: Next.js needed to write `.next/types/routes.d.ts` |
| `npm run lint` | 0 errors, 1 pre-existing warning |
| `git diff --check` | Passed |

### Lint warning

`src/app/game/[id]/GameLive.tsx:3:26` reports `_props` as unused (`@typescript-eslint/no-unused-vars`). It is pre-existing: the base revision already contained the Task 21 stub parameter. This task changed only the nested catalogue prop shape.

## Scope review

Modified only the Task 4 route/logger/live contract files and their directly affected component tests. `tests/components/AppStates.test.tsx` required no change. No database, action, standings, gallery, dependencies, hosted services, push, or deployment changes were made.
