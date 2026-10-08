\set ON_ERROR_STOP on

-- Behavioural proofs for migration 0016, run against the full migration stack.
--
-- Two halves. The first ends real matches through end_chip_game and checks what it records. The
-- second builds two ladders out of fixture games and checks that every board keeps them apart.
-- The second half matters more than it looks: on a fresh replay no game has ended, so the
-- reconciliation inside 0016 itself compares two empty boards and proves nothing here.
create schema variant_test;
create function variant_test.assert_true(condition boolean, message text) returns void
language plpgsql as $$
begin
  if condition is not true then
    raise exception 'assertion failed: %', message;
  end if;
end $$;

-- Four players of their own, so the totals asserted below are not mixed with what earlier case
-- files left on the shared players.
insert into auth.users (id, email, raw_user_meta_data) values
  ('0e000000-0000-0000-0000-000000000001', 'variant-east@example.com',  '{"full_name":"Variant East"}'),
  ('0e000000-0000-0000-0000-000000000002', 'variant-south@example.com', '{"full_name":"Variant South"}'),
  ('0e000000-0000-0000-0000-000000000003', 'variant-west@example.com',  '{"full_name":"Variant West"}'),
  ('0e000000-0000-0000-0000-000000000004', 'variant-north@example.com', '{"full_name":"Variant North"}');

insert into tables (id, code, label) values
  ('0e000000-0000-0000-0000-0000000000ff', 'VARIANTEND', 'variant end test table'),
  ('0e000000-0000-0000-0000-0000000000fe', 'VARIANTBOARD', 'variant board fixture');

-- A fresh active chip match with a counted proposal already entered by South, so each case
-- below starts one call away from ending.
create function variant_test.counted_game(p_game_id uuid) returns void
language plpgsql as $$
begin
  -- Clears the whole TABLE, not just this id: one open game per table.
  delete from games where table_id = '0e000000-0000-0000-0000-0000000000ff';
  insert into games (id, table_id, mode, status, started_at)
    values (p_game_id, '0e000000-0000-0000-0000-0000000000ff', 'chips', 'active', now());
  insert into game_players (game_id, player_id, seat) values
    (p_game_id, '0e000000-0000-0000-0000-000000000001', 'E'),
    (p_game_id, '0e000000-0000-0000-0000-000000000002', 'S'),
    (p_game_id, '0e000000-0000-0000-0000-000000000003', 'W'),
    (p_game_id, '0e000000-0000-0000-0000-000000000004', 'N');
  -- One $10 chip has moved from South to East: balances on every denomination, and is not all
  -- zeros, so a finalize that wrote nothing could not pass for one that worked.
  perform propose_chip_counts(p_game_id, jsonb_build_object(
    'E', jsonb_build_object('1', 10, '10', 10, '50', 4, '100', 1),
    'S', jsonb_build_object('1', 10, '10',  8, '50', 4, '100', 1),
    'W', jsonb_build_object('1', 10, '10',  9, '50', 4, '100', 1),
    'N', jsonb_build_object('1', 10, '10',  9, '50', 4, '100', 1)
  ), '0e000000-0000-0000-0000-000000000002');
end $$;

-- ============ a match in progress has not been asked yet ============

select variant_test.counted_game('0e000000-0000-0000-0000-00000000a001');
select variant_test.assert_true(
  (select variant = 'regular' from games where id = '0e000000-0000-0000-0000-00000000a001'),
  'a match that has not ended carries the default variant'
);

-- ============ ending records the answer ============

select variant_test.assert_true(
  end_chip_game('0e000000-0000-0000-0000-00000000a001',
                '0e000000-0000-0000-0000-000000000002', 'fei') = 'ended',
  'the counter ends the match as a fei game'
);
select variant_test.assert_true(
  (select status = 'ended' and variant = 'fei' and ended_at is not null
     and pending_counts is null and pending_proposed_by is null
   from games where id = '0e000000-0000-0000-0000-00000000a001'),
  'the fei answer is stored on the ended match'
);
select variant_test.assert_true(
  (select final_total = 10 from game_players
   where game_id = '0e000000-0000-0000-0000-00000000a001' and seat = 'E')
  and (select sum(final_total) = 0 from game_players
       where game_id = '0e000000-0000-0000-0000-00000000a001'),
  'a fei match is settled exactly like a regular one'
);

select variant_test.counted_game('0e000000-0000-0000-0000-00000000a002');
select end_chip_game('0e000000-0000-0000-0000-00000000a002',
                     '0e000000-0000-0000-0000-000000000002', 'regular');
select variant_test.assert_true(
  (select status = 'ended' and variant = 'regular'
   from games where id = '0e000000-0000-0000-0000-00000000a002'),
  'the regular answer is stored on the ended match'
);

-- The app that was deployed BEFORE this migration still calls with two arguments. It must go on
-- ending matches, and what it ends is a regular game.
select variant_test.counted_game('0e000000-0000-0000-0000-00000000a003');
select end_chip_game('0e000000-0000-0000-0000-00000000a003',
                     '0e000000-0000-0000-0000-000000000002');
select variant_test.assert_true(
  (select status = 'ended' and variant = 'regular'
   from games where id = '0e000000-0000-0000-0000-00000000a003'),
  'a caller that does not send a variant ends a regular game'
);

-- ============ an answer that is not one of the two is refused, whole ============

select variant_test.counted_game('0e000000-0000-0000-0000-00000000a004');
do $$
declare v_bad text;
begin
  foreach v_bad in array array['FEI', 'open', '', ' fei'] loop
    begin
      perform end_chip_game('0e000000-0000-0000-0000-00000000a004',
                            '0e000000-0000-0000-0000-000000000002', v_bad);
      raise exception 'variant "%" was accepted', v_bad;
    exception when others then
      if sqlerrm like 'variant "%" was accepted' then raise; end if;
      if sqlerrm not like 'unknown game variant%' then
        raise exception 'variant "%" was refused for the wrong reason: %', v_bad, sqlerrm;
      end if;
    end;
  end loop;

  begin
    perform end_chip_game('0e000000-0000-0000-0000-00000000a004',
                          '0e000000-0000-0000-0000-000000000002', null);
    raise exception 'a null variant was accepted';
  exception when others then
    if sqlerrm = 'a null variant was accepted' then raise; end if;
    if sqlerrm not like 'unknown game variant%' then
      raise exception 'a null variant was refused for the wrong reason: %', sqlerrm;
    end if;
  end;
end $$;
-- Refused BEFORE anything was written, not half-settled.
select variant_test.assert_true(
  (select status = 'active' and pending_counts is not null and variant = 'regular'
   from games where id = '0e000000-0000-0000-0000-00000000a004'),
  'a refused variant leaves the match active with its count intact'
);
select variant_test.assert_true(
  (select count(*) = 4 from game_players
   where game_id = '0e000000-0000-0000-0000-00000000a004' and final_total is null),
  'a refused variant wrote no results'
);

-- Somebody who did not enter the counts is told THAT, whatever variant they send. The permission
-- answer must not be replaced by a complaint about the argument.
do $$
begin
  perform end_chip_game('0e000000-0000-0000-0000-00000000a004',
                        '0e000000-0000-0000-0000-000000000001', 'nonsense');
  raise exception 'a non-counter ended the match';
exception when others then
  if sqlerrm = 'a non-counter ended the match' then raise; end if;
  if sqlerrm not like 'only the player who entered the counts%' then
    raise exception 'a non-counter was refused for the wrong reason: %', sqlerrm;
  end if;
end $$;

-- ============ reopening lets the table answer again ============

-- The fix for a wrong pick. Ended as fei, reopened inside the hour, counted again, ended as
-- regular: the second answer replaces the first.
select variant_test.counted_game('0e000000-0000-0000-0000-00000000a005');
select end_chip_game('0e000000-0000-0000-0000-00000000a005',
                     '0e000000-0000-0000-0000-000000000002', 'fei');
select reopen_game('0e000000-0000-0000-0000-00000000a005');
select propose_chip_counts('0e000000-0000-0000-0000-00000000a005', jsonb_build_object(
    'E', jsonb_build_object('1', 10, '10', 10, '50', 4, '100', 1),
    'S', jsonb_build_object('1', 10, '10',  8, '50', 4, '100', 1),
    'W', jsonb_build_object('1', 10, '10',  9, '50', 4, '100', 1),
    'N', jsonb_build_object('1', 10, '10',  9, '50', 4, '100', 1)
  ), '0e000000-0000-0000-0000-000000000003');
select end_chip_game('0e000000-0000-0000-0000-00000000a005',
                     '0e000000-0000-0000-0000-000000000003', 'regular');
select variant_test.assert_true(
  (select status = 'ended' and variant = 'regular'
   from games where id = '0e000000-0000-0000-0000-00000000a005'),
  'ending a reopened match again replaces the earlier answer'
);

-- Clear the end-test table so the board fixture below is the ONLY thing these four players have
-- ever played, and every number asserted can be derived by hand from the rows that follow.
delete from games where table_id = '0e000000-0000-0000-0000-0000000000ff';

-- ============ two ladders, built by hand ============
--
-- East against South; West and North sit at zero throughout so each game still has four seats.
--
--   REGULAR  AY2040  1 game    East +100
--   FEI      AY2041  1 game    East +1000   (the OLD one: 1 Sep 2041)
--   FEI      AY2041  20 games  East +1 each (1 Oct 2041 onward, all newer than the old one)
--   REGULAR  AY2042  5 games   East -500 each (the newest games of all)
--
-- The shape is chosen so each wrong implementation of the twenty-game window gives a DIFFERENT
-- wrong number for East on the fei ladder:
--   correct                           20 games, average 1
--   no window at all                  21 games, average 1020/21
--   variant applied AFTER the window  15 games (the 5 newest regular games used up slots)
create function variant_test.ended_game(
  p_n int, p_variant text, p_ended timestamptz, p_east int
) returns void
language plpgsql as $$
declare v_id uuid := ('0e000000-0000-0000-0000-0000000b' || lpad(p_n::text, 4, '0'))::uuid;
begin
  insert into games (id, table_id, mode, status, variant, started_at, ended_at)
    values (v_id, '0e000000-0000-0000-0000-0000000000fe', 'chips', 'ended', p_variant,
            p_ended - interval '2 hours', p_ended);
  insert into game_players (game_id, player_id, seat, final_total) values
    (v_id, '0e000000-0000-0000-0000-000000000001', 'E',  p_east),
    (v_id, '0e000000-0000-0000-0000-000000000002', 'S', -p_east),
    (v_id, '0e000000-0000-0000-0000-000000000003', 'W', 0),
    (v_id, '0e000000-0000-0000-0000-000000000004', 'N', 0);
end $$;

select variant_test.ended_game(1, 'regular', timestamptz '2040-11-01 12:00+08', 100);
select variant_test.ended_game(2, 'fei',     timestamptz '2041-09-01 12:00+08', 1000);
select variant_test.ended_game(100 + n, 'fei', timestamptz '2041-10-01 12:00+08' + n * interval '1 day', 1)
  from generate_series(1, 20) n;
select variant_test.ended_game(200 + n, 'regular', timestamptz '2042-11-01 12:00+08' + n * interval '1 day', -500)
  from generate_series(1, 5) n;

-- One notable win on each ladder, by different players, so a board that mixed them would show
-- the wrong name rather than merely the wrong count.
insert into notable_claims (id, game_id, player_id, notable_hand_id, logged_by, created_at) values
  ('0e000000-0000-0000-0000-0000000c0001', '0e000000-0000-0000-0000-0000000b0002',
   '0e000000-0000-0000-0000-000000000001', (select id from notable_hands where name = 'Pure Suit'),
   '0e000000-0000-0000-0000-000000000002', timestamptz '2041-09-01 11:00+08'),
  ('0e000000-0000-0000-0000-0000000c0002', '0e000000-0000-0000-0000-0000000b0001',
   '0e000000-0000-0000-0000-000000000002', (select id from notable_hands where name = 'All Pungs'),
   '0e000000-0000-0000-0000-000000000001', timestamptz '2040-11-01 11:00+08');

-- ============ Total score ============

select variant_test.assert_true(
  (select total_points = -2400 and games_played = 6 from total_score_board
   where id = '0e000000-0000-0000-0000-000000000001' and variant = 'regular'),
  'East on the regular ladder: 100 - 2500 over 6 games'
);
select variant_test.assert_true(
  (select total_points = 1020 and games_played = 21 from total_score_board
   where id = '0e000000-0000-0000-0000-000000000001' and variant = 'fei'),
  'East on the fei ladder: 1000 + 20 over 21 games'
);
select variant_test.assert_true(
  (select count(*) = 2 from total_score_board where id = '0e000000-0000-0000-0000-000000000001'),
  'a player who has played both games has exactly one row per variant'
);
-- The two ladders together are everything the player has played. A game dropped, or counted on
-- both, shows up here.
select variant_test.assert_true(
  (select l.total_points = t.total_points and l.games_played = t.games_played
   from lifetime_board l
   join (select id, sum(total_points) as total_points, sum(games_played) as games_played
         from total_score_board group by id) t on t.id = l.id
   where l.id = '0e000000-0000-0000-0000-000000000001'),
  'the two ladders add up to the old all-games board'
);
select variant_test.assert_true(
  (select total_points = -1380 and games_played = 27 from lifetime_board
   where id = '0e000000-0000-0000-0000-000000000001'),
  'and that old board really does hold the hand-derived total (non-vacuity)'
);

select variant_test.assert_true(
  (select total_points = 1020 and games_played = 21 from total_score_board_by_year
   where id = '0e000000-0000-0000-0000-000000000001' and variant = 'fei' and academic_year = 2041),
  'East on the fei ladder in AY2041'
);
select variant_test.assert_true(
  (select total_points = 100 and games_played = 1 from total_score_board_by_year
   where id = '0e000000-0000-0000-0000-000000000001' and variant = 'regular' and academic_year = 2040)
  and (select total_points = -2500 and games_played = 5 from total_score_board_by_year
       where id = '0e000000-0000-0000-0000-000000000001' and variant = 'regular' and academic_year = 2042),
  'East on the regular ladder, year by year'
);
select variant_test.assert_true(
  not exists (select 1 from total_score_board_by_year
              where id = '0e000000-0000-0000-0000-000000000001'
                and ((variant = 'fei' and academic_year <> 2041)
                  or (variant = 'regular' and academic_year = 2041))),
  'no year carries a game of the other variant'
);

-- ============ which years each ladder offers ============

select variant_test.assert_true(
  exists (select 1 from academic_years_by_variant where variant = 'fei' and academic_year = 2041)
  and exists (select 1 from academic_years_by_variant where variant = 'regular' and academic_year = 2040)
  and exists (select 1 from academic_years_by_variant where variant = 'regular' and academic_year = 2042),
  'each ladder offers the years it has games in'
);
select variant_test.assert_true(
  not exists (select 1 from academic_years_by_variant where variant = 'fei' and academic_year in (2040, 2042))
  and not exists (select 1 from academic_years_by_variant where variant = 'regular' and academic_year = 2041),
  'and does not offer a year that only the other ladder played in'
);

-- ============ Pts per game ============

select variant_test.assert_true(
  (select avg_points = 1 and games_counted = 20 from points_per_game_board(null, 'fei')
   where id = '0e000000-0000-0000-0000-000000000001'),
  'the fei window is the latest twenty FEI games: the old +1000 is out, regular games took no slots'
);
select variant_test.assert_true(
  (select avg_points = -400 and games_counted = 6 from points_per_game_board(null, 'regular')
   where id = '0e000000-0000-0000-0000-000000000001'),
  'the regular average is over the six regular games alone'
);
-- The default argument is the regular ladder: what the previously deployed app receives.
select variant_test.assert_true(
  (select avg_points = -400 and games_counted = 6 from points_per_game_board(null)
   where id = '0e000000-0000-0000-0000-000000000001'),
  'a caller that does not send a variant reads the regular ladder'
);
select variant_test.assert_true(
  (select avg_points = 1 and games_counted = 20 from points_per_game_board(2041, 'fei')
   where id = '0e000000-0000-0000-0000-000000000001')
  and not exists (select 1 from points_per_game_board(2041, 'regular')
                  where id = '0e000000-0000-0000-0000-000000000001')
  and not exists (select 1 from points_per_game_board(2040, 'fei')
                  where id = '0e000000-0000-0000-0000-000000000001'),
  'the year and the variant narrow together'
);

-- ============ Notable wins ============

select variant_test.assert_true(
  exists (select 1 from notable_wins_board(null, array[]::uuid[], 'fei')
          where claim_id = '0e000000-0000-0000-0000-0000000c0001')
  and not exists (select 1 from notable_wins_board(null, array[]::uuid[], 'fei')
                  where claim_id = '0e000000-0000-0000-0000-0000000c0002'),
  'the fei ladder lists the win from the fei match and not the regular one'
);
select variant_test.assert_true(
  exists (select 1 from notable_wins_board(null, array[]::uuid[], 'regular')
          where claim_id = '0e000000-0000-0000-0000-0000000c0002')
  and not exists (select 1 from notable_wins_board(null, array[]::uuid[], 'regular')
                  where claim_id = '0e000000-0000-0000-0000-0000000c0001'),
  'the regular ladder lists the win from the regular match and not the fei one'
);
select variant_test.assert_true(
  exists (select 1 from notable_wins_board(null, array[]::uuid[])
          where claim_id = '0e000000-0000-0000-0000-0000000c0002')
  and not exists (select 1 from notable_wins_board(null, array[]::uuid[])
                  where claim_id = '0e000000-0000-0000-0000-0000000c0001'),
  'a caller that does not send a variant reads the regular ladder'
);
-- The hand filter still works inside a ladder: the fei win is a Pure Suit.
select variant_test.assert_true(
  exists (select 1 from notable_wins_board(
            2041, array[(select id from notable_hands where name = 'Pure Suit')], 'fei')
          where claim_id = '0e000000-0000-0000-0000-0000000c0001')
  and not exists (select 1 from notable_wins_board(
            2041, array[(select id from notable_hands where name = 'All Pungs')], 'fei')
          where claim_id = '0e000000-0000-0000-0000-0000000c0001'),
  'year, hand filter and variant narrow together'
);

drop schema variant_test cascade;
