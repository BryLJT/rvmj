# RVMJ Standings and Multi-Label Notable Wins Design

**Date:** 2026-08-28  
**Status:** Approved by Bryan; implementation plan written
**Scope:** Rename and redefine the three standings tabs, make academic-year selection shared, support several hand-type labels on one notable win, and rank individual notable wins with multi-select filtering.

## 1. Why this change exists

The three current tab labels do not describe what a player sees clearly enough:

- `Lifetime` is broad and is not actually lifetime-only because the board now defaults to the current NUS academic year.
- `Form` is an unavailable placeholder tied to the future app scorekeeper.
- `Skill` currently means a player ranking by the number of single-label notable claims, which neither explains the number nor represents hands that satisfy several notable types.

A real mahjong win can satisfy several catalogue types at once. For example, one physical winning hand may be both Pure Suit and All Pungs. RVMJ currently forces one type because each `notable_claims` row has one `notable_hand_id`. Saving two rows would falsely turn one physical win and one photo into two separate wins.

The design must preserve one actual winning hand as one event while attaching any number of valid hand-type labels to it.

## 2. Goals

1. Replace the tab labels with language that describes the numbers directly:
   - **Total score**
   - **Pts per game**
   - **Notable wins**
2. Preserve Bryan's current-academic-year default so future players are not greeted by a board permanently dominated by seniors who graduated years earlier.
3. Apply the selected academic year consistently across all three tabs.
4. Make Pts per game useful now, using completed chip-mode games rather than waiting for app-mode hand recording.
5. Record one notable winning hand with one or more hand-type labels and at most one photo.
6. Make Notable wins a ranking of individual winning hands, not a player leaderboard.
7. Let players filter by several hand types while ranking hands that match more of those selections first.
8. Preserve all existing notable wins and photos without changing their count.
9. Release without breaking the currently deployed application or an ongoing game.

## 3. Non-goals

- Building or changing app-mode per-hand scoring.
- Adding, removing, or redefining the 12 notable-hand catalogue entries or their rarity.
- Adding post-save photo replacement. Before saving, choosing a new photo may replace the preview; after saving, the existing Remove photo action remains the only photo edit.
- Deleting or editing a saved notable win.
- Applying temporary Notable wins filters to the separate photo gallery.
- Adding private, group, or table-specific leaderboards.
- Removing the old single-label database path in the same release. That is a later contract cleanup after production verification.

## 4. Confirmed product decisions

| Decision | Approved behaviour |
|---|---|
| First tab label | **Total score** |
| Second tab label | **Pts per game** |
| Third tab label | **Notable wins** |
| Default time period | Current NUS academic year once it contains a completed game; existing All time fallback before the year's first completed game |
| Academic-year reach | One selector controls all three tabs |
| Pts per game window | Each player's own latest 20 completed games inside the selected period |
| Fewer than 20 games | Show the player using every available game and state how many were counted |
| One physical notable win | Counts once even when several hand types apply |
| Notable-win logger | All 12 hand types inline in one scrolling form, grouped by rarity |
| Board filter layout | Dedicated filter panel; selected types remain visible above the list |
| Multiple filter eligibility | A hand qualifies when it matches at least one selected type |
| Filtered ranking | More selected labels matched first, then more total labels, then newest |
| Unfiltered ranking | More total labels first, then newest |
| Gallery | Remains a complete photo archive and does not inherit board filters |

## 5. Shared standings shell

The homepage remains `Table standings`. Its primary navigation becomes:

1. Total score
2. Pts per game
3. Notable wins

The existing academic-year pill row moves from being Total-score-only to being shared by all three tabs.

### 5.1 Time selection

- If the current academic year contains at least one completed game, a bare homepage request selects it.
- If the current academic year contains no completed game yet, RVMJ retains the existing All time fallback. This avoids a board that appears to have lost its history on the first morning of a new academic year.
- Selecting All time removes the academic-year boundary.
- Switching tabs preserves the selected period.
- NUS academic years continue to be derived from the existing rule: the first Monday of August, using `Asia/Singapore` before classification.
- A game's standings period is determined from its `ended_at`, not when a notable win was logged. All results from one completed game therefore remain in one period.

### 5.2 Address and navigation state

The page address remains the recoverable source of the user's current view:

- `board` identifies the tab.
- `year` identifies an academic year or All time.
- Notable-hand filter values identify the selected catalogue types.

Tab switches, refreshes, and browser Back preserve the selected year. Hand-type filters may remain in the address while another tab is open, but only Notable wins uses them. Returning to Notable wins restores them.

Unknown, duplicated, malformed, or no-longer-existing hand-type values are ignored. Valid values continue to work rather than the entire board failing.

## 6. Total score

Total score preserves the current calculation:

- Include completed games only.
- Sum `game_players.final_total` for each player inside the selected period.
- Both game modes remain compatible because both converge on `final_total`.
- Positive scores keep an explicit plus sign; negative scores retain their minus sign; zero stays neutral.
- The row states how many completed games contributed.

Only the tab label changes from Lifetime to Total score. The academic-year behaviour remains the Bryan-approved default described above.

## 7. Pts per game

Pts per game replaces the unavailable Form placeholder with a board that works from completed games today.

For each player:

1. Find that player's completed games inside the selected period.
2. Order them by `ended_at` newest first, with game ID as a deterministic final tie-break.
3. Keep at most the latest 20.
4. Average that player's signed `final_total` values.

The calculation is per player. Different attendance therefore produces different sets of 20 games.

### 7.1 Display and ranking

- A player appears after one completed game.
- With fewer than 20, the context says `1 game counted` or `<n> games counted`.
- At 20 or more, the context says `Latest 20 games`.
- The displayed average uses one decimal place and keeps its sign, for example `+8.5`, `0.0`, or `-3.2`.
- Higher averages rank first.
- Exact average ties use more games counted first, then display name, then player ID for a stable final order.

### 7.2 All time

All time removes the academic-year boundary but not the rolling window. Each player's latest 20 completed games overall are averaged.

No app-mode explanation appears in the interface. The old app-mode `form_board` may remain internally for future work, but the homepage no longer uses it.

## 8. Notable-win identity and labels

One `notable_claims` row becomes the durable identity of one real winning hand. It continues to hold:

- Game
- Winner
- Logger
- Time
- Optional photo path

A new connecting table attaches catalogue hand types to that win:

```text
notable_claims
└── notable_claim_types
    ├── notable_hand_id: Pure Suit
    └── notable_hand_id: All Pungs
```

The connecting table has one row per `(notable win, hand type)` pair. Its database constraints guarantee:

- The notable win exists.
- The catalogue hand type exists.
- The same type cannot be attached twice to one win.
- Deleting a notable win deletes its connections.

Signed-in game participants may read the connections so the existing direct Realtime refresh can render every label. Browser roles receive no insert, update, or delete access. Both the old single-label save function and the new multi-label save function remain server-only, retain a pinned database search path, and re-check that the winner and logger belong to the active chip game.

Indexes support both directions: reading every label for a win and finding every win carrying a selected type.

An array or JSON list on the main record is rejected because ordinary database relationships could no longer guarantee that every stored type actually exists in the catalogue.

Creating several existing `notable_claims` rows for one win is rejected because it would duplicate the event and photo, make the gallery ambiguous, and lose the fact that the labels occurred together.

## 9. Logging a notable win

The active chip-game action and panel title become **Log notable win**.

The logger remains one scrolling screen in this order:

1. **Who won it?** Choose exactly one participating player.
2. **Hand types.** Show all 12 catalogue types directly inside the form, grouped as Uncommon, Rare, and Legendary. Each choice is an accessible checkbox-style control.
3. **Photo of the tiles.** Keep Take photo, Choose from library, preview replacement, and pre-save removal.
4. **Log notable win.** Enable only when one winner and at least one hand type are selected and no photo is still being prepared.

The caller sends the complete selected-type set in one request. The database creates the win and all its label connections in one transaction. Either everything saves or nothing saves.

The server removes repeated IDs from an untrusted request before saving. If no valid catalogue type remains, it refuses the request. The database's unique pair constraint independently prevents duplicates if the server check regresses.

### 9.1 Photo behaviour

- One win has at most one photo.
- Before saving, choosing another photo replaces the unsaved preview.
- A failed photo upload retains the winner and selected hand types and offers Log it without the photo.
- A database refusal after upload removes the uploaded object, preserving the current no-orphan rule.
- After saving, Remove photo clears only the image. The win and its labels remain.
- Post-save photo replacement is not added.

### 9.2 Live match display

The live match shows one notable-win entry containing:

- Winner
- Every attached hand-type label
- One thumbnail when a photo exists

A multi-label win never renders as several live entries.

## 10. Notable wins ranking

Notable wins becomes a ranked list of individual winning hands from completed games inside the selected period. It is not a player leaderboard.

Each item shows:

- Winner's display name
- Win date in Singapore time
- Every attached hand-type label
- Total label count

The separate View hand gallery action remains. The ranked list itself does not become a second full photo gallery.

### 10.1 No hand-type filters selected

All notable wins in the selected period qualify.

Order by:

1. Total attached label count, descending.
2. Win creation time, newest first.
3. Notable-win ID as a deterministic final tie-break.

### 10.2 Hand-type filters selected

The selected types use an eligibility rule and a ranking rule:

**Eligibility:** a hand must match at least one selected type. Matching none excludes it.

**Ranking:**

1. Number of selected types matched, descending.
2. Total attached label count, descending.
3. Win creation time, newest first.
4. Notable-win ID as a deterministic final tie-break.

Example with Pure Suit, All Pungs, and Great Winds selected:

- A hand matching all three ranks above one matching two.
- A hand matching two ranks above one matching one.
- A hand matching none is absent.
- If two hands match the same number of selected types, the hand with more total labels ranks first.

This is the exact meaning of the approved requirement: **a hand must match at least one selected filter, then hands matching the most selected filters rank first.**

### 10.3 Filter interface

- A dedicated Filter hand types control opens the full 12-type selection panel.
- Several types can be selected.
- Selected types remain visible as removable chips above the ranking after the panel closes.
- Clear all removes every selection.
- The screen states that matching any selected type is sufficient to qualify.
- No selected types means the unfiltered ranking above, not an error state.

## 11. Gallery

The signed-in gallery remains an archive of photographed wins only, newest first by Singapore night.

After this change:

- One physical win produces at most one gallery card.
- The card and full-screen view show every attached hand-type label.
- Removing the photo removes that one card on refresh but leaves the notable win and its labels available to the Notable wins ranking.
- Temporary board filters do not change the gallery.

## 12. Query boundaries

The browser continues to receive rendered results, not database credentials.

### 12.1 Pts per game query

The database performs the per-player latest-20 selection and average. The application does not fetch an unbounded game history and reproduce ranking rules in JavaScript.

### 12.2 Notable wins query

The server passes the selected year and validated hand-type IDs to one database query boundary. That boundary returns one result per notable win with:

- Win identity
- Winner and display name
- Creation time
- All attached labels
- Total label count
- Selected-label match count

The database applies the eligibility and ordering rules. The page renders the returned order rather than independently recreating it.

The existing `skill_board` remains compatible during the transition for the old deployed application. The new application no longer depends on that player-aggregate shape for Notable wins.

## 13. Existing-data conversion

Every existing `notable_claims` row already represents one physical win with one hand type. The additive database change:

1. Creates the new connecting table.
2. Copies each existing row's `notable_hand_id` into exactly one connection.
3. Verifies that the number of distinct notable wins is unchanged.
4. Verifies that every existing row has exactly one connection after conversion.
5. Leaves every existing ID, game, winner, logger, timestamp, and photo path unchanged.

The old `notable_hand_id` column remains temporarily. During the compatibility window it holds the alphabetically first selected hand type for old code, so an old phone still displays one truthful label from a new multi-label win. The new application treats the connecting table as the complete source of label truth.

## 14. Safe release sequence

### Stage 1: additive database expansion

Apply and verify the database change before application deployment:

- Add and backfill the connecting table.
- Add the new multi-label save path.
- Update the old single-label save path so any win logged by the currently deployed app also receives its one connection.
- Add the Pts per game and individual-hand query boundaries.
- Keep the old column, old save path, and old `skill_board` readable.

The deployed application remains usable throughout this stage. An ongoing game can still log a single-label notable win.

### Stage 2: application deployment

Deploy the new interface and switch reads and writes to the new paths:

- New tab labels and shared academic-year pills.
- Pts per game board.
- Multi-label logger.
- Individual-hand ranking and filter panel.
- Multi-label live entries and gallery cards.

### Stage 3: later contract cleanup

Only after the new production flow is verified may a separate migration remove the old single-label column, old save function, and obsolete player-aggregate query if nothing else uses them. This cleanup is not required to ship the feature and is not bundled into this release.

Applying the hosted database change and deploying the application remain separate Bryan approval gates.

## 15. Failure behaviour

- A failed board query renders `Couldn't load this board` and never masquerades as an empty result.
- A valid filter set with no result renders `No notable wins match these hand types.`
- Invalid filter values are ignored.
- A notable win and all its label connections save atomically.
- A repeated hand type cannot create a duplicate connection.
- A failed photo upload preserves winner and label selections and retains the no-photo escape.
- A claim-level refusal does not offer the no-photo escape because removing the photo would not make the claim valid.
- Existing fail-closed live-game behaviour remains: stale or failed table reads disable state-changing controls.

## 16. Verification

### 16.1 Database migration and compatibility

- Fresh replay applies every migration including the new one.
- Existing single-label fixtures retain the same notable-win count, IDs, metadata, and photo paths.
- Every converted win has exactly one attached type.
- The old deployed save path creates one attached type after Stage 1.
- The new save path creates one win with every selected type.
- Repeated selected types are collapsed to one by the server and cannot create duplicate connections at the database backstop.
- Forced failure during label attachment leaves neither a partial win nor partial connections.
- The old deployed board remains readable during Stage 1.

### 16.2 Pts per game

Cover separate players with 1, 19, 20, and more than 20 completed games.

Prove:

- Each player's window is independent.
- Only the latest 20 inside the selected academic year count.
- All time removes the year boundary but still caps at 20.
- Singapore academic-year boundaries classify late-night games correctly.
- Positive, zero, and negative averages render with one decimal and correct sign.
- Ranking and deterministic ties match Section 7.

### 16.3 Notable-win ranking

Use fixtures where one win carries several types and several wins share the same timestamp.

Prove:

- One multi-label win returns once.
- No filters orders by total labels, then newest, then ID.
- Several filters require at least one match.
- More selected-label matches outrank fewer.
- Total labels break equal selected-match counts.
- Newest breaks equal label counts.
- Academic-year and All time selections include exactly the intended completed games.
- Invalid, repeated, or obsolete URL filter values do not break valid results.

### 16.4 Interface

- The exact tab labels render and the selected tab remains accessible.
- The selected academic year survives tab switches, refresh, and Back.
- Pts per game states how many games were counted.
- The board filter supports several choices, individual removal, and Clear all.
- The logger requires one winner and at least one hand type.
- All 12 types render under their correct rarity.
- Multi-label live entries and gallery cards render once with every label.
- Photo preparation, replacement before save, removal, retry, and log-without-photo paths remain covered.
- Touch targets, checkbox names, focus handling, and live error announcements remain accessible.

### 16.5 Release gates

Before any release:

- Full application tests pass.
- Type checking passes.
- Lint has no new errors.
- Production build compiles.
- Full database replay passes.
- Stage 1 compatibility is proven against the old application contract.

After each separately approved production stage, verify the actual hosted database or deployment surface rather than relying on a success banner.

## 17. Approved outcome

RVMJ will show three plainly named standings views under one academic-year selection. Total score remains the selected period's cumulative result. Pts per game becomes a rolling per-player average of at most 20 completed games. Notable wins becomes an individual-hand ranking where one real win may carry several valid labels, filters admit any matching hand, and hands matching more selected labels rank first.

No application or database implementation is included in this design document.
