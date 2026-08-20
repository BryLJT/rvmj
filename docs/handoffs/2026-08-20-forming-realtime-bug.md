# Handoff: forming screen does not update when other players tap in

**Written** 2026-08-20 ~21:10 SGT. **Updated** 2026-08-20 21:52 SGT. **Author** Alfred.
**Status** root cause reproduced and local fix implemented. Production validation remains open.

Read the whole document before touching anything. The production symptom is not closed until two signed-in phones verify it after an approved push and deploy.

---

## 1. The bug

Four players tap NFC stickers to join a game. Each tap lands them on the forming screen. **The first player's screen does not update as the others join.** They must manually refresh the browser to see the roster fill up.

Reported by Bryan after migration `0004` was applied to hosted Supabase earlier the same day. The controlled reproduction in §5 now explains why that migration exposed the symptom without being the source of the client race.

The same subscription pattern was present in:

- `src/app/game/[id]/FormingScreen.tsx`
- `src/app/game/[id]/ChipLive.tsx`
- `src/app/game/[id]/ChipEndFlow.tsx`

`ChipEndFlow` is the four-phone confirmation step, so the implementation covers all three rather than patching only the forming screen.

---

## 2. Current repository and hosted state

- GitHub `main` and local `main` both point to **`bbb10ab`**. Bryan approved and requested pushing the existing `0004` correction before this work began.
- Realtime implementation is isolated on local branch **`fix/authenticated-realtime`**, based on `bbb10ab`.
- The Realtime work is uncommitted, unpushed, and undeployed.
- Baseline before implementation: **23 test files, 237 tests passed**.
- Focused TDD verification currently passes: helper **6/6** and the three subscription screens **66/66** (or **71/71** including the directly affected NotableLogger suite).
- No file under `supabase/` and no hosted database permission was changed by this Realtime work.

### What `bbb10ab` changed

`supabase/migrations/0004_explicit_access_grants.sql` makes database permissions explicit. Its original function-default cleanup revoked only the global entry, while hosted Supabase also carried a `postgres`-owned, `public`-schema entry granting future-function `EXECUTE` to API roles. `bbb10ab` added the schema-scoped revoke and a hosted-baseline database test.

**Migration `0004` is applied and verified on hosted.** Migration history reads `0001/0002/0003/0004`.

---

## 3. What `0004` changed about access

Measured on the hosted database, not inferred:

| Check | Result |
|---|---|
| All 15 functions in `public`, runnable by `anon` | **no** |
| All 15 functions in `public`, runnable by `authenticated` | **no** |
| All 15 functions in `public`, runnable by `service_role` | **yes** |
| `supabase_auth_admin` can execute `handle_new_user()` | **yes** |
| `authenticated` can read `players.display_name` | **yes** |
| `authenticated` can read `players.email` | **no** |
| `authenticated` can read `table_seats` | **no** |

The material change for this bug: `anon` previously had implicit `SELECT` on `public` tables. `0004` removed that and granted gameplay reads only to `authenticated` and `service_role`. A channel that accidentally joined as `anon` therefore stopped receiving table events.

---

## 4. Eliminated hypotheses

Each was checked with source or hosted evidence.

**H1. The first player is on a screen with no subscription.**
Eliminated by `src/app/t/[secret]/page.tsx`: every successful path redirects to `/game/{id}`, where the forming screen subscribes.

**H2. Row-level security hides other players' rows.**
Eliminated. `0001_chip_spine.sql` contains `read game_players` for `authenticated` with `using (true)`.

**H3. The RLS policy is inert because there is no matching grant.**
Eliminated. `0004` explicitly grants `SELECT` on `game_players` to `authenticated`.

**H4. Supabase is not broadcasting the tables, or `0004` over-revoked.**
Eliminated on hosted:

```text
game_players_broadcast     = 1
games_broadcast            = 1
can_read_game_players      = true
can_read_games             = true
can_reach_public           = true
game_players_detail_level  = 'd'
```

**H5. The exported Realtime logs contain a channel authorization failure.**
They do not. The 12 exported entries are tenant startup and Broadcast plumbing; there is no channel join, role, subscription, or authorization entry.

---

## 5. Proven root cause

The installed client versions can subscribe before the restored user's access token reaches Realtime. That produces a tokenless channel join authorized as `anon`. A later auth update changes the Realtime client's stored token but does not repair the already-joining channel.

This was reproduced in a controlled in-memory harness against the exact installed packages: `@supabase/supabase-js` 2.112.0 and `@supabase/ssr` 0.12.4.

### Controlled comparison

```json
{
  "delayedRestore": {
    "frames": 1,
    "joinSent": true,
    "joinHadUserToken": false,
    "joinRole": "anon"
  },
  "explicitPreAuth": {
    "frames": 1,
    "joinSent": true,
    "joinHadUserToken": true,
    "joinRole": "authenticated"
  }
}
```

### Stronger false-positive check

A fake server acknowledged the tokenless join. The client reported `SUBSCRIBED`; session restoration later put the authenticated token into the Realtime client; no corrective channel event followed:

```json
{
  "joinHadUserToken": false,
  "statuses": ["SUBSCRIBED"],
  "followupEvents": [],
  "realtimeEventuallyHeldUserToken": true
}
```

This matters because `SUBSCRIBED` plus “a session exists now” does **not** prove the original `phx_join` carried the user token.

The harness used fake URLs, fake tokens, in-memory storage, and a fake WebSocket/server. It used no real access token, NFC seat secret, hosted row, network call, or database permission change.

### SDK nuance

The earlier observation that application source did not call `onAuthStateChange` was incomplete. `createBrowserClient`/Supabase wires auth changes into Realtime internally. The failure is the startup ordering: that later wiring updates the client token but does not retroactively authenticate the channel join already in progress.

---

## 6. Local implementation

New shared gate: `src/lib/supabase/realtime.ts`.

For every gameplay channel it now:

1. Restores the current session with `auth.getSession()`.
2. Requires a signed-in session.
3. Explicitly calls `realtime.setAuth(session.access_token)`.
4. Only then constructs and subscribes the channel.
5. Cancels pending startup if the component unmounts.
6. Removes an established channel while suppressing the expected cleanup `CLOSED` callback.
7. Waits for a same-topic channel removal to finish before rebuilding, avoiding Supabase's reuse of a channel still in `leaving`.
8. Converts startup failures into `CHANNEL_ERROR` without logging or displaying the token.

All three components now use that gate while preserving their channel names, filters, event handlers, `SUBSCRIBED` reloads, foreground recovery, and stale-state locks.

Player-facing failure behavior:

- `FormingScreen`: shows “Live updates paused,” blocks stale starting, and keeps `Refresh seats` available until the channel actually reaches `SUBSCRIBED` again.
- `ChipLive`: marks the table stale, explains the lost live connection, invalidates older reads, and keeps live-game actions blocked across successful HTTP refreshes until a new `SUBSCRIBED`.
- `NotableLogger`: preserves an already-open draft after connection loss but blocks submission and shows the live-connection error.
- `ChipEndFlow`: synchronously blocks count/confirmation actions, invalidates older reads, and keeps them blocked across successful HTTP refreshes until a new `SUBSCRIBED`.

---

## 7. TDD evidence

The helper test was run before the helper existed and failed because `src/lib/supabase/realtime.ts` could not be resolved. Later review-driven tests were also observed RED before each lifecycle fix. All six helper tests now pass.

The first three component failure tests were run against the old direct-subscription callbacks. Exactly those three tests failed while all 60 pre-existing focused tests passed. Four later review-driven component tests then failed against the first implementation before the failure latches and open-logger guard were added. The three subscription-screen suites now pass 66/66; including NotableLogger, the directly affected component suites pass 71/71.

The tests guard these concrete regressions:

- channel construction or `.subscribe()` moving ahead of `setAuth()`;
- subscribing with no session;
- subscribing after unmount wins session restoration;
- subscribing after unmount wins token attachment;
- rebuilding a same-topic channel before its previous asynchronous removal finishes;
- leaking cleanup-triggered `CLOSED` to the screen;
- silently ignoring `CHANNEL_ERROR`, `TIMED_OUT`, or unexpected `CLOSED`;
- leaving stale gameplay actions enabled after a connection failure;
- allowing a successful HTTP refresh to mask a still-failed live channel;
- leaving an already-open notable-hand action enabled after connection loss;
- removing FormingScreen's recovery UI before the live channel reconnects.

---

## 8. Verification results and acceptance gate

Fresh local verification on 2026-08-20:

| Check | Result |
|---|---|
| `npm test` | **pass** — 24 files, 249 tests |
| `npm run typecheck` | **pass** |
| `npm run lint` | **pass** — 0 errors; one known untouched `GameLive.tsx` warning |
| `npm run build` | **environment-blocked** — Turbopack could not bind an internal CSS-processing port in the sandbox |
| `npm run build -- --webpack` | **pass** — supported Next 16 fallback; compile, typecheck, page generation, and route output completed |
| `git diff --check` | **pass** |

An independent read-only code review found no critical issue. Its lifecycle findings were fixed and regression-tested; the second pass found no remaining merge-blocking correctness issue.

The first build attempt was also initially denied network access to Google Fonts; after network approval it reached compilation and failed only on the sandbox's port-binding restriction. The default Turbopack command therefore still needs a fresh run in an unrestricted environment before deployment. No build configuration or package script was changed.

The database harness was not run because no `supabase/` file changed.

Even when those commands pass, **do not mark the production bug fixed**. Remaining acceptance requires:

1. A normal environment or deployment runs the default Turbopack production build successfully.
2. Bryan approves committing/pushing the Realtime branch and the resulting deployment.
3. Two real signed-in phones join the same table.
4. The first phone's forming roster updates when the second joins, without manual browser refresh.
5. Preferably continue through the chip proposal/confirmation flow on both phones.

---

## 9. Constraints

- Do not commit, push, merge, or deploy the Realtime work without Bryan's approval.
- Do not change hosted database permissions for this client fix.
- Never log, print, display, or persist Supabase access tokens or NFC seat secrets.
- Preserve the fail-closed action guards and post-subscription reloads; Realtime does not replay events missed during an outage.
- Automated verification cannot by itself close the original production report.

---

## 10. Out of scope

Do not bundle these separate feature requests:

1. A button returning to the leaderboard from the final results screen.
2. Attaching a public photo to a notable hand.
3. Making the Form board work for chip mode over a player's last 20 games.

Full project history and decisions live outside this repo in `memory/projects/rvmj.md`.
