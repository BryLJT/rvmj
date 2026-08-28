# Handover: RVMJ standings and multi-label notable wins

**Written:** 2026-08-28 17:19 SGT  
**For:** Claude or another agent resuming cold  
**Owner:** Bryan, who is not a developer. Explain user-visible consequences and the system flow before technical detail.

Read this entire document before touching the repository.

---

## 1. Exact stopping point

The work is isolated here:

```text
/Users/bryan/Desktop/claude code/RVMJ/.worktrees/standings-multi-label
```

- Branch: `feat/standings-multi-label`
- Committed HEAD: `4c2cd8afcd5b7c18db00b2c527ffe8c0300783da`
- Main repo: `/Users/bryan/Desktop/claude code/RVMJ`
- Main remains clean and untouched at `1c7ebd866f4e763ec21831cc21e6861b16026066`
- Nothing has been pushed, deployed, or applied to hosted Supabase.

Tasks 1–7 are committed and independently review-clean. Task 8 was started, then deliberately interrupted when Bryan asked for a handover.

There is exactly one in-progress code file:

```text
 M tests/components/HomeBoards.test.tsx
```

Its uncommitted diff is only the beginning of Task 8's test-recorder rewrite: 34 additions and 5 deletions. It adds RPC/table-read recording and scalar-or-array URL inputs. **No Task 8 production code has changed.** The new Task 8 cases have not yet been written or run RED.

The interrupted worker was `/root/task_8_ppg_home`. Do not assume it produced a report or a valid checkpoint.

---

## 2. Source documents and execution process

- Approved design: `docs/superpowers/specs/2026-08-28-standings-and-multi-label-notable-wins-design.md`
- Approved implementation plan: `docs/superpowers/plans/2026-08-28-standings-and-multi-label-notable-wins.md`
- Task 8 brief: `.superpowers/sdd/2026-08-28-standings-and-multi-label-notable-wins/task-8-brief.md`
- Full execution ledger: `.superpowers/sdd/2026-08-28-standings-and-multi-label-notable-wins/progress.md`

Bryan chose the subagent-driven execution option: one fresh implementer per task, strict TDD, then an independent reviewer, with bounded fix rounds and fresh scoped re-review. Continue that process. Do not implement later tasks in parallel.

The SDD workspace is git-ignored except for some reports that earlier workers accidentally committed. Do not run `git clean -fdx`; it would erase the useful briefs, review packages, reports, and ledger.

`AGENTS.md` requires the relevant Next.js 16 guides under `node_modules/next/dist/docs/` to be read before editing Next files. The plan names the three pinned guides at line 28.

---

## 3. Completed work

| Task | Result | Commits |
|---|---|---|
| 1 | Multi-label relation, backfill, atomic save RPC, legacy wrapper, and cutover-race bridge | `0765ef3`, `51f73da`, `74bae17` |
| 2 | Server-only latest-20 PPG and ranked notable-win query functions | `3b86925`, `18615e7` |
| 3 | Server action accepts and defensively normalizes a label array while preserving photo behavior | `f915b0b`, `004d3cc` |
| 4 | Approved inline logger B: all 12 checkbox choices grouped Uncommon/Rare/Legendary | `849bafa`, `4a94277` |
| 5 | Live match keeps one win row and displays every attached label, failing closed on unreadable labels | `e4d9374`, `d956948` |
| 6 | Gallery keeps one photographed card per win and displays every label | `ee48f91`, `b8f1e7f` |
| 7 | Shared board/year/hand URL contract, formatting helpers, and generalized year pills | `ebd3293`, `4c2cd8a` |

Every completed task had an independent review. Important findings were fixed and freshly re-reviewed.

One deferred Minor from Task 1 remains in the ledger: the two-label database case proves a count of two and the legacy label, but does not compare the exact `{All Pungs, Pure Suit}` ID set. It is not a production defect. Include it in final review or harden it if nearby test work makes that natural.

---

## 4. Verification state

At the Task 7 clean checkpoint:

- Focused Task 7 tests: 26 passed.
- Full Vitest: 50 files, 524 tests passed.
- Lint: 0 errors and one known pre-existing warning for unused `_props` in `src/app/game/[id]/GameLive.tsx`.
- `git diff --check`: passed.
- Typecheck currently fails only because Task 7 made `board` and `handIds` required on `YearPills`, while Task 8 has not yet updated the homepage call. This is the planned Task 7 → Task 8 handoff, not an unexplained regression.

Database verification after Tasks 1–2 passed through the real PostgreSQL harness:

```bash
bash tests/database/run-migrations.sh
```

The harness needs permission outside the sandbox because local PostgreSQL shared memory is blocked inside it. Existing `wal_level` and `NOTICE` output are known and non-failing.

Do not claim current typecheck or the final app is green until Task 8 completes the `YearPills` integration.

---

## 5. Resume with Task 8

First inspect the one uncommitted test diff. Continue it; do not discard it automatically.

Task 8 owns only:

- `src/app/page.tsx`
- `tests/components/HomeBoards.test.tsx`

Required outcome:

1. Visible tabs are exactly `Total score`, `Pts per game`, and `Notable wins`; internal keys remain `lifetime`, `form`, and `skill`.
2. The default is the current academic year when it has finished games, otherwise All time.
3. The same academic-year pills appear on all three boards whenever years exist.
4. Valid repeated `hand` filters survive tab switches and year changes, even though Total score and Pts per game ignore them.
5. Pts per game calls `points_per_game_board` with `p_academic_year: null` for All time or the selected integer year.
6. Render PPG in the SQL-returned order. The database already averages each player's own latest 20 completed games within the selected period.
7. Exact contexts: `1 game counted`, `19 games counted`, and `Latest 20 games`.
8. Exact signed one-decimal values such as `+8.5`, `0.0`, and `-3.2`, with gain/neutral/loss tones.
9. Remove the old Form placeholder and every app-mode scoring explanation. Bryan explicitly said not to mention app-mode scoring at all.
10. A failed PPG RPC must show `Couldn’t load this board`, not an empty board.
11. Preserve Total score behavior, board prefetching, auth, house prompt, House rules, and the hand-gallery link.

Task 9, not Task 8, owns the new Notable-wins ranking/filter components and RPC integration. Do not pre-build it.

After Task 8 implementation, run:

```bash
npx vitest run tests/components/HomeBoards.test.tsx tests/components/YearPills.test.tsx tests/standings.test.ts
npm test
npm run typecheck
npm run lint
git diff --check
```

Then commit, independently review Task 8, and use the normal fix/re-review loop before starting Task 9.

---

## 6. Product rules that must survive

- One physical winning hand can carry several labels. Never render it as several wins.
- Logger design is the approved original B: one scrolling form, all 12 inline checkboxes, grouped Uncommon/Rare/Legendary.
- The leaderboard ranks individual notable wins, not players.
- No filters: total label count descending, then newest, then ID.
- Active filters use match-any eligibility, then rank by how many selected labels match, then total labels, newest, and ID.
- Empty filter selection means all notable wins.
- The gallery is a separate, complete photographed archive and never inherits leaderboard hand filters.
- Removing or replacing a photo affects the one win's photo only; the win and all labels remain.
- Winner/date/all labels/label count appear on each ranked notable-win row.
- Dates use Singapore time.
- Tab switches and academic-year changes preserve valid hand filters.
- Do not mention app-mode scoring.

---

## 7. Remaining plan

- **Task 8:** homepage labels, shared period state, and Pts per game. In progress only at the test-recorder setup.
- **Task 9:** server-rendered hand-type filter panel, individual notable-win rows, and `notable_wins_board` integration.
- **Task 10:** focused/full verification, migration harness, build/browser checks, full diff review, and final independent review.
- **Task 11:** stop for Bryan at production Gate A.

Do not combine Tasks 8 and 9 merely because both touch `page.tsx`; Bryan approved the review checkpoint between them.

---

## 8. Production gates

No production action is authorized.

When local work is completely verified:

1. **Gate A:** ask Bryan separately before applying migrations `0011` and `0012` to hosted Supabase, then verify the live database.
2. **Gate B:** only after Gate A is verified, ask Bryan separately before pushing/deploying the application.

The database change is deliberately compatible with the old application: the legacy single-label RPC remains and a migration-time bridge covers a request already in flight. The database-first order is intentional. Never edit old migrations; any correction belongs in a new migration.

**Gate A must come before Gate B — the compatibility runs one way only.** `0011` keeps the CURRENTLY deployed app working after the migration lands. It does not make the NEW app work before it. The new application hard-depends on three objects `0011` creates:

| What the app calls | Where |
|---|---|
| `log_notable_win(uuid, uuid, uuid[], uuid, text)` | `src/lib/actions/game.ts` |
| `notable_claim_types(notable_hand_id)` | `src/app/game/[id]/ChipLive.tsx` |
| `notable_claim_types(notable_hands(name))` | `src/app/hands/page.tsx` |

Deployed ahead of the migration, notable logging fails, the hand gallery errors, and the live chip screen cannot end or count a game — on the screen four people use around a table. Migrate first, verify, then deploy. The same note is on `0011`'s own header so it travels with the migration.

**One exception to "never edit old migrations", already taken.** That rule protects migrations that have RUN somewhere. `0011` and `0012` have never been applied to hosted Supabase — Gate A is still closed — so two review findings were corrected in place rather than shipped as fix-ups for migrations that never existed anywhere: `0011`'s `notable_claim_types` read policy (it was narrower than its parent, which broke the live game screen for spectators) and `0012`'s `notable_wins_board` label aggregation (it scanned every label ever logged on every home page view). Once Gate A opens, the rule applies again with no exceptions.

Do not push, merge, deploy, alter hosted data, or open either gate on your own.
