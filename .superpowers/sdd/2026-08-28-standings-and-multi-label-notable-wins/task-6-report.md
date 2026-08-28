# Task 6 Report: Multi-label photographed-hand gallery

## Result

Completed. `/hands` remains a complete, unfiltered photographed-win archive. It now reads each parent claim's `notable_claim_types(notable_hands(name))` join, alphabetizes every present label name, signs all paths in one batch, and produces one `HandPhoto` per parent claim.

The gallery keeps `claimId` as the React key and photo-removal target. Each one card and full-screen panel now renders every label, while the card, image, and dialog accessible names include the joined labels and winner. Existing Singapore-night grouping, owner-only removal control, failure retention, refresh, authentication, error state, newest-first ordering, 60-row limit, and unsigned-path omission remain unchanged.

## Test-first evidence

- Updated the gallery fixture to the `handNames: string[]` DTO and added a parent claim with `['All Pungs', 'Pure Suit']` before production changes.
- Observed RED with the legacy implementation: gallery controls were named from an undefined singular field; the old parent relationship failed the exact nested-query assertion; joined labels were absent from the rendered archive.
- Added the nested-query boundary test and server-rendered alphabetization/card-count test before changing the page.
- Mutation checks passed:
  - Temporarily replacing `notable_claim_types(notable_hands(name))` with legacy `notable_hands(name)` failed the query-contract assertion.
  - Temporarily duplicating each parent gallery item failed the one-card assertion (`expected 1, received 2`).
  - Both mutations were restored before final verification.

## Verification

| Check | Result |
| --- | --- |
| `npx vitest run tests/components/HandsGallery.test.tsx tests/pages/hands-page.test.ts` | 12 passed |
| `npm test` | 49 files, 503 tests passed |
| `npm run typecheck` | passed after the required sandbox retry for Next-generated `.next/types/routes.d.ts` |
| `npm run lint` | no errors; one pre-existing unused `_props` warning in `src/app/game/[id]/GameLive.tsx` |
| `git diff --check` | passed |

## References reviewed

- `AGENTS.md`
- `.superpowers/sdd/2026-08-28-standings-and-multi-label-notable-wins/task-6-brief.md`
- `docs/superpowers/plans/2026-08-28-standings-and-multi-label-notable-wins.md`
- `docs/superpowers/specs/2026-08-28-standings-and-multi-label-notable-wins-design.md`
- `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/page.md`
- `node_modules/next/dist/docs/01-app/03-api-reference/02-components/link.md`
- `node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md`

## Scope and concerns

Only the assigned gallery page/component tests and this report changed. No live logger, action, database, standings, dependency, hosted-service, deployment, or push changes were made.
