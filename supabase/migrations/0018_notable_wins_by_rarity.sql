-- ============================================================================
-- 0018 — Notable wins: rarest first, then most tags
--
-- Bryan, 2026-11-13: sort notable hands by rarity, Legendary on top, and inside each rarity by
-- the number of tags. The photo archive applies the same rule in the app; this is the board's half.
--
-- A win's rarity is the rarity of its RAREST tag. A Legendary hand that also happened to be
-- All Pungs is still a Legendary hand, and ranking it by its least impressive tag would bury it.
--
-- The new order, every key strictly before the next:
--   1. rarest tag              legendary, then rare, then uncommon;
--   2. selected matches        only when hand types are selected, as before;
--   3. tag count               most first, as before;
--   4. newest, then claim id   as before, so ties stay stable from one read to the next.
-- The selected-match key keeps its old job of floating the wins that match MORE of a filter, but
-- now inside a rarity rather than above it: Bryan asked for rarity first, and a filter is a view
-- of the same board, not a different ordering principle.
--
-- `overall_rank` (0017) is the row number of this same order, so it moves with it. Both are
-- written from one expression list below, and the assertions at the foot hold them together.
--
-- Same arguments, same returned row: `create or replace` keeps the grants, and the deployed app
-- keeps working across it. It simply receives the rows in the new order, which it already shows as
-- given. So this can be applied before or after the app change; nothing breaks in between.
-- ============================================================================
begin;

-- The catalogue's three rarities as a number, highest first. A function rather than a CASE
-- repeated in two places, so the ORDER BY and the window below cannot drift apart. An unknown
-- value would be a catalogue the CHECK on notable_hands.rarity forbids; it sorts last regardless.
create or replace function public.notable_rarity_rank(p_rarity text) returns int
language sql immutable set search_path = public as $$
  select case p_rarity when 'legendary' then 3 when 'rare' then 2 when 'uncommon' then 1 else 0 end
$$;

revoke all privileges on function public.notable_rarity_rank(text) from public, anon, authenticated;
grant execute on function public.notable_rarity_rank(text) to service_role, postgres;

create or replace function public.notable_wins_board(
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
  -- Which wins the caller could possibly be shown, decided BEFORE any labels are aggregated
  -- (0012, 0016): the year and the variant live on `games`, and the planner cannot push either
  -- through the GROUP BY below.
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
      count(selected.id)::bigint as selected_match_count,
      -- Over EVERY tag the win carries, not only the selected ones: a filter narrows which wins
      -- are shown, never what a win is.
      max(notable_rarity_rank(h.rarity)) as rarity_rank
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
    -- The same five keys as the ORDER BY, so the rank IS the row number of this result.
    row_number() over (
      order by
        labels.rarity_rank desc,
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
    labels.rarity_rank desc,
    case when selection.filter_count > 0 then labels.selected_match_count else 0 end desc,
    labels.total_label_count desc,
    in_scope.created_at desc,
    in_scope.claim_id asc
$$;

-- `create or replace` keeps the existing grants. Restated anyway so this file alone says who may
-- call the board, and so the assertions below check a state this migration wrote.
revoke all privileges on function public.notable_wins_board(int, uuid[], text) from public, anon, authenticated;
grant execute on function public.notable_wins_board(int, uuid[], text) to service_role, postgres;

-- ============ ASSERTIONS ============
do $$
declare
  r record;
begin
  if has_function_privilege('anon', 'public.notable_wins_board(integer,uuid[],text)', 'execute')
     or has_function_privilege('authenticated', 'public.notable_wins_board(integer,uuid[],text)', 'execute')
     or not has_function_privilege('service_role', 'public.notable_wins_board(integer,uuid[],text)', 'execute')
     or has_function_privilege('anon', 'public.notable_rarity_rank(text)', 'execute')
     or has_function_privilege('authenticated', 'public.notable_rarity_rank(text)', 'execute')
     or not has_function_privilege('service_role', 'public.notable_rarity_rank(text)', 'execute')
  then
    raise exception 'notable wins ordering function access is wrong';
  end if;

  if exists (
    select 1 from pg_proc p
    where p.oid = 'public.notable_wins_board(integer,uuid[],text)'::regprocedure
      and (p.prosecdef or not (p.proconfig @> array['search_path=public']))
  ) then
    raise exception 'notable_wins_board must retain security invoker and search_path=public';
  end if;

  -- Every rarity the catalogue can hold has its own place, highest first.
  if not (notable_rarity_rank('legendary') > notable_rarity_rank('rare')
          and notable_rarity_rank('rare') > notable_rarity_rank('uncommon')
          and notable_rarity_rank('uncommon') > 0) then
    raise exception 'rarity ranks are out of order';
  end if;

  -- Not vacuous on hosted: each ladder is still numbered 1..N, and nothing rarer sits below
  -- anything less rare.
  for r in select v from (values ('regular'), ('fei')) ladders(v) loop
    if exists (
      select 1 from (
        select count(*) as n, max(overall_rank) as top, count(distinct overall_rank) as different
        from notable_wins_board(null, array[]::uuid[], r.v)
      ) s where n <> coalesce(top, 0) or n <> different
    ) then
      raise exception 'notable_wins_board ranks are not a clean 1..N for %', r.v;
    end if;
    if exists (
      with board as (
        select b.overall_rank,
          (select max(notable_rarity_rank(t->>'rarity')) from jsonb_array_elements(b.hand_types) t) as rarity_rank
        from notable_wins_board(null, array[]::uuid[], r.v) b
      )
      select 1 from board a join board b
        on a.rarity_rank > b.rarity_rank and a.overall_rank > b.overall_rank
    ) then
      raise exception 'notable_wins_board ranks a rarer win below a less rare one for %', r.v;
    end if;
  end loop;
end $$;

commit;
