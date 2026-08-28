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
