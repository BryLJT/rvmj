\set ON_ERROR_STOP on

-- Behavioural proofs for migration 0021 (edit the tags of a win, delete a win).
-- Role denial probes live in run-migrations.sh, as for 0014.
create schema winedit_test;
create function winedit_test.assert_true(condition boolean, message text) returns void
language plpgsql as $$ begin if condition is not true then raise exception 'win edit assertion: %', message; end if; end $$;
create function winedit_test.refusal(sql text) returns text
language plpgsql as $$ begin execute sql; return '(no error)'; exception when others then return sqlerrm; end $$;

insert into auth.users (id, email, raw_user_meta_data) values
  ('30000000-0000-0000-0000-000000000001', 'winedit-east@example.com',     '{"full_name":"Edit East"}'),
  ('30000000-0000-0000-0000-000000000002', 'winedit-south@example.com',    '{"full_name":"Edit South"}'),
  ('30000000-0000-0000-0000-000000000005', 'winedit-outsider@example.com', '{"full_name":"Edit Outsider"}');

insert into tables (id, code, label) values ('30000000-0000-0000-0000-0000000000a1', 'WINEDIT30', 'Win edit table');
-- An ENDED game: both functions must work after the game is over.
insert into games (id, table_id, status, mode, started_at, ended_at) values
  ('30000000-0000-0000-0000-0000000000f1', '30000000-0000-0000-0000-0000000000a1',
   'ended', 'chips', now() - interval '3 hours', now() - interval '1 hour');
insert into game_players (game_id, player_id, seat) values
  ('30000000-0000-0000-0000-0000000000f1', '30000000-0000-0000-0000-000000000001', 'E'),
  ('30000000-0000-0000-0000-0000000000f1', '30000000-0000-0000-0000-000000000002', 'S');

-- Three distinct hand types, and two wins that each start with the FIRST one (the "wrong tag").
create table winedit_test.hands as select id, row_number() over (order by name, id) n from notable_hands;
insert into notable_claims (id, game_id, player_id, notable_hand_id, logged_by, photo_path, photo_added_by) values
  ('30000000-0000-0000-0000-0000000000c1', '30000000-0000-0000-0000-0000000000f1',
   '30000000-0000-0000-0000-000000000001', (select id from winedit_test.hands where n = 1),
   '30000000-0000-0000-0000-000000000001', 'f1/keep-me.webp', '30000000-0000-0000-0000-000000000001'),
  ('30000000-0000-0000-0000-0000000000c2', '30000000-0000-0000-0000-0000000000f1',
   '30000000-0000-0000-0000-000000000001', (select id from winedit_test.hands where n = 1),
   '30000000-0000-0000-0000-000000000001', 'f1/delete-me.webp', '30000000-0000-0000-0000-000000000001');
-- The insert trigger gave each win its first tag in notable_claim_types.

-- ---------------------------------------------------------------------------
-- Edit
-- ---------------------------------------------------------------------------
select winedit_test.assert_true(
  winedit_test.refusal($$select update_notable_win_hands('30000000-0000-0000-0000-0000000000c1',
    '30000000-0000-0000-0000-000000000005', array[(select id from winedit_test.hands where n = 2)])$$)
    = 'you did not play in this game',
  'an outsider cannot change tags');
select winedit_test.assert_true(
  winedit_test.refusal($$select update_notable_win_hands('30000000-0000-0000-0000-0000000000ff',
    '30000000-0000-0000-0000-000000000001', array[(select id from winedit_test.hands where n = 2)])$$)
    = 'no such win',
  'an unknown win is refused');
select winedit_test.assert_true(
  winedit_test.refusal($$select update_notable_win_hands('30000000-0000-0000-0000-0000000000c1',
    '30000000-0000-0000-0000-000000000001', array[]::uuid[])$$)
    = 'choose at least one valid hand type',
  'an empty list is refused');
select winedit_test.assert_true(
  winedit_test.refusal($$select update_notable_win_hands('30000000-0000-0000-0000-0000000000c1',
    '30000000-0000-0000-0000-000000000001',
    array[(select id from winedit_test.hands where n = 2), '30000000-0000-0000-0000-0000000000ee'::uuid])$$)
    = 'choose at least one valid hand type',
  'one unknown hand id refuses the whole call');
-- Refusals changed nothing.
select winedit_test.assert_true(
  (select count(*) = 1 and bool_and(notable_hand_id = (select id from winedit_test.hands where n = 1))
   from notable_claim_types where claim_id = '30000000-0000-0000-0000-0000000000c1'),
  'refused edits left the tags alone');

-- South did not log the win, and the game has ended. Both must be allowed.
select update_notable_win_hands('30000000-0000-0000-0000-0000000000c1',
  '30000000-0000-0000-0000-000000000002',
  array[(select id from winedit_test.hands where n = 3), (select id from winedit_test.hands where n = 2),
        (select id from winedit_test.hands where n = 3)]);
select winedit_test.assert_true(
  (select array_agg(notable_hand_id order by notable_hand_id) = array(
     select id from winedit_test.hands where n in (2, 3) order by id)
   from notable_claim_types where claim_id = '30000000-0000-0000-0000-0000000000c1'),
  'the old tag is gone and the two new tags are stored once each');
select winedit_test.assert_true(
  (select notable_hand_id = (select id from winedit_test.hands where n = 2) from notable_claims
   where id = '30000000-0000-0000-0000-0000000000c1'),
  'the single-label column is the first tag by name');
select winedit_test.assert_true(
  (select photo_path = 'f1/keep-me.webp' and player_id = '30000000-0000-0000-0000-000000000001'
          and logged_by = '30000000-0000-0000-0000-000000000001' from notable_claims
   where id = '30000000-0000-0000-0000-0000000000c1'),
  'editing tags keeps the photo, the winner and the logger');

-- ---------------------------------------------------------------------------
-- Delete
-- ---------------------------------------------------------------------------
select winedit_test.assert_true(
  winedit_test.refusal($$select delete_notable_win('30000000-0000-0000-0000-0000000000c2',
    '30000000-0000-0000-0000-000000000005')$$) = 'you did not play in this game',
  'an outsider cannot delete a win');
select winedit_test.assert_true(
  (select count(*) = 1 from notable_claims where id = '30000000-0000-0000-0000-0000000000c2'),
  'a refused delete left the win in place');
select winedit_test.assert_true(
  delete_notable_win('30000000-0000-0000-0000-0000000000c2', '30000000-0000-0000-0000-000000000002')
    = 'f1/delete-me.webp',
  'delete returns the photo path so the caller can remove the file');
select winedit_test.assert_true(
  (select count(*) = 0 from notable_claims where id = '30000000-0000-0000-0000-0000000000c2')
  and (select count(*) = 0 from notable_claim_types where claim_id = '30000000-0000-0000-0000-0000000000c2'),
  'the win and its tags are gone');
select winedit_test.assert_true(
  winedit_test.refusal($$select delete_notable_win('30000000-0000-0000-0000-0000000000c2',
    '30000000-0000-0000-0000-000000000002')$$) = 'no such win',
  'deleting twice is refused');
select winedit_test.assert_true(
  (select count(*) = 1 from notable_claims where id = '30000000-0000-0000-0000-0000000000c1'),
  'the other win was not touched');
