-- ============================================================================
-- 0002 — chip-spine hardening
--
-- Fixes three findings from the Task 10 review of 0001_chip_spine.sql. 0001 is
-- already applied to the hosted database (which holds no data), so it is left
-- untouched and the corrections ship forward as this migration.
--
-- Finding 1 — RPCs callable by anon / any authenticated user.
--   The 8 SECURITY DEFINER functions in `public` kept Postgres' default
--   EXECUTE-to-PUBLIC grant, and PostgREST exposes public functions to the
--   anon and authenticated roles. Nothing in them checks auth.uid(), so e.g.
--   confirm_chip_result(p_game_id, p_player_id) would let an outsider holding
--   the anon key finalize any game while impersonating any seated player.
--   Intended model: only the server (service_role) ever calls these.
--   Fix: revoke ALL from PUBLIC/anon/authenticated, then explicitly grant
--   EXECUTE to service_role (and postgres).
--
-- Finding 2 — both boards bypass RLS.
--   lifetime_board and skill_board were created without security_invoker, so
--   they execute as their owner and read base tables with RLS bypassed; and
--   Supabase's default privileges hand anon SELECT on new public views.
--   Fix: set security_invoker = true on both and revoke anon's access, so the
--   base-table SELECT policies (authenticated-only) actually govern reads.
--
-- Finding 3 — derivation CHECK passes when final_total is erased.
--   `check (chip_1 is null or final_total = chip_1 + 10*chip_10 + ...)` is
--   NULL (not false) when final_total is NULL with the chip columns set, and a
--   CHECK that evaluates to NULL passes — so blanking a score slips the tamper
--   net the constraint exists to be. Fix: require final_total to be NOT NULL
--   whenever the chip columns are populated. The 0001 constraint is unnamed
--   (auto-named by Postgres); it is discovered from pg_constraint by its
--   definition rather than by a guessed name, and the replacement carries an
--   explicit name.
-- ============================================================================


-- ============ GUARDED CHIP ABANDONMENT ============
-- The confirmation screen acts on a snapshot. Lock the row and require that snapshot's
-- exact activity timestamp so a Continue action that commits first cannot be erased by an
-- older confirmation request that was already in flight.
create or replace function expire_abandoned_game(
  p_game_id uuid,
  p_expected_last_activity_at timestamptz
) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_game games%rowtype;
begin
  select * into v_game from games where id = p_game_id for update;
  if not found then return false; end if;

  if v_game.status <> 'active'
    or v_game.mode <> 'chips'
    or v_game.last_activity_at is distinct from p_expected_last_activity_at
    or v_game.last_activity_at >= now() - interval '12 hours'
  then
    return false;
  end if;

  update games set
    status = 'expired',
    ended_at = now(),
    pending_counts = null,
    pending_confirmed = '{}'
  where id = p_game_id;
  return true;
end $$;


-- ============ GUARDED FORMING-GAME ABANDONMENT ============
-- A forming game is empty, but the decision to expire it still comes from an earlier read.
-- Require the exact creation timestamp and forming status under the row lock so an old tap
-- cannot expire the game after another phone has started it.
create or replace function expire_abandoned_forming_game(
  p_game_id uuid,
  p_expected_created_at timestamptz
) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_game games%rowtype;
begin
  select * into v_game from games where id = p_game_id for update;
  if not found then return false; end if;

  if v_game.status <> 'forming'
    or v_game.created_at is distinct from p_expected_created_at
    or v_game.created_at >= now() - interval '30 minutes'
  then
    return false;
  end if;

  update games set
    status = 'expired',
    ended_at = now(),
    pending_counts = null,
    pending_confirmed = '{}'
  where id = p_game_id;
  return true;
end $$;


-- ============ CHIP-ONLY NOTABLE CLAIMS ============
-- App-mode notables belong to scoring_events. Accepting a notable_claims row for the same
-- app game would make skill_board count one real hand twice.
create or replace function log_notable_claim(
  p_game_id uuid,
  p_player_id uuid,
  p_notable_hand_id uuid,
  p_logged_by uuid
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

  insert into notable_claims (game_id, player_id, notable_hand_id, logged_by)
  values (p_game_id, p_player_id, p_notable_hand_id, p_logged_by)
  returning id into v_id;
  update games set last_activity_at = now() where id = p_game_id;
  return v_id;
end $$;


-- ============ FINDING 1: lock the RPCs to the server ============
-- Fail loudly rather than silently skipping a revoke if the expected PostgREST
-- roles are missing — a half-applied ACL change is worse than none.
do $$
declare v_missing text;
begin
  select string_agg(r, ', ') into v_missing
  from unnest(array['anon','authenticated','service_role']) as r
  where not exists (select 1 from pg_roles where rolname = r);
  if v_missing is not null then
    raise exception 'expected PostgREST roles are missing: %', v_missing;
  end if;
end $$;

do $$
declare
  r record;
  v_count int := 0;
begin
  for r in
    select p.oid::regprocedure::text as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'start_game',
        'create_game_with_seat',
        'propose_chip_counts',
        'confirm_chip_result',
        'expire_game',
        'expire_abandoned_game',
        'expire_abandoned_forming_game',
        'reopen_game',
        'log_notable_claim',
        'handle_new_user'
      )
  loop
    execute format('revoke all on function %s from public', r.sig);
    execute format('revoke all on function %s from anon', r.sig);
    execute format('revoke all on function %s from authenticated', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
    execute format('grant execute on function %s to postgres', r.sig);
    v_count := v_count + 1;
  end loop;

  if v_count <> 10 then
    raise exception 'expected to harden 10 chip-spine functions, found %', v_count;
  end if;
end $$;

-- handle_new_user backs the on_auth_user_created trigger on auth.users, which
-- GoTrue writes as supabase_auth_admin. Postgres checks EXECUTE at CREATE
-- TRIGGER time rather than at fire time, so the revoke above cannot break the
-- existing trigger — but grant the auth admin explicitly so a future re-create
-- of the trigger cannot fail either. Signup is not a thing to leave to a
-- subtlety of when the ACL is checked.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    execute 'grant execute on function public.handle_new_user() to supabase_auth_admin';
  end if;
end $$;


-- ============ FINDING 2: boards must respect RLS ============
alter view public.lifetime_board set (security_invoker = true);
alter view public.skill_board    set (security_invoker = true);

-- anon has no business on the boards; authenticated keeps SELECT and now reads
-- the base tables under its own RLS policies.
revoke all on public.lifetime_board from anon;
revoke all on public.skill_board    from anon;
grant select on public.lifetime_board to authenticated;
grant select on public.skill_board    to authenticated;

-- Player email is operator-only. Game rosters and security-invoker board views need only
-- the public identity columns, so ordinary clients receive column-scoped access instead of
-- a table-wide SELECT that would expose every Google email through PostgREST.
revoke select on public.players from anon;
revoke select on public.players from authenticated;
grant select (id, display_name, created_at) on public.players to authenticated;


-- ============ FINDING 3: derivation CHECK must reject a NULL total ============
do $$
declare
  v_name text;
  v_count int;
begin
  -- 0001's derivation constraint is unnamed. Identify it by the exact five-column
  -- dependency set it owns, not by the broad word `final_total`: a future independent
  -- integrity check may mention that column and must survive this migration.
  select min(c.conname), count(*) into v_name, v_count
  from pg_constraint c
  where c.conrelid = 'public.game_players'::regclass
    and c.contype = 'c'
    and array_length(c.conkey, 1) = 5
    and c.conkey @> array[
      (select attnum from pg_attribute where attrelid = c.conrelid and attname = 'final_total'),
      (select attnum from pg_attribute where attrelid = c.conrelid and attname = 'chip_1'),
      (select attnum from pg_attribute where attrelid = c.conrelid and attname = 'chip_10'),
      (select attnum from pg_attribute where attrelid = c.conrelid and attname = 'chip_50'),
      (select attnum from pg_attribute where attrelid = c.conrelid and attname = 'chip_100')
    ]::smallint[];

  if v_count <> 1 then
    raise exception 'expected exactly one chip final-total derivation CHECK, found %', v_count;
  end if;

  execute format('alter table public.game_players drop constraint %I', v_name);
  raise notice 'dropped derivation CHECK %', v_name;
end $$;

alter table public.game_players
  add constraint game_players_final_total_derivation check (
    chip_1 is null
    or (
      final_total is not null
      and final_total = chip_1 + 10 * chip_10 + 50 * chip_50 + 100 * chip_100 - 400
    )
  );
