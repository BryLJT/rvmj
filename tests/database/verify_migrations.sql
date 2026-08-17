\set ON_ERROR_STOP on

create schema test_support;
create function test_support.assert_true(condition boolean, message text) returns void
language plpgsql as $$
begin
  if condition is not true then
    raise exception 'assertion failed: %', message;
  end if;
end $$;

select test_support.assert_true(
  to_regprocedure('public.expire_abandoned_game(uuid,timestamp with time zone)') is not null,
  'expire_abandoned_game exists'
);
select test_support.assert_true(
  to_regprocedure('public.end_abandoned_game(uuid,timestamp with time zone)') is not null,
  'end_abandoned_game exists'
);

do $$
declare
  r record;
begin
  for r in
    select p.oid, p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'start_game', 'create_game_with_seat', 'propose_chip_counts',
        'confirm_chip_result', 'expire_game', 'expire_abandoned_game',
        'reopen_game', 'log_notable_claim', 'handle_new_user',
        'record_hand', 'void_hand', 'end_game', 'end_abandoned_game'
      )
  loop
    if has_function_privilege('anon', r.oid, 'execute') then
      raise exception 'anon can execute protected function %', r.proname;
    end if;
    if has_function_privilege('authenticated', r.oid, 'execute') then
      raise exception 'authenticated can execute protected function %', r.proname;
    end if;
    if not has_function_privilege('service_role', r.oid, 'execute') then
      raise exception 'service_role cannot execute protected function %', r.proname;
    end if;
  end loop;
end $$;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-000000000001', 'east@example.com', '{"full_name":"East"}'),
  ('00000000-0000-0000-0000-000000000002', 'south@example.com', '{"full_name":"South"}'),
  ('00000000-0000-0000-0000-000000000003', 'west@example.com', '{"full_name":"West"}'),
  ('00000000-0000-0000-0000-000000000004', 'north@example.com', '{"full_name":"North"}'),
  ('00000000-0000-0000-0000-000000000005', 'outsider@example.com', '{"full_name":"Outsider"}');

insert into tables (id, code, label) values
  ('10000000-0000-0000-0000-000000000001', 'table-1', 'Test table 1'),
  ('10000000-0000-0000-0000-000000000002', 'table-2', 'Test table 2'),
  ('10000000-0000-0000-0000-000000000003', 'table-3', 'Test table 3'),
  ('10000000-0000-0000-0000-000000000004', 'table-4', 'Test table 4'),
  ('10000000-0000-0000-0000-000000000005', 'table-5', 'Test table 5'),
  ('10000000-0000-0000-0000-000000000006', 'table-6', 'Test table 6'),
  ('10000000-0000-0000-0000-000000000007', 'table-7', 'Test table 7');

-- An actual service-role call, not only an ACL read-back.
insert into games (id, table_id, mode, status, last_activity_at)
values (
  '20000000-0000-0000-0000-000000000007',
  '10000000-0000-0000-0000-000000000007',
  'chips', 'active', '2020-07-02 03:04:05+00'
);
set role service_role;
select expire_abandoned_game(
  '20000000-0000-0000-0000-000000000007',
  '2020-07-02 03:04:05+00'
);
reset role;
select test_support.assert_true(
  (select status = 'expired' from games where id = '20000000-0000-0000-0000-000000000007'),
  'service_role executes guarded abandonment function'
);

-- Chip: unchanged stale row expires; a repeated confirmation is harmless.
insert into games (id, table_id, mode, status, last_activity_at)
values (
  '20000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  'chips', 'active', '2020-01-02 03:04:05.678+00'
);
select test_support.assert_true(
  expire_abandoned_game(
    '20000000-0000-0000-0000-000000000001',
    '2020-01-02 03:04:05.678+00'
  ),
  'unchanged abandoned chip game expires'
);
select test_support.assert_true(
  not expire_abandoned_game(
    '20000000-0000-0000-0000-000000000001',
    '2020-01-02 03:04:05.678+00'
  ),
  'second chip confirmation is a harmless false result'
);

-- Resume first: old confirmation cannot erase the refreshed match.
insert into games (id, table_id, mode, status, last_activity_at)
values (
  '20000000-0000-0000-0000-000000000002',
  '10000000-0000-0000-0000-000000000002',
  'chips', 'active', '2020-02-02 03:04:05+00'
);
update games set last_activity_at = now()
where id = '20000000-0000-0000-0000-000000000002' and status = 'active';
select test_support.assert_true(
  not expire_abandoned_game(
    '20000000-0000-0000-0000-000000000002',
    '2020-02-02 03:04:05+00'
  ),
  'old chip confirmation loses after resume'
);
select test_support.assert_true(
  (select status = 'active' from games where id = '20000000-0000-0000-0000-000000000002'),
  'resumed chip game remains active'
);

-- Void first: the existing status-guarded resume updates zero rows.
insert into games (id, table_id, mode, status, last_activity_at)
values (
  '20000000-0000-0000-0000-000000000003',
  '10000000-0000-0000-0000-000000000003',
  'chips', 'active', '2020-03-02 03:04:05+00'
);
select expire_abandoned_game(
  '20000000-0000-0000-0000-000000000003',
  '2020-03-02 03:04:05+00'
);
do $$
declare changed int;
begin
  update games set last_activity_at = now()
  where id = '20000000-0000-0000-0000-000000000003' and status = 'active';
  get diagnostics changed = row_count;
  if changed <> 0 then raise exception 'resume changed an already expired game'; end if;
end $$;

-- log_notable_claim is chip-only.
insert into games (id, table_id, mode, status, last_activity_at)
values (
  '20000000-0000-0000-0000-000000000004',
  '10000000-0000-0000-0000-000000000004',
  'app', 'active', now()
);
insert into game_players (game_id, player_id, seat) values
  ('20000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000001', 'E');
do $$
declare rejected boolean := false;
begin
  begin
    perform log_notable_claim(
      '20000000-0000-0000-0000-000000000004',
      '00000000-0000-0000-0000-000000000001',
      (select id from notable_hands limit 1),
      '00000000-0000-0000-0000-000000000001'
    );
  exception when others then rejected := true;
  end;
  if not rejected then raise exception 'app-mode notable claim was accepted'; end if;
end $$;

-- A normal four-player app game for actor/movement/tai validation and ending.
insert into games (id, table_id, mode, status, last_activity_at)
values (
  '20000000-0000-0000-0000-000000000005',
  '10000000-0000-0000-0000-000000000005',
  'app', 'active', '2020-05-02 03:04:05+00'
);
insert into game_players (game_id, player_id, seat) values
  ('20000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000001', 'E'),
  ('20000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000002', 'S'),
  ('20000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000003', 'W'),
  ('20000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000004', 'N');

do $$
declare
  bad_events jsonb[] := array[
    '[{"type":"win","payload":{},"winner_player_id":"00000000-0000-0000-0000-000000000001","movements":[]}]'::jsonb,
    '[{"type":"win","payload":{},"winner_player_id":"00000000-0000-0000-0000-000000000001","tai":0,"movements":[]}]'::jsonb,
    '[{"type":"win","payload":{},"winner_player_id":"00000000-0000-0000-0000-000000000001","tai":-1,"movements":[]}]'::jsonb,
    '[{"type":"win","payload":{},"winner_player_id":"00000000-0000-0000-0000-000000000001","tai":1.5,"movements":[]}]'::jsonb,
    '[{"type":"bonus","payload":{},"tai":1,"movements":[]}]'::jsonb
  ];
  candidate jsonb;
  rejected boolean;
begin
  foreach candidate in array bad_events loop
    rejected := false;
    begin
      perform record_hand(
        '20000000-0000-0000-0000-000000000005',
        '00000000-0000-0000-0000-000000000001',
        candidate
      );
    exception when others then rejected := true;
    end;
    if not rejected then raise exception 'invalid tai payload accepted: %', candidate; end if;
  end loop;
end $$;

do $$
declare rejected boolean := false;
begin
  begin
    perform record_hand(
      '20000000-0000-0000-0000-000000000005',
      '00000000-0000-0000-0000-000000000005',
      '[]'::jsonb
    );
  exception when others then rejected := true;
  end;
  if not rejected then raise exception 'non-participant recorded_by was accepted'; end if;
end $$;

do $$
declare
  candidate jsonb;
  rejected boolean;
begin
  foreach candidate in array array[
    '[{"type":"win","payload":{},"winner_player_id":"00000000-0000-0000-0000-000000000001","tai":1,"movements":[{"player_id":"00000000-0000-0000-0000-000000000005","seat":"E","points":0}]}]'::jsonb,
    '[{"type":"win","payload":{},"winner_player_id":"00000000-0000-0000-0000-000000000001","tai":1,"movements":[{"player_id":"00000000-0000-0000-0000-000000000002","seat":"W","points":0}]}]'::jsonb
  ] loop
    rejected := false;
    begin
      perform record_hand(
        '20000000-0000-0000-0000-000000000005',
        '00000000-0000-0000-0000-000000000001',
        candidate
      );
    exception when others then rejected := true;
    end;
    if not rejected then raise exception 'foreign player/seat movement accepted: %', candidate; end if;
  end loop;
end $$;

select record_hand(
  '20000000-0000-0000-0000-000000000005',
  '00000000-0000-0000-0000-000000000001',
  '[{"type":"win","payload":{},"winner_player_id":"00000000-0000-0000-0000-000000000001","tai":1,"movements":[
    {"player_id":"00000000-0000-0000-0000-000000000001","seat":"E","points":3},
    {"player_id":"00000000-0000-0000-0000-000000000002","seat":"S","points":-1},
    {"player_id":"00000000-0000-0000-0000-000000000003","seat":"W","points":-1},
    {"player_id":"00000000-0000-0000-0000-000000000004","seat":"N","points":-1}
  ]}]'::jsonb
);

do $$
declare rejected boolean := false;
begin
  begin
    perform void_hand(
      (select id from hands where game_id = '20000000-0000-0000-0000-000000000005' limit 1),
      '00000000-0000-0000-0000-000000000005'
    );
  exception when others then rejected := true;
  end;
  if not rejected then raise exception 'non-participant void actor was accepted'; end if;
end $$;

select test_support.assert_true(
  end_abandoned_game(
    '20000000-0000-0000-0000-000000000005',
    '2020-05-02 03:04:05+00'
  ) = 'changed',
  'app abandonment returns changed after record_hand refreshed activity'
);

update games set last_activity_at = '2020-05-03 03:04:05+00'
where id = '20000000-0000-0000-0000-000000000005';
select test_support.assert_true(
  end_abandoned_game(
    '20000000-0000-0000-0000-000000000005',
    '2020-05-03 03:04:05+00'
  ) = 'ended',
  'unchanged abandoned app game finishes through normal ending'
);
select test_support.assert_true(
  (select count(*) = 4 and count(final_total) = 4 and sum(final_total) = 0
   from game_players where game_id = '20000000-0000-0000-0000-000000000005'),
  'normal app ending writes four non-null zero-sum totals'
);

-- Corrupt but globally zero-sum ledger: a foreign player absorbs +10, so the four seated
-- totals sum to -10. end_game must quarantine and clear unpublished totals.
insert into games (id, table_id, mode, status, last_activity_at)
values (
  '20000000-0000-0000-0000-000000000006',
  '10000000-0000-0000-0000-000000000006',
  'app', 'active', '2020-06-02 03:04:05+00'
);
insert into game_players (game_id, player_id, seat) values
  ('20000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000001', 'E'),
  ('20000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000002', 'S'),
  ('20000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000003', 'W'),
  ('20000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000004', 'N');
insert into hands (id, game_id, seq, recorded_by) values (
  '30000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000006', 1,
  '00000000-0000-0000-0000-000000000001'
);
insert into scoring_events (id, hand_id, type, payload, winner_player_id, tai) values (
  '40000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001', 'win', '{}',
  '00000000-0000-0000-0000-000000000001', 1
);
insert into point_movements (event_id, hand_id, game_id, player_id, seat, points) values
  ('40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000005', 'E', 10),
  ('40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000001', 'E', -10);
select test_support.assert_true(
  end_abandoned_game(
    '20000000-0000-0000-0000-000000000006',
    '2020-06-02 03:04:05+00'
  ) = 'quarantined',
  'corrupt abandoned app ending propagates quarantine'
);
select test_support.assert_true(
  (select status = 'quarantined' from games where id = '20000000-0000-0000-0000-000000000006'),
  'corrupt ending stores quarantined status'
);
select test_support.assert_true(
  (select count(final_total) = 0 from game_players where game_id = '20000000-0000-0000-0000-000000000006'),
  'quarantined totals are not published'
);

-- Constraint replacement removed only the derivation check, not the future check installed
-- by the harness between 0001 and 0002.
select test_support.assert_true(
  exists (
    select 1 from pg_constraint
    where conrelid = 'game_players'::regclass and conname = 'test_future_final_total_check'
  ),
  'unrelated future final_total check survives migration logic'
);

drop schema test_support cascade;
