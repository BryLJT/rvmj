-- Personal history reads are bounded. Historical saves never rewrite game results.
begin;
create index games_history_ended on public.games (ended_at desc, id desc) where status = 'ended';

create function public.personal_game_history(p_viewer uuid, p_before_time timestamptz default null, p_before_id uuid default null)
returns table(id uuid, mode text, variant text, ended_at timestamptz, players jsonb)
language sql stable security definer set search_path = public as $$
  select g.id, g.mode::text, g.variant, g.ended_at,
    (select jsonb_agg(jsonb_build_object('player_id',gp.player_id,'seat',gp.seat,'display_name',p.display_name,'final_total',gp.final_total)
      order by case gp.seat when 'E' then 1 when 'S' then 2 when 'W' then 3 else 4 end)
     from game_players gp join players p on p.id=gp.player_id where gp.game_id=g.id)
  from games g
  where g.status='ended' and g.ended_at is not null
    and exists(select 1 from game_players me where me.game_id=g.id and me.player_id=p_viewer)
    and ((p_before_time is null and p_before_id is null) or (g.ended_at,g.id)<(p_before_time,p_before_id))
  order by g.ended_at desc,g.id desc limit 21;
$$;

-- Persist the original photo intent separately from the mutable photo on the claim. A retry of
-- a completed save must not resurrect a photograph another participant later removed.
create table public.historical_notable_saves (
  claim_id uuid primary key references public.notable_claims(id) on delete cascade,
  photo_digest text,
  photo_extension text,
  photo_complete boolean not null,
  check ((photo_digest is null and photo_extension is null) or
    (photo_digest ~ '^[0-9a-f]{64}$' and photo_extension in ('webp','jpg')))
);
alter table public.historical_notable_saves enable row level security;
revoke all on public.historical_notable_saves from public,anon,authenticated;
grant all on public.historical_notable_saves to service_role;

create function public.save_historical_notable(p_claim_id uuid,p_game_id uuid,p_player_id uuid,p_actor uuid,p_hand_ids uuid[],p_photo_digest text default null,p_photo_extension text default null)
returns table(claim_id uuid,photo_complete boolean,upload_path text)
language plpgsql security definer set search_path = public as $$
declare
  v_game games%rowtype; v_claim notable_claims%rowtype; v_save historical_notable_saves%rowtype;
  v_hands uuid[]; v_existing uuid[];
begin
  -- Lock by identity first, then inspect the current row after any competing reopen commits.
  select * into v_game from games where id=p_game_id for update;
  if not found then raise exception 'game is unavailable'; end if;
  if not exists(select 1 from game_players where game_id=p_game_id and player_id=p_actor) then raise exception 'you did not play in this game'; end if;
  if not exists(select 1 from game_players where game_id=p_game_id and player_id=p_player_id) then raise exception 'winner did not play in this game'; end if;
  if p_claim_id is null then raise exception 'save id is required'; end if;
  select array_agg(distinct h order by h) into v_hands from unnest(p_hand_ids) h;
  if coalesce(cardinality(v_hands),0)=0 or array_position(v_hands,null) is not null
    or (select count(*) from notable_hands where id=any(v_hands))<>cardinality(v_hands)
    then raise exception 'choose valid hand types'; end if;
  if (p_photo_digest is null)<>(p_photo_extension is null) or (p_photo_digest is not null and
    (p_photo_digest !~ '^[0-9a-f]{64}$' or p_photo_extension not in ('webp','jpg')))
    then raise exception 'invalid photo intent'; end if;

  select * into v_claim from notable_claims where id=p_claim_id;
  if found then
    select * into v_save from historical_notable_saves where historical_notable_saves.claim_id=p_claim_id;
    select array_agg(notable_hand_id order by notable_hand_id) into v_existing from notable_claim_types where notable_claim_types.claim_id=p_claim_id;
    if v_save.claim_id is null or v_claim.game_id<>p_game_id or v_claim.player_id<>p_player_id or v_claim.logged_by<>p_actor
      or v_existing is distinct from v_hands or v_save.photo_digest is distinct from p_photo_digest
      or v_save.photo_extension is distinct from p_photo_extension then raise exception 'save id belongs to a different win'; end if;
    -- A confirmed replay is still the same win even if the game reopened or its photo changed.
  else
    if v_game.status<>'ended' or v_game.mode<>'chips' or v_game.ended_at is null then raise exception 'game is not an ended chip game'; end if;
    insert into notable_claims(id,game_id,player_id,notable_hand_id,logged_by,created_at)
      values(p_claim_id,p_game_id,p_player_id,v_hands[1],p_actor,v_game.ended_at);
    insert into notable_claim_types(claim_id,notable_hand_id) select p_claim_id,unnest(v_hands) on conflict do nothing;
    insert into historical_notable_saves values(p_claim_id,p_photo_digest,p_photo_extension,p_photo_digest is null)
      returning * into v_save;
  end if;
  return query select p_claim_id,v_save.photo_complete,
    case when v_save.photo_digest is null then null else p_game_id::text || '/' || p_claim_id::text || '-history.' || v_save.photo_extension end;
end $$;

create function public.finish_historical_photo(p_claim_id uuid,p_actor uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_claim notable_claims%rowtype; v_save historical_notable_saves%rowtype; v_path text;
begin
  select * into v_claim from notable_claims where id=p_claim_id for update;
  if not found or v_claim.logged_by<>p_actor or not exists(select 1 from game_players where game_id=v_claim.game_id and player_id=p_actor)
    then raise exception 'win is unavailable'; end if;
  select * into v_save from historical_notable_saves where claim_id=p_claim_id for update;
  if not found or v_save.photo_digest is null then raise exception 'no historical photo requested'; end if;
  v_path:=v_claim.game_id::text || '/' || p_claim_id::text || '-history.' || v_save.photo_extension;
  if v_save.photo_complete then return v_claim.photo_path; end if;
  -- A competing photo is never overwritten. Return its path so only the unused upload is removed.
  if v_claim.photo_path is null then
    update notable_claims set photo_path=v_path,photo_added_by=p_actor where id=p_claim_id;
    v_claim.photo_path:=v_path;
  end if;
  update historical_notable_saves set photo_complete=true where claim_id=p_claim_id;
  return v_claim.photo_path;
end $$;

revoke all on function public.personal_game_history(uuid,timestamptz,uuid) from public,anon,authenticated;
revoke all on function public.save_historical_notable(uuid,uuid,uuid,uuid,uuid[],text,text) from public,anon,authenticated;
revoke all on function public.finish_historical_photo(uuid,uuid) from public,anon,authenticated;
grant execute on function public.personal_game_history(uuid,timestamptz,uuid) to service_role,postgres;
grant execute on function public.save_historical_notable(uuid,uuid,uuid,uuid,uuid[],text,text) to service_role,postgres;
grant execute on function public.finish_historical_photo(uuid,uuid) to service_role,postgres;
do $$
declare f regprocedure;
begin
  foreach f in array array['public.personal_game_history(uuid,timestamptz,uuid)'::regprocedure,'public.save_historical_notable(uuid,uuid,uuid,uuid,uuid[],text,text)'::regprocedure,'public.finish_historical_photo(uuid,uuid)'::regprocedure] loop
    if has_function_privilege('anon',f,'execute') or has_function_privilege('authenticated',f,'execute')
      or not has_function_privilege('service_role',f,'execute') or not exists(select 1 from pg_proc where oid=f and prosecdef and proconfig @> array['search_path=public']) then raise exception 'unsafe history function %',f; end if;
  end loop;
end $$;
commit;
