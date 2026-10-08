-- ============================================================================
-- 0016 — game variant: Regular and 8 Fei are separate ladders
--
-- Bryan, 2026-10-07/08: "8 fei open american" is a separate game mode played by similar rules
-- with the same chips, and it gets its own leaderboard. A match saved as a fei game counts ONLY
-- on the fei boards; the regular boards ignore it. The table says which game it was at the very
-- end, in a question asked when End match is pressed.
--
-- `variant` is deliberately NOT `mode`. `mode` (chips / app) says how a match is SCORED; `variant`
-- says which GAME was played. A fei match is still a chip match, counted and balanced exactly like
-- a regular one, so the two are independent and one column cannot carry both.
--
-- The variant lives on the match and nowhere else. A score, a notable win and a photograph all
-- reach it through their game, so they cannot disagree about which ladder they belong to.
--
-- MIGRATE BEFORE DEPLOY, and the currently deployed app keeps working across it:
--   * the column defaults to 'regular', which is true of every match saved so far (Bryan
--     confirmed on 2026-10-08 that no fei game has been saved yet);
--   * the three functions whose signatures grow each take the new argument LAST, WITH A DEFAULT,
--     so a caller that still sends the old arguments resolves to the new function and gets the
--     regular game. That is the opposite of 0007, which removed functions the deployed app still
--     called and so had to go out code-first;
--   * the old board views (lifetime_board, lifetime_board_by_year, academic_years) are left
--     exactly as they are. They count every match regardless of variant, which is correct for as
--     long as no fei match exists, and the new app stops reading them. A later migration with its
--     own reason to touch them may drop them.
--
-- The NEW app does depend on this migration: it reads games.variant and the three new views, so
-- deploying it first would fail every board and the live match screen.
--
-- Wrapped in an explicit transaction, matching 0004 onward: the assertion block at the foot
-- raises, and without the wrapper a firing assertion would leave the schema half-changed.
-- ============================================================================
begin;

-- ============ the variant, on the match ============

alter table games add column variant text not null default 'regular'
  check (variant in ('regular', 'fei'));
comment on column games.variant is
  'which game was played: regular or fei. Written once, by end_chip_game, from the answer the table gives when the match is ended. Only meaningful on an ended game.';

-- ============ ending a chip match now records which game it was ============

-- The signature grows, so this is a drop and create rather than a replace, and a new function
-- starts with a default ACL: the grants below are not optional.
--
-- The body is 0007's, unchanged, plus the variant: validated before anything is written, and
-- stored in the SAME update that marks the match ended, so a match can never exist as finished
-- but unlabelled.
drop function if exists end_chip_game(uuid, uuid);

create function end_chip_game(p_game_id uuid, p_player_id uuid, p_variant text default 'regular') returns text
language plpgsql security definer set search_path = public as $$
declare v_game games%rowtype; v_seat text; v_stack int; v_zero int;
begin
  select * into v_game from games
  where id = p_game_id and status = 'active' and mode = 'chips' for update;
  if not found then raise exception 'game is not an active chip game'; end if;
  -- Order matters: "nothing to end" before "not yours to end". A reopened match has its counts
  -- cleared but keeps whatever pending_proposed_by the previous settlement left behind, and that
  -- leftover must read as inert rather than as a standing permission.
  if v_game.pending_counts is null then raise exception 'no counted result to end this match with'; end if;
  if v_game.pending_proposed_by is distinct from p_player_id then
    raise exception 'only the player who entered the counts can end the match';
  end if;
  -- After the permission checks, so somebody who may not end this match is told that rather than
  -- being told about an argument. The column's own check constraint would refuse a bad value too,
  -- but only after the four result rows had been written and with a message nobody could read.
  if p_variant is null or p_variant not in ('regular', 'fei') then
    raise exception 'unknown game variant %', coalesce(p_variant, '(none)');
  end if;
  -- finalize: write counts + derived totals for all four seats, one transaction
  foreach v_seat in array array['E','S','W','N'] loop
    v_stack := (v_game.pending_counts->v_seat->>'1')::int
             + 10  * (v_game.pending_counts->v_seat->>'10')::int
             + 50  * (v_game.pending_counts->v_seat->>'50')::int
             + 100 * (v_game.pending_counts->v_seat->>'100')::int;
    update game_players set
      chip_1   = (v_game.pending_counts->v_seat->>'1')::int,
      chip_10  = (v_game.pending_counts->v_seat->>'10')::int,
      chip_50  = (v_game.pending_counts->v_seat->>'50')::int,
      chip_100 = (v_game.pending_counts->v_seat->>'100')::int,
      final_total = v_stack - 400
    where game_id = p_game_id and seat = v_seat;
  end loop;
  -- should-never-happen backstop: conservation at propose time guarantees this sums to zero;
  -- if it does not, something bypassed propose_chip_counts. The caller alerts Telegram.
  select sum(final_total) into v_zero from game_players where game_id = p_game_id;
  if v_zero <> 0 then
    raise exception 'should-never-happen: chip finalize sums to % (expected 0)', v_zero;
  end if;
  -- Written on EVERY end, not only the first. A match reopened inside the hour and ended again
  -- is asked the question again, and this is what lets the second answer correct the first.
  update games set status = 'ended', ended_at = now(), variant = p_variant,
    pending_counts = null, pending_proposed_by = null
  where id = p_game_id;
  return 'ended';
end $$;

-- ============ Total score, one ladder per variant ============

-- SEPARATE views, not replacements, for the reason 0008 gave: the boards the deployed app reads
-- stay provably untouched by this migration.
--
-- A player who has played both games gets one row per variant here, and the page always asks for
-- exactly one variant, so a reader never sees the two side by side.
create view total_score_board as
select p.id, p.display_name, g.variant,
  coalesce(sum(gp.final_total), 0) as total_points,
  count(gp.game_id) as games_played,
  p.house
from players p
join game_players gp on gp.player_id = p.id
join games g on g.id = gp.game_id and g.status = 'ended'
group by p.id, p.display_name, g.variant, p.house;

create view total_score_board_by_year as
select p.id, p.display_name, g.variant,
  academic_year_of(g.ended_at) as academic_year,
  coalesce(sum(gp.final_total), 0) as total_points,
  count(gp.game_id) as games_played,
  p.house
from players p
join game_players gp on gp.player_id = p.id
join games g on g.id = gp.game_id and g.status = 'ended'
group by p.id, p.display_name, g.variant, academic_year_of(g.ended_at), p.house;

-- Which year pills to draw, per variant. A year that only ever saw regular games must not offer
-- itself on the fei ladder, where it would open onto an empty board.
create view academic_years_by_variant as
select distinct g.variant, academic_year_of(g.ended_at) as academic_year
from games g
where g.status = 'ended';

-- A view created without this reads its base tables as its OWNER, which would hand every caller
-- the owner's access. Applied here because a new view has no reloptions at all.
alter view public.total_score_board          set (security_invoker = true);
alter view public.total_score_board_by_year  set (security_invoker = true);
alter view public.academic_years_by_variant  set (security_invoker = true);

-- Server-read only, exactly like 0008's views: the boards are rendered on the server with the
-- service role, so no browser role is granted anything. EXECUTE on academic_year_of, which a
-- security_invoker view needs as well as SELECT, was granted to service_role by 0009.
revoke all on public.total_score_board, public.total_score_board_by_year, public.academic_years_by_variant
  from anon, authenticated;
grant select on public.total_score_board, public.total_score_board_by_year, public.academic_years_by_variant
  to service_role;

-- ============ Pts per game and Notable wins, one ladder per variant ============

-- Both bodies are 0012's with one added condition each. The variant is applied BEFORE the
-- twenty-game window is cut, so a player's "latest 20" are their latest twenty games OF THAT
-- VARIANT. Filtering afterwards would let fei games use up slots on the regular ladder.
drop function if exists public.points_per_game_board(int);

create function public.points_per_game_board(
  p_academic_year int default null,
  p_variant text default 'regular'
)
returns table (
  id uuid,
  display_name text,
  house text,
  avg_points numeric,
  games_counted bigint
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
    count(*)::bigint as games_counted
  from recent
  join players p on p.id = recent.player_id
  group by p.id, p.display_name, p.house
  order by avg(recent.final_total) desc, count(*) desc, p.display_name asc, p.id asc
$$;

drop function if exists public.notable_wins_board(int, uuid[]);

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
  selected_match_count bigint
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
    labels.selected_match_count
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
-- All three functions are new to the catalog (each was dropped and recreated with a longer
-- signature), so each carries its own grants. 0004 revoked the schema-wide defaults, which makes
-- an ungranted function executable by nobody rather than by everybody.
revoke all privileges on function public.end_chip_game(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.end_chip_game(uuid, uuid, text) to service_role, postgres;

revoke all privileges on function public.points_per_game_board(int, text) from public, anon, authenticated;
grant execute on function public.points_per_game_board(int, text) to service_role, postgres;

revoke all privileges on function public.notable_wins_board(int, uuid[], text) from public, anon, authenticated;
grant execute on function public.notable_wins_board(int, uuid[], text) to service_role, postgres;

-- ============ ASSERTIONS ============
do $$
declare
  r record;
begin
  -- Every match saved before this migration is a regular game. True by the column default, and
  -- asserted so that a later edit which backfilled anything else would have to come here and say so.
  if exists (select 1 from games where variant <> 'regular') then
    raise exception 'a pre-existing match was not filed as a regular game';
  end if;

  -- The shorter signatures are GONE, not merely shadowed. A surviving two-argument end_chip_game
  -- would still be callable by the service role and would end a match without the question ever
  -- having an answer; the surviving board functions would count both ladders as one.
  if to_regprocedure('public.end_chip_game(uuid,uuid)') is not null
     or to_regprocedure('public.points_per_game_board(integer)') is not null
     or to_regprocedure('public.notable_wins_board(integer,uuid[])') is not null
  then
    raise exception 'a pre-variant function signature survived';
  end if;

  if has_function_privilege('anon', 'public.end_chip_game(uuid,uuid,text)', 'execute')
     or has_function_privilege('authenticated', 'public.end_chip_game(uuid,uuid,text)', 'execute')
     or not has_function_privilege('service_role', 'public.end_chip_game(uuid,uuid,text)', 'execute')
     or has_function_privilege('anon', 'public.points_per_game_board(integer,text)', 'execute')
     or has_function_privilege('authenticated', 'public.points_per_game_board(integer,text)', 'execute')
     or not has_function_privilege('service_role', 'public.points_per_game_board(integer,text)', 'execute')
     or has_function_privilege('anon', 'public.notable_wins_board(integer,uuid[],text)', 'execute')
     or has_function_privilege('authenticated', 'public.notable_wins_board(integer,uuid[],text)', 'execute')
     or not has_function_privilege('service_role', 'public.notable_wins_board(integer,uuid[],text)', 'execute')
  then
    raise exception 'variant function access is wrong';
  end if;

  -- The two board functions stay security invoker; ending a match stays security definer. Both
  -- keep search_path pinned. Recreating a function resets every one of these to its default.
  if exists (
    select 1 from pg_proc p
    where p.oid in (
      'public.points_per_game_board(integer,text)'::regprocedure,
      'public.notable_wins_board(integer,uuid[],text)'::regprocedure
    ) and (p.prosecdef or not (p.proconfig @> array['search_path=public']))
  ) then
    raise exception 'standings query functions must retain security invoker and search_path=public';
  end if;
  if exists (
    select 1 from pg_proc p
    where p.oid = 'public.end_chip_game(uuid,uuid,text)'::regprocedure
      and (not p.prosecdef or not (p.proconfig @> array['search_path=public']))
  ) then
    raise exception 'end_chip_game must retain security definer and search_path=public';
  end if;

  for r in
    select c.oid, c.relname, c.reloptions
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('total_score_board', 'total_score_board_by_year', 'academic_years_by_variant')
  loop
    if r.reloptions is null or not (r.reloptions @> array['security_invoker=true']) then
      raise exception 'variant view % is not security_invoker', r.relname;
    end if;
    if has_table_privilege('anon', r.oid, 'select') or has_table_privilege('authenticated', r.oid, 'select') then
      raise exception 'a browser role can select variant view %', r.relname;
    end if;
    if not has_table_privilege('service_role', r.oid, 'select') then
      raise exception 'service_role cannot select variant view %', r.relname;
    end if;
  end loop;

  -- BOTH halves of reading a security_invoker view (0009's lesson): SELECT on the view above, and
  -- EXECUTE on the function its body calls. 0009 granted this; asserted here because these views
  -- are unreadable without it and nothing in this file grants it.
  if not has_function_privilege('service_role', 'public.academic_year_of(timestamptz)', 'execute') then
    raise exception 'service_role cannot execute academic_year_of, so the variant views are unreadable';
  end if;

  -- Reconciliation against the boards the deployed app is reading right now. Summed across
  -- variants, the new board must agree with the old one player by player, or a match was dropped
  -- or counted twice in the move. Vacuous on a fresh replay, where no game has ended; not vacuous
  -- on hosted, which is why it is here as well as in the test harness.
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
    raise exception 'total_score_board does not reconcile with lifetime_board';
  end if;
  if exists (
    select 1
    from lifetime_board_by_year l
    full join (
      select id, academic_year, sum(total_points) as total_points, sum(games_played) as games_played
      from total_score_board_by_year group by id, academic_year
    ) t on t.id = l.id and t.academic_year = l.academic_year
    where l.id is null or t.id is null
       or l.total_points <> t.total_points or l.games_played <> t.games_played
  ) then
    raise exception 'total_score_board_by_year does not reconcile with lifetime_board_by_year';
  end if;
end $$;

commit;
