\set ON_ERROR_STOP on

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then create role supabase_auth_admin nologin; end if;
end $$;

grant usage on schema public to anon, authenticated, service_role, supabase_auth_admin;

create schema auth;
create table auth.users (
  id uuid primary key,
  email text,
  raw_user_meta_data jsonb not null default '{}'
);
grant usage on schema auth to supabase_auth_admin;

create function auth.uid() returns uuid
language sql stable as $$ select null::uuid $$;

create publication supabase_realtime;

-- Supabase provisions the storage schema; a bare initdb database does not. 0005 inserts one
-- bucket row, so the replay needs somewhere for it to land. This stub carries only the columns
-- 0005 names. It is deliberately NOT a faithful copy of Supabase's table: the migration's
-- contract is "the bucket row exists with these limits", and a wider stub would invite
-- assertions about storage internals that this harness cannot honestly make.
create schema storage;
create table storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);
