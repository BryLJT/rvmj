\set ON_ERROR_STOP on

-- The fixture row existed before 0011. Its identity and all legacy values must be retained;
-- multi-label storage is additive, never a rewrite of historical claims.
do $$
begin
  if not exists (
    select 1
    from notable_claims nc
    join notable_hands nh on nh.id = nc.notable_hand_id
    where nc.id = '51000000-0000-0000-0000-000000000001'
      and nc.game_id = '52000000-0000-0000-0000-000000000001'
      and nc.player_id = '50000000-0000-0000-0000-000000000001'
      and nc.logged_by = '50000000-0000-0000-0000-000000000002'
      and nc.created_at = timestamptz '2025-11-01 12:00+08'
      and nc.photo_path = '52000000-0000-0000-0000-000000000001/existing.webp'
      and nh.name = 'Pure Suit'
  ) then
    raise exception '0011 changed the pre-existing notable claim';
  end if;

  if (select count(*) from notable_claim_types
      where claim_id = '51000000-0000-0000-0000-000000000001') <> 1
     or exists (
       select 1
       from notable_claim_types nct
       join notable_claims nc on nc.id = nct.claim_id
       where nct.claim_id = '51000000-0000-0000-0000-000000000001'
         and nct.notable_hand_id <> nc.notable_hand_id
     )
  then
    raise exception '0011 did not backfill the pre-existing claim exactly once';
  end if;
end $$;

-- A fresh active chip game lets the retained old RPC and the new multi-label RPC both exercise
-- their real write paths.
insert into games (id, table_id, mode, status, last_activity_at)
values (
  '52000000-0000-0000-0000-000000000002',
  '53000000-0000-0000-0000-000000000001',
  'chips',
  'active',
  timestamptz '2025-11-02 12:00+08'
);

insert into game_players (
  game_id, player_id, seat, final_total, chip_1, chip_10, chip_50, chip_100
) values
  ('52000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000001', 'E', 0, 0, 40, 0, 0),
  ('52000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000002', 'S', 0, 0, 40, 0, 0),
  ('52000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000003', 'W', 0, 0, 40, 0, 0),
  ('52000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000004', 'N', 0, 0, 40, 0, 0);

do $$
declare v_claim_id uuid;
begin
  v_claim_id := log_notable_claim(
    '52000000-0000-0000-0000-000000000002',
    '50000000-0000-0000-0000-000000000001',
    (select id from notable_hands where name = 'Pure Suit'),
    '50000000-0000-0000-0000-000000000002',
    '52000000-0000-0000-0000-000000000002/old-save.webp'
  );

  if (select count(*) from notable_claim_types where claim_id = v_claim_id) <> 1
     or exists (
       select 1 from notable_claim_types nct
       join notable_claims nc on nc.id = nct.claim_id
       where nct.claim_id = v_claim_id and nct.notable_hand_id <> nc.notable_hand_id
     )
  then
    raise exception 'the retained log_notable_claim path did not save one matching label';
  end if;
end $$;

do $$
declare
  v_claim_id uuid;
  v_all_pungs_id uuid := (select id from notable_hands where name = 'All Pungs');
  v_pure_suit_id uuid := (select id from notable_hands where name = 'Pure Suit');
begin
  v_claim_id := log_notable_win(
    '52000000-0000-0000-0000-000000000002',
    '50000000-0000-0000-0000-000000000001',
    array[v_pure_suit_id, v_all_pungs_id, v_pure_suit_id],
    '50000000-0000-0000-0000-000000000002',
    '52000000-0000-0000-0000-000000000002/multi-save.webp'
  );

  if (select count(*) from notable_claim_types where claim_id = v_claim_id) <> 2 then
    raise exception 'log_notable_win did not collapse duplicate labels';
  end if;
  if (select notable_hand_id from notable_claims where id = v_claim_id) <> v_all_pungs_id then
    raise exception 'legacy notable_hand_id did not use the alphabetically first label';
  end if;
end $$;

do $$
declare
  v_before integer := (select count(*) from notable_claims);
  v_rejected boolean;
begin
  v_rejected := false;
  begin
    perform log_notable_win(
      '52000000-0000-0000-0000-000000000002',
      '50000000-0000-0000-0000-000000000001',
      array[]::uuid[],
      '50000000-0000-0000-0000-000000000002'
    );
  exception when others then v_rejected := true;
  end;
  if not v_rejected then raise exception 'log_notable_win accepted an empty label array'; end if;

  v_rejected := false;
  begin
    perform log_notable_win(
      '52000000-0000-0000-0000-000000000002',
      '50000000-0000-0000-0000-000000000001',
      array['ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid],
      '50000000-0000-0000-0000-000000000002'
    );
  exception when others then v_rejected := true;
  end;
  if not v_rejected then raise exception 'log_notable_win accepted an all-invalid label array'; end if;
  if (select count(*) from notable_claims) <> v_before then
    raise exception 'rejected label arrays created a claim';
  end if;
end $$;

-- The function's two writes are one atomic unit: a label insert failure cannot leave a
-- claim without connections. The trigger exists only in this transaction and is rolled back.
begin;
create schema test_support;
create function test_support.reject_notable_claim_type() returns trigger
language plpgsql as $$
begin
  raise exception 'forced notable label failure';
end $$;
create trigger test_reject_notable_claim_type
before insert on notable_claim_types
for each row execute function test_support.reject_notable_claim_type();
do $$
declare
  v_before integer := (select count(*) from notable_claims);
  v_rejected boolean := false;
begin
  begin
    perform log_notable_win(
      '52000000-0000-0000-0000-000000000002',
      '50000000-0000-0000-0000-000000000001',
      array[(select id from notable_hands where name = 'Pure Suit')],
      '50000000-0000-0000-0000-000000000002'
    );
  exception when others then v_rejected := true;
  end;
  if not v_rejected then raise exception 'forced label failure did not reject the RPC'; end if;
  if (select count(*) from notable_claims) <> v_before then
    raise exception 'failed label insert left a notable claim behind';
  end if;
end $$;
rollback;

do $$
declare
  v_claim_id uuid;
begin
  v_claim_id := log_notable_claim(
    '52000000-0000-0000-0000-000000000002',
    '50000000-0000-0000-0000-000000000001',
    (select id from notable_hands where name = 'Pure Suit'),
    '50000000-0000-0000-0000-000000000002'
  );
  delete from notable_claims where id = v_claim_id;
  if exists (select 1 from notable_claim_types where claim_id = v_claim_id) then
    raise exception 'deleting a notable claim did not cascade its labels';
  end if;
end $$;

-- The old board deliberately counts claims, so a two-label claim remains one notable win.
update games set status = 'ended', ended_at = timestamptz '2025-11-02 13:00+08'
where id = '52000000-0000-0000-0000-000000000002';

do $$
begin
  if (select notable_wins from skill_board
      where id = '50000000-0000-0000-0000-000000000001') <> 3 then
    raise exception 'skill_board counted notable labels instead of notable claims';
  end if;
end $$;

-- Standings fixtures are deliberately direct historical rows. They model already-ended games,
-- not a new write path, so the query tests can isolate rolling windows and date filing.
-- East has 21 AY50 games: 19 newer tens, then two tied cutoff games. The larger UUID (21) is
-- included as the twentieth row, while the smaller UUID (20) is an extreme score that must stay
-- out of the average. South, West and North have 20, 19 and 1 AY50 games respectively.
insert into games (id, table_id, mode, status, ended_at, last_activity_at)
select
  ('54000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
  '53000000-0000-0000-0000-000000000001',
  'chips', 'ended',
  academic_year_start(2050)::timestamp at time zone 'Asia/Singapore' + interval '1 day' + n * interval '1 hour',
  academic_year_start(2050)::timestamp at time zone 'Asia/Singapore' + interval '1 day' + n * interval '1 hour'
from generate_series(1, 19) as n;

insert into games (id, table_id, mode, status, ended_at, last_activity_at) values
  ('54000000-0000-0000-0000-000000000020', '53000000-0000-0000-0000-000000000001', 'chips', 'ended', academic_year_start(2050)::timestamp at time zone 'Asia/Singapore', academic_year_start(2050)::timestamp at time zone 'Asia/Singapore'),
  ('54000000-0000-0000-0000-000000000021', '53000000-0000-0000-0000-000000000001', 'chips', 'ended', academic_year_start(2050)::timestamp at time zone 'Asia/Singapore', academic_year_start(2050)::timestamp at time zone 'Asia/Singapore'),
  ('54000000-0000-0000-0000-000000000022', '53000000-0000-0000-0000-000000000001', 'chips', 'ended', academic_year_start(2050)::timestamp at time zone 'Asia/Singapore' - interval '1 minute', academic_year_start(2050)::timestamp at time zone 'Asia/Singapore' - interval '1 minute'),
  ('54000000-0000-0000-0000-000000000023', '53000000-0000-0000-0000-000000000001', 'chips', 'ended', academic_year_start(2050)::timestamp at time zone 'Asia/Singapore', academic_year_start(2050)::timestamp at time zone 'Asia/Singapore');

insert into game_players (game_id, player_id, seat, final_total)
select
  ('54000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
  '50000000-0000-0000-0000-000000000001', 'E', 10
from generate_series(1, 19) as n;
insert into game_players (game_id, player_id, seat, final_total) values
  ('54000000-0000-0000-0000-000000000020', '50000000-0000-0000-0000-000000000001', 'E', 1000),
  ('54000000-0000-0000-0000-000000000021', '50000000-0000-0000-0000-000000000001', 'E', 30),
  ('54000000-0000-0000-0000-000000000022', '50000000-0000-0000-0000-000000000004', 'N', 999),
  ('54000000-0000-0000-0000-000000000023', '50000000-0000-0000-0000-000000000004', 'N', 10);

insert into game_players (game_id, player_id, seat, final_total)
select
  ('54000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
  '50000000-0000-0000-0000-000000000002', 'S',
  case when n = 1 then 11 else 10 end
from generate_series(1, 20) as n;
insert into game_players (game_id, player_id, seat, final_total)
select
  ('54000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
  '50000000-0000-0000-0000-000000000003', 'W',
  case when n = 1 then 11 else 10 end
from generate_series(1, 19) as n;

-- New claims exercise three, two, one and zero selected-label matches. Claims 3 and 4 share a
-- timestamp, making their UUID the final deterministic ordering key when no labels are selected.
insert into notable_claims (id, game_id, player_id, notable_hand_id, logged_by, created_at) values
  ('55000000-0000-0000-0000-000000000001', '54000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', (select id from notable_hands where name = 'All Pungs'), '50000000-0000-0000-0000-000000000002', timestamptz '2050-08-05 12:00+08'),
  ('55000000-0000-0000-0000-000000000002', '54000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000002', (select id from notable_hands where name = 'All Pungs'), '50000000-0000-0000-0000-000000000001', timestamptz '2050-08-05 11:00+08'),
  ('55000000-0000-0000-0000-000000000003', '54000000-0000-0000-0000-000000000003', '50000000-0000-0000-0000-000000000003', (select id from notable_hands where name = 'All Pungs'), '50000000-0000-0000-0000-000000000001', timestamptz '2050-08-05 10:00+08'),
  ('55000000-0000-0000-0000-000000000004', '54000000-0000-0000-0000-000000000023', '50000000-0000-0000-0000-000000000004', (select id from notable_hands where name = 'Thirteen Wonders'), '50000000-0000-0000-0000-000000000001', timestamptz '2050-08-05 10:00+08');
insert into notable_claim_types (claim_id, notable_hand_id)
select c.id, h.id
from (values
  ('55000000-0000-0000-0000-000000000001'::uuid, 'All Pungs'),
  ('55000000-0000-0000-0000-000000000001'::uuid, 'Pure Suit'),
  ('55000000-0000-0000-0000-000000000001'::uuid, 'Mixed Suit'),
  ('55000000-0000-0000-0000-000000000002'::uuid, 'All Pungs'),
  ('55000000-0000-0000-0000-000000000002'::uuid, 'Pure Suit'),
  ('55000000-0000-0000-0000-000000000003'::uuid, 'All Pungs'),
  ('55000000-0000-0000-0000-000000000004'::uuid, 'Thirteen Wonders')
) as c(id, hand_name)
join notable_hands h on h.name = c.hand_name
on conflict do nothing;

-- Make the existing post-0011 claims deterministic for the all-time ordering assertion.
update notable_claims set created_at = timestamptz '2025-11-02 12:00+08'
where photo_path = '52000000-0000-0000-0000-000000000002/multi-save.webp';
update notable_claims set created_at = timestamptz '2025-11-02 11:00+08'
where photo_path = '52000000-0000-0000-0000-000000000002/old-save.webp';

do $$
declare
  v_ids uuid[];
  v_east record;
  v_west record;
  v_south record;
  v_north record;
begin
  select array_agg(id order by ordinality) into v_ids
  from points_per_game_board(null) with ordinality
    as board(id, display_name, house, avg_points, games_counted, ordinality);
  if v_ids <> array[
    '50000000-0000-0000-0000-000000000004'::uuid,
    '50000000-0000-0000-0000-000000000001'::uuid,
    '50000000-0000-0000-0000-000000000002'::uuid,
    '50000000-0000-0000-0000-000000000003'::uuid,
    '00000000-0000-0000-0000-000000000001'::uuid,
    '00000000-0000-0000-0000-000000000004'::uuid,
    '00000000-0000-0000-0000-000000000002'::uuid,
    '00000000-0000-0000-0000-000000000003'::uuid
  ] then
    raise exception 'all-time points-per-game order is wrong: %', v_ids;
  end if;

  select array_agg(id order by ordinality) into v_ids
  from points_per_game_board(2050) with ordinality
    as board(id, display_name, house, avg_points, games_counted, ordinality);
  if v_ids <> array[
    '50000000-0000-0000-0000-000000000001'::uuid,
    '50000000-0000-0000-0000-000000000003'::uuid,
    '50000000-0000-0000-0000-000000000002'::uuid,
    '50000000-0000-0000-0000-000000000004'::uuid
  ] then
    raise exception 'AY50 points-per-game order is wrong: %', v_ids;
  end if;

  select * into v_east from points_per_game_board(2050)
  where id = '50000000-0000-0000-0000-000000000001';
  select * into v_west from points_per_game_board(2050)
  where id = '50000000-0000-0000-0000-000000000003';
  select * into v_south from points_per_game_board(2050)
  where id = '50000000-0000-0000-0000-000000000002';
  select * into v_north from points_per_game_board(2050)
  where id = '50000000-0000-0000-0000-000000000004';
  if v_east.games_counted <> 20 or v_east.avg_points <> 11
     or v_west.games_counted <> 19 or v_west.avg_points <> 191::numeric / 19
     or v_south.games_counted <> 20 or v_south.avg_points <> 201::numeric / 20
     or v_north.games_counted <> 1 or v_north.avg_points <> 10 then
    raise exception 'AY50 points-per-game windows or exact averages are wrong';
  end if;
end $$;

do $$
declare
  v_ids uuid[];
  v_selected uuid[] := array[
    (select id from notable_hands where name = 'All Pungs'),
    (select id from notable_hands where name = 'Pure Suit'),
    (select id from notable_hands where name = 'Mixed Suit'),
    (select id from notable_hands where name = 'All Pungs'),
    'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid
  ];
begin
  select array_agg(claim_id order by ordinality) into v_ids
  from notable_wins_board(null, null) with ordinality
    as board(claim_id, player_id, display_name, house, created_at, hand_types, total_label_count, selected_match_count, ordinality);
  if v_ids <> array[
    '55000000-0000-0000-0000-000000000001'::uuid,
    '55000000-0000-0000-0000-000000000002'::uuid,
    (select id from notable_claims where photo_path = '52000000-0000-0000-0000-000000000002/multi-save.webp'),
    '55000000-0000-0000-0000-000000000003'::uuid,
    '55000000-0000-0000-0000-000000000004'::uuid,
    (select id from notable_claims where photo_path = '52000000-0000-0000-0000-000000000002/old-save.webp'),
    '51000000-0000-0000-0000-000000000001'::uuid
  ] then
    raise exception 'all-time unfiltered notable-wins order is wrong: %', v_ids;
  end if;

  select array_agg(claim_id order by ordinality) into v_ids
  from notable_wins_board(2050, v_selected) with ordinality
    as board(claim_id, player_id, display_name, house, created_at, hand_types, total_label_count, selected_match_count, ordinality);
  if v_ids <> array[
    '55000000-0000-0000-0000-000000000001'::uuid,
    '55000000-0000-0000-0000-000000000002'::uuid,
    '55000000-0000-0000-0000-000000000003'::uuid
  ] then
    raise exception 'AY50 selected notable-wins order is wrong: %', v_ids;
  end if;

  select array_agg(claim_id order by ordinality) into v_ids
  from notable_wins_board(2050, array[]::uuid[]) with ordinality
    as board(claim_id, player_id, display_name, house, created_at, hand_types, total_label_count, selected_match_count, ordinality);
  if v_ids <> array[
    '55000000-0000-0000-0000-000000000001'::uuid,
    '55000000-0000-0000-0000-000000000002'::uuid,
    '55000000-0000-0000-0000-000000000003'::uuid,
    '55000000-0000-0000-0000-000000000004'::uuid
  ] then
    raise exception 'AY50 empty-filter notable-wins order is wrong: %', v_ids;
  end if;
end $$;
