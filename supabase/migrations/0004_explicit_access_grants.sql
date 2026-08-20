-- ============================================================================
-- 0004 — explicit access grants
--
-- RLS decides which rows a role may see, but PostgreSQL privileges decide
-- whether it can reach the relation at all. Earlier migrations relied partly
-- on environment default privileges, so a clean database and a hosted one
-- could expose different APIs. This migration makes the current contract
-- explicit and removes automatic grants for future objects.
-- ============================================================================

begin;

do $$
declare v_missing text;
begin
  select string_agg(role_name, ', ' order by role_name) into v_missing
  from unnest(array['anon', 'authenticated', 'service_role']) role_name
  where not exists (select 1 from pg_roles where rolname = role_name);
  if v_missing is not null then
    raise exception 'expected PostgREST roles are missing: %', v_missing;
  end if;
end $$;

-- Start browser roles from zero on every current public relation and sequence.
-- Table-level REVOKE does not remove column ACLs, so clear those separately.
revoke all privileges on all tables in schema public from anon, authenticated;
revoke all privileges on all sequences in schema public from anon, authenticated;

do $$
declare r record;
begin
  for r in
    select cls.oid::regclass as relation,
      string_agg(quote_ident(att.attname), ', ' order by att.attnum) as columns
    from pg_class cls
    join pg_namespace n on n.oid = cls.relnamespace
    join pg_attribute att on att.attrelid = cls.oid
      and att.attnum > 0 and not att.attisdropped
    where n.nspname = 'public' and cls.relkind in ('r', 'p', 'v', 'm')
    group by cls.oid
  loop
    execute format(
      'revoke all privileges (%s) on table %s from anon, authenticated',
      r.columns,
      r.relation
    );
  end loop;
end $$;

-- Signed-in gameplay reads. RLS remains the row-level boundary (including
-- owner-only presets); writes still go exclusively through server RPCs.
grant select on
  public.tables,
  public.games,
  public.game_players,
  public.notable_hands,
  public.notable_claims,
  public.presets,
  public.hands,
  public.scoring_events,
  public.point_movements
to authenticated;

-- Public identity is enough for rosters and all three security-invoker boards.
-- Email remains operator-only, and NFC secrets in table_seats remain server-only.
grant select (id, display_name, created_at) on public.players to authenticated;
grant select on
  public.lifetime_board,
  public.skill_board,
  public.form_board
to authenticated;

-- Server-only code owns all direct writes and the signed-out, server-rendered boards.
grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;

-- Future migrations must opt each object into an API role deliberately. In particular,
-- remove PostgreSQL's normal EXECUTE-to-PUBLIC default for new functions.
alter default privileges in schema public
  revoke all privileges on tables from public, anon, authenticated, service_role;
alter default privileges in schema public
  revoke all privileges on sequences from public, anon, authenticated, service_role;
alter default privileges
  revoke all privileges on functions from public, anon, authenticated, service_role;

-- Reassert the existing server-only function boundary without broadening it.
do $$
declare
  r record;
  v_count integer := 0;
begin
  for r in
    select p.oid::regprocedure::text as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'start_game', 'create_game_with_seat', 'propose_chip_counts',
        'confirm_chip_result', 'expire_game', 'expire_abandoned_game',
        'expire_abandoned_forming_game', 'reopen_game', 'log_notable_claim',
        'handle_new_user', 'record_hand', 'void_hand', 'end_game',
        'end_abandoned_game', 'check_event_zero_sum'
      )
  loop
    execute format('revoke all privileges on function %s from public, anon, authenticated', r.signature);
    execute format('grant execute on function %s to service_role, postgres', r.signature);
    v_count := v_count + 1;
  end loop;
  if v_count <> 15 then
    raise exception 'expected to normalize 15 protected functions, found %', v_count;
  end if;
end $$;

-- Preserve the one non-server execution grant used by the auth.users trigger.
grant execute on function public.handle_new_user() to supabase_auth_admin;

-- Assert the full role matrix before commit. Any drift in object names or grants
-- aborts this migration instead of leaving a partially normalized database.
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
        'tables', 'games', 'game_players', 'notable_hands', 'notable_claims',
        'presets', 'hands', 'scoring_events', 'point_movements'
      );
      if r.relname = 'players' then
        if has_table_privilege('authenticated', r.oid, 'select') then
          raise exception 'authenticated has broad players SELECT';
        end if;
        for col in
          select attname from pg_attribute
          where attrelid = r.oid and attnum > 0 and not attisdropped
        loop
          if has_column_privilege('authenticated', r.oid, col.attname, 'select')
             is distinct from (col.attname in ('id', 'display_name', 'created_at'))
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
    select cls.oid, cls.relname
    from pg_class cls
    join pg_namespace n on n.oid = cls.relnamespace
    where n.nspname = 'public' and cls.relkind = 'S'
  loop
    if has_sequence_privilege('anon', r.oid, 'usage,select,update')
      or has_sequence_privilege('authenticated', r.oid, 'usage,select,update')
    then
      raise exception 'browser role has direct access to sequence %', r.relname;
    end if;
    if not (
      select bool_and(has_sequence_privilege('service_role', r.oid, privilege))
      from unnest(array['usage','select','update']) privilege
    ) then
      raise exception 'service_role lacks full access to sequence %', r.relname;
    end if;
  end loop;
end $$;

do $$
declare
  v_owner oid := (select oid from pg_roles where rolname = current_user);
  v_namespace oid := 'public'::regnamespace;
  v_acl aclitem[];
  r record;
begin
  for r in select * from (values ('r'::"char"), ('S'::"char"), ('f'::"char")) as kinds(kind)
  loop
    -- Global defaults are the baseline. A per-schema REVOKE cannot subtract
    -- PostgreSQL's global EXECUTE-to-PUBLIC function default.
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
declare r record;
begin
  for r in
    select p.oid, p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'start_game', 'create_game_with_seat', 'propose_chip_counts',
        'confirm_chip_result', 'expire_game', 'expire_abandoned_game',
        'expire_abandoned_forming_game', 'reopen_game', 'log_notable_claim',
        'handle_new_user', 'record_hand', 'void_hand', 'end_game',
        'end_abandoned_game', 'check_event_zero_sum'
      )
  loop
    if has_function_privilege('anon', r.oid, 'execute')
      or has_function_privilege('authenticated', r.oid, 'execute')
      or not has_function_privilege('service_role', r.oid, 'execute')
    then
      raise exception 'protected function access is wrong for %', r.proname;
    end if;
  end loop;
end $$;

commit;
