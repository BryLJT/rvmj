-- ============================================================================
-- 0008 — academic-year standings and player rename
--
-- Wrapped in an explicit transaction, matching 0004 through 0007. This migration carries
-- assertion blocks that raise; without the wrapper a firing assertion would leave the functions
-- created and the views half-built. Do not remove the begin/commit.
--
-- ADDITIVE ONLY. Nothing existing is altered or dropped: lifetime_board, form_board and
-- skill_board are untouched, and no column changes. That is what makes the ordinary
-- database-first release order safe here, unlike 0007 which removed functions the deployed app
-- still called and therefore had to go out code-first.
-- ============================================================================
begin;

-- ============ THE ACADEMIC YEAR, AS A RULE ============
-- NUS Office of the University Registrar, footnote 1, verbatim: "Commences on first Monday of
-- August each year." Never store a table of start dates: it would need a row every August, and
-- the year somebody forgets files games into the wrong bucket silently.
--
-- Exactly one of 1-7 August is a Monday, so truncating the week containing 7 August always
-- lands on the first Monday of that August. date_trunc('week', ...) returns the MONDAY of the
-- containing week.
create or replace function academic_year_start(p_year int) returns date
language sql immutable set search_path = public as $$
  select date_trunc('week', make_date(p_year, 8, 7))::date
$$;

-- STABLE, not IMMUTABLE. Converting a timestamptz to a local date depends on the timezone
-- database, which PostgreSQL treats as mutable across sessions; marking it immutable would be a
-- lie that permits indexing a value which could change.
--
-- The Asia/Singapore conversion is load-bearing, not cosmetic. ended_at is UTC and mahjong runs
-- late: a game finishing 00:30 on the Monday a year opens is stored as 16:30 the previous
-- afternoon, and would be filed a whole year early without it.
create or replace function academic_year_of(p_when timestamptz) returns int
language sql stable set search_path = public as $$
  select case
           when d >= academic_year_start(extract(year from d)::int)
           then extract(year from d)::int
           else extract(year from d)::int - 1
         end
  from (select (p_when at time zone 'Asia/Singapore')::date as d) s
$$;

-- ============ BOARDS ============
-- A SEPARATE view, not a replacement for lifetime_board. "All time" must keep reading the
-- existing view, so the default path is provably untouched by this migration.
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

-- Which pills to render. A view rather than a distinct-select in the application, so the pill
-- row and the board it filters can never disagree about which years exist.
create or replace view academic_years as
select distinct academic_year_of(g.ended_at) as academic_year
from games g
where g.status = 'ended';

-- ============ RENAME ============
-- Shaped exactly like choose_house: explicit player id, row lock, (stored, applied) return so a
-- no-op retry reports honestly rather than claiming to have written.
--
-- Unlike house, a display name is NOT permanent and has no trigger guarding it. Nothing in the
-- model joins on it, so a rename is retroactive by construction: every board reads the name
-- live, and a renamed player appears under the new name in games from months ago. That is the
-- confirmed product decision, not an oversight.
create or replace function set_display_name(p_player_id uuid, p_name text)
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
    -- `return query` APPENDS to the result set; it does not return. Without this bare return the
    -- function falls through and emits a second, bogus row. Exactly the trap 0006 documented.
    return;
  end if;

  update players set display_name = v_clean where id = p_player_id;
  return query select v_clean, true;
end $$;

-- ============ HARDENING ============
-- 0008 carries its own, because an applied migration cannot be extended. `create or replace
-- view` DISCARDS reloptions, so security_invoker must be applied here or the views read base
-- tables with RLS bypassed.
alter view public.lifetime_board_by_year set (security_invoker = true);
alter view public.academic_years          set (security_invoker = true);

-- NO browser role gets these, not even authenticated. The application reads both views on the
-- server with the service role (see src/app/page.tsx), so a grant to `authenticated` would be
-- privilege nobody uses -- and the standing verify_migrations.sql assertion treats the readable
-- views as an exhaustive allowlist of exactly three. Removing the need beats widening the
-- allowlist: an absent grant cannot be got wrong later, and the assertion stays tight.
revoke all on public.lifetime_board_by_year, public.academic_years from anon, authenticated;
grant select on public.lifetime_board_by_year, public.academic_years to service_role;

revoke all privileges on function public.set_display_name(uuid, text) from public, anon, authenticated;
grant execute on function public.set_display_name(uuid, text) to service_role, postgres;

-- The two date functions are pure calculations over supplied arguments. They read no table and
-- are reachable only through views that are themselves revoked from browser roles.

-- ============ ASSERTIONS ============
-- Everything below aborts the transaction rather than leaving a half-migrated database.

-- 1. Every ended game carries an ended_at. Both new views file games by it, so a null would drop
-- a real night of play from every year pill while leaving it in the all-time total, and the two
-- boards would quietly disagree. True by reading 0001, 0003 and 0007 — every path setting
-- status='ended' sets ended_at=now(), and reopen_game nulls it while returning status to
-- 'active'. Asserted anyway; that is what makes it an invariant rather than a coincidence.
do $$
begin
  if exists (select 1 from games where status = 'ended' and ended_at is null) then
    raise exception 'ended game with no ended_at: the per-year boards would silently drop it';
  end if;
end $$;

-- 2. The year rule lands on the known answers, at BOTH edges. The edge years are named rather
-- than spot-checked so the assertion cannot quietly test the easy case twice.
do $$
begin
  if academic_year_start(2026) <> date '2026-08-03' then
    raise exception 'academic_year_start(2026) = %, expected 2026-08-03', academic_year_start(2026);
  end if;
  -- 7 August 2023 IS a Monday: the truncation must return the 7th itself.
  if academic_year_start(2023) <> date '2023-08-07' then
    raise exception 'academic_year_start(2023) = %, expected 2023-08-07', academic_year_start(2023);
  end if;
  -- 7 August 2022 is a Sunday: the furthest the truncation ever reaches back.
  if academic_year_start(2022) <> date '2022-08-01' then
    raise exception 'academic_year_start(2022) = %, expected 2022-08-01', academic_year_start(2022);
  end if;
end $$;

-- 3. Boundary filing across the timezone. 16:30 UTC on 2 August is 00:30 on 3 August in
-- Singapore, the first day of AY26/27. This is the likeliest defect in the whole feature.
do $$
begin
  if academic_year_of(timestamptz '2026-08-02 16:30+00') <> 2026 then
    raise exception 'late-night game filed by UTC date, not Singapore date';
  end if;
  if academic_year_of(timestamptz '2026-08-02 15:59+00') <> 2025 then
    raise exception 'a game before Singapore midnight was filed into the new year';
  end if;
end $$;

-- 4. Per-year totals reconcile with the all-time total, for every player. One assertion that
-- catches a filing bug, a dropped game and a double-count together.
do $$
declare v_bad int;
begin
  select count(*) into v_bad from (
    select l.id from lifetime_board l
    join (select id, sum(total_points) as t, sum(games_played) as g
          from lifetime_board_by_year group by id) y on y.id = l.id
    where y.t <> l.total_points or y.g <> l.games_played
  ) s;
  if v_bad > 0 then
    raise exception 'per-year totals disagree with the all-time board for % player(s)', v_bad;
  end if;
  -- And nobody appears on one board but not the other.
  if (select count(*) from lifetime_board) <>
     (select count(distinct id) from lifetime_board_by_year) then
    raise exception 'a player appears on one lifetime board but not the other';
  end if;
end $$;

-- 5. Browser roles cannot execute the rename, and cannot read the new views.
do $$
begin
  if has_function_privilege('anon', 'public.set_display_name(uuid, text)', 'execute')
     or has_function_privilege('authenticated', 'public.set_display_name(uuid, text)', 'execute') then
    raise exception 'set_display_name must not be executable by a browser role';
  end if;
  if has_table_privilege('anon', 'public.lifetime_board_by_year', 'select')
     or has_table_privilege('anon', 'public.academic_years', 'select')
     or has_table_privilege('authenticated', 'public.lifetime_board_by_year', 'select')
     or has_table_privilege('authenticated', 'public.academic_years', 'select') then
    raise exception 'no browser role may read the new views';
  end if;
  -- The positive half. A denial suite alone would also pass with the views unreadable by
  -- EVERYONE, which would take the boards down rather than secure them.
  if not has_table_privilege('service_role', 'public.lifetime_board_by_year', 'select')
     or not has_table_privilege('service_role', 'public.academic_years', 'select') then
    raise exception 'service_role must be able to read the new views';
  end if;
end $$;

commit;
