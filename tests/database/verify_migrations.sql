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
select test_support.assert_true(
  to_regprocedure('public.expire_abandoned_forming_game(uuid,timestamp with time zone)') is not null,
  'expire_abandoned_forming_game exists'
);
select test_support.assert_true(
  not has_column_privilege('authenticated', 'public.players', 'email', 'select'),
  'authenticated cannot select player emails'
);

-- 0007: the counter alone ends a chip match (spec 8.6). The old four-player confirmation is
-- GONE, not merely unused — a surviving confirm_chip_result would still be callable by the
-- service role and would still finalize on a fourth confirmation.
select test_support.assert_true(
  to_regprocedure('public.end_chip_game(uuid,uuid)') is not null,
  'end_chip_game exists'
);
select test_support.assert_true(
  to_regprocedure('public.confirm_chip_result(uuid,uuid)') is null,
  'confirm_chip_result is gone'
);
select test_support.assert_true(
  to_regprocedure('public.propose_chip_counts(uuid,jsonb,uuid)') is not null,
  'propose_chip_counts takes the proposing player'
);
select test_support.assert_true(
  to_regprocedure('public.propose_chip_counts(uuid,jsonb)') is null,
  'the anonymous two-argument propose_chip_counts is gone'
);
select test_support.assert_true(
  (select count(*) = 1 from pg_attribute
   where attrelid = 'public.games'::regclass and attname = 'pending_proposed_by'
     and not attisdropped),
  'games.pending_proposed_by exists'
);
-- Vestigial, deliberately kept (spec 8.6): dropping it would mean re-issuing expire_game,
-- reopen_game and 0002's cleanup blocks, and re-verifying the hardening of all three.
select test_support.assert_true(
  (select count(*) = 1 from pg_attribute
   where attrelid = 'public.games'::regclass and attname = 'pending_confirmed'
     and not attisdropped),
  'pending_confirmed survives as a vestigial column'
);

-- 0004 is the complete ACL source of truth. These assertions deliberately test both table-level
-- and column-level grants so a broad grant cannot hide behind the safe players column list.
do $$
declare
  r record;
  col record;
  v_readable boolean;
begin
  for r in
    select cls.oid, cls.relname, cls.relkind
    from pg_class cls
    join pg_namespace n on n.oid = cls.relnamespace
    where n.nspname = 'public' and cls.relkind in ('r', 'p', 'v', 'm')
  loop
    if has_table_privilege('anon', r.oid, 'select,insert,update,delete,truncate,references,trigger')
      or has_any_column_privilege('anon', r.oid, 'select,insert,update,references')
    then
      raise exception 'anon has direct access to public relation %', r.relname;
    end if;

    if r.relkind in ('r', 'p') then
      if has_table_privilege('authenticated', r.oid, 'insert,update,delete,truncate,references,trigger')
        or has_any_column_privilege('authenticated', r.oid, 'insert,update,references')
      then
        raise exception 'authenticated can write public table %', r.relname;
      end if;

      v_readable := r.relname in (
        'tables', 'games', 'game_players', 'notable_hands', 'notable_claims', 'notable_claim_types',
        'presets', 'hands', 'scoring_events', 'point_movements'
      );
      if r.relname = 'players' then
        if has_table_privilege('authenticated', r.oid, 'select') then
          raise exception 'authenticated has broad players SELECT';
        end if;
        for col in
          select attname
          from pg_attribute
          where attrelid = r.oid and attnum > 0 and not attisdropped
        loop
          if has_column_privilege('authenticated', r.oid, col.attname, 'select')
             is distinct from (col.attname in ('id', 'display_name', 'created_at', 'house'))
          then
            raise exception 'authenticated players column access is wrong for %', col.attname;
          end if;
        end loop;
      elsif has_table_privilege('authenticated', r.oid, 'select') is distinct from v_readable then
        raise exception 'authenticated SELECT access is wrong for table %', r.relname;
      end if;

      if not (
        select bool_and(has_table_privilege('service_role', r.oid, privilege))
        from unnest(array['select','insert','update','delete','truncate','references','trigger']) privilege
      ) then
        raise exception 'service_role lacks full access to table %', r.relname;
      end if;
    else
      v_readable := r.relname in ('lifetime_board', 'skill_board', 'form_board');
      if has_table_privilege('authenticated', r.oid, 'select') is distinct from v_readable then
        raise exception 'authenticated SELECT access is wrong for view %', r.relname;
      end if;
      if has_table_privilege('authenticated', r.oid, 'insert,update,delete,truncate,references,trigger') then
        raise exception 'authenticated can write view %', r.relname;
      end if;
      if not has_table_privilege('service_role', r.oid, 'select') then
        raise exception 'service_role cannot select view %', r.relname;
      end if;
    end if;
  end loop;
end $$;

do $$
declare r record;
begin
  for r in
    select c.oid, c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'S'
  loop
    if has_sequence_privilege('anon', r.oid, 'usage,select,update') then
      raise exception 'anon has access to sequence %', r.relname;
    end if;
    if has_sequence_privilege('authenticated', r.oid, 'usage,select,update') then
      raise exception 'authenticated has access to sequence %', r.relname;
    end if;
    if not (
      select bool_and(has_sequence_privilege('service_role', r.oid, privilege))
      from unnest(array['usage','select','update']) privilege
    ) then
      raise exception 'service_role lacks full access to sequence %', r.relname;
    end if;
  end loop;
end $$;

-- Future objects do not inherit browser or service-role access. Each migration must make its
-- own deliberate grants; functions also opt out of Postgres' EXECUTE-to-PUBLIC default.
do $$
declare
  v_owner oid := (select oid from pg_roles where rolname = current_user);
  v_namespace oid := 'public'::regnamespace;
  v_acl aclitem[];
  r record;
begin
  for r in select * from (values ('r'::"char"), ('S'::"char"), ('f'::"char")) as kinds(kind)
  loop
    select d.defaclacl into v_acl
    from pg_default_acl d
    where d.defaclrole = v_owner
      and d.defaclnamespace = 0
      and d.defaclobjtype = r.kind;
    v_acl := coalesce(v_acl, acldefault(r.kind, v_owner));
    if exists (
      select 1
      from aclexplode(v_acl) a
      left join pg_roles grantee on grantee.oid = a.grantee
      where a.grantee = 0 or grantee.rolname in ('anon', 'authenticated', 'service_role')
    ) then
      raise exception 'unsafe global default privilege remains for object type %', r.kind;
    end if;
    if exists (
      select 1
      from pg_default_acl d
      cross join lateral aclexplode(d.defaclacl) a
      left join pg_roles grantee on grantee.oid = a.grantee
      where d.defaclrole = v_owner
        and d.defaclnamespace = v_namespace
        and d.defaclobjtype = r.kind
        and (a.grantee = 0 or grantee.rolname in ('anon', 'authenticated', 'service_role'))
    ) then
      raise exception 'unsafe public-schema default privilege remains for object type %', r.kind;
    end if;
  end loop;
end $$;

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
        'end_chip_game', 'expire_game', 'expire_abandoned_game',
        'expire_abandoned_forming_game',
        'reopen_game', 'log_notable_claim', 'log_notable_win', 'handle_new_user',
        'record_hand', 'void_hand', 'end_game', 'end_abandoned_game',
        'clear_notable_photo', 'choose_house'
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

select test_support.assert_true(
  (select relrowsecurity from pg_class where oid = 'public.notable_claim_types'::regclass),
  'notable_claim_types keeps RLS enabled'
);

select test_support.assert_true(
  not has_table_privilege('authenticated', 'public.notable_claim_types',
    'insert,update,delete,truncate,references,trigger'),
  'authenticated cannot write notable_claim_types'
);

-- enforce_permanent_house is not in the list above on purpose: it is a trigger function, and a
-- trigger fires on the strength of the EXECUTE check made when the trigger was created. It
-- should therefore carry no execute grant at all, including for service_role.
select test_support.assert_true(
  not has_function_privilege('anon', 'public.enforce_permanent_house()', 'execute')
    and not has_function_privilege('authenticated', 'public.enforce_permanent_house()', 'execute')
    and not has_function_privilege('service_role', 'public.enforce_permanent_house()', 'execute'),
  'the house permanence trigger function carries no execute grant'
);

do $$
declare
  r record;
  seen int := 0;
begin
  for r in
    select c.oid, c.relname, c.reloptions
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('lifetime_board', 'form_board', 'skill_board')
  loop
    if has_table_privilege('anon', r.oid, 'select') then
      raise exception 'anon can select protected view %', r.relname;
    end if;
    if not has_table_privilege('authenticated', r.oid, 'select') then
      raise exception 'authenticated cannot select board view %', r.relname;
    end if;
    if r.reloptions is null or not (r.reloptions @> array['security_invoker=true']) then
      raise exception 'board view % is not security_invoker', r.relname;
    end if;
    if not exists (
      select 1 from pg_attribute
      where attrelid = r.oid and attname = 'house' and attnum > 0 and not attisdropped
    ) then
      raise exception 'board view % does not expose house', r.relname;
    end if;
    seen := seen + 1;
  end loop;
  if seen <> 3 then raise exception 'expected three hardened board views, found %', seen; end if;
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
  ('10000000-0000-0000-0000-000000000007', 'table-7', 'Test table 7'),
  ('10000000-0000-0000-0000-000000000008', 'table-8', 'Test table 8'),
  ('10000000-0000-0000-0000-000000000009', 'table-9', 'Test table 9');

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

-- A forming-game snapshot cannot expire a game that has since started.
insert into games (id, table_id, mode, status, created_at, last_activity_at)
values (
  '20000000-0000-0000-0000-000000000008',
  '10000000-0000-0000-0000-000000000008',
  'chips', 'forming', '2020-08-02 03:04:05+00', '2020-08-02 03:04:05+00'
);
update games set status = 'active', last_activity_at = now()
where id = '20000000-0000-0000-0000-000000000008';
select test_support.assert_true(
  not expire_abandoned_forming_game(
    '20000000-0000-0000-0000-000000000008',
    '2020-08-02 03:04:05+00'
  ),
  'stale forming snapshot cannot expire a game that has started'
);
select test_support.assert_true(
  (select status = 'active' from games where id = '20000000-0000-0000-0000-000000000008'),
  'started game survives old forming-game expiry request'
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
    '[{"type":"bonus","payload":{},"tai":1,"movements":[]}]'::jsonb,
    '[{"type":"win","payload":{},"winner_player_id":"00000000-0000-0000-0000-000000000001","tai":1,"movements":[]}]'::jsonb,
    '[{"type":"bonus","payload":{},"movements":[]}]'::jsonb,
    '[{"type":"reversal","payload":{},"movements":[
      {"player_id":"00000000-0000-0000-0000-000000000001","seat":"E","points":0},
      {"player_id":"00000000-0000-0000-0000-000000000002","seat":"S","points":0},
      {"player_id":"00000000-0000-0000-0000-000000000003","seat":"W","points":0},
      {"player_id":"00000000-0000-0000-0000-000000000004","seat":"N","points":0}
    ]}]'::jsonb,
    '[{"type":"win","payload":{},"winner_player_id":"00000000-0000-0000-0000-000000000005","tai":1,"movements":[
      {"player_id":"00000000-0000-0000-0000-000000000001","seat":"E","points":0},
      {"player_id":"00000000-0000-0000-0000-000000000002","seat":"S","points":0},
      {"player_id":"00000000-0000-0000-0000-000000000003","seat":"W","points":0},
      {"player_id":"00000000-0000-0000-0000-000000000004","seat":"N","points":0}
    ]}]'::jsonb,
    '[{"type":"win","payload":{},"winner_player_id":"00000000-0000-0000-0000-000000000001","tai":1,"movements":[
      {"player_id":"00000000-0000-0000-0000-000000000001","seat":"E","points":0},
      {"player_id":"00000000-0000-0000-0000-000000000001","seat":"E","points":0},
      {"player_id":"00000000-0000-0000-0000-000000000003","seat":"W","points":0},
      {"player_id":"00000000-0000-0000-0000-000000000004","seat":"N","points":0}
    ]}]'::jsonb
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

-- The early app quarantine branch also clears any stale/pre-existing totals.
insert into games (id, table_id, mode, status, last_activity_at)
values (
  '20000000-0000-0000-0000-000000000009',
  '10000000-0000-0000-0000-000000000009',
  'app', 'active', '2020-09-02 03:04:05+00'
);
insert into game_players (game_id, player_id, seat, final_total) values
  ('20000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-000000000001', 'E', 10),
  ('20000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-000000000002', 'S', -5),
  ('20000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-000000000003', 'W', -5);
select test_support.assert_true(
  end_game('20000000-0000-0000-0000-000000000009') = 'quarantined',
  'wrong player-row count quarantines app ending'
);
select test_support.assert_true(
  (select count(final_total) = 0 from game_players where game_id = '20000000-0000-0000-0000-000000000009'),
  'every app quarantine branch clears unpublished totals'
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

-- Column-scoped player access still supports all three security-invoker boards, house included.
set role authenticated;
select count(*) from (select id, display_name, house from lifetime_board) x;
select count(*) from (select id, display_name, house from form_board) x;
select count(*) from (select id, display_name, house from skill_board) x;
reset role;

-- 0008: the academic-year rule and the rename function. Re-checked on EVERY database shape
-- rather than only inside 0008's own transaction, because a later migration could replace these
-- functions and 0008's assertions would never run again to notice.
select test_support.assert_true(
  to_regprocedure('public.set_display_name(uuid,text)') is not null,
  'set_display_name exists'
);
select test_support.assert_true(
  not has_function_privilege('anon', 'public.set_display_name(uuid,text)', 'execute')
  and not has_function_privilege('authenticated', 'public.set_display_name(uuid,text)', 'execute'),
  'no browser role may execute set_display_name'
);
select test_support.assert_true(
  (select reloptions::text[] @> array['security_invoker=true']
   from pg_class where oid = 'public.lifetime_board_by_year'::regclass),
  'lifetime_board_by_year keeps security_invoker'
);
select test_support.assert_true(
  (select reloptions::text[] @> array['security_invoker=true']
   from pg_class where oid = 'public.academic_years'::regclass),
  'academic_years keeps security_invoker'
);
-- Both halves. The new views are server-read only, so no browser role may select them -- but
-- service_role must, or the boards would simply be broken rather than secured.
select test_support.assert_true(
  has_table_privilege('service_role', 'public.lifetime_board_by_year', 'select')
  and has_table_privilege('service_role', 'public.academic_years', 'select'),
  'service_role can read the academic-year views'
);
-- Both edges of the first-Monday rule, named rather than spot-checked so the assertion cannot
-- quietly cover the easy case twice. 7 Aug 2023 IS a Monday; 7 Aug 2022 is a Sunday, the
-- furthest the truncation ever reaches back.
select test_support.assert_true(
  academic_year_start(2026) = date '2026-08-03'
  and academic_year_start(2023) = date '2023-08-07'
  and academic_year_start(2022) = date '2022-08-01',
  'the first-Monday-of-August rule holds at both edges'
);
-- 16:30 UTC on 2 August is 00:30 on 3 August in Singapore, the first day of AY26/27. Mahjong
-- runs late, so this is a real night of play rather than a hypothetical.
select test_support.assert_true(
  academic_year_of(timestamptz '2026-08-02 16:30+00') = 2026
  and academic_year_of(timestamptz '2026-08-02 15:59+00') = 2025,
  'a late-night game is filed by the Singapore date, not the UTC date'
);

drop schema test_support cascade;
