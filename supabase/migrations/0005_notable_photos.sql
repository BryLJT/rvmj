-- ============================================================================
-- 0005 — notable-hand photos
--
-- Wrapped in an explicit transaction, matching 0004. This migration both DROPS a
-- function and carries assertion blocks that raise. Without the wrapper a firing
-- assertion would leave the drop and the added column already committed: the old
-- RPC gone, the grants unapplied, a half-migrated database — precisely the state
-- the assertions exist to prevent. Do not remove the begin/commit.
-- ============================================================================

begin;

-- ============ NOTABLE-HAND PHOTOS ============
-- One photo per claim. "One" is enforced structurally by there being a single column, not by
-- a constraint that a later migration could relax by accident.
alter table notable_claims add column photo_path text;

-- ---------------------------------------------------------------------------
-- The four-parameter function is DROPPED, not replaced.
--
-- 0004's normalize loop matches protected functions BY NAME and asserts it found exactly 15.
-- Leaving the old signature in place would put two `log_notable_claim` rows in pg_proc, so any
-- database rebuilt from these migrations counts 16 and aborts. Do NOT edit the 15 in 0004.
-- ---------------------------------------------------------------------------
drop function if exists log_notable_claim(uuid, uuid, uuid, uuid);

create function log_notable_claim(
  p_game_id uuid,
  p_player_id uuid,
  p_notable_hand_id uuid,
  p_logged_by uuid,
  p_photo_path text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform 1 from games
  where id = p_game_id and status = 'active' and mode = 'chips'
  for update;
  if not found then raise exception 'game is not an active chip game'; end if;

  perform 1 from game_players where game_id = p_game_id and player_id = p_player_id;
  if not found then raise exception 'claimed player is not in this game'; end if;
  perform 1 from game_players where game_id = p_game_id and player_id = p_logged_by;
  if not found then raise exception 'logger is not in this game'; end if;

  insert into notable_claims (game_id, player_id, notable_hand_id, logged_by, photo_path)
  values (p_game_id, p_player_id, p_notable_hand_id, p_logged_by, p_photo_path)
  returning id into v_id;
  update games set last_activity_at = now() where id = p_game_id;
  return v_id;
end $$;

-- Authorization lives HERE, not only in the server action. A rule enforced solely in
-- application code protects you exactly until someone adds a second caller.
--
-- Returns the freed path so the caller knows which object to delete. A claim that is yours but
-- has no photo is a successful no-op returning null, not an error.
create function clear_notable_photo(p_claim_id uuid, p_actor uuid) returns text
language plpgsql security definer set search_path = public as $$
declare v_path text;
begin
  select photo_path into v_path from notable_claims
  where id = p_claim_id and logged_by = p_actor
  for update;
  if not found then raise exception 'not your claim'; end if;

  update notable_claims set photo_path = null where id = p_claim_id;
  return v_path;
end $$;

-- ---------------------------------------------------------------------------
-- 0005 carries its own hardening. An applied migration cannot be extended, so the pattern from
-- 0004 is repeated here for the objects this migration introduces.
--
-- The count of 2 does double duty: if the old four-parameter overload had survived the drop
-- above, this loop would find 3 and fail here rather than in a confusing rebuild months later.
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
  v_count integer := 0;
begin
  for r in
    select p.oid::regprocedure::text as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('log_notable_claim', 'clear_notable_photo')
  loop
    execute format('revoke all privileges on function %s from public, anon, authenticated', r.signature);
    execute format('grant execute on function %s to service_role, postgres', r.signature);
    v_count := v_count + 1;
  end loop;
  if v_count <> 2 then
    raise exception 'expected to normalize 2 photo functions, found % (a stale log_notable_claim overload?)', v_count;
  end if;
end $$;

do $$
declare r record;
begin
  for r in
    select p.oid, p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('log_notable_claim', 'clear_notable_photo')
  loop
    if has_function_privilege('anon', r.oid, 'execute')
      or has_function_privilege('authenticated', r.oid, 'execute')
      or not has_function_privilege('service_role', r.oid, 'execute')
    then
      raise exception 'photo function access is wrong for %', r.proname;
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Private bucket. Limits are set here as well as in the server action: defence in depth, so a
-- bug in application validation cannot fill the bucket with arbitrary files.
--
-- NO storage policies are created, deliberately. Uploads are server-mediated and reads use
-- server-minted signed URLs, so no `anon` or `authenticated` role ever touches this bucket.
-- The absence of policies IS the design. Do not "fix" it by adding one.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('notable-photos', 'notable-photos', false, 2097152, array['image/webp'])
on conflict (id) do nothing;

commit;
