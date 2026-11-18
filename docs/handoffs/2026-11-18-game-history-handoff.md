# RVMJ game history — Claude handoff

**Stopped at Bryan's request: 18 November 2026, about 18:23 SGT.**
Bryan: "nvm just end where you can, claude will take over you".

## State
- Repository: /Users/bryan/Desktop/claude code/RVMJ.
- Branch: main. HEAD is da2cb7d04e2ee3e84eb497aa39426fea94ec47f9, the existing remote main.
- Feature changes are UNCOMMITTED in the working tree. Nothing from this feature has been pushed or deployed.
- No hosted Supabase changes were applied.
- Preserve all current modified/untracked files. Do not reset/clean the checkout.
- Implementation agent implement_history has stopped and saved its detailed report at .superpowers/sdd/2026-11-18-game-history/task-1-report.md.

## Approved behaviour
- Game history directly in Settings in a bounded independently scrollable box.
- Fixed history heading; newest ended games first; date/time, co-players, signed net points.
- Load older games (20 per page) without resetting the box. Restore loaded rows/scroll after visiting a game or win photo.
- Narrower display-name input with Save aligned on its right.
- Participant-only game detail with four stored results and existing notable wins.
- Record a missed notable win after an ended chip game; any participant can nominate a participant winner and catalogue labels, optional photo.
- Reuse existing photo preparation/private storage and individual win page.
- Original game date, no score/chip changes. Stable claim UUID prevents duplicates after a lost response.
- Approved spec: docs/superpowers/specs/2026-11-18-game-history-design.md.
- Build plan: docs/superpowers/plans/2026-11-18-game-history.md.
- Approved interactive prototype: /Users/bryan/Desktop/claude code/claude agents/output/rvmj/game-history-preview.html.

## Implemented files
- src/lib/game-history.ts: DTOs, cursor validation, parsing and display helpers.
- src/lib/actions/history.ts: getGameHistory, getHistoricalGame, saveHistoricalNotable.
- src/app/account/GameHistory.tsx: bounded list, pagination/retry, cache restoration.
- src/app/account/HistoryState.tsx and src/app/layout.tsx: root-lifetime, viewer-scoped history cache so the /hands trip does not lose state.
- src/app/account/games/[gameId]/: route, detail, historical form and photo picker.
- src/app/account/page.tsx and RenameForm.tsx: history placement and compact name row.
- src/app/hands/[claimId]/page.tsx: safe from=history return link derived from claim's own game.
- supabase/migrations/0020_game_history.sql: personal_game_history, save_historical_notable, finish_historical_photo, historical_notable_saves retry metadata.
- Added/extended action, component/page tests and tests/database/history_cases.sql + run-migrations.sh.

## Checks and remaining work
- Baseline latest main: 833 tests passed.
- Last full feature suite before final formatting/operator-log edits: **60 test files, 863 tests passed**. Current final edits have not been re-tested. Log: /tmp/rvmj-history-tests.log.
- Last production build before those final edits: **passed**, including /account/games/[gameId]. Log: /tmp/rvmj-history-build.log.
- Earlier targeted actions/UI tests and typecheck passed; inspect worker report for most recent status after cache changes.
- New migration replay completed locally through the existing harness, but the complete database behavioural/race run has NOT passed.
- Latest local SQL failure: tests/database/history_cases.sql:17, duplicate key games_one_open_per_table. The fixture creates multiple open games on one table. Correct the fixture while preserving the real unique constraint. An earlier fixture failure was invalid chip counts versus final_total; that was corrected.
- Latest lint exits 0 with 4 warnings: 1 pre-existing GameLive warning and 3 new unused mock-argument warnings in tests/actions/history.test.ts. Clear the new warnings. Final formatting verification, independent code review and browser inspection remain unfinished. Do not treat the approved prototype screenshots as actual implementation verification.
- The ignored Vite/browser fixture requested earlier was not created. No new packages were installed.
- Check same-user navigation through history → detail → /hands → detail → Settings and cross-user state resets.
- Re-run relevant checks after fixes, then commit and push main under Bryan's prior authorisation unless he gives a new scope.

## Historical photo ordering
The implementation creates/confirms the historical claim first with a stable UUID and immutable photo digest/format metadata, then uploads to a deterministic path and finishes attachment. A lost response can replay the same request. A confirmed save should not resurrect a photo another participant later removed. Review concurrent retries and all rejected/ambiguous attachment cleanup paths carefully.

## Supabase scope and existing setup
Bryan explicitly assigned Supabase to Claude. Do not ask him to log in again. Use the existing setup.
- Global Supabase CLI returned an auth-required message; that was a tool-path failure, not proof access is absent.
- The installed official bundled client at node_modules/@supabase/cli-darwin-arm64/bin/supabase-go reached the database connection step with normal stored auth, then reported IPv6 network routing failure to port 5432. No new login is established as necessary.
- A separate metadata check of the saved credential was blocked by automatic approval as credential extraction. Do not repeat it or bypass that rejection.
- No credential values were printed, stored or added to this handoff.
- Existing main includes migrations 0018/0019 (rarity/gallery changes). New code needs **0020** for its history reader and historical writes. Until 0020 is applied, history shows an honest error/retry and existing account controls remain available.
- Before applying, read the migration fresh and verify local tests/review. Apply using the existing authorised Supabase connection and keep migration history in sync. Verify server-only function grants, all labels, unchanged existing scores, and retry behaviour.
