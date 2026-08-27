# RVMJ Academic-Year Standings and the Account Page

Status: approved design, not yet built
Date: 2026-08-27
Migration: `0008` (additive only)

## 1. Outcome

Two features that ship together because they share one migration and one release gate.

1. **Academic-year standings.** The Lifetime board gains a row of year pills. "All time" stays the default and today's behaviour is unchanged for anyone who ignores the row. Selecting a year recalculates and re-ranks the whole board for the games played inside it.
2. **The account page.** A settings control in the top-right corner of the leaderboard opens a page where a signed-in player can change the name the boards display.

Neither feature changes any existing database object. `0008` only creates: two views, three functions. **This is the additive case, so database-first is safe** and the deployed app keeps working unchanged against the new schema. It is the opposite of `0007`, which removed functions the running app still called and therefore had to be released code-first.

## 2. Confirmed product rules

Decided by Bryan on 2026-08-27; do not re-litigate during the build.

- **Year pills, not grouped sections and not a fourth tab.** One ranked list; switching year re-ranks everything.
- **"All time" is the default view.** Opening RVMJ shows what it shows today.
- **Only years containing at least one finished game get a pill.** The row starts with one entry and grows on its own each August. There is no maintained list.
- **The academic year is NUS's.** See §3.
- **The account control is a settings icon in the TOP-RIGHT corner of the leaderboard**, not a button in the action row beside House rules.
- **Renaming is retroactive and total.** A new name replaces the old one everywhere, including games from months ago. There is deliberately no record of the previous name. Explicitly confirmed by Bryan: "yes it should rename you everywhere."
- **Display names need not be unique.** Enforcing it would mean telling a player their own name is taken, for a table of four friends who can resolve it between themselves.
- **A name may be changed as often as the player likes.** Unlike `house`, it is not permanent. Nothing in the model depends on it being stable, because nothing joins on it.

## 3. What an academic year is

**Primary source: the NUS Office of the University Registrar academic calendar page**, read 2026-08-27 through a real browser (the site sits behind Imperva bot protection which blocks both `curl` and summarising fetchers; a summariser's paraphrase would not have been acceptable evidence for a rule being written into a view).

Footnote 1, verbatim: **"Commences on first Monday of August each year."**
Footnote 6 confirms the far end: Semester 2's vacation "goes from May through July."

So **AY N/N+1 runs from the first Monday of August in year N up to, but not including, the first Monday of August in year N+1.** For the current year that is **Mon 3 Aug 2026 through Sun 1 Aug 2027** (AY27/28 begins Mon 2 Aug 2027). Verified independently across 2020-2060 by deriving the first Monday two different ways and comparing: zero mismatches. Cross-checked against NUS SCALE's published calendar, which places Semester 1 teaching at 10 Aug 2026, consistent with footnote 2's "week immediately following Orientation Week."

**This is a RULE, not a table of dates, and it must stay one.** A lookup table of start dates would need a new row every year, and the year somebody forgot would silently file games into the wrong bucket with nothing failing and nothing logging. Do not introduce one.

### 3.1 The timezone trap

`games.ended_at` is `timestamptz` and is stored in UTC. Mahjong runs late. A game finishing at 00:30 Singapore time on Mon 3 Aug 2026 is recorded as 16:30 UTC on Sun 2 Aug 2026, and a naive year calculation files it into AY25/26 — the night before the year it was actually played in.

**Every academic-year calculation converts to `Asia/Singapore` before taking the date.** This is the single most likely defect in the feature and the least visible, because it is only ever wrong for games played closest to the boundary.

## 4. User flow

### 4.1 The year row

Renders under the existing three-tab nav, on the Lifetime board only. Form and Skill are unaffected: Form does not exist yet, and Skill counts notable hands rather than points over time.

The row reads: `All time` `AY26/27` `AY25/26` … newest year first after "All time".

Selection travels in the address as a second parameter alongside `board`, matching how the tabs already work (`/?board=lifetime&year=2026`). An absent, malformed, or unknown year falls back to "All time" rather than erroring — the same fail-soft posture as `board` itself.

Each pill is a `<Link prefetch>`, for the same reason the board tabs got it on 2026-08-27: the route is dynamic, so Next prefetches only an empty frame unless told otherwise, and a tap then waits on a full round trip. Measured on that change: median 65ms and a 23–161ms spread became a median 15ms and a 14–20ms spread in production.

### 4.2 The settings control

A single icon control in the top-right of the leaderboard header, on the same row as the brand mark. **Rendered only when signed in** — it leads to a page about your own account, and offering it to a signed-out visitor leads only to a login wall.

Tapping it navigates to `/account`.

### 4.3 The account page

Shows, in order: the player's current display name, their house (or "No house yet"), and a form to change the display name. Back returns to the leaderboard.

Saving shows one of four outcomes (§8). On success the new name is shown immediately and the leaderboard reflects it on the next visit.

`/account` requires a session. A signed-out visitor is redirected to `/login?next=%2Faccount`, matching `/hands`.

## 5. Data model and migration `0008`

Additive only. No column is added, altered, or dropped; no existing function or view is replaced with a different signature.

### 5.1 The year rule, as two functions

```sql
-- The first Monday of August. date_trunc('week', ...) returns the MONDAY of the containing
-- week, and exactly one of 1-7 August is a Monday, so the week containing 7 August always
-- begins on the first Monday of that August. Immutable: it depends on nothing but its input.
create or replace function academic_year_start(p_year int) returns date
language sql immutable set search_path = public as $$
  select date_trunc('week', make_date(p_year, 8, 7))::date
$$;

-- STABLE, not IMMUTABLE: converting a timestamptz to a local date depends on the timezone
-- database, which PostgreSQL treats as mutable across sessions. Marking it immutable would be
-- a lie that permits indexing on a value that could change.
create or replace function academic_year_of(p_when timestamptz) returns int
language sql stable set search_path = public as $$
  select case
           when d >= academic_year_start(extract(year from d)::int)
           then extract(year from d)::int
           else extract(year from d)::int - 1
         end
  from (select (p_when at time zone 'Asia/Singapore')::date as d) s
$$;
```

`academic_year_of` returns the STARTING year: AY26/27 is `2026`. The `AY26/27` label is formed in the application, not in SQL, following the established split where the database owns facts and the code owns display.

### 5.2 The per-year board

Mirrors `lifetime_board` exactly, with the year added to the grouping key. Kept as a SEPARATE view rather than replacing `lifetime_board`: "All time" must keep reading the existing view, so the default path is provably untouched by this migration.

```sql
create or replace view lifetime_board_by_year as
select p.id, p.display_name,
  academic_year_of(g.ended_at) as academic_year,
  coalesce(sum(gp.final_total), 0) as total_points,
  count(gp.game_id) as games_played,
  p.house
from players p
join game_players gp on gp.player_id = p.id
join games g on g.id = gp.game_id and g.status = 'ended'
group by p.id, p.display_name, academic_year_of(g.ended_at), p.house;

-- Which pills to render. A view rather than a distinct-select in the application, so the
-- pill row and the board it filters can never disagree about which years exist.
create or replace view academic_years as
select distinct academic_year_of(g.ended_at) as academic_year
from games g
where g.status = 'ended';
```

Both views omit an `ended_at is not null` guard **on the strength of an asserted invariant, not an assumption** — see §5.4.

### 5.3 The rename function

Follows `choose_house` exactly: explicit player id, `security definer`, row lock, `(stored, applied)` return so a no-op retry reports honestly.

```sql
create function set_display_name(p_player_id uuid, p_name text)
returns table (stored_name text, applied boolean)
language plpgsql security definer set search_path = public as $$
declare v_clean text; v_current text;
begin
  v_clean := btrim(coalesce(p_name, ''));
  if v_clean = '' then raise exception 'display name may not be blank'; end if;
  if length(v_clean) > 40 then raise exception 'display name may not exceed 40 characters'; end if;

  select p.display_name into v_current from players p where p.id = p_player_id for update;
  if not found then raise exception 'no such player'; end if;

  if v_clean = v_current then
    return query select v_current, false;
    -- `return query` APPENDS; without the bare return the function falls through and emits a
    -- second bogus row. Exactly the trap 0006 documented.
    return;
  end if;

  update players set display_name = v_clean where id = p_player_id;
  return query select v_clean, true;
end $$;
```

`display_name` is `not null` in `0001`, so the blank guard protects the value's meaning rather than the column.

The 40-character cap is a layout decision expressed in the database because that is the only place it cannot be bypassed. The browser will also stop at 40 (§7.2); neither guard is load-bearing alone.

### 5.4 Hardening and assertions

`0008` carries its own hardening, because an applied migration cannot be extended. Repeat the `0004`/`0005`/`0006` pattern:

```sql
alter view public.lifetime_board_by_year set (security_invoker = true);
alter view public.academic_years          set (security_invoker = true);

revoke all on public.lifetime_board_by_year, public.academic_years from anon, authenticated;
grant select on public.lifetime_board_by_year, public.academic_years to authenticated;

revoke all privileges on function public.set_display_name(uuid, text) from public, anon, authenticated;
grant execute on function public.set_display_name(uuid, text) to service_role, postgres;
```

`academic_year_of` and `academic_year_start` are pure calculations over supplied arguments, reachable only through views that are themselves revoked from browser roles. They read no table and leak nothing.

Assertions that abort the transaction rather than half-migrating:

1. **Every ended game has an `ended_at`.** Both new views file games by it, so a null would silently drop a real night of play from every year pill while leaving it in the all-time total, and the two boards would quietly disagree. Verified true by reading `0001`, `0003` and `0007` — every path setting `status = 'ended'` sets `ended_at = now()`, and `reopen_game` nulls it while returning status to `'active'`. Assert it anyway; that is what makes it an invariant rather than a coincidence.
2. **The year rule lands on the known answers**, including both edges of the `date_trunc` trick. Assert all three; the edge years are named rather than "spot-checked" so the assertion cannot quietly test the easy case twice:
   - `academic_year_start(2026) = '2026-08-03'` — the current year.
   - `academic_year_start(2023) = '2023-08-07'` — 7 August IS a Monday, so the truncation must return 7 August itself.
   - `academic_year_start(2022) = '2022-08-01'` — 7 August is a Sunday, the furthest the truncation ever reaches back.
3. **Boundary filing is correct across the timezone.** `academic_year_of('2026-08-02 16:30+00')` is 2026, because that instant is 00:30 on 3 August in Singapore. This is the §3.1 trap, asserted directly.
4. **Browser roles cannot execute `set_display_name`**, and cannot select from either new view.
5. **The per-year totals reconcile with the all-time total** for every player: summing a player's `total_points` across all years equals their `lifetime_board.total_points`. This catches a filing bug, a dropped game, and a double-count in one assertion.

## 6. Server boundary

`renameMe(name: string)` in `src/lib/actions/account.ts`, following `chooseHouse` precisely.

**It does not take a player id.** Identity comes from the session cookie and nowhere else, so a forged form, a stale page, or a hand-rolled fetch still cannot nominate another account. The name IS untrusted and is trimmed and length-checked in TypeScript before the call; the database checks again.

Returns a discriminated union: `{ status: 'saved'; name }`, `{ status: 'unchanged'; name }`, `{ status: 'invalid'; reason }`, `{ status: 'expired' }`, `{ status: 'failed' }`. `unchanged` is not a failure — it is the database honestly reporting that the submitted name is the one already stored.

The boards continue to be read server-side with the service role, unchanged.

## 7. Interface design

### 7.1 The settings control

Top-right of the leaderboard header, on the brand mark's row, which becomes a flex row with the mark left and the control right.

- A gear glyph drawn in the project's existing visual language (chunky border, hard offset shadow), matching `BrandMark` and the card header badges rather than importing an icon set.
- **44x44 minimum**, via the same `min-h-11 min-w-11` contract that `ActionLink` carries and that `ChipLive.test.tsx` already asserts for the in-game rules link.
- **An icon alone is not a label.** It carries an accessible name of "Account settings" and the glyph itself is `aria-hidden`.
- Rendered only when `user` is present.

### 7.2 The year pills

Visually subordinate to the board tabs above them, which stay the primary control: lighter weight, smaller, no filled background on the selected pill competing with the selected tab. The selected pill carries `aria-current="page"` exactly as the tabs do.

Horizontally scrollable within its own container, so the row cannot widen the page as years accumulate. The page body must never scroll sideways.

### 7.3 The account page

Reuses `AppFrame` and `PageHeader` with a Back link to `/`. The name field is a plain labelled text input with `maxLength={40}`, showing the current name as its initial value. One primary Save button, disabled while submitting, using `Button`'s existing `busy`/`busyLabel` contract.

The retroactive consequence is stated on the page in one plain line, near the field: changing this name changes it on every board and every past game.

## 8. Failure handling

| Situation | Behaviour |
|---|---|
| Save fails (network, database) | `StatusMessage` tone `error`; the field keeps what was typed so nothing is lost |
| Session expired mid-edit | `expired`; invite re-sign-in, do not silently discard the typed name |
| Name blank or whitespace only | Refused client-side before the call, with a message; database refuses independently |
| Name over 40 characters | Input stops at 40; database refuses independently |
| Submitted name equals stored name | `unchanged`; a neutral confirmation, never an error |
| `academic_years` read fails | Render the board with "All time" only and no pills, rather than an empty row that reads as "no years exist" |
| Board read fails for a selected year | The existing error copy: say the board failed to load, never render an empty table that reads as "nobody played" |

## 9. Accessibility

- The settings control has a text accessible name; the glyph is `aria-hidden`.
- The pill row is a labelled `nav` (`aria-label="Academic year"`), distinct from the existing `aria-label="Leaderboard"` nav, so a screen-reader user can tell the two rows apart.
- Selected pill: `aria-current="page"`.
- The name input has a real `<label>`, not a placeholder standing in for one.
- Save outcomes are announced through the existing `LiveRegion`.

## 10. Verification

### 10.1 Database

Against the LOCAL stack first, then re-verified on hosted after the push. Probe grants AS `anon`, do not read them from the catalogue.

- Full replay from scratch through `0008` passes.
- The five assertions in §5.4 hold.
- `anon` gets `permission denied` on `set_display_name` and on both new views.
- A rename through the function changes exactly one row and leaves every other player untouched.
- The boundary case: seed a game ended at `2026-08-02 16:30+00` and confirm it appears under 2026, not 2025.

### 10.2 Application and components

- `academic_year_of`'s TypeScript counterpart for labels (`2026` to `AY26/27`) is unit-tested, including the century roll (`2099` to `AY99/00`).
- The year row renders one pill per year returned, newest first, with "All time" first and selected by default.
- An unknown, malformed, or absent `year` parameter falls back to "All time".
- The pills carry `prefetch`, asserted by walking the returned element tree (the technique added for the board tabs on 2026-08-27 — `prefetch` never reaches the HTML, so markup cannot be asserted on).
- The settings control is absent when signed out and present when signed in, and carries its accessible name and the 44x44 contract.
- `/account` redirects a signed-out visitor to `/login?next=%2Faccount` and reads nothing on the way, mirroring the `/hands` test.
- `renameMe` returns each of its five statuses.

### 10.3 Full project checks

Tests, `typecheck`, `lint` (0 errors; the known `GameLive` `_props` warning is expected), and `build`.

### 10.4 Browser verification

On a real running server, not only in tests: the pills filter and re-rank, "All time" matches today's board exactly, the settings icon opens `/account`, a rename lands, and the renamed player appears under the new name on both the all-time and the per-year board.

## 11. Release order

**Database first.** `0008` is additive, so the deployed app keeps working unchanged against the new schema and there is no window of breakage. This is the ordinary order, and it is safe here for the specific reason `0007` was not: nothing the running code calls is being removed or re-signed.

1. Apply `0008` to hosted; verify §10.1 against the live database, function by function.
2. Bryan's explicit approval to push code. This is a separate gate.
3. Push; confirm Vercel Ready on the exact commit sha, filtered on sha and not accepted on age.
4. Re-run §10.4 against production.

## 12. Out of scope

- **Renaming history.** No record is kept of a previous display name. Bryan chose the retroactive rename knowing this.
- **Unique names.** Deliberately not enforced.
- **Year filtering on Skill.** It counts notable hands, and slicing glory by academic year was not asked for.
- **Form board.** Still not live; it needs app-mode games.
- **Anything else on the account page.** Sign-out, house changes (permanent by design), and photo management are not part of this. The page shows the name, the house as read-only, and a rename field.
