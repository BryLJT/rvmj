-- ============================================================================
-- 0009 — let the server actually read 0008's views
--
-- 0008 created lifetime_board_by_year and academic_years with `security_invoker = true`, so a
-- view runs with the CALLER's privileges. Reading either therefore needs EXECUTE on
-- academic_year_of, and through it academic_year_start.
--
-- 0008 granted SELECT on the views to service_role and stopped, reasoning that the date
-- functions "read no table and are reachable only through views". A correct statement about
-- SECURITY and the wrong conclusion about ACCESS: 0004 revoked the schema-wide default
-- privileges, so a new function is executable by nobody until granted.
--
-- Live effect: `select count(*) from academic_years` as service_role raised
-- `42501: permission denied for function academic_year_of`, the server's year query failed, and
-- the app fell back to the all-time board with no pill row. It failed SOFT, which is why nothing
-- broke -- but the feature did not appear.
--
-- 0008's assertion missed it by asking has_table_privilege(service_role, 'academic_years',
-- 'select'), which is TRUE: the role does hold the view privilege, it just cannot run the view's
-- body. THE TWO PRIVILEGES ARE SEPARATE AND BOTH ARE REQUIRED. The assertion below checks the
-- pair; run-migrations.sh proves it for real by becoming the role and running the query, which
-- is the only check that could not have been fooled.
--
-- No `set role` here, deliberately. The first version of this file used it inside DO blocks to
-- probe access, and the role leaked past `commit` into the CLI's own ledger write, which then
-- failed with `permission denied for schema supabase_migrations`: the grants applied while the
-- migration went unrecorded. Role switching belongs in the test harness, not in a migration.
--
-- ADDITIVE ONLY, and idempotent: two grants and two revokes, no object created or dropped.
-- ============================================================================
begin;

grant execute on function public.academic_year_start(int) to service_role, postgres;
grant execute on function public.academic_year_of(timestamptz) to service_role, postgres;

-- Still nothing for the browser roles. Neither reads these views, and 0004's revocation of the
-- schema-wide defaults is what keeps that true by default rather than by anyone remembering.
revoke all privileges on function public.academic_year_start(int) from public, anon, authenticated;
revoke all privileges on function public.academic_year_of(timestamptz) from public, anon, authenticated;

-- ============ ASSERTIONS ============
do $$
begin
  -- BOTH halves, together. Either alone is what let 0008 ship unreadable.
  if not (has_function_privilege('service_role', 'public.academic_year_of(timestamptz)', 'execute')
      and has_function_privilege('service_role', 'public.academic_year_start(int)', 'execute')) then
    raise exception 'service_role cannot execute the academic-year functions';
  end if;
  if not (has_table_privilege('service_role', 'public.academic_years', 'select')
      and has_table_privilege('service_role', 'public.lifetime_board_by_year', 'select')) then
    raise exception 'service_role cannot select the academic-year views';
  end if;

  -- And no browser role gains either privilege.
  if has_function_privilege('anon', 'public.academic_year_of(timestamptz)', 'execute')
     or has_function_privilege('authenticated', 'public.academic_year_of(timestamptz)', 'execute')
     or has_function_privilege('anon', 'public.academic_year_start(int)', 'execute')
     or has_function_privilege('authenticated', 'public.academic_year_start(int)', 'execute') then
    raise exception 'a browser role can execute the academic-year functions';
  end if;
end $$;

commit;
