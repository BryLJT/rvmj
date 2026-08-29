# RVMJ Notable Win Page and Filtered Gallery Design

**Date:** 2026-08-29
**Status:** Approved by Bryan (design decisions D1–D8 below); Release 1 to be implemented
**Scope:** Give every notable win its own page reachable from the Notable wins board, make the hand gallery honour the board's filter, and — in a second release — let the people who played a game attach a photo to a win after the fact.

## 1. Why this change exists

Bryan reported two things while using the Notable wins board:

1. With a hand-type filter applied, he could not open an individual person's win.
2. **View hand gallery** showed every photographed hand rather than the ones he had filtered to.

Reading the code established what is actually true, which is not quite what the report assumed:

- **No row on the Notable wins board has ever been tappable**, filtered or unfiltered. `NotableWinRow` renders a plain list item containing text only — no link, no button. The filter did not remove an interaction; there has never been one. This is therefore new capability, not a repair.
- **The gallery ignoring the filter is deliberate and documented.** The board sends `/hands` the selected year and hand types, but purely as *return state* so the gallery's back arrow can restore the exact board the player left. `src/app/page.tsx` says so in a comment: "The gallery does not INHERIT these; it shows every photographed win exactly as it always has." Bryan has now chosen to reverse that decision.

A third fact shapes the whole design: **the board and the gallery describe different populations.** The board ranks every notable win whether or not it was photographed (capped at 50, ordered by label matches). The gallery lists only wins that have a photo (capped at 60, newest first, grouped by night) and requires sign-in. Making the gallery obey the filter therefore cannot make the two agree — a filter matching wins nobody photographed yields a populated board and an empty gallery. That must read as an honest answer, not as a fault.

## 2. Goals

1. Make every row on Notable wins open that single win.
2. Give a win an address, so it can be linked, bookmarked, refreshed, and returned to via Back.
3. Preserve the player's board state — tab, year, and ticked hand types — across the trip out and back, including across a sign-in.
4. Show, on the win page, the one thing the board row cannot: the photo, and each label's local (Chinese) name.
5. Make **View hand gallery** carry the board's year and hand-type selection into the gallery's own listing.
6. Say plainly when a filter matches wins that were never photographed, rather than looking broken or empty.
7. (Release 2) Let anyone who played a game attach a photo to a notable win from that game after the fact, closing the gap that previously required editing the production database by hand.

## 3. Non-goals

- Changing the ranking, eligibility, or ordering rules of the Notable wins board.
- Changing the hand catalogue, its rarities, or the logger.
- Editing or deleting a saved notable win, its labels, its winner, or its date.
- Replacing an existing photo. Release 2 adds a photo where there is none; it does not overwrite one that exists.
- Adding photo support to games that are still in progress beyond what the logger already does.
- Any change to houses, chips, academic years, or the other two boards.
- Retiring the gallery's own photo panel in Release 1. See §9.

## 4. Confirmed product decisions

All decided by Bryan on 2026-08-29 during the design conversation.

| ID | Decision | Approved behaviour |
|---|---|---|
| D1 | What a board row opens | That one win, up close — not the player's record, not the gallery |
| D2 | A win with no photo | Still opens; the page says no photo was taken and (Release 2) offers **Add photo** |
| D3 | A signed-out visitor taps a row | Sign-in wall, then delivered to the win they tapped — the gallery's existing rule, applied to one more door |
| D4 | Gallery and the filter | The gallery inherits the board's ticked hand types **and** its year, with an honest empty state and one tap to see everything |
| D5 | Who may attach a photo after the fact | Anyone who played that game. Removal opens to the same people, so nobody can attach a photo they are then locked out of removing |
| D6 | How "one win" is surfaced | A real page with its own address (Approach A) — not an overlay on the board, not folded into the gallery |
| D7 | Delivery | Two releases: navigation and filtering first, add-photo second |
| D8 | Details settled with §1 of the design | Address is `/hands/<win id>`; the winner is shown in their house colour; the gallery-panel overlap is resolved in Release 2 |

### 4.1 Approaches considered and rejected

**An overlay on the board (rejected).** Tapping would open a full-screen panel without navigating. Rejected because the homepage currently ships no client-side JavaScript at all — it is assembled on the server and sent as finished HTML — so an overlay means shipping a JavaScript bundle to a *public* page for a feature only signed-in players can use. An overlay is also not an address: Back would not close it, a refresh would lose it, and a win could not be linked to anyone. The entire board is built on the principle that the URL is the state; this is the one option that carves out an exception to it.

**Folding it into the gallery (rejected).** Board rows would jump into the gallery, which would gain the photo-less wins. Rejected because it changes what the gallery is — a grid of photographs grouped by night — by putting empty tiles into a photo wall, and because linking to one win inside it requires that win to have an address anyway. It is Approach A with a worse gallery attached.

## 5. Release 1 — the win page and the filtered gallery

Release 1 requires **no database migration.** The ranking query already returns each win's identifier and the board already uses it internally, so the link can be built from data the page holds today.

### 5.1 The address

One win lives at `/hands/<win id>`, where the identifier is the notable claim's UUID. This nests the page under the existing archive — `/hands` is all the notable hands, `/hands/<id>` is one of them — and places it beside the code that already solves the sign-in and back-link problems.

An identifier that is not a well-formed UUID renders the app's existing not-found page without touching the database. A well-formed UUID that matches no claim renders the same not-found page.

### 5.2 Reaching it while signed out

Identical to the archive's existing behaviour: the visitor is redirected to `/login?next=<this page's own address>`, and after signing in lands on the win they tapped. The year and hand types travel through that redirect, so the back link still works on arrival.

The return address is rebuilt from its parts on every hop — never carried whole as a single URL parameter — because a parameter used verbatim as a redirect target is an open redirect. The path is a literal in the file and the year and hand values are encoded query values, so the worst a hand-typed address can do is aim at another view of this same app.

### 5.3 What the page shows

- A back link to **the board the player left**: Notable wins, same year, same ticked hand types. Not a generic home link.
- The winner's display name, prominently, tinted with their house colour and carrying the house label when they have chosen one. Neutral when they have not. This matches how the other two boards already colour players.
- The date the hand was won, in Singapore time, formatted exactly as the board formats it.
- Every hand label the win carries, **each with its local name beside the English one** — the board row shows English only. Labels are ordered as the catalogue orders them.
- The photograph, shown large, when the win has one.
- When it has none: a plain line stating that no photo was taken. In Release 1 that is all it says.

### 5.4 Failure states, and one that matters more than it looks

- **Unknown or malformed win id** → the app's not-found page.
- **Labels that cannot be read** → the page reports that the win could not be loaded. It never renders the win with fewer labels than it carries. This mirrors the board's existing rule and exists for the same reason: a win shown a label short understates what somebody actually did at the table.
- **A photo that exists but whose signed link cannot be produced** → the page states that the photo could not be loaded. **It must never fall through to the "no photo was taken" state.**

That last rule is the one worth stating explicitly. The gallery *does* silently drop a photo it cannot sign, and that is correct there: it is a wall of many photos, and one missing tile is a gap rather than a false statement. On a page about a single win the same silent drop changes the meaning of the page — "this photo failed to load" becomes "no photo exists." In Release 1 that misleads the reader. In Release 2 it becomes a data-loss path: the page would offer to *add* a photo to a win that already has one. An error state and an empty state must never render as the same thing.

### 5.5 The board row becomes a link

Each row on Notable wins becomes a single link covering the whole row, targeting that win's page and carrying the current year and hand selection. The row keeps its existing height, which already meets the touch-target minimum, and gains a visible affordance and a pressed state so it reads as tappable.

The link's accessible name is its visible content; the existing screen-reader-only "Rank N" text stays as it is. The hand-label group inside the row remains a labelled group — it contains no interactive content, so it may sit inside the link.

### 5.6 The gallery honours the filter

The archive gains real filtering, distinct from the return state it already receives:

- With hand types selected, the gallery lists only photographed wins carrying **at least one** of them — the same "any selected type qualifies" rule the board uses, so the two never disagree about what a selection means.
- With a year selected, the gallery lists only photographed wins from games that ended in that academic year.
- A visible line states that the view is filtered and which selection produced it.
- **One tap shows every photographed hand again.** This uses a separate parameter that turns the gallery's own filtering off while leaving the return address intact, so clearing the gallery's view never silently clears the board the player will return to.
- When the filter matches nothing, the gallery says **no photos of these hand types yet** — distinct from the existing "no photographed hands yet", which means the archive is empty. Two different facts, two different sentences.

The gallery's cap and its newest-first grouping by night are unchanged.

## 6. Release 2 — attaching a photo after the fact

Specified here for coherence. It gets its own implementation plan at its own gate, after Release 1 is verified in production.

- On a win with no photo, the page offers **Add photo** to anyone who played in that game.
- The upload reuses the logger's existing photo preparation path unchanged: downscale in the browser, WebP first with a JPEG fallback, the same private bucket, the same size ceiling, the same server-side format and size checks.
- Permission is enforced **in the database**, inside the same transaction that writes the path — not on the screen. A forged flag in the browser buys nothing, exactly as it buys nothing for photo removal today.
- The write refuses when the win already has a photo, so the feature can never overwrite one.
- **Removal widens to match:** whoever may add may also remove. Today removal is restricted to whoever logged the win, which would otherwise let a player attach a photo they cannot take down.
- Release 2 also resolves the overlap described in §9.

## 7. Data reads

The win page performs one read for the claim — winner, house, date, labels with local names and rarity, photo path, the logging player, and the game — followed by one signed-URL request when a photo path exists. Both run server-side with the service credential, as every other read in the app does; the browser never receives that credential or direct database access.

The gallery's hand-type filter resolves in two explicit steps rather than through an embedded join filter: first the set of claims carrying any selected hand type, then the archive query restricted to that set. This keeps every label on each photo visible — an inner-join filter would restrict the labels shown to the matching ones — and avoids depending on subtleties of how the data layer reads embedded relationships. At this data volume the extra round trip is not measurable.

## 8. A deliberate looseness

The win page renders any real notable claim, including one belonging to a game still in progress. Only claims from ended games are reachable from the board, so such a page cannot be arrived at by browsing. It is left readable rather than blocked because the page requires sign-in, every signed-in viewer is a player at this table, and a claim from a live game is already visible to them on the game screen. Blocking it would add a rule that protects nothing.

## 9. A seam this release does not close

The gallery has its own way of showing a photo: tapping a tile opens a panel over the grid, carrying **Remove photo** when the viewer logged that win. Release 1 leaves that untouched, so there will briefly be two ways to look at a photograph — the gallery's panel and the new win page.

This is not broken, but it is not tidy, and it must not survive Release 2: *add* living on the win page while *remove* lives in a gallery panel would be genuinely confusing, and the two would enforce different permission rules. Release 2 resolves it by making the gallery tile lead to the win page and moving removal there.

## 10. Testing

Release 1 is covered by automated tests in the repository's existing style, written before the code they cover:

1. A signed-out visitor is redirected to sign in, and no claim is read on the way.
2. That redirect carries the year and hand selection, so the board survives the sign-in.
3. A malformed identifier renders not-found without querying the database.
4. A well-formed identifier matching no claim renders not-found.
5. The back link rebuilds the exact board the player left, filters included.
6. A bare address with no return state still renders, with a plain back link to Notable wins.
7. Every label is rendered, each with its local name.
8. A win whose labels cannot be read reports a failure and renders no partial label list.
9. A win with a photo renders the photo.
10. A win with a photo whose link cannot be signed reports a photo failure and **does not** render the "no photo was taken" state.
11. A win with no photo renders the "no photo was taken" state.
12. Board rows link to the right win and carry the current year and hand selection.
13. The gallery lists only photographed wins matching a selected hand type.
14. The gallery lists only photographed wins from a selected academic year.
15. The gallery's "show everything" link clears its own filter while leaving the return address intact.
16. A filter matching no photographed win produces the filtered empty message, not the archive-is-empty message.

Alongside these: the full existing suite, type checking, linting, and a production build must all pass before release.

## 11. Release gates

Release 1 touches no migration, so there is no database gate. The single gate is **push and deploy**, which is Bryan's to give explicitly after he has seen the work pass. Nothing is pushed to GitHub or deployed to Vercel before that.

Release 2 reinstates the full pattern: a database gate for the new permission function, then a separate push-and-deploy gate after hosted verification.
