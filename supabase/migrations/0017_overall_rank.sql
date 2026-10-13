-- ============================================================================
-- 0017 — every board row says where it stands among everyone
--
-- Bryan, 2026-10-11: the boards can be narrowed to one house, and a narrowed row shows TWO
-- numbers: its place inside the house, and its place among everyone on that board.
--
-- The first number is free: it is the row's position in the list the page was handed. The second
-- cannot be worked out from a narrowed list at all. Three Orcaella rows do not know that seven
-- other players sit between them. So the place among everyone has to be written onto each row
-- BEFORE anything is narrowed, and that is the one thing this migration adds: an `overall_rank`
-- on all three board reads.
--
-- "Everyone" is everyone on the board being read: the same game, the same academic year where
-- one is chosen, and on Notable wins the same selected hand types. It is never narrowed by house.
-- The page applies the house on top of the answer, so the database ranks first and the house is
-- chosen second. That order is a property of the query shape, not of the planner: a condition on
-- a column the ranking is not partitioned by cannot be moved underneath the ranking.
--
-- Nothing is stored. No table changes, and no column is added to players or games. The rank is
-- computed on every read, so it cannot go stale when a match ends.
--
-- Each rank uses EXACTLY the order its board is already read in, ties included:
--   * Total score     points, then name, then id (the order the page asks for);
--   * Pts per game    average, then games counted, then name, then id (the function's own);
--   * Notable wins    selected matches, then labels, then newest, then claim id (the function's own).
-- So on an un-narrowed board the rank is simply the row number the page already shows.
--
-- MIGRATE BEFORE DEPLOY, and the currently deployed app keeps working across it:
--   * the two views gain one column at the END, which a caller reading `*` receives and ignores;
--   * the two functions keep their arguments, so the same call resolves to the new function. Only
--     the row they return grows, again at the end.
-- The NEW app does depend on this migration: it sorts the two function boards by `overall_rank`.
--
-- The views are replaced in place rather than added beside the old ones, which is the opposite of
-- what 0008 and 0016 did. Those added new views because the old ones answered a DIFFERENT
-- question and the deployed app still needed the old answer. Here the question is unchanged and
-- the answer only grows, so a second pair of views would be two things to keep identical forever.
--
-- Wrapped in an explicit transaction, matching 0004 onward: the assertion block at the foot
-- raises, and without the wrapper a firing assertion would leave the schema half-changed.
-- ============================================================================
begin;

-- ============ Total score ============

-- `create or replace view` may only ADD columns, and only at the end, so every existing column
-- is restated exactly as 0016 wrote it. The window is evaluated after the grouping, which is why
-- it can order by the summed points.
create or replace view total_score_board as
select p.id, p.display_name, g.variant,
  coalesce(sum(gp.final_total), 0) as total_points,
  count(gp.game_id) as games_played,
  p.house,
  row_number() over (
    partition by g.variant
    order by coalesce(sum(gp.final_total), 0) desc, p.display_name asc, p.id asc
  ) as overall_rank
from players p
join game_players gp on gp.player_id = p.id
join games g on g.id = gp.game_id and g.status = 'ended'
group by p.id, p.display_name, g.variant, p.house;

create or replace view total_score_board_by_year as
select p.id, p.display_name, g.variant,
  academic_year_of(g.ended_at) as academic_year,
  coalesce(sum(gp.final_total), 0) as total_points,
  count(gp.game_id) as games_played,
  p.house,
  row_number() over (
    partition by g.variant, academic_year_of(g.ended_at)
    order by coalesce(sum(gp.final_total), 0) desc, p.display_name asc, p.id asc
  ) as overall_rank
from players p
join game_players gp on gp.player_id = p.id
join games g on g.id = gp.game_id and g.status = 'ended'
group by p.id, p.display_name, g.variant, academic_year_of(g.ended_at), p.house;

-- Restated rather than assumed to survive the replace. A view that lost this would read its base
-- tables as its OWNER and hand every caller the owner's access. Asserted at the foot as well.
alter view public.total_score_board         set (security_invoker = true);
alter view public.total_score_board_by_year set (security_invoker = true);

revoke all on public.total_score_board, public.total_score_board_by_year from anon, authenticated;
grant select on public.total_score_board, public.total_score_board_by_year to service_role;

-- ============ Pts per game and Notable wins ============

-- A function's returned row cannot be changed by `create or replace`, so both are dropped and
-- created again. Each body is 0016's, with one added column. A new function starts with a default
-- ACL, so the grants below are not optional.
drop function if exists public.points_per_game_board(int, text);

create function public.points_per_game_board(
  p_academic_year int default null,
  p_variant text default 'regular'
)
returns table (
  id uuid,
  display_name text,
  house text,
  avg_points numeric,
  games_counted bigint,
  overall_rank bigint
)
language sql stable security invoker set search_path = public as $$
  with ranked as (
    select
      gp.player_id,
      gp.final_total,
      row_number() over (
        partition by gp.player_id
        order by g.ended_at desc, g.id desc
      ) as recency
    from game_players gp
    join games g on g.id = gp.game_id
    where g.status = 'ended'
      and g.variant = p_variant
      and gp.final_total is not null
      and (
        p_academic_year is null
        or academic_year_of(g.ended_at) = p_academic_year
      )
  ), recent as (
    select * from ranked where recency <= 20
  )
  select
    p.id,
    p.display_name,
    p.house,
    avg(recent.final_total)::numeric as avg_points,
    count(*)::bigint as games_counted,
    -- The same four keys as the ORDER BY below, so the rank IS the row number of this result.
    row_number() over (
      order by avg(recent.final_total) desc, count(*) desc, p.display_name asc, p.id asc
    ) as overall_rank
  from recent
  join players p on p.id = recent.player_id
  group by p.id, p.display_name, p.house
  order by avg(recent.final_total) desc, count(*) desc, p.display_name asc, p.id asc
$$;

drop function if exists public.notable_wins_board(int, uuid[], text);

create function public.notable_wins_board(
  p_academic_year int default null,
  p_hand_ids uuid[] default array[]::uuid[],
  p_variant text default 'regular'
) returns table (
  claim_id uuid,
  player_id uuid,
  display_name text,
  house text,
  created_at timestamptz,
  hand_types jsonb,
  total_label_count bigint,
  selected_match_count bigint,
  overall_rank bigint
)
language sql stable security invoker set search_path = public as $$
  with selected as (
    select distinct h.id
    from unnest(coalesce(p_hand_ids, array[]::uuid[])) requested(id)
    join notable_hands h on h.id = requested.id
  ), selection as (
    select count(*)::bigint as filter_count from selected
  -- Which wins the caller could possibly be shown, decided BEFORE any labels are aggregated.
  -- The variant sits here with the year for the same reason 0012 put the year here: both live on
  -- `games`, and the planner cannot push either through the GROUP BY below.
  ), in_scope as (
    select nc.id as claim_id, nc.player_id, nc.created_at
    from notable_claims nc
    join games g on g.id = nc.game_id and g.status = 'ended' and g.variant = p_variant
    where p_academic_year is null
       or academic_year_of(g.ended_at) = p_academic_year
  ), labels as (
    select
      nct.claim_id,
      jsonb_agg(
        jsonb_build_object(
          'id', h.id,
          'name', h.name,
          'local_name', h.local_name,
          'rarity', h.rarity
        ) order by h.name, h.id
      ) as hand_types,
      count(*)::bigint as total_label_count,
      count(selected.id)::bigint as selected_match_count
    from notable_claim_types nct
    join in_scope on in_scope.claim_id = nct.claim_id
    join notable_hands h on h.id = nct.notable_hand_id
    left join selected on selected.id = nct.notable_hand_id
    group by nct.claim_id
  )
  select
    in_scope.claim_id,
    p.id as player_id,
    p.display_name,
    p.house,
    in_scope.created_at,
    labels.hand_types,
    labels.total_label_count,
    labels.selected_match_count,
    -- Ranked among the wins that passed the hand filter, which is what the WHERE below leaves:
    -- a window is evaluated after it. The same four keys as the ORDER BY, so the rank IS the row
    -- number of this result.
    row_number() over (
      order by
        case when selection.filter_count > 0 then labels.selected_match_count else 0 end desc,
        labels.total_label_count desc,
        in_scope.created_at desc,
        in_scope.claim_id asc
    ) as overall_rank
  from in_scope
  join labels on labels.claim_id = in_scope.claim_id
  join players p on p.id = in_scope.player_id
  cross join selection
  where selection.filter_count = 0 or labels.selected_match_count > 0
  order by
    case when selection.filter_count > 0 then labels.selected_match_count else 0 end desc,
    labels.total_label_count desc,
    in_scope.created_at desc,
    in_scope.claim_id asc
$$;

-- ============ hardening ============
-- Both functions are new to the catalog, so each carries its own grants. 0004 revoked the
-- schema-wide defaults, which makes an ungranted function executable by nobody.
revoke all privileges on function public.points_per_game_board(int, text) from public, anon, authenticated;
grant execute on function public.points_per_game_board(int, text) to service_role, postgres;

revoke all privileges on function public.notable_wins_board(int, uuid[], text) from public, anon, authenticated;
grant execute on function public.notable_wins_board(int, uuid[], text) to service_role, postgres;

-- ============ ASSERTIONS ============
do $$
declare
  r record;
begin
  if has_function_privilege('anon', 'public.points_per_game_board(integer,text)', 'execute')
     or has_function_privilege('authenticated', 'public.points_per_game_board(integer,text)', 'execute')
     or not has_function_privilege('service_role', 'public.points_per_game_board(integer,text)', 'execute')
     or has_function_privilege('anon', 'public.notable_wins_board(integer,uuid[],text)', 'execute')
     or has_function_privilege('authenticated', 'public.notable_wins_board(integer,uuid[],text)', 'execute')
     or not has_function_privilege('service_role', 'public.notable_wins_board(integer,uuid[],text)', 'execute')
  then
    raise exception 'ranked board function access is wrong';
  end if;

  -- Recreating a function resets every one of these to its default.
  if exists (
    select 1 from pg_proc p
    where p.oid in (
      'public.points_per_game_board(integer,text)'::regprocedure,
      'public.notable_wins_board(integer,uuid[],text)'::regprocedure
    ) and (p.prosecdef or not (p.proconfig @> array['search_path=public']))
  ) then
    raise exception 'standings query functions must retain security invoker and search_path=public';
  end if;

  for r in
    select c.oid, c.relname, c.reloptions
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('total_score_board', 'total_score_board_by_year')
  loop
    if r.reloptions is null or not (r.reloptions @> array['security_invoker=true']) then
      raise exception 'ranked view % is not security_invoker', r.relname;
    end if;
    if has_table_privilege('anon', r.oid, 'select') or has_table_privilege('authenticated', r.oid, 'select') then
      raise exception 'a browser role can select ranked view %', r.relname;
    end if;
    if not has_table_privilege('service_role', r.oid, 'select') then
      raise exception 'service_role cannot select ranked view %', r.relname;
    end if;
  end loop;

  -- BOTH halves of reading a security_invoker view (0009's lesson).
  if not has_function_privilege('service_role', 'public.academic_year_of(timestamptz)', 'execute') then
    raise exception 'service_role cannot execute academic_year_of, so the ranked views are unreadable';
  end if;

  -- The replace added a column and changed nothing else. Summed across variants, Total score must
  -- still agree with the all-games board player by player. Vacuous on a fresh replay, where no
  -- game has ended; not vacuous on hosted, which is why it is here as well as in the harness.
  if exists (
    select 1
    from lifetime_board l
    full join (
      select id, sum(total_points) as total_points, sum(games_played) as games_played
      from total_score_board group by id
    ) t on t.id = l.id
    where l.id is null or t.id is null
       or l.total_points <> t.total_points or l.games_played <> t.games_played
  ) then
    raise exception 'total_score_board no longer reconciles with lifetime_board';
  end if;

  -- Each ladder is numbered 1 to N with no gap and no repeat.
  if exists (
    select 1 from total_score_board
    group by variant
    having count(*) <> max(overall_rank) or count(*) <> count(distinct overall_rank) or min(overall_rank) <> 1
  ) then
    raise exception 'total_score_board ranks are not a clean 1..N per game';
  end if;
  if exists (
    select 1 from total_score_board_by_year
    group by variant, academic_year
    having count(*) <> max(overall_rank) or count(*) <> count(distinct overall_rank) or min(overall_rank) <> 1
  ) then
    raise exception 'total_score_board_by_year ranks are not a clean 1..N per game and year';
  end if;

  -- And the numbering follows the points: nobody is ranked above a player with more of them.
  if exists (
    select 1 from total_score_board a
    join total_score_board b on b.variant = a.variant
    where a.total_points > b.total_points and a.overall_rank > b.overall_rank
  ) then
    raise exception 'total_score_board ranks a player below somebody with fewer points';
  end if;

  -- The two function boards, read for both games across all time.
  for r in select v from (values ('regular'), ('fei')) ladders(v) loop
    if exists (
      select 1 from (
        select count(*) as n, max(overall_rank) as top, count(distinct overall_rank) as different
        from points_per_game_board(null, r.v)
      ) s where n <> coalesce(top, 0) or n <> different
    ) then
      raise exception 'points_per_game_board ranks are not a clean 1..N for %', r.v;
    end if;
    if exists (
      select 1 from (
        select count(*) as n, max(overall_rank) as top, count(distinct overall_rank) as different
        from notable_wins_board(null, array[]::uuid[], r.v)
      ) s where n <> coalesce(top, 0) or n <> different
    ) then
      raise exception 'notable_wins_board ranks are not a clean 1..N for %', r.v;
    end if;
  end loop;
end $$;

commit;
