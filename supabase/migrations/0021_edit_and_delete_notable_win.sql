begin;

-- ---------------------------------------------------------------------------
-- 0021: change the hand tags of a notable win, or delete the win.
--
-- Until now a win could be logged and its photo could be added or removed, but nothing could
-- correct the tags or take back a win that should not exist. A wrong tag stayed forever.
--
-- Permission rule: the same one as the photo functions (0014). You must have played in the game the
-- win belongs to. It is read through the claim's own game, so the caller cannot name another game.
-- There is no status check on purpose. A win must stay fixable after the game has ended, which is
-- when most mistakes are noticed.
--
-- The row is locked first in both functions, so two players acting at once cannot interleave.
-- ---------------------------------------------------------------------------

-- Replace every tag on a win. Strict: an unknown hand id refuses the whole call. (log_notable_win
-- drops unknown ids silently. A silent drop on an EDIT would save fewer tags than the player ticked.)
create function public.update_notable_win_hands(
  p_claim_id uuid,
  p_actor uuid,
  p_hand_ids uuid[]
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_game_id uuid;
  v_requested uuid[];
  v_hand_ids uuid[];
begin
  select game_id into v_game_id
  from notable_claims where id = p_claim_id
  for update;
  if not found then raise exception 'no such win'; end if;

  perform 1 from game_players where game_id = v_game_id and player_id = p_actor;
  if not found then raise exception 'you did not play in this game'; end if;

  select array_agg(distinct requested.id) into v_requested
  from unnest(coalesce(p_hand_ids, array[]::uuid[])) requested(id)
  where requested.id is not null;

  if coalesce(cardinality(v_requested), 0) = 0 then
    raise exception 'choose at least one valid hand type';
  end if;

  select array_agg(h.id order by h.name, h.id) into v_hand_ids
  from notable_hands h where h.id = any(v_requested);

  if coalesce(cardinality(v_hand_ids), 0) <> cardinality(v_requested) then
    raise exception 'choose at least one valid hand type';
  end if;

  delete from notable_claim_types where claim_id = p_claim_id;
  insert into notable_claim_types (claim_id, notable_hand_id)
  select p_claim_id, unnest(v_hand_ids);

  -- The single-label column stays the first tag by name, exactly as log_notable_win sets it.
  update notable_claims set notable_hand_id = v_hand_ids[1] where id = p_claim_id;
end $$;

-- Delete a win. The tag rows and the historical-save record go with it (on delete cascade). The
-- photo path is returned so the caller can remove the stored file AFTER the row is gone: a failed
-- file delete then leaves a harmless orphan, never a win that points at a missing picture.
create function public.delete_notable_win(
  p_claim_id uuid,
  p_actor uuid
) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_game_id uuid;
  v_path text;
begin
  select game_id, photo_path into v_game_id, v_path
  from notable_claims where id = p_claim_id
  for update;
  if not found then raise exception 'no such win'; end if;

  perform 1 from game_players where game_id = v_game_id and player_id = p_actor;
  if not found then raise exception 'you did not play in this game'; end if;

  delete from notable_claims where id = p_claim_id;
  return v_path;
end $$;

revoke all privileges on function public.update_notable_win_hands(uuid, uuid, uuid[])
  from public, anon, authenticated;
grant execute on function public.update_notable_win_hands(uuid, uuid, uuid[])
  to service_role, postgres;
revoke all privileges on function public.delete_notable_win(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.delete_notable_win(uuid, uuid)
  to service_role, postgres;

-- The migration asserts its own outcome, like 0014.
do $$
declare f regprocedure;
begin
  foreach f in array array[
    'public.update_notable_win_hands(uuid,uuid,uuid[])'::regprocedure,
    'public.delete_notable_win(uuid,uuid)'::regprocedure
  ] loop
    if has_function_privilege('anon', f, 'execute')
       or has_function_privilege('authenticated', f, 'execute')
       or not has_function_privilege('service_role', f, 'execute')
       or not exists (
         select 1 from pg_proc where oid = f and prosecdef and proconfig @> array['search_path=public']
       )
    then
      raise exception 'unsafe win edit function %', f;
    end if;
  end loop;
end $$;

commit;
