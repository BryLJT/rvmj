\set ON_ERROR_STOP on

-- Behavioural proofs for migration 0006, run against a database rebuilt from 0001 through 0006.
-- Denial probes live in run-migrations.sh instead, using the existing "run it as the role and
-- expect a non-zero exit" idiom: a caught exception inside plpgsql cannot distinguish "denied"
-- from "the probe itself was wrong".
create schema house_test;
create function house_test.assert_true(condition boolean, message text) returns void
language plpgsql as $$
begin
  if condition is not true then
    raise exception 'assertion failed: %', message;
  end if;
end $$;

-- handle_new_user turns each auth user into a player, so this is the real creation path.
insert into auth.users (id, email, raw_user_meta_data) values
  ('0a000000-0000-0000-0000-000000000000', 'house-none@example.com',    '{"full_name":"No House"}'),
  ('0a000000-0000-0000-0000-000000000001', 'house-manis@example.com',   '{"full_name":"Manis Player"}'),
  ('0a000000-0000-0000-0000-000000000002', 'house-strix@example.com',   '{"full_name":"Strix Player"}'),
  ('0a000000-0000-0000-0000-000000000003', 'house-aonynx@example.com',  '{"full_name":"Aonynx Player"}'),
  ('0a000000-0000-0000-0000-000000000004', 'house-orcaella@example.com','{"full_name":"Orcaella Player"}'),
  ('0a000000-0000-0000-0000-000000000005', 'house-rusa@example.com',    '{"full_name":"Rusa Player"}'),
  ('0a000000-0000-0000-0000-000000000006', 'house-chelonia@example.com','{"full_name":"Chelonia Player"}'),
  ('0a000000-0000-0000-0000-000000000007', 'house-panthera@example.com','{"full_name":"Panthera Player"}'),
  ('0a000000-0000-0000-0000-000000000008', 'house-second@example.com',  '{"full_name":"Second Call"}'),
  ('0a000000-0000-0000-0000-000000000009', 'house-operator@example.com','{"full_name":"Operator Target"}'),
  ('0a000000-0000-0000-0000-00000000000a', 'house-race@example.com',    '{"full_name":"Race Player"}'),
  ('0a000000-0000-0000-0000-00000000000b', 'house-shape@example.com',   '{"full_name":"Row Shape"}');

-- Null is valid for every player, new or pre-existing. There is no default: assigning a house
-- automatically would violate the product decision that the player chooses it.
select house_test.assert_true(
  (select count(*) = 12 from players where id::text like '0a000000%' and house is null),
  'every player starts with no house'
);
select house_test.assert_true(
  (select attnotnull = false from pg_attribute
   where attrelid = 'public.players'::regclass and attname = 'house'),
  'players.house is nullable'
);
select house_test.assert_true(
  (select not atthasdef from pg_attribute
   where attrelid = 'public.players'::regclass and attname = 'house'),
  'players.house has no default'
);

-- All seven identifiers are accepted, through the real write path.
do $$
declare
  v_ids uuid[] := array[
    '0a000000-0000-0000-0000-000000000001','0a000000-0000-0000-0000-000000000002',
    '0a000000-0000-0000-0000-000000000003','0a000000-0000-0000-0000-000000000004',
    '0a000000-0000-0000-0000-000000000005','0a000000-0000-0000-0000-000000000006',
    '0a000000-0000-0000-0000-000000000007'
  ];
  v_houses text[] := array['manis','strix','aonynx','orcaella','rusa','chelonia','panthera'];
  v_stored text;
  v_applied boolean;
  i int;
begin
  for i in 1..7 loop
    select stored_house, applied into v_stored, v_applied from choose_house(v_ids[i], v_houses[i]);
    if v_stored is distinct from v_houses[i] or v_applied is not true then
      raise exception 'choose_house did not set % (stored %, applied %)', v_houses[i], v_stored, v_applied;
    end if;
  end loop;
end $$;

select house_test.assert_true(
  (select count(distinct house) = 7 from players where id::text like '0a000000%'),
  'all seven houses are stored'
);

-- Exactly ONE row, on both paths. `select ... into` takes the first row and discards the rest,
-- so every other test here would stay green while the function quietly returned a second,
-- bogus row — and a PostgREST caller asking for a single object would then fail outright.
select house_test.assert_true(
  (select count(*) = 1 from choose_house('0a000000-0000-0000-0000-00000000000b', 'manis')),
  'choose_house returns exactly one row when it sets the house'
);
select house_test.assert_true(
  (select count(*) = 1 from choose_house('0a000000-0000-0000-0000-00000000000b', 'strix')),
  'choose_house returns exactly one row when the house was already set'
);
select house_test.assert_true(
  (select stored_house = 'manis' and applied = false
   from choose_house('0a000000-0000-0000-0000-00000000000b', 'strix')),
  'the already-set row names the stored house'
);

-- An invalid identifier is rejected twice over: by the function, and by the column constraint
-- underneath it. Each block proves the guard it names, so the sentinel raise sits OUTSIDE the
-- handler; a bare raise inside would be caught by its own exception clause.
do $$
declare v_blocked boolean := false;
begin
  begin
    perform 1 from choose_house('0a000000-0000-0000-0000-000000000000', 'gryffindor');
  exception when raise_exception then v_blocked := true;
  end;
  if not v_blocked then raise exception 'choose_house accepted an unknown house'; end if;
end $$;

do $$
declare v_blocked boolean := false;
begin
  begin
    update players set house = 'gryffindor' where id = '0a000000-0000-0000-0000-000000000000';
  exception when check_violation then v_blocked := true;
  end;
  if not v_blocked then raise exception 'the check constraint accepted an unknown house'; end if;
end $$;

-- Second call with a DIFFERENT house: the stored value wins and nothing is written.
do $$
declare v_stored text; v_applied boolean;
begin
  perform 1 from choose_house('0a000000-0000-0000-0000-000000000008', 'manis');
  select stored_house, applied into v_stored, v_applied
  from choose_house('0a000000-0000-0000-0000-000000000008', 'strix');
  if v_stored is distinct from 'manis' or v_applied is not false then
    raise exception 'a second choice was not resolved to the stored house (got %, applied %)', v_stored, v_applied;
  end if;
end $$;
select house_test.assert_true(
  (select house = 'manis' from players where id = '0a000000-0000-0000-0000-000000000008'),
  'the second choice did not overwrite the permanent house'
);

-- Same-value retry is a harmless no-op, through the function and through a direct update.
do $$
declare v_stored text; v_applied boolean;
begin
  select stored_house, applied into v_stored, v_applied
  from choose_house('0a000000-0000-0000-0000-000000000008', 'manis');
  if v_stored is distinct from 'manis' or v_applied is not false then
    raise exception 'the same-house retry did not resolve to manis (got %, applied %)', v_stored, v_applied;
  end if;
end $$;
update players set house = 'manis' where id = '0a000000-0000-0000-0000-000000000008';

-- The trigger rejects a change to a different value, and a change back to null.
do $$
declare v_blocked boolean := false;
begin
  begin
    update players set house = 'strix' where id = '0a000000-0000-0000-0000-000000000008';
  exception when raise_exception then v_blocked := true;
  end;
  if not v_blocked then raise exception 'the permanence trigger allowed a house change'; end if;
end $$;

do $$
declare v_blocked boolean := false;
begin
  begin
    update players set house = null where id = '0a000000-0000-0000-0000-000000000008';
  exception when raise_exception then v_blocked := true;
  end;
  if not v_blocked then raise exception 'the permanence trigger allowed a house to be cleared'; end if;
end $$;

-- The same guard holds for a direct service-role update. This is the case that matters: the
-- service role bypasses RLS and owns every write in the app, so if permanence lived anywhere
-- but a trigger, this is exactly where it would leak.
do $$
declare v_blocked boolean := false;
begin
  perform 1 from choose_house('0a000000-0000-0000-0000-000000000009', 'rusa');
  begin
    set local role service_role;
    update players set house = 'chelonia' where id = '0a000000-0000-0000-0000-000000000009';
  exception when raise_exception then v_blocked := true;
  end;
  reset role;
  if not v_blocked then raise exception 'service_role changed a permanent house'; end if;
end $$;
select house_test.assert_true(
  (select house = 'rusa' from players where id = '0a000000-0000-0000-0000-000000000009'),
  'the operator update left the permanent house alone'
);

-- Grants, read directly from the catalog.
select house_test.assert_true(
  not has_function_privilege('anon', 'public.choose_house(uuid,text)', 'execute')
    and not has_function_privilege('authenticated', 'public.choose_house(uuid,text)', 'execute')
    and has_function_privilege('service_role', 'public.choose_house(uuid,text)', 'execute'),
  'choose_house is executable by the service role only'
);
select house_test.assert_true(
  not has_function_privilege('anon', 'public.enforce_permanent_house()', 'execute')
    and not has_function_privilege('authenticated', 'public.enforce_permanent_house()', 'execute')
    and not has_function_privilege('service_role', 'public.enforce_permanent_house()', 'execute'),
  'the trigger function carries no execute grant at all'
);
select house_test.assert_true(
  has_column_privilege('authenticated', 'public.players', 'house', 'select')
    and not has_column_privilege('authenticated', 'public.players', 'email', 'select')
    and not has_column_privilege('authenticated', 'public.players', 'house', 'update'),
  'authenticated reads house, never email, and writes nothing'
);

-- All three boards expose house and still run as the reader.
do $$
declare r record; seen int := 0;
begin
  for r in
    select c.oid, c.relname, c.reloptions
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname in ('lifetime_board', 'form_board', 'skill_board')
  loop
    if not exists (
      select 1 from pg_attribute
      where attrelid = r.oid and attname = 'house' and attnum > 0 and not attisdropped
    ) then
      raise exception 'board view % does not expose house', r.relname;
    end if;
    if r.reloptions is null or not (r.reloptions @> array['security_invoker=true']) then
      raise exception 'board view % lost security_invoker', r.relname;
    end if;
    seen := seen + 1;
  end loop;
  if seen <> 3 then raise exception 'expected three board views, found %', seen; end if;
end $$;

drop schema house_test cascade;
