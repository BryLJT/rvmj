-- ============================================================================
-- 0006 — house onboarding
--
-- Wrapped in an explicit transaction, matching 0004 and 0005. This migration REPLACES three
-- views and carries assertion blocks that raise. Without the wrapper a firing assertion would
-- leave the column added and the views half-rebuilt. Do not remove the begin/commit.
--
-- Migrations 0001 through 0005 are applied history and are not edited here. 0004 in particular
-- is a point-in-time hardening record; its player-column list still reads (id, display_name,
-- created_at) and MUST keep reading that. The new final contract lives in
-- tests/database/verify_migrations.sql.
-- ============================================================================

begin;

-- ============ OPTIONAL HOUSE ============
-- Nullable with NO default. Null is valid forever: it is both "has not chosen yet" and
-- "deferred again", and there is no third state. A default would assign a house automatically,
-- which is exactly the product decision this feature exists to avoid.
alter table players add column house text;

alter table players add constraint players_house_check
  check (house is null or house in ('manis', 'strix', 'aonynx', 'orcaella', 'rusa', 'chelonia', 'panthera'));

-- ============ PERMANENCE BACKSTOP ============
-- The final guard. It fires for the service role and for a human editing rows in the Supabase
-- dashboard, so a later application bug cannot weaken permanence. Writing the SAME value is an
-- idempotent no-op and stays legal: a retry after a lost response must not turn into an error.
--
-- Not SECURITY DEFINER: it must run with the caller's identity so it constrains the caller.
create function enforce_permanent_house() returns trigger
language plpgsql set search_path = public as $$
begin
  if old.house is not null and new.house is distinct from old.house then
    raise exception 'house is permanent: % cannot become %', old.house, coalesce(new.house, 'null');
  end if;
  return new;
end $$;

create trigger players_house_permanent
  before update of house on players
  for each row execute function enforce_permanent_house();

-- ============ ATOMIC SELECTION ============
-- `for update` is the whole point. Two phones confirming different houses at the same instant
-- serialize here: the second caller waits, re-reads the committed row, and is handed the
-- permanent house instead of overwriting it. `applied` answers "did THIS call set it", so a
-- same-house retry honestly reports false while still resolving to that house.
create function choose_house(p_player_id uuid, p_house text)
returns table (stored_house text, applied boolean)
language plpgsql security definer set search_path = public as $$
declare v_current text;
begin
  if p_house is null or p_house not in ('manis', 'strix', 'aonynx', 'orcaella', 'rusa', 'chelonia', 'panthera') then
    raise exception 'unknown house %', coalesce(p_house, 'null');
  end if;

  select p.house into v_current from players p where p.id = p_player_id for update;
  if not found then raise exception 'no such player'; end if;

  if v_current is null then
    update players set house = p_house where id = p_player_id;
    return query select p_house, true;
  end if;

  return query select v_current, false;
end $$;

-- 0006 carries its own hardening: an applied migration cannot be extended, so the pattern from
-- 0004 and 0005 is repeated for the objects introduced here.
--
-- The trigger function gets NO grant, not even to service_role. PostgreSQL checks EXECUTE on a
-- trigger function when the trigger is CREATED, not when it fires, so the trigger keeps working
-- with an empty ACL. Do not "fix" the absence by granting it.
revoke all privileges on function public.choose_house(uuid, text) from public, anon, authenticated;
grant execute on function public.choose_house(uuid, text) to service_role, postgres;
revoke all privileges on function public.enforce_permanent_house() from public, anon, authenticated, service_role;

-- One more readable column. Email stays server-only and authenticated still writes nothing.
grant select (house) on public.players to authenticated;

-- ============ BOARDS ============
-- house is appended as the FINAL column of each view: `create or replace view` may add trailing
-- columns but may not reorder or retype existing ones.
--
-- lifetime_board and form_board aggregate, so p.house joins the grouping key. It is functionally
-- dependent on p.id and PostgreSQL would accept it either way; naming it is for the reader.
create or replace view lifetime_board as
select p.id, p.display_name,
  coalesce(sum(gp.final_total), 0) as total_points,
  count(gp.game_id) as games_played,
  p.house
from players p
join game_players gp on gp.player_id = p.id
join games g on g.id = gp.game_id and g.status = 'ended'
group by p.id, p.display_name, p.house;

-- Reproduced from 0003 unchanged except for the trailing column. The voided-hand exclusion in
-- the joins is load-bearing (it keeps hands_played agreeing with skill_board) — do not simplify.
create or replace view form_board as
select p.id, p.display_name,
  coalesce(sum(m.points), 0) as total_points,
  count(distinct m.hand_id) as hands_played,
  round(coalesce(sum(m.points), 0)::numeric / count(distinct m.hand_id), 2) as avg_points_per_hand,
  p.house
from players p
join point_movements m on m.player_id = p.id
join hands h on h.id = m.hand_id and not h.voided
join games g on g.id = m.game_id and g.status = 'ended'
group by p.id, p.display_name, p.house
having count(distinct m.hand_id) >= 20;

-- Reproduced from 0003 unchanged except for the trailing column.
create or replace view skill_board as
with app_wins as (
  select e.winner_player_id as player_id,
    coalesce(sum(least(e.tai, coalesce((g.rules->>'taiCap')::int, e.tai))), 0) as total_tai,
    count(*) filter (where e.notable_hand_id is not null) as notable_wins
  from scoring_events e
  join hands h on h.id = e.hand_id and not h.voided
  join games g on g.id = h.game_id and g.status = 'ended'
  where e.type = 'win' and e.winner_player_id is not null
  group by e.winner_player_id
),
claims as (
  select nc.player_id, count(*) as claim_count
  from notable_claims nc
  join games g on g.id = nc.game_id and g.status = 'ended'
  group by nc.player_id
)
select p.id, p.display_name,
  coalesce(a.total_tai, 0) as total_tai,
  coalesce(a.notable_wins, 0) + coalesce(c.claim_count, 0) as notable_wins,
  p.house
from players p
left join app_wins a on a.player_id = p.id
left join claims c on c.player_id = p.id
where a.player_id is not null or c.player_id is not null;

-- `create or replace view` DISCARDS reloptions, so security_invoker must be re-applied to all
-- three or the boards silently revert to reading base tables with RLS bypassed. The grants are
-- reasserted alongside it: cheap, and it keeps the whole read contract visible in one place.
alter view public.lifetime_board set (security_invoker = true);
alter view public.form_board     set (security_invoker = true);
alter view public.skill_board    set (security_invoker = true);

revoke all on public.lifetime_board from anon, authenticated;
revoke all on public.form_board     from anon, authenticated;
revoke all on public.skill_board    from anon, authenticated;
grant select on public.lifetime_board, public.form_board, public.skill_board to authenticated;

-- ============ ASSERTIONS ============
-- Everything below aborts the transaction rather than leaving a half-migrated database.

-- The column is optional, defaulted to nothing, and constrained to exactly the seven. Comparing
-- the SET of quoted literals catches an extra identifier as well as a missing one; a `like`
-- check for each of the seven would pass on a constraint that also allowed an eighth.
do $$
declare
  v_def text;
  v_allowed text[];
  v_count int;
begin
  if (select attnotnull from pg_attribute
      where attrelid = 'public.players'::regclass and attname = 'house') then
    raise exception 'players.house must be nullable';
  end if;
  if (select atthasdef from pg_attribute
      where attrelid = 'public.players'::regclass and attname = 'house') then
    raise exception 'players.house must have no default';
  end if;

  select count(*) into v_count
  from pg_constraint
  where conrelid = 'public.players'::regclass and contype = 'c'
    and pg_get_constraintdef(oid) like '%house%';
  if v_count <> 1 then
    raise exception 'expected exactly one house check constraint, found %', v_count;
  end if;

  select pg_get_constraintdef(oid) into v_def
  from pg_constraint
  where conrelid = 'public.players'::regclass and contype = 'c'
    and pg_get_constraintdef(oid) like '%house%';

  select array_agg(m[1] order by m[1]) into v_allowed
  from regexp_matches(v_def, '''([a-z]+)''', 'g') m;

  if v_allowed is distinct from array['aonynx', 'chelonia', 'manis', 'orcaella', 'panthera', 'rusa', 'strix'] then
    raise exception 'house constraint allows %, not the seven approved identifiers', v_allowed;
  end if;
end $$;

-- One function, one trigger, and the trigger is narrowed to the house column.
do $$
declare
  v_count int;
  v_house_attnum text := (
    select attnum::text from pg_attribute
    where attrelid = 'public.players'::regclass and attname = 'house'
  );
begin
  select count(*) into v_count
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'choose_house';
  if v_count <> 1 then raise exception 'expected exactly one choose_house, found %', v_count; end if;

  select count(*) into v_count
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'enforce_permanent_house';
  if v_count <> 1 then raise exception 'expected exactly one enforce_permanent_house, found %', v_count; end if;

  select count(*) into v_count
  from pg_trigger
  where tgrelid = 'public.players'::regclass and not tgisinternal
    and tgfoid = 'public.enforce_permanent_house()'::regprocedure;
  if v_count <> 1 then raise exception 'expected exactly one permanence trigger, found %', v_count; end if;

  -- tgtype bits: 1 = FOR EACH ROW, 2 = BEFORE, 16 = UPDATE. tgattr names the UPDATE OF columns.
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.players'::regclass and tgname = 'players_house_permanent'
      and (tgtype & 1) = 1 and (tgtype & 2) = 2 and (tgtype & 16) = 16
      and tgattr::text = v_house_attnum
  ) then
    raise exception 'players_house_permanent is not BEFORE UPDATE OF house FOR EACH ROW';
  end if;
end $$;

-- Browser roles reach neither function and write nothing; the service role reaches exactly one.
do $$
declare r record;
begin
  for r in
    select p.oid, p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('choose_house', 'enforce_permanent_house')
  loop
    if has_function_privilege('anon', r.oid, 'execute')
      or has_function_privilege('authenticated', r.oid, 'execute')
    then
      raise exception 'a browser role can execute %', r.proname;
    end if;
  end loop;

  if not has_function_privilege('service_role', 'public.choose_house(uuid,text)'::regprocedure, 'execute') then
    raise exception 'service_role cannot execute choose_house';
  end if;
  if has_function_privilege('service_role', 'public.enforce_permanent_house()'::regprocedure, 'execute') then
    raise exception 'the trigger function has a needless service_role execute grant';
  end if;

  if has_table_privilege('authenticated', 'public.players', 'insert,update,delete,truncate,references,trigger')
    or has_any_column_privilege('authenticated', 'public.players', 'insert,update,references')
  then
    raise exception 'authenticated can write players';
  end if;
  if has_table_privilege('anon', 'public.players', 'select,insert,update,delete,truncate,references,trigger')
    or has_any_column_privilege('anon', 'public.players', 'select,insert,update,references')
  then
    raise exception 'anon can reach players';
  end if;
end $$;

-- Authenticated player reads are exactly four columns, and email is still not one of them.
do $$
declare col record;
begin
  if has_table_privilege('authenticated', 'public.players', 'select') then
    raise exception 'authenticated has broad players SELECT';
  end if;
  for col in
    select attname from pg_attribute
    where attrelid = 'public.players'::regclass and attnum > 0 and not attisdropped
  loop
    if has_column_privilege('authenticated', 'public.players', col.attname, 'select')
       is distinct from (col.attname in ('id', 'display_name', 'created_at', 'house'))
    then
      raise exception 'authenticated players column access is wrong for %', col.attname;
    end if;
  end loop;
  if has_column_privilege('authenticated', 'public.players', 'email', 'select') then
    raise exception 'authenticated can read player email';
  end if;
end $$;

-- All three boards: read-only, reader-scoped, and carrying house.
do $$
declare r record; seen int := 0;
begin
  for r in
    select c.oid, c.relname, c.reloptions
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname in ('lifetime_board', 'form_board', 'skill_board')
  loop
    if r.reloptions is null or not (r.reloptions @> array['security_invoker=true']) then
      raise exception 'board view % is not security_invoker', r.relname;
    end if;
    if has_table_privilege('anon', r.oid, 'select') then
      raise exception 'anon can select board view %', r.relname;
    end if;
    if not has_table_privilege('authenticated', r.oid, 'select') then
      raise exception 'authenticated cannot select board view %', r.relname;
    end if;
    if has_table_privilege('authenticated', r.oid, 'insert,update,delete,truncate,references,trigger') then
      raise exception 'authenticated can write board view %', r.relname;
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

-- 0004's opt-in posture still holds after this migration adds objects.
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
    where d.defaclrole = v_owner and d.defaclnamespace = 0 and d.defaclobjtype = r.kind;
    v_acl := coalesce(v_acl, acldefault(r.kind, v_owner));
    if exists (
      select 1 from aclexplode(v_acl) a
      left join pg_roles grantee on grantee.oid = a.grantee
      where a.grantee = 0 or grantee.rolname in ('anon', 'authenticated', 'service_role')
    ) then
      raise exception 'unsafe global default privilege remains for object type %', r.kind;
    end if;
    if exists (
      select 1 from pg_default_acl d
      cross join lateral aclexplode(d.defaclacl) a
      left join pg_roles grantee on grantee.oid = a.grantee
      where d.defaclrole = v_owner and d.defaclnamespace = v_namespace and d.defaclobjtype = r.kind
        and (a.grantee = 0 or grantee.rolname in ('anon', 'authenticated', 'service_role'))
    ) then
      raise exception 'unsafe public-schema default privilege remains for object type %', r.kind;
    end if;
  end loop;
end $$;

commit;
