-- ============================================================================
-- 0003 — app mode: hands, scoring events, point movements, zero-sum trigger,
--        presets, app RPCs, board upgrades (spec §9, §10)
--
-- Purely additive with respect to the live chip spine: no ALTERs of chip
-- tables, no changes to chip RPCs. The running chip app is untouched.
--
-- NOTE ON NUMBERING: the task brief called this file `0002_app_mode.sql`, but
-- 0002 is already taken by `0002_chip_spine_hardening.sql`. Because that
-- hardening migration ran BEFORE any of the objects below existed, none of
-- them inherit its posture — so this migration replicates it explicitly:
--   * every new SECURITY DEFINER function: revoke all from public/anon/
--     authenticated, grant execute to service_role + postgres;
--   * every board view: security_invoker = true, revoked from anon, select
--     granted to authenticated. `create or replace view skill_board` DROPS the
--     reloptions 0002 set on it, so security_invoker is re-applied below.
-- ============================================================================


-- ============ TABLES ============
create table presets (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references players(id) on delete cascade,
  name text not null,
  rules jsonb not null,
  created_at timestamptz not null default now()
);

create table hands (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references games(id) on delete cascade,
  seq int not null,
  recorded_by uuid not null references players(id),
  voided boolean not null default false,
  created_at timestamptz not null default now(),
  unique (game_id, seq)
);

-- Strict by design: every scoring event belongs to a hand and its movements sum to zero.
-- No glory type here — chip-mode notables are notable_claims rows (migration 0001).
create table scoring_events (
  id uuid primary key default gen_random_uuid(),
  hand_id uuid not null references hands(id) on delete cascade,
  type text not null check (type in ('win','bonus','reversal')),
  payload jsonb not null default '{}',
  winner_player_id uuid references players(id),
  tai int check (
    (type = 'win' and tai is not null and tai > 0)
    or (type <> 'win' and tai is null)
  ),
  notable_hand_id uuid references notable_hands(id),
  created_at timestamptz not null default now()
);
-- skill_board joins events to hands, and deleting a hand cascades here; the FK
-- gets no index of its own.
create index on scoring_events (hand_id);

create table point_movements (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references scoring_events(id) on delete cascade,
  hand_id uuid not null references hands(id) on delete cascade,
  game_id uuid not null references games(id) on delete cascade,
  player_id uuid not null references players(id),
  seat text not null check (seat in ('E','S','W','N')),
  points int not null
);
create index on point_movements (game_id);
create index on point_movements (player_id);
-- void_hand and the zero-sum trigger both fan out from a single hand / event.
create index on point_movements (hand_id);
create index on point_movements (event_id);


-- ============ ONE OPEN GAME PER TABLE (Task 12 review carry) ============
-- The tap route reads "the newest forming/active game at this table" and, when
-- there is none, creates one. Two simultaneous first taps both read nothing and
-- both create — one of the two forming games then orphans forever, and nothing
-- self-heals it. This partial unique index makes the second insert FAIL instead,
-- which the tap route already surfaces as a create error rather than a silent
-- duplicate. It doubles as the index that `.eq(table_id).in(status,...)` lacks.
--
-- Interaction with create_game_with_seat's expire-then-create path: the tap
-- route calls `expire_game` (status -> 'expired') and only then calls
-- `create_game_with_seat`. 'expired' is outside the index predicate, so the old
-- row leaves the index before the new row enters it and the constraint holds.
-- Both statements run as separate autocommitted calls, so there is not even a
-- transient in-transaction overlap to consider.
--
-- Preflight: unlike everything else here, this index is retroactive — it has to
-- be satisfiable by rows that already exist. If the live database is already
-- carrying a table with two open games (exactly the bug this prevents), CREATE
-- INDEX fails with a bare "Key (table_id)=(...) is duplicated" that says nothing
-- about what to do. Name the offenders instead.
do $$
declare v_bad text;
begin
  select string_agg(
    'table ' || d.table_id::text || ': games [' || d.game_ids || ']',
    '; '
  )
  into v_bad
  from (
    select table_id, string_agg(id::text, ', ' order by created_at) as game_ids
    from games where status in ('forming', 'active')
    group by table_id having count(*) > 1
  ) d;
  if v_bad is not null then
    raise exception
      'cannot enforce one open game per table — duplicate open games found: %. Inspect those game IDs before retrying the migration.',
      v_bad;
  end if;
end $$;

create unique index games_one_open_per_table
  on games (table_id)
  where status in ('forming', 'active');


-- ============ ZERO-SUM CONSTRAINT (spec §10 layer 2) ============
create or replace function check_event_zero_sum() returns trigger
language plpgsql as $$
declare v_event uuid; v_sum int;
begin
  v_event := coalesce(new.event_id, old.event_id);
  select coalesce(sum(points), 0) into v_sum from point_movements where event_id = v_event;
  if v_sum <> 0 then
    raise exception 'zero-sum violation: event % sums to %', v_event, v_sum;
  end if;
  return null;
end $$;

create constraint trigger event_zero_sum
  after insert or update or delete on point_movements
  deferrable initially deferred
  for each row execute function check_event_zero_sum();


-- ============ RPCs ============
create or replace function record_hand(p_game_id uuid, p_recorded_by uuid, p_events jsonb)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_hand_id uuid := gen_random_uuid();
  v_seq int;
  v_event jsonb;
  v_event_id uuid;
  v_mv jsonb;
begin
  perform 1 from games where id = p_game_id and status = 'active' and mode = 'app' for update;
  if not found then raise exception 'game is not an active app-mode game'; end if;
  perform 1 from game_players where game_id = p_game_id and player_id = p_recorded_by;
  if not found then raise exception 'recorded_by is not in this game'; end if;
  select coalesce(max(seq), 0) + 1 into v_seq from hands where game_id = p_game_id;
  insert into hands (id, game_id, seq, recorded_by) values (v_hand_id, p_game_id, v_seq, p_recorded_by);
  for v_event in select * from jsonb_array_elements(p_events) loop
    v_event_id := gen_random_uuid();
    insert into scoring_events (id, hand_id, type, payload, winner_player_id, tai, notable_hand_id)
    values (
      v_event_id, v_hand_id, v_event->>'type', v_event->'payload',
      nullif(v_event->>'winner_player_id', '')::uuid,
      nullif(v_event->>'tai', '')::int,
      nullif(v_event->>'notable_hand_id', '')::uuid
    );
    for v_mv in select * from jsonb_array_elements(v_event->'movements') loop
      perform 1 from game_players
      where game_id = p_game_id
        and player_id = (v_mv->>'player_id')::uuid
        and seat = v_mv->>'seat';
      if not found then
        raise exception 'movement player/seat is not seated in this game';
      end if;
      insert into point_movements (event_id, hand_id, game_id, player_id, seat, points)
      values (v_event_id, v_hand_id, p_game_id, (v_mv->>'player_id')::uuid, v_mv->>'seat', (v_mv->>'points')::int);
    end loop;
  end loop;
  update games set last_activity_at = now() where id = p_game_id;
  return v_hand_id;
end $$;

create or replace function void_hand(p_hand_id uuid, p_by uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_game uuid; v_event_id uuid := gen_random_uuid();
begin
  -- Read only to learn the parent id, then take the shared lock order used everywhere:
  -- games first, child hand second. That prevents void_hand and end_game from committing
  -- incompatible histories while avoiding a hand->game / game->hand deadlock.
  select game_id into v_game from hands where id = p_hand_id;
  if not found then raise exception 'hand not found or already voided'; end if;
  perform 1 from games where id = v_game and status = 'active' and mode = 'app' for update;
  if not found then raise exception 'game is not an active app-mode game'; end if;
  perform 1 from hands where id = p_hand_id and game_id = v_game and not voided for update;
  if not found then raise exception 'hand not found or already voided'; end if;
  perform 1 from game_players where game_id = v_game and player_id = p_by;
  if not found then raise exception 'voided_by is not in this game'; end if;
  insert into scoring_events (id, hand_id, type, payload)
  values (v_event_id, p_hand_id, 'reversal', jsonb_build_object('voided_by', p_by));
  insert into point_movements (event_id, hand_id, game_id, player_id, seat, points)
  select v_event_id, hand_id, game_id, player_id, seat, -points
  from point_movements where hand_id = p_hand_id and event_id <> v_event_id;
  update hands set voided = true where id = p_hand_id;
  update games set last_activity_at = now() where id = v_game;
end $$;

-- App-mode end ONLY. A chip game can never reach the quarantine branch (spec §10:
-- a chip conservation failure is a user-facing recount, not a system failure).
-- src/app/game/[id]/page.tsx casts on that guarantee.
create or replace function end_game(p_game_id uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_total int;
  v_player_count int;
  v_non_null_count int;
  r record;
begin
  perform 1 from games where id = p_game_id and status = 'active' and mode = 'app' for update;
  if not found then raise exception 'game is not an active app-mode game'; end if;
  select coalesce(sum(points), 0) into v_total from point_movements where game_id = p_game_id;
  select count(*) into v_player_count from game_players where game_id = p_game_id;
  if v_total <> 0 or v_player_count <> 4 then
    update games set status = 'quarantined', ended_at = now() where id = p_game_id;
    return 'quarantined';
  end if;
  for r in
    select gp.player_id, coalesce(sum(m.points), 0) as total
    from game_players gp
    left join point_movements m on m.game_id = gp.game_id and m.player_id = gp.player_id
    where gp.game_id = p_game_id
    group by gp.player_id
  loop
    update game_players set final_total = r.total
    where game_id = p_game_id and player_id = r.player_id;
  end loop;

  select count(*), count(final_total), coalesce(sum(final_total), 0)
  into v_player_count, v_non_null_count, v_total
  from game_players where game_id = p_game_id;

  if v_player_count <> 4 or v_non_null_count <> 4 or v_total <> 0 then
    update game_players set final_total = null where game_id = p_game_id;
    update games set status = 'quarantined', ended_at = now() where id = p_game_id;
    return 'quarantined';
  end if;

  update games set status = 'ended', ended_at = now() where id = p_game_id;
  return 'ended';
end $$;

-- The app-mode counterpart to expire_abandoned_game. It owns the game-row lock before
-- end_game calculates anything, and compares the exact timestamp the confirmation screen
-- observed. A resume or void that commits first therefore becomes `changed`, never an older
-- request destroying or publishing a different history.
create or replace function end_abandoned_game(
  p_game_id uuid,
  p_expected_last_activity_at timestamptz
) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_game games%rowtype;
  v_result text;
begin
  select * into v_game from games where id = p_game_id for update;
  if not found
    or v_game.status <> 'active'
    or v_game.mode <> 'app'
    or v_game.last_activity_at is distinct from p_expected_last_activity_at
    or v_game.last_activity_at >= now() - interval '12 hours'
  then
    return 'changed';
  end if;

  select end_game(p_game_id) into v_result;
  return v_result;
end $$;

-- reopen_game from 0001 already serves app games: it clears final_total (correct — end_game
-- rewrites it) and the chip columns (null for app games; a no-op). No change needed.


-- ============ RPC HARDENING (matches 0002's posture) ============
-- These four functions were created after 0002 ran, so they still carry
-- Postgres' default EXECUTE-to-PUBLIC grant. Nothing in them checks auth.uid();
-- only the server (service_role) is ever meant to call them.
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
      and p.proname in ('record_hand', 'void_hand', 'end_game', 'end_abandoned_game')
  loop
    execute format('revoke all on function %s from public', r.sig);
    execute format('revoke all on function %s from anon', r.sig);
    execute format('revoke all on function %s from authenticated', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
    execute format('grant execute on function %s to postgres', r.sig);
    v_count := v_count + 1;
  end loop;

  if v_count <> 4 then
    raise exception 'expected to harden 4 app-mode functions, found %', v_count;
  end if;
end $$;

-- check_event_zero_sum is a plain (non-definer) trigger function; it is never
-- meant to be invoked directly. Lock it down for the same reason.
revoke all on function public.check_event_zero_sum() from public;
revoke all on function public.check_event_zero_sum() from anon;
revoke all on function public.check_event_zero_sum() from authenticated;
grant execute on function public.check_event_zero_sum() to service_role;
grant execute on function public.check_event_zero_sum() to postgres;


-- ============ BOARD UPGRADES (spec §9) ============
-- Form: average points per hand, minimum 20 hands (app-mode games only — chip games have no hands).
--
-- DELIBERATE DEVIATION from the task brief's SQL: the brief joined point_movements
-- directly and so counted VOIDED hands in the denominator. void_hand attaches its
-- reversal movements to the SAME hand_id, so a voided hand keeps contributing a
-- distinct hand_id while its points net to zero — 20 real hands plus 1 voided one
-- read as 21 hands played and dragged the average down (verified locally: 180/21 =
-- 8.57 instead of 180/20 = 9.00). skill_board already excludes voided hands
-- (`and not h.voided`), so the two boards disagreed about what a hand is.
-- Excluding the voided hand entirely drops BOTH its original and its reversal
-- movements, which cancel — so total_points is unchanged and still agrees with
-- game_players.final_total.
create view form_board as
select p.id, p.display_name,
  coalesce(sum(m.points), 0) as total_points,
  count(distinct m.hand_id) as hands_played,
  round(coalesce(sum(m.points), 0)::numeric / count(distinct m.hand_id), 2) as avg_points_per_hand
from players p
join point_movements m on m.player_id = p.id
join hands h on h.id = m.hand_id and not h.voided
join games g on g.id = m.game_id and g.status = 'ended'
group by p.id, p.display_name
having count(distinct m.hand_id) >= 20;

-- Skill v2: tai from app-mode win events, notables from BOTH sources (win events ∪ notable_claims),
-- so chip-mode glory keeps counting after app mode ships.
create or replace view skill_board as
with app_wins as (
  select e.winner_player_id as player_id,
    coalesce(sum(least(e.tai, coalesce((g.rules->>'taiCap')::int, e.tai))), 0) as total_tai,
    count(*) filter (where e.notable_hand_id is not null) as notable_wins
  from scoring_events e
  join hands h on h.id = e.hand_id and not h.voided
  join games g on g.id = h.game_id and g.status = 'ended'
  where e.type = 'win' and e.winner_player_id is not null
  group by e.winner_player_id
),
claims as (
  select nc.player_id, count(*) as claim_count
  from notable_claims nc
  join games g on g.id = nc.game_id and g.status = 'ended'
  group by nc.player_id
)
select p.id, p.display_name,
  coalesce(a.total_tai, 0) as total_tai,
  coalesce(a.notable_wins, 0) + coalesce(c.claim_count, 0) as notable_wins
from players p
left join app_wins a on a.player_id = p.id
left join claims c on c.player_id = p.id
where a.player_id is not null or c.player_id is not null;


-- ============ VIEW HARDENING (matches 0002's posture) ============
-- `create or replace view` DISCARDS the reloptions 0002 set, so skill_board's
-- security_invoker must be re-applied here or the board silently reverts to
-- reading base tables with RLS bypassed. form_board is brand new and needs the
-- same treatment.
alter view public.skill_board set (security_invoker = true);
alter view public.form_board  set (security_invoker = true);

revoke all on public.skill_board from anon;
revoke all on public.form_board  from anon;
grant select on public.skill_board to authenticated;
grant select on public.form_board  to authenticated;


-- ============ RLS ============
alter table presets enable row level security;
alter table hands enable row level security;
alter table scoring_events enable row level security;
alter table point_movements enable row level security;

create policy "read own presets" on presets for select to authenticated using (owner = auth.uid());
create policy "read hands" on hands for select to authenticated using (true);
create policy "read scoring_events" on scoring_events for select to authenticated using (true);
create policy "read point_movements" on point_movements for select to authenticated using (true);


-- ============ REALTIME ============
alter publication supabase_realtime add table hands, point_movements;
