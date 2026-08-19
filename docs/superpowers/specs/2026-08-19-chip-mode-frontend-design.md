# RVMJ Chip-Mode Frontend Redesign

**Date:** 2026-08-19
**Status:** Approved by Bryan
**Scope:** Complete chip-mode frontend only
**Visual direction:** Refined Tile Club

## 1. Outcome

RVMJ should feel like a distinctive social game companion rather than a scaffolded web app. The redesign covers the full working chip-mode experience, from the public leaderboard and first sign-in through NFC joining, forming a table, live play, chip counting, four-player confirmation, results, and recovery states.

The app must look completely new while preserving the authentication, NFC joining, multiplayer timing, realtime refresh, chip arithmetic, database behaviour, and server-side safety already proven in the current build.

The existing uncommitted dark-green felt and brass draft was explicitly rejected by Bryan. It is not a baseline. None of its palette, typography, decorative language, or component treatment carries forward.

## 2. Scope

### Included

- Root leaderboard in signed-out, loading, populated, empty, and failed states
- Google sign-in and return-to-table experience
- Standard chip-set guide
- NFC tag outcomes:
  - Unknown tag
  - Seat joined or rejoined
  - Seat occupied
  - Table full
  - Game already in progress
  - Unfinished previous match
- Forming-game screen and live seat updates
- Chip mode as the selected and only live mode in this pass
- Active chip-game screen
- Notable-hand logging
- One-phone chip-count entry for all four players
- Count validation and denomination-specific recount guidance
- Shared four-phone confirmation
- Completed results and one-hour reopen action
- Abandoned-match viewing, continuing, and voiding
- Network, server, empty, loading, disabled, and completed states
- Mobile, tablet, and desktop responsiveness
- Keyboard, screen-reader, touch, contrast, focus, and reduced-motion behaviour

### Excluded

- App-scorekeeper mode and per-hand recording
- New game rules or scoring behaviour
- Database changes
- Authentication changes
- NFC security changes
- New navigation, history, profile, group, or admin features
- A second dark theme
- Push notifications
- Three-player games, guests, dollar display, and other deferred product items

## 3. Chosen build approach

Build a shared Refined Tile Club interface system around the working game logic.

This is deliberately between two rejected extremes:

- Do not merely repaint the existing large components. That would preserve inconsistent structures and make future changes harder.
- Do not rewrite the whole frontend flow. That would put proven multiplayer, reconnect, and recovery behaviour at unnecessary risk.

The redesign therefore keeps all existing data reads, server operations, realtime subscriptions, validation, and redirects unless a frontend-only adjustment is explicitly named below. Screens are recomposed from shared visual and interaction pieces.

## 4. Visual system

### Identity

**Refined Tile Club** is social and recognisably mahjong-inspired without turning every surface into a novelty tile. Character comes from colour, decisive typography, seat markers, and a small number of tactile accents. Dense or high-stakes screens remain calm and easy to scan.

### Palette

| Role | Colour | Use |
|---|---|---|
| Canvas | `#F7F2E9` | Main page background |
| Surface | `#FFFDF8` | Cards, fields, raised panels |
| Ink | `#142D37` | Primary text, outlines, strong dividers |
| Muted text | `#68797D` | Supporting copy and metadata |
| Divider | `#D9D1C5` | Quiet borders and row separation |
| Cobalt | `#2F6FE4` | Primary actions, selected states, focus |
| Soft cobalt | `#E7EEFC` | Seat badges and informational messages |
| Coral | `#ED6048` | Brand tile and destructive/error emphasis |
| Soft coral | `#FCE7E2` | Destructive and error backgrounds |
| Gain green | `#24715D` | Positive scores and success messages |
| Soft green | `#DEF1E9` | Successful validation backgrounds |
| Amber | `#9A6315` | Recoverable warnings and miscounts |
| Soft amber | `#FBEFD2` | Warning backgrounds |

Coral is not used for routine primary actions. Green and coral never carry meaning alone; signs, labels, and message copy remain present.

### Typography

- One family: **Sora**, supplied through the framework's built-in Google-font integration.
- Weight 800: page titles, scores, totals, and primary decisions.
- Weight 600–700: controls, player names, field labels, and tabs.
- Weight 400–500: supporting copy.
- Scores and chip counts use tabular numerals so columns do not shift when values change.
- Small uppercase labels are reserved for state and structure, not paragraphs.

### Shape and depth

- Page corners and large panels: 14–18 pixels.
- Buttons and fields: 9–11 pixels.
- Seat and brand tiles: compact rounded squares.
- Outlines and hard shadows are used selectively for tile-like accents, never on every row.
- Primary actions may use a quiet cobalt shadow. Most information surfaces remain flat.
- Motion is brief and functional: state feedback, not decoration.

## 5. Shared interface pieces

The following pieces form the reusable frontend layer:

| Piece | Responsibility |
|---|---|
| App frame | Responsive cream canvas, content width, page padding, safe areas |
| Brand mark | Coral mahjong tile plus RVMJ wordmark |
| Page header | Title, supporting copy, optional back or contextual action |
| Primary button | Main cobalt action with pending and disabled states |
| Secondary button | Quiet outlined or neutral action |
| Destructive button | Coral treatment used only after consequences are clear |
| Seat badge | East, South, West, and North identity in a compact tile |
| Player row | Seat, player name, local context, score or state |
| Board tabs | Lifetime, Form, and Skill selection with an explicit current state |
| Leaderboard row | Rank, player, game count or skill context, signed score, optional bar |
| Chip field | Denomination label, numeric field, focus state, validation state |
| Status message | Informational, successful, warning, and failed variants |
| Progress status | Named confirmation progress, not only a number |
| Full-screen panel | Counting, notable logging, and confirmation without visual drift |
| Empty/error state | Plain consequence, reason when known, and the next useful action |

Each piece owns its appearance and interaction states. Screens should not recreate those rules locally.

## 6. Screen design

### Home and leaderboards

- RVMJ branding leads, followed by the Lifetime, Form, and Skill tabs.
- The current board is visually selected and marked for assistive technology.
- Scores dominate each row; context such as games played stays secondary.
- Positive values include a plus sign and green treatment. Negative values retain their minus sign and coral treatment.
- Zero remains neutral.
- Empty boards explain what has not happened yet.
- A failed board read never masquerades as an empty leaderboard.
- The chip-set guide remains reachable beneath the board.

### Sign-in

- The page explains the consequence first: sign in once, then future seat taps go straight to the table.
- Google sign-in is the single primary action.
- Return addresses continue to preserve the original tag or match screen.

### Chip-set guide

- The fixed $1, $10, $50, and $100 composition remains generated from the same data used by the checker.
- Per-player quantities and whole-table quantities are visually distinct.
- The 400-point player stack and 1,600-point table total are prominent.

### NFC and recovery screens

- Every outcome uses the same page frame instead of raw text on a blank page.
- Expected conflicts use warning treatment and give the next action.
- Unknown tags and true server failures use failure treatment.
- An unfinished previous match shows View last match first.
- Tonight's East seat sees the two-step Start new match action.
- Other seats see that they are waiting for East.
- Continue remains on the viewed match and belongs only to that match's original East player.

### Forming a table

- Four stable seat rows remain visible from the first tap onward.
- Joined players replace the empty seat prompt without shifting the layout.
- The screen identifies the game as Chip mode without presenting a mode picker.
- The disabled App scorekeeper option is removed. It returns only when that mode is functional.
- Start remains disabled until four players have joined, with the current count stated in its label.
- The standard chip set remains one tap away.

### Active chip game

- The interface is intentionally quiet: the app is not the scorekeeper during play.
- It shows the active state, the four seated players, notable hands already logged, and two actions:
  - Log notable hand
  - End game · count chips
- Ending is the stronger primary action. Notable logging is secondary.
- Completed games replace seat letters with final signed scores.
- Reopen remains available for one hour and shows its limit plainly.

### Notable-hand logging

- Player selection uses large buttons or rows.
- Hand selection uses a labelled native list. The current catalogue has twelve items, so search is unnecessary in this pass.
- The action remains disabled until both selections exist.
- A failed request keeps both selections and restores the action.

### Chip counting

The existing ownership model remains: one phone enters all four stacks, then all four players confirm the combined proposal.

Bryan selected one scrollable overview rather than a player-by-player wizard or denomination-by-denomination flow.

- All four player sections appear on one page.
- Each section clearly states seat and player name.
- Four columns remain in the fixed order $1, $10, $50, $100.
- Column labels remain visible and each field also has its own accessible label.
- Each player's point total updates as counts change.
- The whole-table total appears before the final action.
- Numeric keyboards open on phones.
- Fields are large enough for touch despite the four-column layout.
- A sticky bottom summary holds the whole-table total and Check all counts action while the player sections scroll behind it. Page padding prevents the footer from covering the final fields.
- A failed request preserves every typed count.

### Count validation

- A good count states that all 1,600 points and all denominations balance.
- A bad count stays on the entry page with all values preserved.
- The warning names the exact denomination or denominations that are short or over.
- When the grand total balances but denominations do not, the message explains that stacks are offset against each other.
- No count is proposed until both forms of conservation pass.

### Shared confirmation

- Every phone shows the same four player names and signed net results.
- Progress names who has confirmed and who remains, not merely `2/4`.
- A player who confirmed sees a clear waiting state and cannot submit again.
- The fourth confirmation finalises the game and routes all phones to results.
- Recount reopens the latest proposal already filled in. It must never reset sixteen fields to zero, including when a phone other than the original counting phone requests the recount.

### Results

- Final signed scores are the strongest content.
- The screen states that the game is locked and the leaderboard has been updated.
- Reopen is visually secondary and states the one-hour limit.
- Realtime or foreground refresh clears stale results if the game is reopened elsewhere.

## 7. Data and state flow

The redesign keeps the existing system boundary:

1. The server loads the authenticated user and current table or game state.
2. The screen receives that state and renders it through shared interface pieces.
3. A player acts through an existing server operation.
4. The database commits the change atomically or returns a failure.
5. Realtime updates notify the other phones.
6. Each phone re-reads the current state before enabling actions after reconnecting or returning to the foreground.

The browser never calculates authoritative scores, grants permissions, or decides whether a match may be resumed or voided.

## 8. Behaviour rules

- Every action disables immediately after activation and changes its label to the current operation.
- A failed request restores the action and keeps local input.
- Duplicate taps do not create duplicate requests.
- Controls that can no longer cancel an in-flight operation disappear rather than implying that cancellation remains possible.
- Destructive actions retain a two-step warning.
- Native browser alerts are replaced with in-interface messages carrying a next action.
- Returning to a visible tab and reconnecting both trigger a fresh state read.
- A newly received proposal clears stale temporary errors and confirmation state.
- Loading, empty, disabled, successful, warning, and failed states are designed explicitly rather than inherited from browser defaults.

## 9. Accessibility and responsive behaviour

- Touch targets are at least 44 by 44 pixels where the device allows.
- Focus remains visible with a cobalt outline and sufficient separation from the component edge.
- Every field has a programmatic label containing both player and denomination.
- Dialog-like full-screen panels use correct dialog naming and focus behaviour.
- Live messages are mounted before their text changes so screen readers announce them reliably.
- Colour is reinforced with signs, labels, and text.
- Text and controls meet accessible contrast against cream and surface backgrounds.
- Reduced-motion preferences remove nonessential movement.
- The interface has no horizontal scrolling at narrow-phone widths.
- The chip grid remains usable at 360 pixels wide.
- Tablet and desktop layouts gain breathing room without becoming a separate information architecture.
- The approved cream theme is the only theme in this pass.

## 10. Verification

### Automated

- Preserve every existing game, reconnect, race-condition, and database test.
- Update existing frontend assertions only where approved wording or structure changed.
- Add focused tests for:
  - Shared buttons and pending states
  - Player and seat rows
  - Chip-field labels and numeric inputs
  - All-four-player count layout
  - Preserving counts after a failed request
  - Denomination-specific validation messages
  - Named confirmation progress
  - Recount prefilled from the latest proposal
  - Reconnect and foreground refresh
  - Destructive-action arming and in-flight behaviour
  - Accessible status announcements
- Run type checking, linting, the full test suite, and the supported production build.

### Visual and manual

- Inspect at narrow-phone, modern-phone, tablet, and desktop widths.
- Confirm no clipped text, overlapping controls, hidden actions, or horizontal scrolling.
- Confirm focus order and visible focus with a keyboard.
- Confirm the interface remains understandable without colour.
- Rehearse one complete four-session table flow:
  1. Join all four seats.
  2. Start the game.
  3. Log a notable hand.
  4. Enter a deliberately bad chip count.
  5. Correct the named denomination.
  6. Submit the balanced proposal.
  7. Confirm from all four sessions.
  8. Verify final results on every session.
  9. Reopen from one session.
  10. Verify stale results disappear everywhere.

## 11. Acceptance criteria

The redesign is complete when:

- Every included chip-mode screen uses the approved Refined Tile Club system.
- No rejected felt/brass styling remains.
- No included screen falls back to raw scaffold styling, unthemed browser alerts, or bare error text.
- The chip-count overview shows all four players and sixteen fields on one scrollable screen.
- Recount restores the latest proposed values on any player's phone.
- Existing product behaviour and security boundaries remain unchanged.
- All automated checks pass.
- The four-session rehearsal passes end to end.
- Bryan confirms the GitHub branch target, then the verified frontend is pushed there.
- The deployed page and every referenced asset load successfully after release.

## 12. Approved decisions

| Decision | Bryan's approval |
|---|---|
| Reject the existing felt/brass draft and start fresh | 2026-08-19 |
| Refined Tile Club visual direction | 2026-08-19 |
| Chip mode first; app-scorekeeper excluded | 2026-08-19 |
| Shared interface system around proven logic | 2026-08-19 |
| One phone enters all four stacks; all four confirm | 2026-08-19 |
| All players and all sixteen fields on one scrollable page | 2026-08-19 |
| Cream-only theme in this pass | 2026-08-19 |
| Remove the disabled app-scorekeeper option until that mode works | 2026-08-19 |
| Architecture, visual system, complete journey, behaviour, accessibility, and verification sections | 2026-08-19 |
