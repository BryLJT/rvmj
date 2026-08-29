\set ON_ERROR_STOP on

-- Behavioural proofs for migration 0014, run against a database rebuilt from 0001 through 0014.
--
-- Role denial probes live in run-migrations.sh instead, using the existing "run it as the role and
-- expect a non-zero exit" idiom: a caught exception inside plpgsql cannot distinguish "permission
-- denied" from "the probe itself was wrong".
create schema photo_test;
create function photo_test.assert_true(condition boolean, message text) returns void
language plpgsql as $$
begin
  if condition is not true then
    raise exception 'assertion failed: %', message;
  end if;
end $$;

-- Captures the error a call raises, so a refusal can be asserted BY ITS MESSAGE. Asserting only
-- that "something failed" would pass just as happily if the function were broken outright.
create function photo_test.refusal(sql text) returns text
language plpgsql as $$
begin
  execute sql;
  return '(no error raised)';
exception when others then
  return sqlerrm;
end $$;

-- handle_new_user turns each auth user into a player, so this is the real creation path.
insert into auth.users (id, email, raw_user_meta_data) values
  ('0c000000-0000-0000-0000-000000000001', 'photo-east@example.com',    '{"full_name":"East Player"}'),
  ('0c000000-0000-0000-0000-000000000002', 'photo-south@example.com',   '{"full_name":"South Player"}'),
  ('0c000000-0000-0000-0000-000000000003', 'photo-west@example.com',    '{"full_name":"West Player"}'),
  ('0c000000-0000-0000-0000-000000000004', 'photo-north@example.com',   '{"full_name":"North Player"}'),
  ('0c000000-0000-0000-0000-000000000005', 'photo-outsider@example.com','{"full_name":"Outsider"}');

-- A FINISHED game. This is the whole point of 0014: log_notable_win refuses this game outright,
-- and add_notable_photo must not.
insert into tables (id, code, label)
values ('0c000000-0000-0000-0000-0000000000a1', 'PHOTO14', 'Photo Table');

insert into games (id, table_id, status, mode, started_at, ended_at)
values (
  '0c000000-0000-0000-0000-0000000000f1',
  '0c000000-0000-0000-0000-0000000000a1',
  'ended', 'chips', now() - interval '3 hours', now() - interval '1 hour'
);

insert into game_players (game_id, player_id, seat) values
  ('0c000000-0000-0000-0000-0000000000f1', '0c000000-0000-0000-0000-000000000001', 'E'),
  ('0c000000-0000-0000-0000-0000000000f1', '0c000000-0000-0000-0000-000000000002', 'S'),
  ('0c000000-0000-0000-0000-0000000000f1', '0c000000-0000-0000-0000-000000000003', 'W'),
  ('0c000000-0000-0000-0000-0000000000f1', '0c000000-0000-0000-0000-000000000004', 'N');

-- The win itself, with NO photo — the situation that previously needed a hand-written insert.
insert into notable_claims (id, game_id, player_id, notable_hand_id, logged_by)
values (
  '0c000000-0000-0000-0000-0000000000c1',
  '0c000000-0000-0000-0000-0000000000f1',
  '0c000000-0000-0000-0000-000000000001',
  (select id from notable_hands order by name limit 1),
  '0c000000-0000-0000-0000-000000000002'
);

-- ---------------------------------------------------------------------------
-- The gap 0014 exists to close.
-- ---------------------------------------------------------------------------
select photo_test.assert_true(
  photo_test.refusal($$
    select log_notable_win(
      '0c000000-0000-0000-0000-0000000000f1'::uuid,
      '0c000000-0000-0000-0000-000000000001'::uuid,
      array[(select id from notable_hands order by name limit 1)]::uuid[],
      '0c000000-0000-0000-0000-000000000002'::uuid,
      'f1/at-log-time.webp'
    )
  $$) = 'game is not an active chip game',
  'the logger still refuses a finished game, which is why add_notable_photo exists'
);

-- ---------------------------------------------------------------------------
-- A participant attaches a photo to a win in an ENDED game.
-- ---------------------------------------------------------------------------
select add_notable_photo(
  '0c000000-0000-0000-0000-0000000000c1',
  '0c000000-0000-0000-0000-000000000003',  -- West: neither the winner nor the logger
  'f1/west-took-it.webp'
);
select photo_test.assert_true(
  (select photo_path = 'f1/west-took-it.webp' and photo_added_by = '0c000000-0000-0000-0000-000000000003'
   from notable_claims where id = '0c000000-0000-0000-0000-0000000000c1'),
  'any player at that table may attach, and the attacher is recorded'
);

-- ---------------------------------------------------------------------------
-- A photo is never overwritten, and a refusal leaves the row exactly as it was.
-- ---------------------------------------------------------------------------
select photo_test.assert_true(
  photo_test.refusal($$
    select add_notable_photo(
      '0c000000-0000-0000-0000-0000000000c1'::uuid,
      '0c000000-0000-0000-0000-000000000004'::uuid,
      'f1/north-tried.webp'
    )
  $$) = 'this win already has a photo',
  'a claim that already has a photo is refused'
);
select photo_test.assert_true(
  (select photo_path = 'f1/west-took-it.webp' and photo_added_by = '0c000000-0000-0000-0000-000000000003'
   from notable_claims where id = '0c000000-0000-0000-0000-0000000000c1'),
  'the refused overwrite changed nothing'
);

-- ---------------------------------------------------------------------------
-- Removal widened: a participant who did NOT attach the photo can still clear it, and clearing
-- takes the attribution with it rather than leaving a name attached to nothing.
-- ---------------------------------------------------------------------------
select photo_test.assert_true(
  clear_notable_photo(
    '0c000000-0000-0000-0000-0000000000c1',
    '0c000000-0000-0000-0000-000000000004'  -- North, who neither logged nor attached
  ) = 'f1/west-took-it.webp',
  'clearing returns the freed path so the caller knows which object to delete'
);
select photo_test.assert_true(
  (select photo_path is null and photo_added_by is null
   from notable_claims where id = '0c000000-0000-0000-0000-0000000000c1'),
  'clearing nulls both the path and who attached it'
);

-- ---------------------------------------------------------------------------
-- Nobody outside the game, on either operation.
-- ---------------------------------------------------------------------------
select photo_test.assert_true(
  photo_test.refusal($$
    select add_notable_photo(
      '0c000000-0000-0000-0000-0000000000c1'::uuid,
      '0c000000-0000-0000-0000-000000000005'::uuid,
      'f1/outsider.webp'
    )
  $$) = 'you did not play in this game',
  'a non-participant cannot attach'
);
select photo_test.assert_true(
  (select photo_path is null from notable_claims where id = '0c000000-0000-0000-0000-0000000000c1'),
  'the refused attach wrote nothing'
);

select add_notable_photo(
  '0c000000-0000-0000-0000-0000000000c1',
  '0c000000-0000-0000-0000-000000000001',
  'f1/east-took-it.webp'
);
select photo_test.assert_true(
  photo_test.refusal($$
    select clear_notable_photo(
      '0c000000-0000-0000-0000-0000000000c1'::uuid,
      '0c000000-0000-0000-0000-000000000005'::uuid
    )
  $$) = 'you did not play in this game',
  'a non-participant cannot clear'
);
select photo_test.assert_true(
  (select photo_path = 'f1/east-took-it.webp' from notable_claims where id = '0c000000-0000-0000-0000-0000000000c1'),
  'the refused clear removed nothing'
);

-- ---------------------------------------------------------------------------
-- Bad input is refused before anything is read or written.
-- ---------------------------------------------------------------------------
select photo_test.assert_true(
  photo_test.refusal($$
    select add_notable_photo(
      '0c000000-0000-0000-0000-0000000000ff'::uuid,
      '0c000000-0000-0000-0000-000000000001'::uuid,
      'f1/nowhere.webp'
    )
  $$) = 'no such win',
  'an unknown claim is refused'
);
select photo_test.assert_true(
  photo_test.refusal($$
    select add_notable_photo(
      '0c000000-0000-0000-0000-0000000000c1'::uuid,
      '0c000000-0000-0000-0000-000000000001'::uuid,
      '   '
    )
  $$) = 'a photo path is required',
  'a blank path is refused'
);
select photo_test.assert_true(
  photo_test.refusal($$
    select add_notable_photo(
      '0c000000-0000-0000-0000-0000000000c1'::uuid,
      '0c000000-0000-0000-0000-000000000001'::uuid,
      null
    )
  $$) = 'a photo path is required',
  'a null path is refused'
);

-- ---------------------------------------------------------------------------
-- The logger attributes its own photo, and attributes nobody when there is none.
-- ---------------------------------------------------------------------------
insert into games (id, table_id, status, mode, started_at)
values (
  '0c000000-0000-0000-0000-0000000000f2',
  '0c000000-0000-0000-0000-0000000000a1',
  'active', 'chips', now()
);
insert into game_players (game_id, player_id, seat) values
  ('0c000000-0000-0000-0000-0000000000f2', '0c000000-0000-0000-0000-000000000001', 'E'),
  ('0c000000-0000-0000-0000-0000000000f2', '0c000000-0000-0000-0000-000000000002', 'S'),
  ('0c000000-0000-0000-0000-0000000000f2', '0c000000-0000-0000-0000-000000000003', 'W'),
  ('0c000000-0000-0000-0000-0000000000f2', '0c000000-0000-0000-0000-000000000004', 'N');

do $$
declare v_with uuid; v_without uuid;
begin
  v_with := log_notable_win(
    '0c000000-0000-0000-0000-0000000000f2',
    '0c000000-0000-0000-0000-000000000001',
    array[(select id from notable_hands order by name limit 1)],
    '0c000000-0000-0000-0000-000000000002',
    'f2/logged-with-photo.webp'
  );
  v_without := log_notable_win(
    '0c000000-0000-0000-0000-0000000000f2',
    '0c000000-0000-0000-0000-000000000001',
    array[(select id from notable_hands order by name limit 1)],
    '0c000000-0000-0000-0000-000000000002'
  );
  perform photo_test.assert_true(
    (select photo_added_by = '0c000000-0000-0000-0000-000000000002' from notable_claims where id = v_with),
    'a photo saved at log time is attributed to the logger'
  );
  perform photo_test.assert_true(
    (select photo_added_by is null from notable_claims where id = v_without),
    'a win logged without a photo attributes nobody'
  );
end $$;

-- ---------------------------------------------------------------------------
-- The backfill holds across everything above.
-- ---------------------------------------------------------------------------
select photo_test.assert_true(
  not exists (select 1 from notable_claims where photo_path is not null and photo_added_by is null),
  'no photographed claim anywhere is missing its attribution'
);

drop schema photo_test cascade;
