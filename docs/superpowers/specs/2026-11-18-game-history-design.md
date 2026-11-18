# RVMJ game history and missed notable wins

Status: Approved by Bryan on 2026-11-18: “ok lgtm build it and push to main”.

## Intent and confirmed requirements

Let a signed-in player review past games from Settings and add a photo of a notable win. Bryan confirmed that a player must also be able to record a win missed during the game. Bryan chose a list directly in Settings, inside a box with its own scroll area. The list must not require a separate history page.

Results use the app's existing points. Cash stakes are not stored. This feature does not introduce them.

## Approaches

1. Separate history page reached from Settings. More browsing space but another navigation. Bryan did not choose this.
2. History box directly in Settings. Immediate access, with bounded height so a long history does not make Settings indefinitely long. Bryan chose this.

Reuse the current Next.js, React and Supabase stack. Reuse the existing notable-hand catalogue, photo preparation, private storage and individual-win page. These are implementation choices proposed by Alfred.

## Settings layout

Keep the existing account controls, with Bryan’s revised layout: a shorter display-name input and Save on its right on the same row. Put the explanatory text below that row. Add the history box below the account controls, using the existing RVMJ colours, type and borders.

```
Your account
House                         [current house]
Display name                  [current name]
[Save]

+-----------------------------------------+
| Game history                            |
| Your results in points                   |
+-----------------------------------------+
| [date and time]                +42 pts  >| ^
| Regular                                 | |
| Player A, Player B, Player C             | | scroll
|-----------------------------------------| |
| [date and time]                -18 pts  >| |
| 8 Fei                                   | |
| Player D, Player E, Player F             | v
| ...                                     |
| [Load older games]                       |
+-----------------------------------------+
```

The numbers and player names in this sketch are illustrative, not real game data.

- The heading and unit description sit outside the scrolling body.
- The body has a responsive bounded height, approximately three to four normal rows on a phone. The builder chooses the final height after looking at phone and desktop layouts.
- Each entire row opens that game's detail page. Show Singapore date and time, Regular or 8 Fei, the other players and the viewer's signed net points. Zero reads `0 pts`; a missing result reads `Result unavailable`.
- Use signs and text as well as the existing gain/loss colours. Long names wrap without horizontal scrolling or hiding the score.
- The scroll area is named, keyboard-focusable and works with touch, wheel and keyboard. Preserve a visible scroll cue when the device supports it. Use contained overscroll so reaching its end does not unexpectedly move Settings.
- Show only games the signed-in user played with status `ended`, across all years and both variants. Exclude forming, active, expired and quarantined games. Include ended app-mode games in history if any exist.
- Order by ended time descending, then game ID for ties. Read a bounded batch (20) initially. A `Load older games` button inside the box appends the next batch without replacing earlier rows or resetting the scroll position. Do not silently cap the player's history.
- No games: `No finished games yet.` Read failure: an error and Retry, not an empty-history claim. Failure loading older games preserves all loaded rows and offers Retry.

## Opening a game

Use a participant-only detail page under `/account/games/[gameId]`. This is a game detail destination, not a separate history listing. It provides Back to Settings and restores the loaded history and scroll position when returning. Browser Back must work too.

Show the game's Singapore end date and time, variant, all four players in seat order, their stored final net points, and existing notable wins with every hand label. Use `Result unavailable` when a stored result cannot be read; do not fabricate zero or calculate from current rules.

Opening a notable win goes to the existing win page with a safe, reconstructed return link to this game's detail page. Photo add/remove rules remain the existing participant rules. Preserve board/gallery return behaviour for visitors from those existing routes.

The detail page does not expose resume, recount or reopen controls. If the game has since reopened, explain that it is in progress and provide a link to the existing game screen. Remove its row on the next history refresh. Invalid or inaccessible identifiers reveal no other player's private history.

## Recording a missed notable win

On a completed chip game's detail page, show `Add notable win`. The current standalone notable-win log belongs to chip games. Preserve that boundary; app-mode history remains readable without inventing a second claim system for the deferred app scorekeeper.

The form lets a participant choose any one of that game's four players, select one or more hand types from the existing catalogue, and optionally choose a photo. This participant permission matches the live logger and is Alfred's proposal. Support Take photo and Choose from library, preview, discard and retry using the existing photo preparation rules. Without a photo the win can still be saved and photographed later.

Show the existing wins before the form so the user can check whether the win is already present. Distinct wins by the same player with the same labels remain valid; do not deduplicate solely on winner and hand type. Prevent duplicate submission of the same save, including retries after a lost response, using a stable request/claim ID.

New historical claims use the game's saved end time as their win date, not the upload time. Record the authenticated logger and photo contributor in the existing attribution fields. Do not offer a freely editable game, winner list or win date. A win added later belongs to that original game and appears in its existing Notable wins board and photo gallery when eligible. It does not change final totals, chip counts or the other two leaderboard scores.

After a successful save, close the form and show the saved win in the game detail. On failure, keep the user's winner, labels and prepared photo so they can retry. Do not report success until the saved claim is confirmed. If labels cannot load, keep results readable and explain that adding a win is temporarily unavailable.

## Data and write safety

History and detail reads authenticate before any service-role query. Derive the viewer ID from the session, never a browser-supplied player ID. Check participation for each detail and pagination request. Select only the fields the UI needs; do not send email addresses or credentials.

Add a new database migration; do not edit migrations already applied. Use a dedicated historical logging function rather than relaxing the live logger's active-game rule. In one transaction, lock the game, require an ended chip game with a usable end time, validate logger and winner membership, validate the full selected label set, and save the claim plus its labels with the game's date. Re-check after locking so a race with reopening cannot save against an active game. Function access remains server-only with pinned search path, following the current project conventions.

Keep existing private photo storage, browser metadata stripping, supported formats, upload size checks and temporary signed links. Clean up a newly uploaded object when its claim is refused. A request retry reuses the same claim and must not create another win or leave redundant photo objects. Reuse the existing photo workflow where possible; resolve the exact upload/idempotency ordering in the implementation plan.

Use stable pagination cursors composed of the end time and game ID, validate them, and bind every query to the current user. A newly ended game appears on refresh without making an old pagination cursor repeat earlier rows.

## Verification and release

Meaningful automated coverage must include:

- Signed-out access; history restricted to the viewer's games; inaccessible detail and forged pagination/writes.
- Ended-only list; both variants; correct players, stored scores and Singapore date; null scores never displayed as zero.
- Pagination with tied end times, multiple batches, a newly ended game and a failed older-batch request.
- Box touch/keyboard scrolling, row navigation and Back restoring its state, empty and failure states.
- Historical save permission, winner membership, all labels validated, ended-game date, no scoring changes, duplicate-submit/lost-response retry and independent identical-looking wins.
- Real PostgreSQL checks for migration permissions, claim/label atomicity, races with reopening and rejected-upload cleanup.
- Existing live logger and board/gallery/photo behaviour remain functional.

Run the relevant suite, type checking, lint, production build and database harness before claiming implementation is complete. Render and inspect Settings and detail at phone and desktop widths. Use clearly marked fixtures locally; do not create real production games or wins as test data.

A hosted database change and push/deploy remain explicit release approvals after local work is reviewable, following the established RVMJ release procedure. This draft authorises neither.

## Scope boundaries and builder choices

No cash conversion, score editing, game deletion, claim editing/deletion, new hand types, new ranking rules or public player-history browser. No new dependencies are expected. The builder decides component boundaries, cursor encoding, exact scroll height and state-restoration mechanism, within this design. Any extra dependency or download still needs Bryan's prior approval.
