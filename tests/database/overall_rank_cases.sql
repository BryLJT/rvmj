\set ON_ERROR_STOP on

-- Behavioural proofs for migration 0017, run against the full migration stack.
--
-- The claim under test is one sentence: a row's `overall_rank` is its place among EVERYONE on the
-- board, and narrowing the board to a house does not change it. Everything below is a fixture
-- small enough to rank by hand, and then that sentence asserted on all three boards.
create schema rank_test;
create function rank_test.assert_true(condition boolean, message text) returns void
language plpgsql as $$
begin
  if condition is not true then
    raise exception 'assertion failed: %', message;
  end if;
end $$;

-- Six players of their own, in academic years no other case file plays in (2060 and 2061), so
-- every per-year number asserted below can be derived from the rows that follow and nothing else.
--
--   Ada  orcaella      Ben  rusa      Cy   orcaella
--   Dee  (no house)    Eli  rusa      Fay  orcaella
insert into auth.users (id, email, raw_user_meta_data) values
  ('0f000000-0000-0000-0000-000000000001', 'rank-ada@example.com', '{"full_name":"Rank Ada"}'),
  ('0f000000-0000-0000-0000-000000000002', 'rank-ben@example.com', '{"full_name":"Rank Ben"}'),
  ('0f000000-0000-0000-0000-000000000003', 'rank-cy@example.com',  '{"full_name":"Rank Cy"}'),
  ('0f000000-0000-0000-0000-000000000004', 'rank-dee@example.com', '{"full_name":"Rank Dee"}'),
  ('0f000000-0000-0000-0000-000000000005', 'rank-eli@example.com', '{"full_name":"Rank Eli"}'),
  ('0f000000-0000-0000-0000-000000000006', 'rank-fay@example.com', '{"full_name":"Rank Fay"}');

update players set house = 'orcaella' where id in (
  '0f000000-0000-0000-0000-000000000001', '0f000000-0000-0000-0000-000000000003',
  '0f000000-0000-0000-0000-000000000006');
update players set house = 'rusa' where id in (
  '0f000000-0000-0000-0000-000000000002', '0f000000-0000-0000-0000-000000000005');

insert into tables (id, code, label) values
  ('0f000000-0000-0000-0000-0000000000ff', 'RANKBOARD', 'overall rank fixture');

create function rank_test.ended_game(
  p_n int, p_variant text, p_ended timestamptz, p_players uuid[], p_totals int[]
) returns void
language plpgsql as $$
declare v_id uuid := ('0f000000-0000-0000-0000-0000000b' || lpad(p_n::text, 4, '0'))::uuid;
begin
  insert into games (id, table_id, mode, status, variant, started_at, ended_at)
    values (v_id, '0f000000-0000-0000-0000-0000000000ff', 'chips', 'ended', p_variant,
            p_ended - interval '2 hours', p_ended);
  insert into game_players (game_id, player_id, seat, final_total) values
    (v_id, p_players[1], 'E', p_totals[1]),
    (v_id, p_players[2], 'S', p_totals[2]),
    (v_id, p_players[3], 'W', p_totals[3]),
    (v_id, p_players[4], 'N', p_totals[4]);
end $$;

-- REGULAR, AY2060
--   game 1   Ada +300   Ben +100   Cy -100   Dee -300
--   game 2   Eli +100   Fay -100   Ada    0   Ben    0
-- REGULAR, AY2061
--   game 3   Dee +500   Ada -500   Ben    0   Cy     0
-- FEI, AY2060
--   game 4   Dee +200   Cy     0   Fay    0   Ada -200
select rank_test.ended_game(1, 'regular', timestamptz '2060-11-01 12:00+08', array[
  '0f000000-0000-0000-0000-000000000001', '0f000000-0000-0000-0000-000000000002',
  '0f000000-0000-0000-0000-000000000003', '0f000000-0000-0000-0000-000000000004']::uuid[],
  array[300, 100, -100, -300]);
select rank_test.ended_game(2, 'regular', timestamptz '2060-11-02 12:00+08', array[
  '0f000000-0000-0000-0000-000000000005', '0f000000-0000-0000-0000-000000000006',
  '0f000000-0000-0000-0000-000000000001', '0f000000-0000-0000-0000-000000000002']::uuid[],
  array[100, -100, 0, 0]);
select rank_test.ended_game(3, 'regular', timestamptz '2061-11-01 12:00+08', array[
  '0f000000-0000-0000-0000-000000000004', '0f000000-0000-0000-0000-000000000001',
  '0f000000-0000-0000-0000-000000000002', '0f000000-0000-0000-0000-000000000003']::uuid[],
  array[500, -500, 0, 0]);
select rank_test.ended_game(4, 'fei', timestamptz '2060-11-03 12:00+08', array[
  '0f000000-0000-0000-0000-000000000004', '0f000000-0000-0000-0000-000000000003',
  '0f000000-0000-0000-0000-000000000006', '0f000000-0000-0000-0000-000000000001']::uuid[],
  array[200, 0, 0, -200]);

-- "Who is on this board, in rank order, with their rank", as one comparable string.
create function rank_test.total_by_year(p_year int, p_variant text, p_house text, p_narrow boolean)
returns text language sql as $$
  select string_agg(split_part(display_name, ' ', 2) || ':' || overall_rank, ' ' order by overall_rank)
  from total_score_board_by_year
  where academic_year = p_year and variant = p_variant
    and (not p_narrow or house is not distinct from p_house)
$$;
create function rank_test.pts(p_year int, p_variant text, p_house text, p_narrow boolean)
returns text language sql as $$
  select string_agg(split_part(display_name, ' ', 2) || ':' || overall_rank, ' ' order by overall_rank)
  from points_per_game_board(p_year, p_variant)
  where not p_narrow or house is not distinct from p_house
$$;

-- ============ Total score ============
--
-- AY2060 regular, by hand:
--   Ada  +300 (300 + 0)      1
--   Ben  +100 (100 + 0)      2   level with Eli; name breaks the tie
--   Eli  +100                3
--   Cy   -100                4   level with Fay; name breaks the tie
--   Fay  -100                5
--   Dee  -300                6
select rank_test.assert_true(
  rank_test.total_by_year(2060, 'regular', null, false) = 'Ada:1 Ben:2 Eli:3 Cy:4 Fay:5 Dee:6',
  'Total score AY2060 regular ranks everyone, ties broken by name: '
    || coalesce(rank_test.total_by_year(2060, 'regular', null, false), '(nothing)')
);
-- THE assertion this migration exists for. Narrowed to Orcaella, the three rows keep the places
-- they hold among all six. A rank worked out after narrowing would read 1, 2, 3.
select rank_test.assert_true(
  rank_test.total_by_year(2060, 'regular', 'orcaella', true) = 'Ada:1 Cy:4 Fay:5',
  'narrowing Total score to Orcaella keeps each overall place: '
    || coalesce(rank_test.total_by_year(2060, 'regular', 'orcaella', true), '(nothing)')
);
select rank_test.assert_true(
  rank_test.total_by_year(2060, 'regular', 'rusa', true) = 'Ben:2 Eli:3',
  'narrowing Total score to Rusa keeps each overall place'
);
-- "No house" is a choice too: the players who have not picked one.
select rank_test.assert_true(
  rank_test.total_by_year(2060, 'regular', null, true) = 'Dee:6',
  'narrowing Total score to players with no house keeps the overall place'
);
-- Each game is its own ladder, numbered from 1. Fei AY2060: Dee +200, Cy 0, Fay 0, Ada -200.
select rank_test.assert_true(
  rank_test.total_by_year(2060, 'fei', null, false) = 'Dee:1 Cy:2 Fay:3 Ada:4',
  'the fei ladder is ranked on its own: '
    || coalesce(rank_test.total_by_year(2060, 'fei', null, false), '(nothing)')
);
select rank_test.assert_true(
  rank_test.total_by_year(2060, 'fei', 'orcaella', true) = 'Cy:2 Fay:3 Ada:4',
  'and narrowing the fei ladder keeps ITS overall places, not the regular ones'
);
-- Each year is its own ladder too. AY2061 regular: Dee +500, Ben 0, Cy 0, Ada -500.
select rank_test.assert_true(
  rank_test.total_by_year(2061, 'regular', null, false) = 'Dee:1 Ben:2 Cy:3 Ada:4',
  'a different year is ranked on its own: '
    || coalesce(rank_test.total_by_year(2061, 'regular', null, false), '(nothing)')
);

-- All time shares its board with every other case file's players, so the places themselves are
-- not hand-derivable here. Two things still are: the six appear in the order their all-time
-- points put them (Dee +200, Ben +100, Eli +100, Cy -100, Fay -100, Ada -200), and the whole
-- ladder is numbered 1 to N with no gap and no repeat.
select rank_test.assert_true(
  (select string_agg(split_part(display_name, ' ', 2), ' ' order by overall_rank)
   from total_score_board
   where variant = 'regular' and id::text like '0f000000-%') = 'Dee Ben Eli Cy Fay Ada',
  'all-time Total score orders the six by their all-time points'
);
select rank_test.assert_true(
  (select count(*) > 6 and count(*) = max(overall_rank) and count(*) = count(distinct overall_rank)
     and min(overall_rank) = 1
   from total_score_board where variant = 'regular'),
  'the all-time regular ladder holds other players as well and is still a clean 1..N'
);
-- On a board nobody has narrowed, the rank is the row number the page already shows: the same
-- order the page asks for (points, then name, then id) and the same numbers.
select rank_test.assert_true(
  not exists (
    select 1 from (
      select overall_rank,
        row_number() over (order by total_points desc, display_name asc, id asc) as page_row
      from total_score_board where variant = 'regular'
    ) s where overall_rank <> page_row
  ),
  'all-time overall_rank equals the row number of the order the page reads in'
);

-- ============ Pts per game ============
--
-- AY2060 regular, by hand (average, then games counted, then name):
--   Ada  +150.0 over 2      1
--   Eli  +100.0 over 1      2   ahead of Ben here, though level with him on Total score
--   Ben   +50.0 over 2      3
--   Cy   -100.0 over 1      4   level with Fay on both keys; name breaks the tie
--   Fay  -100.0 over 1      5
--   Dee  -300.0 over 1      6
select rank_test.assert_true(
  rank_test.pts(2060, 'regular', null, false) = 'Ada:1 Eli:2 Ben:3 Cy:4 Fay:5 Dee:6',
  'Pts per game AY2060 regular ranks everyone: '
    || coalesce(rank_test.pts(2060, 'regular', null, false), '(nothing)')
);
select rank_test.assert_true(
  rank_test.pts(2060, 'regular', 'orcaella', true) = 'Ada:1 Cy:4 Fay:5',
  'narrowing Pts per game to Orcaella keeps each overall place: '
    || coalesce(rank_test.pts(2060, 'regular', 'orcaella', true), '(nothing)')
);
select rank_test.assert_true(
  rank_test.pts(2060, 'regular', 'rusa', true) = 'Eli:2 Ben:3',
  'narrowing Pts per game to Rusa keeps each overall place'
);
select rank_test.assert_true(
  rank_test.pts(2060, 'regular', null, true) = 'Dee:6',
  'narrowing Pts per game to players with no house keeps the overall place'
);
select rank_test.assert_true(
  rank_test.pts(2060, 'fei', 'orcaella', true) = 'Cy:2 Fay:3 Ada:4',
  'the fei Pts per game ladder is ranked on its own'
);
-- The rank is the row number of the function's own result, in the order it returns.
select rank_test.assert_true(
  not exists (
    select 1 from (
      select overall_rank, row_number() over () as returned_row
      from points_per_game_board(null, 'regular')
    ) s where overall_rank <> returned_row
  ),
  'Pts per game overall_rank equals the row number of the result as returned'
);
-- The columns the deployed app already reads are untouched by the added one.
select rank_test.assert_true(
  (select avg_points = 150 and games_counted = 2 and house = 'orcaella'
   from points_per_game_board(2060, 'regular') where id = '0f000000-0000-0000-0000-000000000001'),
  'Pts per game still reports the average, the count and the house'
);

-- ============ Notable wins ============
--
-- Four wins in game 1 (regular, AY2060), all logged on the day:
--   W1  Ada  11:00  All Pungs + Pure Suit   (two labels)
--   W2  Ben  11:30  All Pungs
--   W3  Cy   11:10  Pure Suit
--   W4  Dee  11:20  All Pungs
insert into notable_claims (id, game_id, player_id, notable_hand_id, logged_by, created_at) values
  ('0f000000-0000-0000-0000-0000000c0001', '0f000000-0000-0000-0000-0000000b0001',
   '0f000000-0000-0000-0000-000000000001', (select id from notable_hands where name = 'All Pungs'),
   '0f000000-0000-0000-0000-000000000002', timestamptz '2060-11-01 11:00+08'),
  ('0f000000-0000-0000-0000-0000000c0002', '0f000000-0000-0000-0000-0000000b0001',
   '0f000000-0000-0000-0000-000000000002', (select id from notable_hands where name = 'All Pungs'),
   '0f000000-0000-0000-0000-000000000001', timestamptz '2060-11-01 11:30+08'),
  ('0f000000-0000-0000-0000-0000000c0003', '0f000000-0000-0000-0000-0000000b0001',
   '0f000000-0000-0000-0000-000000000003', (select id from notable_hands where name = 'Pure Suit'),
   '0f000000-0000-0000-0000-000000000001', timestamptz '2060-11-01 11:10+08'),
  ('0f000000-0000-0000-0000-0000000c0004', '0f000000-0000-0000-0000-0000000b0001',
   '0f000000-0000-0000-0000-000000000004', (select id from notable_hands where name = 'All Pungs'),
   '0f000000-0000-0000-0000-000000000001', timestamptz '2060-11-01 11:20+08');
-- W1's second label. The first arrived through the insert above.
insert into notable_claim_types (claim_id, notable_hand_id) values
  ('0f000000-0000-0000-0000-0000000c0001', (select id from notable_hands where name = 'Pure Suit'));

create function rank_test.wins(p_hands text[], p_house text, p_narrow boolean)
returns text language sql as $$
  select string_agg('W' || right(claim_id::text, 1) || ':' || overall_rank, ' ' order by overall_rank)
  from notable_wins_board(
    2060,
    coalesce((select array_agg(id) from notable_hands where name = any(p_hands)), array[]::uuid[]),
    'regular')
  where not p_narrow or house is not distinct from p_house
$$;

select rank_test.assert_true(
  (select count(*) = 2 from notable_claim_types where claim_id = '0f000000-0000-0000-0000-0000000c0001'),
  'the fixture win really carries two labels (non-vacuity)'
);
-- No hand filter: most labels first, then newest. W1 (two labels), then W2 11:30, W4 11:20, W3 11:10.
select rank_test.assert_true(
  rank_test.wins(array[]::text[], null, false) = 'W1:1 W2:2 W4:3 W3:4',
  'Notable wins AY2060 ranks every win: ' || coalesce(rank_test.wins(array[]::text[], null, false), '(nothing)')
);
select rank_test.assert_true(
  rank_test.wins(array[]::text[], 'orcaella', true) = 'W1:1 W3:4',
  'narrowing Notable wins to Orcaella keeps each overall place: '
    || coalesce(rank_test.wins(array[]::text[], 'orcaella', true), '(nothing)')
);
select rank_test.assert_true(
  rank_test.wins(array[]::text[], 'rusa', true) = 'W2:2'
  and rank_test.wins(array[]::text[], null, true) = 'W4:3',
  'narrowing Notable wins to Rusa, and to no house, keeps each overall place'
);
-- A hand filter changes who "everyone" is: the place is among the wins that match it. Only
-- All Pungs leaves W1, W2 and W4; Cy's Pure Suit is not on that board at all.
select rank_test.assert_true(
  rank_test.wins(array['All Pungs'], null, false) = 'W1:1 W2:2 W4:3',
  'with a hand filter the rank is among the matching wins: '
    || coalesce(rank_test.wins(array['All Pungs'], null, false), '(nothing)')
);
select rank_test.assert_true(
  rank_test.wins(array['All Pungs'], 'orcaella', true) = 'W1:1'
  and rank_test.wins(array['All Pungs'], null, true) = 'W4:3',
  'and narrowing a filtered board keeps the filtered places'
);
select rank_test.assert_true(
  rank_test.wins(array['Pure Suit'], 'orcaella', true) = 'W1:1 W3:2',
  'a different hand filter gives the same wins different places: '
    || coalesce(rank_test.wins(array['Pure Suit'], 'orcaella', true), '(nothing)')
);
select rank_test.assert_true(
  not exists (
    select 1 from (
      select overall_rank, row_number() over () as returned_row
      from notable_wins_board(null, array[]::uuid[], 'regular')
    ) s where overall_rank <> returned_row
  ),
  'Notable wins overall_rank equals the row number of the result as returned'
);

drop schema rank_test cascade;
