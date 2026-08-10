-- ============ TABLES ============
create table players (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  email text not null,
  created_at timestamptz not null default now()
);

create table tables (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  label text,
  created_at timestamptz not null default now()
);

create table table_seats (
  table_id uuid not null references tables(id) on delete cascade,
  seat text not null check (seat in ('E','S','W','N')),
  secret text unique not null,
  primary key (table_id, seat)
);

create table games (
  id uuid primary key default gen_random_uuid(),
  table_id uuid not null references tables(id),
  mode text not null default 'chips' check (mode in ('chips','app')),
  status text not null default 'forming'
    check (status in ('forming','active','ended','quarantined','expired')),
  rules jsonb,                                    -- app mode only; stays null for chip games
  pending_counts jsonb,                           -- chip mode: proposed per-seat counts awaiting confirmation
  pending_confirmed uuid[] not null default '{}', -- players who confirmed the pending counts
  created_at timestamptz not null default now(),
  started_at timestamptz,
  ended_at timestamptz,
  last_activity_at timestamptz not null default now()
);

create table game_players (
  game_id uuid not null references games(id) on delete cascade,
  player_id uuid not null references players(id),
  seat text not null check (seat in ('E','S','W','N')),
  final_total int,
  -- chip mode only. Numbers mirror src/lib/chips.ts PER_PLAYER (the single source of truth).
  chip_1 int check (chip_1 >= 0),
  chip_10 int check (chip_10 >= 0),
  chip_50 int check (chip_50 >= 0),
  chip_100 int check (chip_100 >= 0),
  -- all-or-none: either no chip columns are set (forming / app mode) or all four are
  check (
    (chip_1 is null and chip_10 is null and chip_50 is null and chip_100 is null)
    or (chip_1 is not null and chip_10 is not null and chip_50 is not null and chip_100 is not null)
  ),
  -- tamper backstop: when counts exist, final_total MUST be their derivation (counted − 400),
  -- even against direct dashboard edits
  check (
    chip_1 is null
    or final_total = chip_1 + 10 * chip_10 + 50 * chip_50 + 100 * chip_100 - 400
  ),
  primary key (game_id, seat),
  unique (game_id, player_id)   -- ledger carry: backs one-account-one-seat
);

create table notable_hands (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  local_name text,
  rarity text not null check (rarity in ('uncommon','rare','legendary'))
);

-- Chip-mode glory log (spec §5, §8.7): standalone, movement-free BY CONSTRUCTION.
-- Deliberately NOT a relaxed scoring_events row — those stay hands-only with balancing
-- movements when they arrive in migration 0002.
create table notable_claims (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references games(id) on delete cascade,
  player_id uuid not null references players(id),
  notable_hand_id uuid not null references notable_hands(id),
  logged_by uuid not null references players(id),
  created_at timestamptz not null default now()
);
create index on notable_claims (game_id);
create index on notable_claims (player_id);

-- ============ NEW-USER TRIGGER ============
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into players (id, display_name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    new.email
  )
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ============ RPCs (all writes go through these) ============
create or replace function start_game(p_game_id uuid, p_mode text, p_rules jsonb default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_mode not in ('chips','app') then raise exception 'unknown mode %', p_mode; end if;
  if p_mode = 'chips' and p_rules is not null then raise exception 'chip mode takes no rules config'; end if;
  if p_mode = 'app' and p_rules is null then raise exception 'app mode requires a rules config'; end if;
  perform 1 from games where id = p_game_id and status = 'forming' for update;
  if not found then raise exception 'game is not forming'; end if;
  if (select count(*) from game_players where game_id = p_game_id) <> 4 then
    raise exception 'need exactly 4 players to start';
  end if;
  update games set status = 'active', mode = p_mode, rules = p_rules,
    started_at = now(), last_activity_at = now()
  where id = p_game_id;
end $$;

-- Atomic create-game-plus-first-seat (ledger carry: multi-row writes made atomic)
create or replace function create_game_with_seat(p_table_id uuid, p_player_id uuid, p_seat text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  insert into games (table_id) values (p_table_id) returning id into v_id;
  insert into game_players (game_id, player_id, seat) values (v_id, p_player_id, p_seat);
  return v_id;
end $$;

-- Chip-mode end, phase 1: propose the counted stacks. Re-proposal RESETS confirmations (spec §8.6).
create or replace function propose_chip_counts(p_game_id uuid, p_counts jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v_seat text; v_sum int; r record;
begin
  perform 1 from games where id = p_game_id and status = 'active' and mode = 'chips' for update;
  if not found then raise exception 'game is not an active chip game'; end if;
  -- shape check: four seats, four non-negative integer counts each
  foreach v_seat in array array['E','S','W','N'] loop
    if p_counts->v_seat is null then raise exception 'missing counts for seat %', v_seat; end if;
    for r in select * from (values ('1'),('10'),('50'),('100')) as t(denom) loop
      if (p_counts->v_seat->>r.denom) is null or (p_counts->v_seat->>r.denom)::int < 0 then
        raise exception 'bad count for seat % denomination $%', v_seat, r.denom;
      end if;
    end loop;
  end loop;
  -- conservation backstop. Table totals mirror src/lib/chips.ts TABLE_QTY (40/36/16/4).
  -- The server action pre-checks with the TS checker and turns failures into a recount
  -- prompt; this raise should never fire in normal flow.
  for r in select * from (values ('1',40),('10',36),('50',16),('100',4)) as t(denom, expected) loop
    select sum((p_counts->s->>r.denom)::int) into v_sum
    from unnest(array['E','S','W','N']) as s;
    if v_sum <> r.expected then
      raise exception 'conservation failed: $% count is %, expected % — recount', r.denom, v_sum, r.expected;
    end if;
  end loop;
  update games set pending_counts = p_counts, pending_confirmed = '{}', last_activity_at = now()
  where id = p_game_id;
end $$;

-- Chip-mode end, phase 2: per-player confirmation. The FOURTH confirmation finalizes atomically.
create or replace function confirm_chip_result(p_game_id uuid, p_player_id uuid) returns text
language plpgsql security definer set search_path = public as $$
declare v_game games%rowtype; v_seat text; v_stack int; v_zero int;
begin
  select * into v_game from games
  where id = p_game_id and status = 'active' and mode = 'chips' for update;
  if not found then raise exception 'game is not an active chip game'; end if;
  if v_game.pending_counts is null then raise exception 'no proposed counts to confirm'; end if;
  perform 1 from game_players where game_id = p_game_id and player_id = p_player_id;
  if not found then raise exception 'player is not in this game'; end if;
  if not (p_player_id = any(v_game.pending_confirmed)) then
    update games set pending_confirmed = pending_confirmed || p_player_id
    where id = p_game_id
    returning * into v_game;
  end if;
  if coalesce(array_length(v_game.pending_confirmed, 1), 0) < 4 then
    return 'pending_' || coalesce(array_length(v_game.pending_confirmed, 1), 0);
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
  update games set status = 'ended', ended_at = now(), pending_counts = null, pending_confirmed = '{}'
  where id = p_game_id;
  return 'ended';
end $$;

-- Stale chip games expire WITHOUT results (spec §10: no counts to settle with)
create or replace function expire_game(p_game_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform 1 from games where id = p_game_id and status in ('forming','active') for update;
  if not found then raise exception 'game cannot expire (not forming or active)'; end if;
  update games set status = 'expired', ended_at = now(), pending_counts = null, pending_confirmed = '{}'
  where id = p_game_id;
end $$;

create or replace function reopen_game(p_game_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform 1 from games
  where id = p_game_id and status = 'ended' and ended_at > now() - interval '1 hour'
  for update;
  if not found then raise exception 'game cannot be reopened (not ended, or ended more than an hour ago)'; end if;
  update games set status = 'active', ended_at = null, last_activity_at = now(),
    pending_counts = null, pending_confirmed = '{}'
  where id = p_game_id;
  update game_players set final_total = null,
    chip_1 = null, chip_10 = null, chip_50 = null, chip_100 = null
  where game_id = p_game_id;
end $$;

create or replace function log_notable_claim(p_game_id uuid, p_player_id uuid, p_notable_hand_id uuid, p_logged_by uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform 1 from games where id = p_game_id and status = 'active' for update;
  if not found then raise exception 'game is not active'; end if;
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

-- ============ BOARDS v1 (spec §9; Task 16 renders, Task 18 upgrades) ============
-- Mode-blind: both modes converge on game_players.final_total.
create view lifetime_board as
select p.id, p.display_name,
  coalesce(sum(gp.final_total), 0) as total_points,
  count(gp.game_id) as games_played
from players p
join game_players gp on gp.player_id = p.id
join games g on g.id = gp.game_id and g.status = 'ended'
group by p.id, p.display_name;

-- v1: notable claims only. total_tai goes live in migration 0002 (app mode).
create view skill_board as
select p.id, p.display_name,
  0::bigint as total_tai,
  count(nc.id) as notable_wins
from players p
join notable_claims nc on nc.player_id = p.id
join games g on g.id = nc.game_id and g.status = 'ended'
group by p.id, p.display_name;

-- ============ RLS ============
-- Reads: any signed-in user. Writes: none (service role bypasses RLS; all writes via RPCs above).
alter table players enable row level security;
alter table tables enable row level security;
alter table table_seats enable row level security;
alter table games enable row level security;
alter table game_players enable row level security;
alter table notable_hands enable row level security;
alter table notable_claims enable row level security;

create policy "read players" on players for select to authenticated using (true);
create policy "read tables" on tables for select to authenticated using (true);
-- table_seats holds tag secrets: NO select policy. Server-only via service role.
create policy "read games" on games for select to authenticated using (true);
create policy "read game_players" on game_players for select to authenticated using (true);
create policy "read notable_hands" on notable_hands for select to authenticated using (true);
create policy "read notable_claims" on notable_claims for select to authenticated using (true);

-- ============ REALTIME ============
alter publication supabase_realtime add table games, game_players, notable_claims;

-- ============ SEEDS ============
insert into notable_hands (name, local_name, rarity) values
  ('Thirteen Wonders', '十三幺', 'legendary'),
  ('Heavenly Hand', '天糊', 'legendary'),
  ('Earthly Hand', '地糊', 'legendary'),
  ('Great Winds', '大四喜', 'legendary'),
  ('Big Three Dragons', '大三元', 'rare'),
  ('Small Three Dragons', '小三元', 'rare'),
  ('All Pungs', '碰碰胡', 'uncommon'),
  ('Pure Suit', '清一色', 'rare'),
  ('Mixed Suit', '混一色', 'uncommon'),
  ('Kong on Kong', '杠上开花', 'rare'),
  ('Robbing the Kong', '抢杠', 'rare'),
  ('Last Tile Catch', '海底捞月', 'rare');
