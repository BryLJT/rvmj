#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)
PG_BIN=${PG_BIN:-/opt/homebrew/opt/postgresql@16/bin}
TEST_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/rvmj-db-test.XXXXXX")
PG_DATA="$TEST_ROOT/data"
PG_SOCKET="$TEST_ROOT/socket"
PG_LOG="$TEST_ROOT/postgres.log"

mkdir -p "$PG_SOCKET"

cleanup() {
  "$PG_BIN/pg_ctl" -D "$PG_DATA" -m fast stop >/dev/null 2>&1 || true
  rm -rf "$TEST_ROOT"
}
trap cleanup EXIT

"$PG_BIN/initdb" -D "$PG_DATA" -A trust -U postgres >/dev/null
"$PG_BIN/pg_ctl" -D "$PG_DATA" -l "$PG_LOG" -o "-k $PG_SOCKET -h ''" -w start >/dev/null

apply() {
  local database=$1
  local migration=$2
  "$PG_BIN/psql" -X -v ON_ERROR_STOP=1 -h "$PG_SOCKET" -U postgres -d "$database" \
    -f "$REPO_ROOT/supabase/migrations/$migration" >/dev/null
}

verify_database() {
  local database=$1
  "$PG_BIN/psql" -X -v ON_ERROR_STOP=1 -h "$PG_SOCKET" -U postgres -d "$database" \
    -f "$SCRIPT_DIR/verify_migrations.sql" >/dev/null
}

scalar() {
  local database=$1
  local sql=$2
  "$PG_BIN/psql" -X -A -t -q -h "$PG_SOCKET" -U postgres -d "$database" -c "$sql"
}

assert_client_denied() {
  local database=$1
  local role=$2
  if "$PG_BIN/psql" -X -v ON_ERROR_STOP=1 -h "$PG_SOCKET" -U postgres -d "$database" \
    -c "set role $role; select expire_abandoned_game('ffffffff-ffff-ffff-ffff-ffffffffffff', now())" \
    >/dev/null 2>&1
  then
    echo "$role unexpectedly executed expire_abandoned_game" >&2
    exit 1
  fi
}

# Clean shape: all local migrations applied in order.
"$PG_BIN/createdb" -h "$PG_SOCKET" -U postgres rvmj_clean
"$PG_BIN/psql" -X -v ON_ERROR_STOP=1 -h "$PG_SOCKET" -U postgres -d rvmj_clean \
  -f "$SCRIPT_DIR/harness.sql" >/dev/null
apply rvmj_clean 0001_chip_spine.sql
"$PG_BIN/psql" -X -v ON_ERROR_STOP=1 -h "$PG_SOCKET" -U postgres -d rvmj_clean \
  -c "alter table game_players add constraint test_future_final_total_check check (final_total is null or final_total > -1000000)" >/dev/null
apply rvmj_clean 0002_chip_spine_hardening.sql
apply rvmj_clean 0003_app_mode.sql
apply rvmj_clean 0004_explicit_access_grants.sql
verify_database rvmj_clean
assert_client_denied rvmj_clean anon
assert_client_denied rvmj_clean authenticated

# Hosted shape: 0001 exists first, then only the two pending migrations are applied.
"$PG_BIN/createdb" -h "$PG_SOCKET" -U postgres rvmj_hosted_shape
"$PG_BIN/psql" -X -v ON_ERROR_STOP=1 -h "$PG_SOCKET" -U postgres -d rvmj_hosted_shape \
  -f "$SCRIPT_DIR/harness.sql" >/dev/null
apply rvmj_hosted_shape 0001_chip_spine.sql
"$PG_BIN/psql" -X -v ON_ERROR_STOP=1 -h "$PG_SOCKET" -U postgres -d rvmj_hosted_shape \
  -c "alter table game_players add constraint test_future_final_total_check check (final_total is null or final_total > -1000000)" >/dev/null
apply rvmj_hosted_shape 0002_chip_spine_hardening.sql
apply rvmj_hosted_shape 0003_app_mode.sql
apply rvmj_hosted_shape 0004_explicit_access_grants.sql
verify_database rvmj_hosted_shape
assert_client_denied rvmj_hosted_shape anon
assert_client_denied rvmj_hosted_shape authenticated

# Supabase baseline shape: the hosted project carries postgres-owned, schema-scoped
# default privileges granting the API roles access to FUTURE objects in public.
# A fresh initdb database has none of these, which is why every other case here
# passed while the real hosted database rejected 0004 on 2026-08-20.
"$PG_BIN/createdb" -h "$PG_SOCKET" -U postgres rvmj_supabase_baseline
"$PG_BIN/psql" -X -v ON_ERROR_STOP=1 -h "$PG_SOCKET" -U postgres -d rvmj_supabase_baseline \
  -f "$SCRIPT_DIR/harness.sql" >/dev/null
"$PG_BIN/psql" -X -v ON_ERROR_STOP=1 -h "$PG_SOCKET" -U postgres -d rvmj_supabase_baseline >/dev/null <<'SQL'
alter default privileges in schema public grant all on tables to anon, authenticated, service_role, postgres;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role, postgres;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role, postgres;
SQL
# Control: the seeded baseline really does expose a new function before 0004 runs.
"$PG_BIN/psql" -X -v ON_ERROR_STOP=1 -h "$PG_SOCKET" -U postgres -d rvmj_supabase_baseline \
  -c "create function public.baseline_probe_before() returns int language sql as \$\$ select 1 \$\$" >/dev/null
[[ "$(scalar rvmj_supabase_baseline "select has_function_privilege('anon','public.baseline_probe_before()','execute')")" == "t" ]]
apply rvmj_supabase_baseline 0001_chip_spine.sql
"$PG_BIN/psql" -X -v ON_ERROR_STOP=1 -h "$PG_SOCKET" -U postgres -d rvmj_supabase_baseline \
  -c "alter table game_players add constraint test_future_final_total_check check (final_total is null or final_total > -1000000)" >/dev/null
apply rvmj_supabase_baseline 0002_chip_spine_hardening.sql
apply rvmj_supabase_baseline 0003_app_mode.sql
apply rvmj_supabase_baseline 0004_explicit_access_grants.sql
verify_database rvmj_supabase_baseline
assert_client_denied rvmj_supabase_baseline anon
assert_client_denied rvmj_supabase_baseline authenticated
# Catalog state: no schema-scoped default privilege for the API roles survives.
[[ "$(scalar rvmj_supabase_baseline "select count(*) from pg_default_acl d cross join lateral aclexplode(d.defaclacl) a left join pg_roles g on g.oid = a.grantee where d.defaclrole = (select oid from pg_roles where rolname = current_user) and d.defaclnamespace = 'public'::regnamespace and (a.grantee = 0 or g.rolname in ('anon','authenticated','service_role'))")" == "0" ]]
# Behaviour: a function created AFTER 0004 is reachable by neither browser role.
"$PG_BIN/psql" -X -v ON_ERROR_STOP=1 -h "$PG_SOCKET" -U postgres -d rvmj_supabase_baseline \
  -c "create function public.baseline_probe_after() returns int language sql as \$\$ select 1 \$\$" >/dev/null
[[ "$(scalar rvmj_supabase_baseline "select has_function_privilege('anon','public.baseline_probe_after()','execute')")" == "f" ]]
[[ "$(scalar rvmj_supabase_baseline "select has_function_privilege('authenticated','public.baseline_probe_after()','execute')")" == "f" ]]

# The duplicate-open-game preflight names the actual game ids an operator must inspect.
"$PG_BIN/createdb" -h "$PG_SOCKET" -U postgres rvmj_preflight
"$PG_BIN/psql" -X -v ON_ERROR_STOP=1 -h "$PG_SOCKET" -U postgres -d rvmj_preflight \
  -f "$SCRIPT_DIR/harness.sql" >/dev/null
apply rvmj_preflight 0001_chip_spine.sql
apply rvmj_preflight 0002_chip_spine_hardening.sql
"$PG_BIN/psql" -X -v ON_ERROR_STOP=1 -h "$PG_SOCKET" -U postgres -d rvmj_preflight >/dev/null <<'SQL'
insert into tables (id, code) values ('12000000-0000-0000-0000-000000000001', 'duplicate-preflight');
insert into games (id, table_id, status) values
  ('22000000-0000-0000-0000-000000000001', '12000000-0000-0000-0000-000000000001', 'forming'),
  ('22000000-0000-0000-0000-000000000002', '12000000-0000-0000-0000-000000000001', 'active');
SQL
PREFLIGHT_OUTPUT="$TEST_ROOT/preflight.txt"
if "$PG_BIN/psql" -X -v ON_ERROR_STOP=1 -h "$PG_SOCKET" -U postgres -d rvmj_preflight \
  -f "$REPO_ROOT/supabase/migrations/0003_app_mode.sql" >"$PREFLIGHT_OUTPUT" 2>&1
then
  echo "0003 unexpectedly accepted duplicate open games" >&2
  exit 1
fi
rg -q '22000000-0000-0000-0000-000000000001' "$PREFLIGHT_OUTPUT"
rg -q '22000000-0000-0000-0000-000000000002' "$PREFLIGHT_OUTPUT"

# Deterministic lock races in independent psql sessions.
"$PG_BIN/createdb" -h "$PG_SOCKET" -U postgres rvmj_races
"$PG_BIN/psql" -X -v ON_ERROR_STOP=1 -h "$PG_SOCKET" -U postgres -d rvmj_races \
  -f "$SCRIPT_DIR/harness.sql" >/dev/null
apply rvmj_races 0001_chip_spine.sql
apply rvmj_races 0002_chip_spine_hardening.sql
apply rvmj_races 0003_app_mode.sql
apply rvmj_races 0004_explicit_access_grants.sql
"$PG_BIN/psql" -X -v ON_ERROR_STOP=1 -h "$PG_SOCKET" -U postgres -d rvmj_races \
  -f "$SCRIPT_DIR/race_fixtures.sql" >/dev/null

# Two confirmations: the first holds the row lock; the second waits and returns false.
FIRST_CONFIRM="$TEST_ROOT/first-confirm.txt"
"$PG_BIN/psql" -X -A -t -q -h "$PG_SOCKET" -U postgres -d rvmj_races \
  -c "begin; select expire_abandoned_game('21000000-0000-0000-0000-000000000001','2020-01-01 00:00:01+00'); select pg_sleep(1); commit" \
  >"$FIRST_CONFIRM" &
FIRST_PID=$!
sleep 0.2
SECOND_RESULT=$(scalar rvmj_races "select expire_abandoned_game('21000000-0000-0000-0000-000000000001','2020-01-01 00:00:01+00')")
wait "$FIRST_PID"
rg -q '^t$' "$FIRST_CONFIRM"
[[ "$SECOND_RESULT" == "f" ]]

# Resume commits first: the old void waits, sees the changed timestamp, and returns false.
"$PG_BIN/psql" -X -A -t -q -h "$PG_SOCKET" -U postgres -d rvmj_races \
  -c "begin; update games set last_activity_at=now() where id='21000000-0000-0000-0000-000000000002' and status='active'; select pg_sleep(1); commit" \
  >/dev/null &
RESUME_PID=$!
sleep 0.2
RESUME_FIRST_RESULT=$(scalar rvmj_races "select expire_abandoned_game('21000000-0000-0000-0000-000000000002','2020-01-01 00:00:02+00')")
wait "$RESUME_PID"
[[ "$RESUME_FIRST_RESULT" == "f" ]]
[[ "$(scalar rvmj_races "select status from games where id='21000000-0000-0000-0000-000000000002'")" == "active" ]]

# Void commits first: the existing status-guarded resume waits and updates zero rows.
"$PG_BIN/psql" -X -A -t -q -h "$PG_SOCKET" -U postgres -d rvmj_races \
  -c "begin; select expire_abandoned_game('21000000-0000-0000-0000-000000000003','2020-01-01 00:00:03+00'); select pg_sleep(1); commit" \
  >/dev/null &
VOID_PID=$!
sleep 0.2
VOID_FIRST_RESULT=$(scalar rvmj_races "with changed as (update games set last_activity_at=now() where id='21000000-0000-0000-0000-000000000003' and status='active' returning 1) select count(*) from changed")
wait "$VOID_PID"
[[ "$VOID_FIRST_RESULT" == "0" ]]

# App void commits first: end waits, includes the reversal, and publishes four zero totals.
VOID_HAND_ID=$(scalar rvmj_races "select id from hands where game_id='21000000-0000-0000-0000-000000000004'")
"$PG_BIN/psql" -X -A -t -q -h "$PG_SOCKET" -U postgres -d rvmj_races \
  -c "begin; select void_hand('$VOID_HAND_ID','01000000-0000-0000-0000-000000000001'); select pg_sleep(1); commit" \
  >/dev/null &
VOID_HAND_PID=$!
sleep 0.2
APP_VOID_FIRST_RESULT=$(scalar rvmj_races "select end_game('21000000-0000-0000-0000-000000000004')")
wait "$VOID_HAND_PID"
[[ "$APP_VOID_FIRST_RESULT" == "ended" ]]
[[ "$(scalar rvmj_races "select count(*)::text || '|' || count(final_total)::text || '|' || coalesce(sum(final_total),0)::text from game_players where game_id='21000000-0000-0000-0000-000000000004'")" == "4|4|0" ]]

# App end commits first: the later void is rejected and cannot rewrite the ended history.
END_HAND_ID=$(scalar rvmj_races "select id from hands where game_id='21000000-0000-0000-0000-000000000005'")
"$PG_BIN/psql" -X -A -t -q -h "$PG_SOCKET" -U postgres -d rvmj_races \
  -c "begin; select end_game('21000000-0000-0000-0000-000000000005'); select pg_sleep(1); commit" \
  >/dev/null &
END_PID=$!
sleep 0.2
if "$PG_BIN/psql" -X -v ON_ERROR_STOP=1 -h "$PG_SOCKET" -U postgres -d rvmj_races \
  -c "select void_hand('$END_HAND_ID','01000000-0000-0000-0000-000000000001')" >/dev/null 2>&1
then
  echo "void_hand unexpectedly rewrote an already-ended game" >&2
  exit 1
fi
wait "$END_PID"
[[ "$(scalar rvmj_races "select status from games where id='21000000-0000-0000-0000-000000000005'")" == "ended" ]]
[[ "$(scalar rvmj_races "select voided from hands where id='$END_HAND_ID'")" == "f" ]]

# Forming game starts first: the old expiry waits and returns false without touching it.
"$PG_BIN/psql" -X -A -t -q -h "$PG_SOCKET" -U postgres -d rvmj_races \
  -c "begin; select start_game('21000000-0000-0000-0000-000000000006','chips',null); select pg_sleep(1); commit" \
  >/dev/null &
FORMING_START_PID=$!
sleep 0.2
FORMING_START_RESULT=$(scalar rvmj_races "select expire_abandoned_forming_game('21000000-0000-0000-0000-000000000006','2020-01-01 00:00:06+00')")
wait "$FORMING_START_PID"
[[ "$FORMING_START_RESULT" == "f" ]]
[[ "$(scalar rvmj_races "select status from games where id='21000000-0000-0000-0000-000000000006'")" == "active" ]]

# Forming expiry commits first: the later start is rejected after it acquires the row lock.
"$PG_BIN/psql" -X -A -t -q -h "$PG_SOCKET" -U postgres -d rvmj_races \
  -c "begin; select expire_abandoned_forming_game('21000000-0000-0000-0000-000000000007','2020-01-01 00:00:07+00'); select pg_sleep(1); commit" \
  >/dev/null &
FORMING_EXPIRE_PID=$!
sleep 0.2
if "$PG_BIN/psql" -X -v ON_ERROR_STOP=1 -h "$PG_SOCKET" -U postgres -d rvmj_races \
  -c "select start_game('21000000-0000-0000-0000-000000000007','chips',null)" >/dev/null 2>&1
then
  echo "start_game unexpectedly revived an expired forming game" >&2
  exit 1
fi
wait "$FORMING_EXPIRE_PID"
[[ "$(scalar rvmj_races "select status from games where id='21000000-0000-0000-0000-000000000007'")" == "expired" ]]

# App void commits first: guarded abandoned ending waits and returns changed.
WRAPPER_VOID_HAND_ID=$(scalar rvmj_races "select id from hands where game_id='21000000-0000-0000-0000-000000000008'")
"$PG_BIN/psql" -X -A -t -q -h "$PG_SOCKET" -U postgres -d rvmj_races \
  -c "begin; select void_hand('$WRAPPER_VOID_HAND_ID','01000000-0000-0000-0000-000000000001'); select pg_sleep(1); commit" \
  >/dev/null &
WRAPPER_VOID_PID=$!
sleep 0.2
WRAPPER_VOID_RESULT=$(scalar rvmj_races "select end_abandoned_game('21000000-0000-0000-0000-000000000008','2020-01-01 00:00:08+00')")
wait "$WRAPPER_VOID_PID"
[[ "$WRAPPER_VOID_RESULT" == "changed" ]]
[[ "$(scalar rvmj_races "select status from games where id='21000000-0000-0000-0000-000000000008'")" == "active" ]]

# Guarded abandoned ending commits first: a later void cannot rewrite published history.
WRAPPER_END_HAND_ID=$(scalar rvmj_races "select id from hands where game_id='21000000-0000-0000-0000-000000000009'")
"$PG_BIN/psql" -X -A -t -q -h "$PG_SOCKET" -U postgres -d rvmj_races \
  -c "begin; select end_abandoned_game('21000000-0000-0000-0000-000000000009','2020-01-01 00:00:09+00'); select pg_sleep(1); commit" \
  >/dev/null &
WRAPPER_END_PID=$!
sleep 0.2
if "$PG_BIN/psql" -X -v ON_ERROR_STOP=1 -h "$PG_SOCKET" -U postgres -d rvmj_races \
  -c "select void_hand('$WRAPPER_END_HAND_ID','01000000-0000-0000-0000-000000000001')" >/dev/null 2>&1
then
  echo "void_hand unexpectedly rewrote a guarded abandoned ending" >&2
  exit 1
fi
wait "$WRAPPER_END_PID"
[[ "$(scalar rvmj_races "select status from games where id='21000000-0000-0000-0000-000000000009'")" == "ended" ]]
[[ "$(scalar rvmj_races "select voided from hands where id='$WRAPPER_END_HAND_ID'")" == "f" ]]

echo "Database migration, permission, preflight, and lock-race verification passed."
