\set ON_ERROR_STOP on

-- Behavioural proofs for migration 0007, run against a database rebuilt from 0001 through 0007.
-- Denial probes live in run-migrations.sh instead, using the "run it as the role and expect a
-- non-zero exit" idiom: a caught exception inside plpgsql cannot distinguish "denied" from
-- "the probe itself was wrong".
create schema chip_end_test;
create function chip_end_test.assert_true(condition boolean, message text) returns void
language plpgsql as $$
begin
  if condition is not true then
    raise exception 'assertion failed: %', message;
  end if;
end $$;

-- Four real players through the real creation path.
insert into auth.users (id, email, raw_user_meta_data) values
  ('0c000000-0000-0000-0000-000000000001', 'chip-east@example.com',  '{"full_name":"East Player"}'),
  ('0c000000-0000-0000-0000-000000000002', 'chip-south@example.com', '{"full_name":"South Player"}'),
  ('0c000000-0000-0000-0000-000000000003', 'chip-west@example.com',  '{"full_name":"West Player"}'),
  ('0c000000-0000-0000-0000-000000000004', 'chip-north@example.com', '{"full_name":"North Player"}'),
  ('0c000000-0000-0000-0000-000000000009', 'chip-outsider@example.com', '{"full_name":"Outsider"}');

insert into tables (id, code, label)
  values ('0c000000-0000-0000-0000-0000000000ff', 'CHIPEND', 'chip end test table');

-- One helper builds a fresh active chip game with all four seats filled, so each case below
-- starts from the same known board instead of inheriting the previous case's leftovers.
create function chip_end_test.fresh_game(p_game_id uuid) returns void
language plpgsql as $$
begin
  -- Clears the whole TABLE, not just this id: 0003's partial unique index allows one open
  -- game per table, so a leftover from the previous case blocks the next insert.
  delete from games where table_id = '0c000000-0000-0000-0000-0000000000ff';
  insert into games (id, table_id, mode, status, started_at)
    values (p_game_id, '0c000000-0000-0000-0000-0000000000ff', 'chips', 'active', now());
  insert into game_players (game_id, player_id, seat) values
    (p_game_id, '0c000000-0000-0000-0000-000000000001', 'E'),
    (p_game_id, '0c000000-0000-0000-0000-000000000002', 'S'),
    (p_game_id, '0c000000-0000-0000-0000-000000000003', 'W'),
    (p_game_id, '0c000000-0000-0000-0000-000000000004', 'N');
end $$;

-- One $10 chip has moved from South to East. Conserves on every denomination (40/36/16/4) and
-- sums to zero, so it passes propose and produces a result that is not all zeros — an all-zero
-- fixture would let a finalize that writes nothing at all pass the sum check.
create function chip_end_test.counts() returns jsonb
language sql immutable as $$
  select jsonb_build_object(
    'E', jsonb_build_object('1', 10, '10', 10, '50', 4, '100', 1),
    'S', jsonb_build_object('1', 10, '10',  8, '50', 4, '100', 1),
    'W', jsonb_build_object('1', 10, '10',  9, '50', 4, '100', 1),
    'N', jsonb_build_object('1', 10, '10',  9, '50', 4, '100', 1)
  );
$$;

-- ============ the proposer is recorded ============

select chip_end_test.fresh_game('0c000000-0000-0000-0000-00000000a001');
select propose_chip_counts(
  '0c000000-0000-0000-0000-00000000a001', chip_end_test.counts(),
  '0c000000-0000-0000-0000-000000000002');

select chip_end_test.assert_true(
  (select pending_proposed_by = '0c000000-0000-0000-0000-000000000002'
   from games where id = '0c000000-0000-0000-0000-00000000a001'),
  'propose_chip_counts records who entered the counts'
);
select chip_end_test.assert_true(
  (select attnotnull = false from pg_attribute
   where attrelid = 'public.games'::regclass and attname = 'pending_proposed_by'),
  'games.pending_proposed_by is nullable'
);

-- A re-proposal by a different player MOVES ownership. This is the dead-phone recovery path:
-- if the counter's phone dies, somebody else re-proposes and inherits the End control.
select propose_chip_counts(
  '0c000000-0000-0000-0000-00000000a001', chip_end_test.counts(),
  '0c000000-0000-0000-0000-000000000003');
select chip_end_test.assert_true(
  (select pending_proposed_by = '0c000000-0000-0000-0000-000000000003'
   from games where id = '0c000000-0000-0000-0000-00000000a001'),
  're-proposing transfers the End control to the new counter'
);

-- Somebody who is not at this table cannot become the counter.
do $$
begin
  perform propose_chip_counts(
    '0c000000-0000-0000-0000-00000000a001', chip_end_test.counts(),
    '0c000000-0000-0000-0000-000000000009');
  raise exception 'a non-participant was allowed to propose counts';
exception when others then
  if sqlerrm = 'a non-participant was allowed to propose counts' then raise; end if;
end $$;
select chip_end_test.assert_true(
  (select pending_proposed_by = '0c000000-0000-0000-0000-000000000003'
   from games where id = '0c000000-0000-0000-0000-00000000a001'),
  'the rejected non-participant did not become the counter'
);

-- ============ only the counter can end the match ============

select chip_end_test.fresh_game('0c000000-0000-0000-0000-00000000a002');
select propose_chip_counts(
  '0c000000-0000-0000-0000-00000000a002', chip_end_test.counts(),
  '0c000000-0000-0000-0000-000000000002');

-- Every other seat is refused, INCLUDING East. Seat is not the permission; being the counter is.
do $$
declare v_id uuid;
begin
  foreach v_id in array array[
    '0c000000-0000-0000-0000-000000000001'::uuid,
    '0c000000-0000-0000-0000-000000000003'::uuid,
    '0c000000-0000-0000-0000-000000000004'::uuid,
    '0c000000-0000-0000-0000-000000000009'::uuid
  ] loop
    begin
      perform end_chip_game('0c000000-0000-0000-0000-00000000a002', v_id);
      raise exception 'player % ended a match they did not count', v_id;
    exception when others then
      if sqlerrm like '%ended a match they did not count%' then raise; end if;
    end;
  end loop;
end $$;

-- A refused end leaves the match completely untouched, not half-settled.
select chip_end_test.assert_true(
  (select status = 'active' and pending_counts is not null
   from games where id = '0c000000-0000-0000-0000-00000000a002'),
  'a refused end leaves the match active with its proposal intact'
);
select chip_end_test.assert_true(
  (select count(*) = 4 from game_players
   where game_id = '0c000000-0000-0000-0000-00000000a002' and final_total is null),
  'a refused end wrote no results'
);

-- The counter ends it, and the whole settlement lands in one go.
select chip_end_test.assert_true(
  end_chip_game('0c000000-0000-0000-0000-00000000a002',
                '0c000000-0000-0000-0000-000000000002') = 'ended',
  'the counter ends the match'
);
select chip_end_test.assert_true(
  (select status = 'ended' and ended_at is not null and pending_counts is null
     and pending_proposed_by is null
   from games where id = '0c000000-0000-0000-0000-00000000a002'),
  'ending clears the proposal and stamps the end'
);
select chip_end_test.assert_true(
  (select sum(final_total) = 0 from game_players
   where game_id = '0c000000-0000-0000-0000-00000000a002'),
  'the settled match sums to zero'
);
select chip_end_test.assert_true(
  (select final_total = 10 from game_players
   where game_id = '0c000000-0000-0000-0000-00000000a002' and seat = 'E'),
  'East is credited the $10 chip that moved'
);
select chip_end_test.assert_true(
  (select final_total = -10 from game_players
   where game_id = '0c000000-0000-0000-0000-00000000a002' and seat = 'S'),
  'South is debited the $10 chip that moved'
);
select chip_end_test.assert_true(
  (select chip_1 = 10 and chip_10 = 10 and chip_50 = 4 and chip_100 = 1
   from game_players
   where game_id = '0c000000-0000-0000-0000-00000000a002' and seat = 'E'),
  'the counted denominations are stored, not just the total'
);

-- Vestigial by design (spec §8.6): the column survives so expire_game, reopen_game and 0002's
-- cleanup blocks keep working untouched, but nothing writes it any more.
select chip_end_test.assert_true(
  (select pending_confirmed = '{}' from games
   where id = '0c000000-0000-0000-0000-00000000a002'),
  'pending_confirmed is left empty by the new flow'
);

-- ============ nothing to end ============

select chip_end_test.fresh_game('0c000000-0000-0000-0000-00000000a003');
do $$
begin
  perform end_chip_game('0c000000-0000-0000-0000-00000000a003',
                        '0c000000-0000-0000-0000-000000000002');
  raise exception 'a match with no counts was ended';
exception when others then
  if sqlerrm = 'a match with no counts was ended' then raise; end if;
end $$;

-- A reopened match cannot be ended on the strength of the OLD proposer. reopen_game clears the
-- counts but is deliberately left untouched by 0007, so this proves the leftover proposer id is
-- inert rather than a live permission.
select chip_end_test.fresh_game('0c000000-0000-0000-0000-00000000a004');
select propose_chip_counts(
  '0c000000-0000-0000-0000-00000000a004', chip_end_test.counts(),
  '0c000000-0000-0000-0000-000000000002');
select end_chip_game('0c000000-0000-0000-0000-00000000a004',
                     '0c000000-0000-0000-0000-000000000002');
select reopen_game('0c000000-0000-0000-0000-00000000a004');
do $$
begin
  perform end_chip_game('0c000000-0000-0000-0000-00000000a004',
                        '0c000000-0000-0000-0000-000000000002');
  raise exception 'a reopened match was ended without a fresh count';
exception when others then
  if sqlerrm = 'a reopened match was ended without a fresh count' then raise; end if;
end $$;
select chip_end_test.assert_true(
  (select status = 'active' and pending_counts is null
   from games where id = '0c000000-0000-0000-0000-00000000a004'),
  'the reopened match is still open and still uncounted'
);

drop schema chip_end_test cascade;
