# Personal Game History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Bryan's approved scrollable game history in Settings, historical notable wins and photo navigation; release to main.
**Architecture:** Existing Next.js/React/Supabase. Account keeps its controls and a client-side bounded history box. Authenticated server actions read the player's ended games with stable pagination; a participant-only detail route shows stored results and existing/new notable wins. A new server-only database function logs historical chip claims idempotently without touching scores.
**Tech Stack:** Next.js 16.3, React 19, TypeScript, Tailwind 4, Supabase PostgreSQL/storage, Vitest.
**Spec:** docs/superpowers/specs/2026-11-18-game-history-design.md
**Execution:** One implementer owns this coherent feature end-to-end; one independent final reviewer. Bryan already authorised building and pushing main on 18 November. No further plan approval is needed. Keep the existing checkout on main; no downloads or new dependencies.

## Global Constraints
- History lives directly in Settings inside its own scrollable box, with fixed heading.
- Display-name field is narrower; Save sits on its right on the same row.
- Reuse existing design, catalogue, private photo pipeline and stored points.
- Preserve other work. Current GitHub main includes migrations 0018/0019; next migration is 0020.
- Existing live logger stays active-chip-only. A separate historical logger permits ended chip games only.
- Only the authenticated player's games appear; all sensitive reads and writes re-check session/membership.
- No production test fixtures or edits to existing game results. No secrets in output/docs.
- Bryan reassigned hosted Supabase work to Claude after authorising build/push. Root finishes/tests/pushes code and provides the 0020 handoff; do not run hosted migrations or ask for a login.
- Do not download packages, models, binaries or assets. Existing node_modules and PostgreSQL binaries are installed.

## Review Focus
- Lost save response/repeated taps must not duplicate a win or delete a referenced photo.
- Reopened games and concurrent historical saves must use the game's locked current status.
- Missing scores/labels/read failures cannot become fabricated zeroes/empty history or partial label sets.
- Navigation and expired sessions must preserve safe return routes; arbitrary query values cannot create open redirects.
- Inner scroll and loaded older pages restore when returning from detail; no wrong-user cache exposure.

### Task 1: Complete personal game history and historical notable wins

**Files/responsibilities:**
- Modify `src/app/account/page.tsx`, `RenameForm.tsx`: history placement and compact save row.
- Create focused files under `src/app/account/` for the scrollable history and `games/[gameId]/` detail/form.
- Add account layout/client context if needed to preserve loaded history and scroll during navigation.
- Create `src/lib/game-history.ts` (serialisable types/validation) and `src/lib/actions/history.ts` (authenticated reads/writes).
- Create `supabase/migrations/0020_game_history.sql`: bounded history reader if needed and server-only idempotent historical logging function.
- Extend existing `src/app/hands/[claimId]/page.tsx` return routing from history; never replace board/gallery navigation.
- Extend database harness and add SQL cases for historical logger guards, idempotency, permission boundaries, labels and unchanged scores.
- Add meaningful tests under `tests/actions/`, `tests/pages/`, `tests/components/`, plus shared helpers as needed.

**Interfaces:**
- Consume existing `createServerSupabase`, `createAdminClient`, `preparePhoto`, `NotablePhotoControls`, catalogue and claim parsers.
- Produce typed `getGameHistory(cursor?)` server action returning a bounded batch of own ended games, each including game id, mode, variant, end timestamp and all player names/stored totals; plus next cursor or error.
- Produce a historical save server action accepting stable request/claim UUID, game, winner, label ids and optional prepared photo. Derive logger from session. Same request replay must confirm the existing identical save; mismatched replay refuses.
- Historical claim timestamp is game's ended_at. Label selection is complete or refuses. Preserve recorded logger/photo contributor.
- Exact internal function names/normalised DTO field names are implementer choices; define them once and keep boundaries typed.

- [ ] Step 1: Read relevant current source and installed Next.js guides; write failing tests for pagination/authentication, historical-save guards/idempotency, scroll-state restoration, display-name layout and safe history return routing. Run targeted tests and observe missing-feature failures.
- [ ] Step 2: Implement additive SQL and real-PostgreSQL cases. Lock ended chip game before checking status; require both actor and winner participation and all requested labels; use existing claim UUID as stable idempotency key (no winner/type dedupe). Assert service-only execution/search_path and preserved scores/dates.
- [ ] Step 3: Implement authenticated server actions and robust optional photo flow. Decide and document the upload/claim ordering so a failed response can be retried without duplicates or broken references. Keep photo bytes private and clean up rejected uploads. Validate cursors/UUIDs and return distinct absent/error states.
- [ ] Step 4: Implement the approved UI, compact name row, history pagination (20 per read), detail and missed-win form, existing win/photo page links. Use Next route state/context or scoped cache to restore history and scroll. Keep form selection/photo on failure. Show safe errors if game reopens.
- [ ] Step 5: Run targeted tests, then `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, `bash tests/database/run-migrations.sh`, `git diff --check`. Expected: all tests pass, typecheck/build pass, no new lint warnings, PostgreSQL harness passes.
- [ ] Step 6: Self-review all diff; commit coherent implementation. Write implementer report with exact test results and any concerns/rulings; root independently reviews and verifies browser rendering before release.

## Release (root responsibility)
- Independent final review; fix material findings and re-run relevant checks.
- Inspect actual rendered implementation on phone/desktop using fixtures without production writes.
- Leave hosted migration 0020 to Claude, per Bryan's explicit scope change. Include exact migration, verification and compatibility instructions in a committed handoff.
- Push reviewed commit to origin main without force and verify remote SHA and deployment status. Report hosted migration as pending for Claude; do not claim the new signed-in feature is live before it is applied.
