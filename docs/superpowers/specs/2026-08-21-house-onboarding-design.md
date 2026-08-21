# RVMJ House Onboarding and Leaderboard Identity

**Date:** 2026-08-21  
**Status:** In-chat design approved by Bryan; written review pending  
**Scope:** Optional one-time house selection, permanent storage, and house identity on leaderboard rows

## 1. Outcome

Every RVMJ player can belong to one of seven houses. A player who has not chosen is invited after each successful sign-in, but can defer and continue using the app. A smaller homepage action remains available between sign-ins.

Once confirmed, the choice is permanent. Leaderboard rows then use the house's approved background and text colours, with the house name visible so colour is never the only signal.

This feature serves identity and friendly competition. It does not change scoring, rankings, game membership, or who can read the public boards.

## 2. Confirmed product rules

- Selection is optional. It never blocks a signed-in destination.
- New and existing accounts with no house are prompted after every future sign-in until they choose.
- Deferral is not remembered as an opt-out. It closes only the current prompt.
- The signed-in homepage shows a compact **Choose your house** action while the house is empty.
- The first confirmed choice is permanent.
- Permanence is enforced by the database, not only by hidden controls.
- Selection takes two deliberate taps: choose a house, then press **Confirm [House]**.
- The prompt is a modal over the intended post-sign-in destination, not a dedicated page.
- **Choose later**, Escape, and tapping the backdrop all defer and leave the user on the same page.
- The full leaderboard row receives the house treatment. Rank, name, context, house label, and score stay inside it.
- A player without a house keeps the neutral row and shows **No house yet**.

## 3. House catalogue

The database stores lowercase identifiers. The interface shows the approved display names. One TypeScript catalogue is the application source for labels and visual tokens; the database independently constrains the allowed stored values.

| Stored value | Display name | Row fill | Text |
|---|---|---|---|
| `manis` | Manis | `#BFE3F2` | `#142D37` |
| `strix` | Strix | `#F7D968` | `#142D37` |
| `aonynx` | Aonynx | `#D3D7D5` | `#142D37` |
| `orcaella` | Orcaella | `#F2B5CE` | `#142D37` |
| `rusa` | Rusa | `#2F644F` | `#FFFDF8` |
| `chelonia` | Chelonia | `#2E4F76` | `#FFFDF8` |
| `panthera` | Panthera | `#E8873A` | `#142D37` |

These values are exact. The earlier softened and transparency variants were rejected.

## 4. User flow

### 4.1 Prompt after sign-in

1. The existing OAuth callback exchanges the Google authorization code for a session.
2. It obtains the authenticated user and reads that player's current house on the server.
3. It preserves the sanitized, same-origin destination already carried by `next`.
4. When the house is null, it adds one temporary query marker: `houseSetup=1`.
5. When the house is already set, it redirects without the marker.
6. A global client-side prompt host sees the marker and opens the modal over the destination.

The callback must retain the current same-origin redirect protection. Existing query values and fragments in the destination are preserved. Adding or removing the house marker must not erase or rewrite any unrelated part of the destination.

In this specification, "every sign-in" means every successful OAuth callback while the stored house is null. A browser that still has a valid session does not manufacture a new sign-in event. The homepage action remains the route to selection in that state.

### 4.2 Deferral

**Choose later**, Escape, and a direct backdrop tap perform the same action:

- close the modal;
- remove only `houseSetup` from the current address without a page navigation;
- keep the destination and its state intact;
- write no deferral preference to the database or browser;
- leave the homepage action available;
- allow the prompt to return after the next sign-in.

A click inside the dialog never counts as a backdrop click.

### 4.3 Confirmation

1. No house is preselected.
2. Tapping a house marks it selected with a visible check and `aria-pressed="true"`.
3. The confirmation control is disabled until a house is selected.
4. Its label becomes **Confirm [House]**.
5. While the save is pending, the label becomes **Saving...** and repeat submission is blocked.
6. A successful save closes the modal, removes the marker, refreshes server-rendered data, removes the homepage action, and recolours any visible row for that player.

The permanent warning uses the approved copy:

> **Choose carefully.** Your house cannot be changed later.

### 4.4 Homepage entry

The homepage reads the signed-in player's house on the server. A null house renders a compact secondary **Choose your house** action near the signed-in identity area, before the leaderboard tabs. That action opens the same modal component without requiring another sign-in or adding a navigation entry.

Signed-out visitors and players with a house never see this action.

## 5. Data model and migration

The next migration is `0006_house_onboarding.sql`. Migrations `0001` through `0005` are applied history and must not be edited. In particular, `0004_explicit_access_grants.sql` is a point-in-time hardening record and must remain untouched.

The migration is transactional and performs five jobs.

### 5.1 Optional house field

Add nullable `players.house text`. A check constraint allows only the seven stored identifiers in section 3. Null remains valid for every existing player and every deferred choice.

There is no default. Assigning a house automatically would violate the product decision that the player chooses it.

### 5.2 Permanent-change backstop

A `BEFORE UPDATE OF house` trigger rejects any attempt to change a non-null house to a different value or back to null. Writing the same value is an idempotent no-op and remains valid.

This trigger is the final backstop. It applies even to the service role and direct operator updates, so a later application bug cannot weaken permanence.

### 5.3 Atomic selection function

A server-only `choose_house` database function:

- receives a player ID and proposed house;
- rejects unknown house identifiers;
- locks the player row;
- writes only when the stored house is null;
- returns the actual stored house and whether this call set it.

The row lock makes two-device confirmation deterministic. The first committed selection wins. The second caller receives the actual permanent house and cannot overwrite it.

The function is callable only by `service_role` and `postgres`. `public`, `anon`, and `authenticated` receive no execute permission. The trigger function receives no browser or service-role execute grant beyond what PostgreSQL needs to fire the trigger.

### 5.4 Leaderboard views

`lifetime_board`, `form_board`, and `skill_board` each add `house` as their final column and include it in grouping where required.

Replacing a view can discard its `security_invoker` setting, so the migration must reapply that setting to all three views. It must also reassert the existing read-only grants and anon denial.

Because the views run with the reader's permissions, authenticated users need column-level read access to `players.house`. The migration adds that one readable column while keeping `players.email` server-only and preserving the ban on authenticated writes.

The Form tab remains the existing informational placeholder. This feature prepares its data source but does not activate app-mode scoring or invent Form rows.

### 5.5 Migration assertions

The migration ends with checks that abort the transaction unless all of the following are true:

- the house column is nullable and constrained to the seven identifiers;
- the one-time function and trigger exist exactly once;
- browser roles cannot execute either function or write the player table;
- the service role can execute `choose_house`;
- authenticated player-column reads are exactly `id`, `display_name`, `created_at`, and `house`;
- email remains unreadable to authenticated users;
- all three board views are read-only and `security_invoker=true`;
- all three views expose `house`;
- unsafe default privileges remain absent.

## 6. Server boundary

The browser never supplies a player ID for selection.

A dedicated server action performs this sequence:

1. validate the submitted value against the canonical house identifiers;
2. identify the current user from the authenticated session;
3. call `choose_house` through the server-only admin client using that user's ID;
4. translate the structured database result into one of three interface outcomes: saved, already set, or failed.

This follows the app's existing write shape. The browser asks the server; the server derives identity; the database makes the final decision.

A caller cannot choose for another account by changing browser data. A forged or stale `houseSetup=1` marker has no authority. At worst it opens the interface; the server and database still return the already stored house.

## 7. Interface design

### 7.1 Modal

The modal follows the approved pop-up visual:

- dimmed destination remains visible behind a centred raised dialog;
- title: **Choose your house**;
- introduction: **Your house colours your leaderboard row and appears beside your name.**;
- permanent warning from section 4.3;
- seven large colour choices in a phone-friendly grid;
- full-width confirmation control;
- quieter **Choose later** control below it.

This is a new modal component, not the existing `FullScreenPanel`. That component intentionally fills the entire viewport, while Bryan explicitly chose a pop-up that leaves the destination visible.

One modal implementation serves both the sign-in marker and the homepage action. Shared state lives in a small prompt provider mounted by the root layout; the homepage launcher only asks that provider to open.

### 7.2 Leaderboard rows

House presentation is shared across current boards:

- each populated row is a separate rounded box with spacing between rows;
- rank, name, house label, context, and score are all inside the coloured background;
- the exact section 3 text colour applies to every piece of text on a house row;
- the plus or minus sign continues to communicate score direction, so red and green score text are not placed on the coloured backgrounds;
- house-less rows keep the current neutral colours and signed score tones;
- the small label says the display house name, or **No house yet** for null.

Lifetime and Skill use this presentation immediately. Form uses the same renderer when its existing product gate is removed in a future feature.

## 8. Failure and race handling

### Ordinary save failure

The modal stays open. It retains the selected house, restores the confirmation control, and announces:

> We couldn't save your house. Try again.

The message uses the existing live-region pattern. **Choose later** remains available.

### Expired sign-in

The modal explains that the sign-in expired and provides a clearly named route back to sign-in. It never converts an unauthenticated request into a write.

### Two-device or stale-marker result

If the database reports that a house was already set:

- the attempted choice is not written;
- the modal switches to the actual stored house;
- it states **Your house is already set to [House].**;
- retry controls disappear and a **Done** control closes the resolved state;
- a refresh makes the permanent house visible everywhere.

Submitting the same house twice is harmless and resolves to that house.

### Read failure

Failure to read the house during the OAuth callback must not block the intended destination. The callback redirects normally without the setup marker and records a server-side error with safe context. The homepage action provides a later route once the profile read succeeds.

## 9. Accessibility

- The container uses `role="dialog"`, `aria-modal="true"`, and a labelled title.
- Focus moves into the dialog on open and remains trapped inside while open.
- Escape defers.
- Closing restores focus to the control that opened the dialog when that control still exists.
- Each house choice is a real button with its name and pressed state.
- Selection is communicated by text/check state as well as colour.
- Save errors and race outcomes are announced through a live region.
- Backdrop, dialog, choices, and controls meet phone-sized touch target expectations.
- The approved foreground/background pairs remain exact because all seven pass normal-text contrast requirements.

## 10. Verification

All behavioural work is test-first. Each new guard must be observed failing for the intended reason before implementation makes it pass.

### 10.1 Database

- Rebuild from every migration in order.
- Prove null is accepted for existing and new players.
- Prove all seven identifiers are accepted.
- Prove an invalid identifier is rejected.
- Prove the first selection succeeds.
- Prove a different or null second value is rejected by the trigger, including a direct service-role update.
- Prove the same-value retry is harmless.
- Exercise two independent connections choosing different houses and prove only the first commit wins.
- Prove the selection function's role grants and the trigger's restricted grants.
- Prove authenticated users can read house but not email and cannot write either.
- Prove all board views expose house, retain `security_invoker=true`, and keep their intended role matrix.
- Update the post-migration verification contract so its expected player columns and protected functions describe the new final schema without editing historical migrations.

### 10.2 Application and components

- The shared catalogue contains exactly the seven approved mappings.
- The callback preserves same-origin redirect protection and all destination state.
- The callback adds the marker only after successful sign-in when house is null.
- A profile read failure never blocks the destination.
- The marker opens the modal; deferral removes only that marker.
- Homepage action visibility covers signed-out, null-house, and chosen-house states.
- No default selection; confirmation is disabled until selection.
- Confirmation label, busy state, duplicate-submit guard, ordinary retry, expired-session state, and already-set state.
- Escape, backdrop targeting, focus trap, focus restoration, pressed state, dialog labels, and live announcements.
- Lifetime and Skill render all seven visual mappings exactly.
- House-less rows remain neutral and say **No house yet**.
- Positive and negative score meaning remains visible without relying on colour.
- Existing Form unavailability, gallery placement under Skill, and signed-out board access do not regress.

### 10.3 Full project checks

- complete Vitest suite;
- generated Next.js types plus TypeScript checking;
- ESLint with zero new warnings or errors;
- production build;
- whitespace and unintended-diff review;
- full migration replay from scratch.

### 10.4 Browser verification

Use Playwright against the local app with controlled authenticated test users to cover:

1. first sign-in opens the modal over the preserved destination;
2. deferral leaves the destination and cleans the address;
3. another sign-in prompts again;
4. homepage action reopens the same modal;
5. confirmation removes the prompt and action;
6. all visible boards show the correct row treatment;
7. keyboard operation, Escape, and focus restoration;
8. no unexpected browser-console or network errors.

Production smoke testing must use an account and permanent house choice approved for that purpose. No arbitrary permanent house may be assigned to Bryan or another real player merely to complete a test.

## 11. Release order

Local implementation and verification happen first. Production release is a separate decision.

When Bryan approves release:

1. Confirm the hosted migration history still ends at `0005` and the local repository is on the intended commit.
2. Apply `0006` to hosted Supabase before pushing any application code that reads `players.house`.
3. Verify the hosted column, constraint, trigger, function permissions, player-column grants, and all three views directly.
4. Only after the database checks pass, push the application commit.
5. Confirm Vercel deployed that exact Git commit and the public alias serves it.
6. Run the controlled production smoke test and inspect runtime logs for errors.

The database change is backward-compatible with the old application because the new column is nullable. If the application must be rolled back, leave the schema and any permanent choices in place; do not erase house assignments automatically.

## 12. Out of scope

- Changing or resetting a confirmed house, including an admin interface
- Random or automatic assignment
- House descriptions, crests, icons, lore, or separate house pages
- House-based scoring, filters, competitions, or private leaderboards
- Activating the Form leaderboard or app-mode scorekeeping
- Adding a top-level House navigation category
- Recording deferral as a durable preference
- Changing the approved palette
- Resolving the separate notable-photo manual checks or photo replacement issue
