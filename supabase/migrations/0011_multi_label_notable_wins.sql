-- ============================================================================
-- 0011 — store multiple labels on one notable win while retaining the legacy label
--
-- `notable_claims.notable_hand_id` remains the deployed application's compatible single-label
-- projection. The join table is additive; the new RPC stores every valid distinct label and the
-- old RPC delegates to it with one label. That is what lets the CURRENTLY deployed application
-- keep working after this migration runs.
--
-- APPLY THIS MIGRATION BEFORE DEPLOYING THE APPLICATION THAT DEPENDS ON IT. The compatibility
-- above runs one way only. The new application hard-depends on objects created here:
--   * `log_notable_win(uuid, uuid, uuid[], uuid, text)`  — src/lib/actions/game.ts
--   * `notable_claim_types(notable_hand_id)`             — src/app/game/[id]/ChipLive.tsx
--   * `notable_claim_types(notable_hands(name))`         — src/app/hands/page.tsx
-- Deployed ahead of this migration, notable logging fails, the hand gallery errors, and the live
-- chip screen cannot end or count a game. Migrate first, then deploy.
-- ============================================================================

begin;

create table public.notable_claim_types (
  claim_id uuid not null references public.notable_claims(id) on delete cascade,
  notable_hand_id uuid not null references public.notable_hands(id),
  primary key (claim_id, notable_hand_id)
);
create index notable_claim_types_by_hand
  on public.notable_claim_types (notable_hand_id, claim_id);

insert into public.notable_claim_types (claim_id, notable_hand_id)
select id, notable_hand_id from public.notable_claims;

do $$
begin
  if (select count(*) from public.notable_claims)
     <> (select count(distinct claim_id) from public.notable_claim_types) then
    raise exception 'not every existing notable win was backfilled';
  end if;
  if exists (
    select claim_id from public.notable_claim_types
    group by claim_id having count(*) <> 1
  ) then
    raise exception 'an existing notable win did not receive exactly one label';
  end if;
end $$;

-- A call that began before this migration can resume with the old log_notable_claim body after
-- the FK lock is released. The bridge trigger gives that legacy insert its one compatible label;
-- the new multi-label RPC below uses conflict-safe inserts because it writes that first label too.
create function public.sync_notable_claim_type() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.notable_claim_types (claim_id, notable_hand_id)
  values (new.id, new.notable_hand_id)
  on conflict (claim_id, notable_hand_id) do nothing;
  return new;
end $$;

create trigger sync_notable_claim_type_after_insert
after insert on public.notable_claims
for each row execute function public.sync_notable_claim_type();

create function public.log_notable_win(
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
    game_id, player_id, notable_hand_id, logged_by, photo_path
  ) values (
    p_game_id, p_player_id, v_hand_ids[1], p_logged_by, p_photo_path
  ) returning id into v_id;

  insert into notable_claim_types (claim_id, notable_hand_id)
  select v_id, unnest(v_hand_ids)
  on conflict (claim_id, notable_hand_id) do nothing;

  update games set last_activity_at = now() where id = p_game_id;
  return v_id;
end $$;

create or replace function public.log_notable_claim(
  p_game_id uuid,
  p_player_id uuid,
  p_notable_hand_id uuid,
  p_logged_by uuid,
  p_photo_path text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
begin
  return log_notable_win(
    p_game_id,
    p_player_id,
    array[p_notable_hand_id],
    p_logged_by,
    p_photo_path
  );
end $$;

alter table public.notable_claim_types enable row level security;
-- Deliberately as open as its PARENT. `read notable_claims` (0001) is `using (true)` for every
-- authenticated user, because watching a game you are not seated at is a supported thing to do:
-- see src/app/game/[id]/page.tsx ("Viewing a match does not depend on who you are") and
-- src/app/t/[secret]/page.tsx ("Everyone can still look; only East can end it").
--
-- A participant-only rule here leaks nothing extra — the claim's existence is already readable,
-- and this child row only names which hand types that claim carries. What it does instead is hand
-- a spectator claims with an empty label list, which the live chip screen cannot tell apart from a
-- broken read: it fails sync and disables "End game · count chips" for the whole table. The app is
-- now resilient to that on its own, and this policy makes sure it never arises.
create policy "read notable_claim_types"
  on public.notable_claim_types for select to authenticated
  using (true);

revoke all on public.notable_claim_types from public, anon, authenticated;
grant select on public.notable_claim_types to authenticated;
grant all privileges on public.notable_claim_types to service_role;

revoke all privileges on function public.log_notable_win(uuid, uuid, uuid[], uuid, text)
  from public, anon, authenticated;
grant execute on function public.log_notable_win(uuid, uuid, uuid[], uuid, text)
  to service_role, postgres;
revoke all privileges on function public.log_notable_claim(uuid, uuid, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.log_notable_claim(uuid, uuid, uuid, uuid, text)
  to service_role, postgres;
revoke all privileges on function public.sync_notable_claim_type()
  from public, anon, authenticated, service_role;

-- Every future migration is independently responsible for its access model. Keep the checks
-- beside the new objects so a hosted database with broad historical defaults cannot drift.
do $$
declare
  v_policy_count integer;
  v_function_count integer;
begin
  if not (select relrowsecurity from pg_class where oid = 'public.notable_claim_types'::regclass) then
    raise exception 'notable_claim_types must keep RLS enabled';
  end if;

  select count(*) into v_policy_count
  from pg_policies
  where schemaname = 'public'
    and tablename = 'notable_claim_types';
  if v_policy_count <> 1 or not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'notable_claim_types'
      and policyname = 'read notable_claim_types'
      and cmd = 'SELECT'
      and roles = array['authenticated']::name[]
      and qual = 'true'
  ) then
    raise exception 'expected exactly one authenticated-read policy, found %', v_policy_count;
  end if;

  if has_table_privilege('anon', 'public.notable_claim_types',
      'select,insert,update,delete,truncate,references,trigger')
     or has_table_privilege('authenticated', 'public.notable_claim_types',
      'insert,update,delete,truncate,references,trigger') then
    raise exception 'browser role has unsafe notable_claim_types access';
  end if;
  if not has_table_privilege('authenticated', 'public.notable_claim_types', 'select') then
    raise exception 'authenticated lacks notable_claim_types SELECT';
  end if;
  if not (
    select bool_and(has_table_privilege('service_role', 'public.notable_claim_types', privilege))
    from unnest(array['select','insert','update','delete','truncate','references','trigger']) privilege
  ) then
    raise exception 'service_role lacks full notable_claim_types access';
  end if;

  if has_function_privilege('anon', 'public.log_notable_win(uuid,uuid,uuid[],uuid,text)', 'execute')
     or has_function_privilege('authenticated', 'public.log_notable_win(uuid,uuid,uuid[],uuid,text)', 'execute')
     or not has_function_privilege('service_role', 'public.log_notable_win(uuid,uuid,uuid[],uuid,text)', 'execute')
     or has_function_privilege('anon', 'public.log_notable_claim(uuid,uuid,uuid,uuid,text)', 'execute')
     or has_function_privilege('authenticated', 'public.log_notable_claim(uuid,uuid,uuid,uuid,text)', 'execute')
     or not has_function_privilege('service_role', 'public.log_notable_claim(uuid,uuid,uuid,uuid,text)', 'execute')
  then
    raise exception 'notable save function access is wrong';
  end if;

  select count(*) into v_function_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('log_notable_win', 'log_notable_claim')
    and p.prosecdef
    and p.proconfig @> array['search_path=public'];
  if v_function_count <> 2 then
    raise exception 'notable save functions must retain security definer and search_path=public';
  end if;
end $$;

commit;
