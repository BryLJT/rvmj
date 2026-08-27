#!/usr/bin/env bash
set -euo pipefail

# macOS ships bash 3.2.57, in which `set -e` does NOT fire on a failing bare `[[ ... ]]`.
# Verified on this machine: `[[ "0" != "0" ]]` as a standalone command continues to the next
# line and the script exits 0, while the same condition written with `test` aborts correctly.
#
# Every value assertion in this file was written as a bare `[[ ... ]]`, so ALL of them ran,
# computed their answer, and threw it away. Found on 2026-08-27 by sabotaging a view to double
# its totals and watching the suite report "verification passed".
#
# `must` makes the failure explicit and names the line, which a bare bracket never did even on a
# shell where it aborted correctly.
must() {
  if ! "$@"; then
    echo "assertion failed (line ${BASH_LINENO[0]}): $*" >&2
    exit 1
  fi
}

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

APPLIED_CLEAN=()

apply() {
  local database=$1
  local migration=$2
  if [[ "$database" == "rvmj_clean" ]]; then
    APPLIED_CLEAN+=("$migration")
  fi
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

assert_denied_as() {
  local database=$1
  local role=$2
  local sql=$3
  local label=$4
  if "$PG_BIN/psql" -X -v ON_ERROR_STOP=1 -h "$PG_SOCKET" -U postgres -d "$database" \
    -c "set role $role; $sql" >/dev/null 2>&1
  then
    echo "$label" >&2
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
apply rvmj_clean 0005_notable_photos.sql
apply rvmj_clean 0006_house_onboarding.sql
apply rvmj_clean 0007_chip_end_by_counter.sql
apply rvmj_clean 0008_academic_year_and_rename.sql
# Coverage guard: the clean replay must apply EVERY migration on disk. Without this a new
# migration file can be added and silently never replayed, which is how 0005 went uncovered
# until the Task 18 review caught it by hand.
EXPECTED_MIGRATIONS=$(cd "$REPO_ROOT/supabase/migrations" && ls *.sql | sort | tr '\n' ' ')
ACTUAL_MIGRATIONS=$(printf '%s\n' "${APPLIED_CLEAN[@]}" | sort | tr '\n' ' ')
if [[ "$EXPECTED_MIGRATIONS" != "$ACTUAL_MIGRATIONS" ]]; then
  echo "migration coverage gap" >&2
  echo "  on disk:        $EXPECTED_MIGRATIONS" >&2
  echo "  clean replay:   $ACTUAL_MIGRATIONS" >&2
  exit 1
fi

verify_database rvmj_clean
# `bool::text` is 'true'/'false'. The bare 't'/'f' is how psql DISPLAYS a boolean column,
# which is a different thing -- the same confusion already documented at the house race below.
# This assertion expected 'f' and had therefore been failing since it was written; nothing
# noticed, because bash 3.2 discards a bare [[ ]] failure. The bucket itself was always correct.
[[ "$(scalar rvmj_clean "select b.public::text || '|' || b.file_size_limit::text from storage.buckets b where b.id = 'notable-photos'")" == "false|2097152" ]] || { echo "assertion failed at line $LINENO: [[ '(scalar rvmj_clean 'select b.public::text || '|' || b.file_size_limit::text from stor" >&2; exit 1; }
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
apply rvmj_hosted_shape 0005_notable_photos.sql
apply rvmj_hosted_shape 0006_house_onboarding.sql
apply rvmj_hosted_shape 0007_chip_end_by_counter.sql
apply rvmj_hosted_shape 0008_academic_year_and_rename.sql
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
[[ "$(scalar rvmj_supabase_baseline "select has_function_privilege('anon','public.baseline_probe_before()','execute')")" == "t" ]] || { echo "assertion failed at line $LINENO: [[ '(scalar rvmj_supabase_baseline 'select has_function_privilege('anon','public.baseline" >&2; exit 1; }
apply rvmj_supabase_baseline 0001_chip_spine.sql
"$PG_BIN/psql" -X -v ON_ERROR_STOP=1 -h "$PG_SOCKET" -U postgres -d rvmj_supabase_baseline \
  -c "alter table game_players add constraint test_future_final_total_check check (final_total is null or final_total > -1000000)" >/dev/null
apply rvmj_supabase_baseline 0002_chip_spine_hardening.sql
apply rvmj_supabase_baseline 0003_app_mode.sql
apply rvmj_supabase_baseline 0004_explicit_access_grants.sql
apply rvmj_supabase_baseline 0005_notable_photos.sql
apply rvmj_supabase_baseline 0006_house_onboarding.sql
apply rvmj_supabase_baseline 0007_chip_end_by_counter.sql
apply rvmj_supabase_baseline 0008_academic_year_and_rename.sql
verify_database rvmj_supabase_baseline
assert_client_denied rvmj_supabase_baseline anon
assert_client_denied rvmj_supabase_baseline authenticated
# Catalog state: no schema-scoped default privilege for the API roles survives.
[[ "$(scalar rvmj_supabase_baseline "select count(*) from pg_default_acl d cross join lateral aclexplode(d.defaclacl) a left join pg_roles g on g.oid = a.grantee where d.defaclrole = (select oid from pg_roles where rolname = current_user) and d.defaclnamespace = 'public'::regnamespace and (a.grantee = 0 or g.rolname in ('anon','authenticated','service_role'))")" == "0" ]] || { echo "assertion failed at line $LINENO: [[ '(scalar rvmj_supabase_baseline 'select count(*) from pg_default_acl d cross join late" >&2; exit 1; }
# Behaviour: a function created AFTER 0004 is reachable by neither browser role.
"$PG_BIN/psql" -X -v ON_ERROR_STOP=1 -h "$PG_SOCKET" -U postgres -d rvmj_supabase_baseline \
  -c "create function public.baseline_probe_after() returns int language sql as \$\$ select 1 \$\$" >/dev/null
[[ "$(scalar rvmj_supabase_baseline "select has_function_privilege('anon','public.baseline_probe_after()','execute')")" == "f" ]] || { echo "assertion failed at line $LINENO: [[ '(scalar rvmj_supabase_baseline 'select has_function_privilege('anon','public.baseline" >&2; exit 1; }
[[ "$(scalar rvmj_supabase_baseline "select has_function_privilege('authenticated','public.baseline_probe_after()','execute')")" == "f" ]] || { echo "assertion failed at line $LINENO: [[ '(scalar rvmj_supabase_baseline 'select has_function_privilege('authenticated','public" >&2; exit 1; }

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

# House onboarding: the full migration stack, then behavioural proofs on a clean board.
"$PG_BIN/createdb" -h "$PG_SOCKET" -U postgres rvmj_house
"$PG_BIN/psql" -X -v ON_ERROR_STOP=1 -h "$PG_SOCKET" -U postgres -d rvmj_house \
  -f "$SCRIPT_DIR/harness.sql" >/dev/null
apply rvmj_house 0001_chip_spine.sql
apply rvmj_house 0002_chip_spine_hardening.sql
apply rvmj_house 0003_app_mode.sql
apply rvmj_house 0004_explicit_access_grants.sql
apply rvmj_house 0005_notable_photos.sql
apply rvmj_house 0006_house_onboarding.sql
apply rvmj_house 0007_chip_end_by_counter.sql
apply rvmj_house 0008_academic_year_and_rename.sql
"$PG_BIN/psql" -X -v ON_ERROR_STOP=1 -h "$PG_SOCKET" -U postgres -d rvmj_house \
  -f "$SCRIPT_DIR/house_cases.sql" >/dev/null

# Browser roles, probed as themselves rather than by reading the catalog.
assert_denied_as rvmj_house authenticated "select email from players limit 1" \
  "authenticated could read a player email"
assert_denied_as rvmj_house authenticated "update players set house = 'manis'" \
  "authenticated could write players.house"
assert_denied_as rvmj_house authenticated \
  "select stored_house from choose_house('0a000000-0000-0000-0000-000000000000','manis')" \
  "authenticated could execute choose_house"
assert_denied_as rvmj_house anon "select house from players limit 1" \
  "anon could read players.house"
assert_denied_as rvmj_house anon "select count(*) from lifetime_board" \
  "anon could read a board view"
# The positive half: an authenticated reader really can see the house column, on the table and
# through every board. A denial suite alone would also pass with the column ungranted.
[[ "$(scalar rvmj_house "set role authenticated; select count(*) from players where house is not null")" == "10" ]] || { echo "assertion failed at line $LINENO: [[ '(scalar rvmj_house 'set role authenticated; select count(*) from players where house " >&2; exit 1; }
[[ "$(scalar rvmj_house "set role authenticated; select count(*) from (select id, display_name, house from lifetime_board) x")" == "0" ]] || { echo "assertion failed at line $LINENO: [[ '(scalar rvmj_house 'set role authenticated; select count(*) from (select id, display_" >&2; exit 1; }
[[ "$(scalar rvmj_house "set role authenticated; select count(*) from (select id, display_name, house from skill_board) x")" == "0" ]] || { echo "assertion failed at line $LINENO: [[ '(scalar rvmj_house 'set role authenticated; select count(*) from (select id, display_" >&2; exit 1; }
[[ "$(scalar rvmj_house "set role authenticated; select count(*) from (select id, display_name, house from form_board) x")" == "0" ]] || { echo "assertion failed at line $LINENO: [[ '(scalar rvmj_house 'set role authenticated; select count(*) from (select id, display_" >&2; exit 1; }

# Two devices confirm different houses at once. The row lock decides: the first commit wins and
# the second caller is told the truth rather than overwriting it.
RACE_PLAYER='0a000000-0000-0000-0000-00000000000a'
FIRST_HOUSE="$TEST_ROOT/first-house.txt"
"$PG_BIN/psql" -X -A -t -q -h "$PG_SOCKET" -U postgres -d rvmj_house \
  -c "begin; select stored_house || '|' || applied::text from choose_house('$RACE_PLAYER','rusa'); select pg_sleep(1); commit" \
  >"$FIRST_HOUSE" &
HOUSE_RACE_PID=$!
sleep 0.2
SECOND_HOUSE=$(scalar rvmj_house "select stored_house || '|' || applied::text from choose_house('$RACE_PLAYER','panthera')")
wait "$HOUSE_RACE_PID"
# `bool::text` is 'true'/'false'; the bare 't'/'f' elsewhere in this file is psql DISPLAYING a
# boolean column, which is a different thing.
rg -q '^rusa\|true$' "$FIRST_HOUSE"
[[ "$SECOND_HOUSE" == "rusa|false" ]] || { echo "assertion failed at line $LINENO: [[ 'SECOND_HOUSE' == 'rusa|false' ]]" >&2; exit 1; }
[[ "$(scalar rvmj_house "select house from players where id='$RACE_PLAYER'")" == "rusa" ]] || { echo "assertion failed at line $LINENO: [[ '(scalar rvmj_house 'select house from players where id='RACE_PLAYER'')' == 'rusa' ]]" >&2; exit 1; }

# Chip-mode end by the counter: the full migration stack, then behavioural proofs.
"$PG_BIN/createdb" -h "$PG_SOCKET" -U postgres rvmj_chip_end
"$PG_BIN/psql" -X -v ON_ERROR_STOP=1 -h "$PG_SOCKET" -U postgres -d rvmj_chip_end \
  -f "$SCRIPT_DIR/harness.sql" >/dev/null
apply rvmj_chip_end 0001_chip_spine.sql
apply rvmj_chip_end 0002_chip_spine_hardening.sql
apply rvmj_chip_end 0003_app_mode.sql
apply rvmj_chip_end 0004_explicit_access_grants.sql
apply rvmj_chip_end 0005_notable_photos.sql
apply rvmj_chip_end 0006_house_onboarding.sql
apply rvmj_chip_end 0007_chip_end_by_counter.sql
apply rvmj_chip_end 0008_academic_year_and_rename.sql
"$PG_BIN/psql" -X -v ON_ERROR_STOP=1 -h "$PG_SOCKET" -U postgres -d rvmj_chip_end \
  -f "$SCRIPT_DIR/chip_end_cases.sql" >/dev/null

# Browser roles, probed as themselves. The old confirm_chip_result is gone; its replacement
# must be no more reachable than it was.
assert_denied_as rvmj_chip_end authenticated \
  "select end_chip_game('0c000000-0000-0000-0000-00000000a002','0c000000-0000-0000-0000-000000000002')" \
  "authenticated could execute end_chip_game"
assert_denied_as rvmj_chip_end anon \
  "select end_chip_game('0c000000-0000-0000-0000-00000000a002','0c000000-0000-0000-0000-000000000002')" \
  "anon could execute end_chip_game"
assert_denied_as rvmj_chip_end authenticated \
  "update games set pending_proposed_by = null" \
  "authenticated could write games.pending_proposed_by"

"$PG_BIN/psql" -X -v ON_ERROR_STOP=1 -h "$PG_SOCKET" -U postgres -d rvmj_chip_end \
  -f "$SCRIPT_DIR/board_year_cases.sql" >/dev/null

# 0008 reconciliation, against data that actually exists. The same check runs inside 0008's own
# transaction, but a FRESH replay has no ended games at migration time, so that copy is vacuous
# HERE -- proven by doubling the per-year sum and watching the whole suite pass regardless. It is
# not vacuous on hosted, where real games exist, which is why it stays in the migration too.
#
# chip_end_cases.sql has by now genuinely ended a game through end_chip_game, so this can fail.
# The non-vacuity guard comes FIRST: a reconciliation over an empty table passes forever.
[[ "$(scalar rvmj_chip_end "select count(*) from lifetime_board_by_year")" != "0" ]] || { echo "assertion failed at line $LINENO: [[ '(scalar rvmj_chip_end 'select count(*) from lifetime_board_by_year')' != '0' ]]" >&2; exit 1; }
[[ "$(scalar rvmj_chip_end "select count(*) from lifetime_board")" != "0" ]] || { echo "assertion failed at line $LINENO: [[ '(scalar rvmj_chip_end 'select count(*) from lifetime_board')' != '0' ]]" >&2; exit 1; }
[[ "$(scalar rvmj_chip_end "select count(*) from (select l.id from lifetime_board l join (select id, sum(total_points) t, sum(games_played) g from lifetime_board_by_year group by id) y on y.id = l.id where y.t <> l.total_points or y.g <> l.games_played) s")" == "0" ]] || { echo "assertion failed at line $LINENO: [[ '(scalar rvmj_chip_end 'select count(*) from (select l.id from lifetime_board l join (" >&2; exit 1; }
# Every player on one lifetime board appears on the other.
[[ "$(scalar rvmj_chip_end "select (select count(*) from lifetime_board) = (select count(distinct id) from lifetime_board_by_year)")" == "t" ]] || { echo "assertion failed at line $LINENO: [[ '(scalar rvmj_chip_end 'select (select count(*) from lifetime_board) = (select count(d" >&2; exit 1; }
# The ended game really was filed into an academic year rather than dropped.
[[ "$(scalar rvmj_chip_end "select count(*) from academic_years")" != "0" ]] || { echo "assertion failed at line $LINENO: [[ '(scalar rvmj_chip_end 'select count(*) from academic_years')' != '0' ]]" >&2; exit 1; }

# A rename is retroactive by construction: the boards read display_name live, so a renamed
# player appears under the new name in games already played. Asserted rather than assumed,
# because it is the confirmed product decision and a future schema change could silently break
# it by snapshotting the name onto the game.
RENAME_PLAYER=$(scalar rvmj_chip_end "select id from lifetime_board_by_year limit 1")
[[ "$(scalar rvmj_chip_end "select stored_name || '|' || applied::text from set_display_name('$RENAME_PLAYER','Renamed Player')")" == "Renamed Player|true" ]] || { echo "assertion failed at line $LINENO: [[ '(scalar rvmj_chip_end 'select stored_name || '|' || applied::text from set_display_na" >&2; exit 1; }
[[ "$(scalar rvmj_chip_end "select count(*) from lifetime_board_by_year where id='$RENAME_PLAYER' and display_name='Renamed Player'")" != "0" ]] || { echo "assertion failed at line $LINENO: [[ '(scalar rvmj_chip_end 'select count(*) from lifetime_board_by_year where id='RENAME_" >&2; exit 1; }
# A no-op retry reports honestly rather than claiming to have written.
[[ "$(scalar rvmj_chip_end "select stored_name || '|' || applied::text from set_display_name('$RENAME_PLAYER','Renamed Player')")" == "Renamed Player|false" ]] || { echo "assertion failed at line $LINENO: [[ '(scalar rvmj_chip_end 'select stored_name || '|' || applied::text from set_display_na" >&2; exit 1; }
# Exactly one row comes back. The 0006 `return query` fall-through would emit a second, bogus
# one, and a caller taking the first row would never notice.
[[ "$(scalar rvmj_chip_end "select count(*) from set_display_name('$RENAME_PLAYER','Another Name')")" == "1" ]] || { echo "assertion failed at line $LINENO: [[ '(scalar rvmj_chip_end 'select count(*) from set_display_name('RENAME_PLAYER','Anothe" >&2; exit 1; }
# Blank and over-long names are refused by the database, not merely by the browser.
if "$PG_BIN/psql" -X -v ON_ERROR_STOP=1 -h "$PG_SOCKET" -U postgres -d rvmj_chip_end \
  -c "select set_display_name('$RENAME_PLAYER','   ')" >/dev/null 2>&1
then
  echo "set_display_name accepted a blank name" >&2
  exit 1
fi
if "$PG_BIN/psql" -X -v ON_ERROR_STOP=1 -h "$PG_SOCKET" -U postgres -d rvmj_chip_end \
  -c "select set_display_name('$RENAME_PLAYER', repeat('x', 41))" >/dev/null 2>&1
then
  echo "set_display_name accepted a 41-character name" >&2
  exit 1
fi
# One player renamed, nobody else touched.
[[ "$(scalar rvmj_chip_end "select count(*) from players where display_name = 'Another Name'")" == "1" ]] || { echo "assertion failed at line $LINENO: [[ '(scalar rvmj_chip_end 'select count(*) from players where display_name = 'Another Nam" >&2; exit 1; }

# Deterministic lock races in independent psql sessions.
"$PG_BIN/createdb" -h "$PG_SOCKET" -U postgres rvmj_races
"$PG_BIN/psql" -X -v ON_ERROR_STOP=1 -h "$PG_SOCKET" -U postgres -d rvmj_races \
  -f "$SCRIPT_DIR/harness.sql" >/dev/null
apply rvmj_races 0001_chip_spine.sql
apply rvmj_races 0002_chip_spine_hardening.sql
apply rvmj_races 0003_app_mode.sql
apply rvmj_races 0004_explicit_access_grants.sql
apply rvmj_races 0005_notable_photos.sql
apply rvmj_races 0006_house_onboarding.sql
apply rvmj_races 0007_chip_end_by_counter.sql
apply rvmj_races 0008_academic_year_and_rename.sql
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
[[ "$SECOND_RESULT" == "f" ]] || { echo "assertion failed at line $LINENO: [[ 'SECOND_RESULT' == 'f' ]]" >&2; exit 1; }

# Resume commits first: the old void waits, sees the changed timestamp, and returns false.
"$PG_BIN/psql" -X -A -t -q -h "$PG_SOCKET" -U postgres -d rvmj_races \
  -c "begin; update games set last_activity_at=now() where id='21000000-0000-0000-0000-000000000002' and status='active'; select pg_sleep(1); commit" \
  >/dev/null &
RESUME_PID=$!
sleep 0.2
RESUME_FIRST_RESULT=$(scalar rvmj_races "select expire_abandoned_game('21000000-0000-0000-0000-000000000002','2020-01-01 00:00:02+00')")
wait "$RESUME_PID"
[[ "$RESUME_FIRST_RESULT" == "f" ]] || { echo "assertion failed at line $LINENO: [[ 'RESUME_FIRST_RESULT' == 'f' ]]" >&2; exit 1; }
[[ "$(scalar rvmj_races "select status from games where id='21000000-0000-0000-0000-000000000002'")" == "active" ]] || { echo "assertion failed at line $LINENO: [[ '(scalar rvmj_races 'select status from games where id='21000000-0000-0000-0000-000000" >&2; exit 1; }

# Void commits first: the existing status-guarded resume waits and updates zero rows.
"$PG_BIN/psql" -X -A -t -q -h "$PG_SOCKET" -U postgres -d rvmj_races \
  -c "begin; select expire_abandoned_game('21000000-0000-0000-0000-000000000003','2020-01-01 00:00:03+00'); select pg_sleep(1); commit" \
  >/dev/null &
VOID_PID=$!
sleep 0.2
VOID_FIRST_RESULT=$(scalar rvmj_races "with changed as (update games set last_activity_at=now() where id='21000000-0000-0000-0000-000000000003' and status='active' returning 1) select count(*) from changed")
wait "$VOID_PID"
[[ "$VOID_FIRST_RESULT" == "0" ]] || { echo "assertion failed at line $LINENO: [[ 'VOID_FIRST_RESULT' == '0' ]]" >&2; exit 1; }

# App void commits first: end waits, includes the reversal, and publishes four zero totals.
VOID_HAND_ID=$(scalar rvmj_races "select id from hands where game_id='21000000-0000-0000-0000-000000000004'")
"$PG_BIN/psql" -X -A -t -q -h "$PG_SOCKET" -U postgres -d rvmj_races \
  -c "begin; select void_hand('$VOID_HAND_ID','01000000-0000-0000-0000-000000000001'); select pg_sleep(1); commit" \
  >/dev/null &
VOID_HAND_PID=$!
sleep 0.2
APP_VOID_FIRST_RESULT=$(scalar rvmj_races "select end_game('21000000-0000-0000-0000-000000000004')")
wait "$VOID_HAND_PID"
[[ "$APP_VOID_FIRST_RESULT" == "ended" ]] || { echo "assertion failed at line $LINENO: [[ 'APP_VOID_FIRST_RESULT' == 'ended' ]]" >&2; exit 1; }
[[ "$(scalar rvmj_races "select count(*)::text || '|' || count(final_total)::text || '|' || coalesce(sum(final_total),0)::text from game_players where game_id='21000000-0000-0000-0000-000000000004'")" == "4|4|0" ]] || { echo "assertion failed at line $LINENO: [[ '(scalar rvmj_races 'select count(*)::text || '|' || count(final_total)::text || '|' |" >&2; exit 1; }

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
[[ "$(scalar rvmj_races "select status from games where id='21000000-0000-0000-0000-000000000005'")" == "ended" ]] || { echo "assertion failed at line $LINENO: [[ '(scalar rvmj_races 'select status from games where id='21000000-0000-0000-0000-000000" >&2; exit 1; }
[[ "$(scalar rvmj_races "select voided from hands where id='$END_HAND_ID'")" == "f" ]] || { echo "assertion failed at line $LINENO: [[ '(scalar rvmj_races 'select voided from hands where id='END_HAND_ID'')' == 'f' ]]" >&2; exit 1; }

# Forming game starts first: the old expiry waits and returns false without touching it.
"$PG_BIN/psql" -X -A -t -q -h "$PG_SOCKET" -U postgres -d rvmj_races \
  -c "begin; select start_game('21000000-0000-0000-0000-000000000006','chips',null); select pg_sleep(1); commit" \
  >/dev/null &
FORMING_START_PID=$!
sleep 0.2
FORMING_START_RESULT=$(scalar rvmj_races "select expire_abandoned_forming_game('21000000-0000-0000-0000-000000000006','2020-01-01 00:00:06+00')")
wait "$FORMING_START_PID"
[[ "$FORMING_START_RESULT" == "f" ]] || { echo "assertion failed at line $LINENO: [[ 'FORMING_START_RESULT' == 'f' ]]" >&2; exit 1; }
[[ "$(scalar rvmj_races "select status from games where id='21000000-0000-0000-0000-000000000006'")" == "active" ]] || { echo "assertion failed at line $LINENO: [[ '(scalar rvmj_races 'select status from games where id='21000000-0000-0000-0000-000000" >&2; exit 1; }

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
[[ "$(scalar rvmj_races "select status from games where id='21000000-0000-0000-0000-000000000007'")" == "expired" ]] || { echo "assertion failed at line $LINENO: [[ '(scalar rvmj_races 'select status from games where id='21000000-0000-0000-0000-000000" >&2; exit 1; }

# App void commits first: guarded abandoned ending waits and returns changed.
WRAPPER_VOID_HAND_ID=$(scalar rvmj_races "select id from hands where game_id='21000000-0000-0000-0000-000000000008'")
"$PG_BIN/psql" -X -A -t -q -h "$PG_SOCKET" -U postgres -d rvmj_races \
  -c "begin; select void_hand('$WRAPPER_VOID_HAND_ID','01000000-0000-0000-0000-000000000001'); select pg_sleep(1); commit" \
  >/dev/null &
WRAPPER_VOID_PID=$!
sleep 0.2
WRAPPER_VOID_RESULT=$(scalar rvmj_races "select end_abandoned_game('21000000-0000-0000-0000-000000000008','2020-01-01 00:00:08+00')")
wait "$WRAPPER_VOID_PID"
[[ "$WRAPPER_VOID_RESULT" == "changed" ]] || { echo "assertion failed at line $LINENO: [[ 'WRAPPER_VOID_RESULT' == 'changed' ]]" >&2; exit 1; }
[[ "$(scalar rvmj_races "select status from games where id='21000000-0000-0000-0000-000000000008'")" == "active" ]] || { echo "assertion failed at line $LINENO: [[ '(scalar rvmj_races 'select status from games where id='21000000-0000-0000-0000-000000" >&2; exit 1; }

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
[[ "$(scalar rvmj_races "select status from games where id='21000000-0000-0000-0000-000000000009'")" == "ended" ]] || { echo "assertion failed at line $LINENO: [[ '(scalar rvmj_races 'select status from games where id='21000000-0000-0000-0000-000000" >&2; exit 1; }
[[ "$(scalar rvmj_races "select voided from hands where id='$WRAPPER_END_HAND_ID'")" == "f" ]] || { echo "assertion failed at line $LINENO: [[ '(scalar rvmj_races 'select voided from hands where id='WRAPPER_END_HAND_ID'')' == 'f" >&2; exit 1; }

echo "Database migration, permission, preflight, and lock-race verification passed."
