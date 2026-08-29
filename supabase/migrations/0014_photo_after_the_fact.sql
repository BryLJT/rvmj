begin;

-- ---------------------------------------------------------------------------
-- 0014 — attaching a photo to a notable win AFTER the game has finished.
--
-- log_notable_win (0011) opens by refusing any game that is not active, which is correct for its
-- job: logging a hand at a live table. It is also exactly why attaching a photo to a finished
-- game's win had to be done by editing this database by hand on 2026-08-29.
--
-- This migration keeps that function's PERMISSION rule — you must have played in the game — and
-- drops its assumption about WHEN. A guard that encodes the moment as well as the permission
-- cannot be reused at a different moment.
-- ---------------------------------------------------------------------------

-- Who put the photo there. Not the same person as who logged the win, once a photo can be added
-- later by anyone at that table. Nullable, because most claims carry no photo at all.
alter table notable_claims add column photo_added_by uuid references players(id);

-- Every photo that exists today was attached at log time by the logger, so the column is TRUE for
-- history rather than merely empty for it. Without this, the app could not tell an existing photo
-- of your own from somebody else's, and would ask for confirmation on both or neither.
update notable_claims set photo_added_by = logged_by where photo_path is not null;

-- ---------------------------------------------------------------------------
-- Attach a photo to a claim that has none.
--
-- No games.status check, on purpose — see the header. The participant check is the same one
-- log_notable_win applies, reached through the claim's own game rather than a passed-in game id,
-- so the caller cannot name a game the claim does not belong to.
--
-- Refuses a claim that already has a photo. This feature fills a gap; it never overwrites. The
-- caller has already uploaded an object by the time this runs, so the refusal is also what tells
-- it to delete those bytes again.
--
-- The row is locked for update before anything is decided, so two players attaching at once
-- cannot both pass the "has no photo" test and leave one object orphaned in the bucket.
-- ---------------------------------------------------------------------------
create function public.add_notable_photo(
  p_claim_id uuid,
  p_actor uuid,
  p_photo_path text
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_game_id uuid;
  v_existing text;
begin
  if p_photo_path is null or length(trim(p_photo_path)) = 0 then
    raise exception 'a photo path is required';
  end if;

  select game_id, photo_path into v_game_id, v_existing
  from notable_claims where id = p_claim_id
  for update;
  if not found then raise exception 'no such win'; end if;

  perform 1 from game_players where game_id = v_game_id and player_id = p_actor;
  if not found then raise exception 'you did not play in this game'; end if;

  if v_existing is not null then raise exception 'this win already has a photo'; end if;

  update notable_claims
  set photo_path = p_photo_path, photo_added_by = p_actor
  where id = p_claim_id;
end $$;

-- ---------------------------------------------------------------------------
-- Removal widens to match.
--
-- 0005 restricted this to whoever LOGGED the claim. Once anyone at the table can attach a photo,
-- that rule would let a player attach a photo they were then locked out of removing.
--
-- Replaced rather than edited: 0005 has run on hosted, and an applied migration is never changed.
-- The signature is unchanged, so 0005's own function-count assertions still hold. Every property
-- is restated in full — language, security definer, search_path — because create or replace does
-- not inherit them, and dropping one silently would be invisible until it mattered.
-- ---------------------------------------------------------------------------
create or replace function public.clear_notable_photo(p_claim_id uuid, p_actor uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_path text;
  v_game_id uuid;
begin
  select photo_path, game_id into v_path, v_game_id
  from notable_claims where id = p_claim_id
  for update;
  if not found then raise exception 'no such win'; end if;

  perform 1 from game_players where game_id = v_game_id and player_id = p_actor;
  if not found then raise exception 'you did not play in this game'; end if;

  update notable_claims set photo_path = null, photo_added_by = null where id = p_claim_id;
  return v_path;
end $$;

-- ---------------------------------------------------------------------------
-- The logger records the new column too, so a photo attached at log time and one attached later
-- are described the same way and the column is never a half-truth.
--
-- Everything else here is 0011's text verbatim; only the insert's column list and values differ.
-- ---------------------------------------------------------------------------
create or replace function public.log_notable_win(
  p_game_id uuid,
  p_player_id uuid,
  p_notable_hand_ids uuid[],
  p_logged_by uuid,
  p_photo_path text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_hand_ids uuid[];
begin
  perform 1 from games
  where id = p_game_id and status = 'active' and mode = 'chips'
  for update;
  if not found then raise exception 'game is not an active chip game'; end if;

  perform 1 from game_players where game_id = p_game_id and player_id = p_player_id;
  if not found then raise exception 'claimed player is not in this game'; end if;
  perform 1 from game_players where game_id = p_game_id and player_id = p_logged_by;
  if not found then raise exception 'logger is not in this game'; end if;

  select array_agg(h.id order by h.name, h.id) into v_hand_ids
  from (
    select distinct requested.id
    from unnest(coalesce(p_notable_hand_ids, array[]::uuid[])) requested(id)
  ) requested
  join notable_hands h on h.id = requested.id;

  if coalesce(cardinality(v_hand_ids), 0) = 0 then
    raise exception 'choose at least one valid hand type';
  end if;

  insert into notable_claims (
    game_id, player_id, notable_hand_id, logged_by, photo_path, photo_added_by
  ) values (
    p_game_id, p_player_id, v_hand_ids[1], p_logged_by, p_photo_path,
    case when p_photo_path is null then null else p_logged_by end
  ) returning id into v_id;

  insert into notable_claim_types (claim_id, notable_hand_id)
  select v_id, unnest(v_hand_ids)
  on conflict (claim_id, notable_hand_id) do nothing;

  update games set last_activity_at = now() where id = p_game_id;
  return v_id;
end $$;

revoke all privileges on function public.add_notable_photo(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.add_notable_photo(uuid, uuid, text)
  to service_role, postgres;
revoke all privileges on function public.clear_notable_photo(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.clear_notable_photo(uuid, uuid)
  to service_role, postgres;

-- ---------------------------------------------------------------------------
-- This migration asserts its own outcome, so a later change that loosens it fails HERE rather
-- than in production. A create or replace that quietly dropped `security definer` or the pinned
-- search_path would otherwise leave no trace until something depended on it.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from pg_proc p
    where p.oid in (
      'public.add_notable_photo(uuid,uuid,text)'::regprocedure,
      'public.clear_notable_photo(uuid,uuid)'::regprocedure,
      'public.log_notable_win(uuid,uuid,uuid[],uuid,text)'::regprocedure
    )
      and (not p.prosecdef or not (p.proconfig @> array['search_path=public']))
  ) then
    raise exception 'photo functions must be security definer with search_path=public';
  end if;

  if has_function_privilege('anon', 'public.add_notable_photo(uuid,uuid,text)', 'execute')
     or has_function_privilege('authenticated', 'public.add_notable_photo(uuid,uuid,text)', 'execute')
     or not has_function_privilege('service_role', 'public.add_notable_photo(uuid,uuid,text)', 'execute')
     or has_function_privilege('anon', 'public.clear_notable_photo(uuid,uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.clear_notable_photo(uuid,uuid)', 'execute')
     or not has_function_privilege('service_role', 'public.clear_notable_photo(uuid,uuid)', 'execute')
  then
    raise exception 'photo function access is wrong';
  end if;

  -- The backfill is part of the contract, not a convenience: a photographed claim with nobody
  -- attributed would make the app's confirmation lie about whose photo it is.
  if exists (
    select 1 from notable_claims where photo_path is not null and photo_added_by is null
  ) then
    raise exception 'every photographed claim must record who attached it';
  end if;
end $$;

commit;
