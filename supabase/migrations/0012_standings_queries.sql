begin;

create function public.points_per_game_board(p_academic_year int default null)
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

create function public.notable_wins_board(
  p_academic_year int default null,
  p_hand_ids uuid[] default array[]::uuid[]
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
  -- Grouping every notable_claim_types row ever written and filtering afterwards made one page
  -- view cost a full scan of every label ever logged: the year predicate lives on `games`, so the
  -- planner cannot push it through the GROUP BY, and the caller's row cap is applied later still.
  -- The board is read on every home view, with all three tabs prefetched, so that scan grew with
  -- the whole history on a page nobody had to ask for.
  ), in_scope as (
    select nc.id as claim_id, nc.player_id, nc.created_at
    from notable_claims nc
    join games g on g.id = nc.game_id and g.status = 'ended'
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

revoke all privileges on function public.points_per_game_board(int)
  from public, anon, authenticated;
grant execute on function public.points_per_game_board(int)
  to service_role, postgres;

revoke all privileges on function public.notable_wins_board(int, uuid[])
  from public, anon, authenticated;
grant execute on function public.notable_wins_board(int, uuid[])
  to service_role, postgres;

do $$
begin
  if has_function_privilege('anon', 'public.points_per_game_board(integer)', 'execute')
     or has_function_privilege('authenticated', 'public.points_per_game_board(integer)', 'execute')
     or not has_function_privilege('service_role', 'public.points_per_game_board(integer)', 'execute')
     or has_function_privilege('anon', 'public.notable_wins_board(integer,uuid[])', 'execute')
     or has_function_privilege('authenticated', 'public.notable_wins_board(integer,uuid[])', 'execute')
     or not has_function_privilege('service_role', 'public.notable_wins_board(integer,uuid[])', 'execute')
  then
    raise exception 'standings query function access is wrong';
  end if;

  if exists (
    select 1
    from pg_proc p
    where p.oid in (
      'public.points_per_game_board(integer)'::regprocedure,
      'public.notable_wins_board(integer,uuid[])'::regprocedure
    )
      and (p.prosecdef or not (p.proconfig @> array['search_path=public']))
  ) then
    raise exception 'standings query functions must retain security invoker and search_path=public';
  end if;
end $$;

commit;
