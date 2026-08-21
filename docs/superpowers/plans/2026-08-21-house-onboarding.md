# House Onboarding and Leaderboard Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let every RVMJ player make one permanent, optional choice of house, prompted after each sign-in until they choose, and paint their leaderboard rows in that house's approved colours.

**Architecture:** A nullable `players.house` column is constrained to seven identifiers, made permanent by a `BEFORE UPDATE OF house` trigger, and written only through a row-locking `choose_house` function that no browser role can execute. The OAuth callback reads the signed-in player's house on the server and appends one temporary `houseSetup=1` marker to the destination it already sanitises; a client provider in the root layout sees that marker and opens a pop-up modal over the destination. The same modal serves a compact homepage action. The browser never sends a player ID: the server action derives it from the session and calls the database function with the service role.

**Tech Stack:** Next.js 16.3 (App Router, Route Handlers, Server Actions), React 19.2, TypeScript 5, Tailwind CSS 4, Supabase (Postgres), Vitest 4 with two projects (`node` and `components`/jsdom), Testing Library, Playwright (MCP), local PostgreSQL 16 for migration replay.

**Spec:** `docs/superpowers/specs/2026-08-21-house-onboarding-design.md`

## Global Constraints

- **The seven-house palette is exact.** Copy these values character for character. Softened or transparency variants were rejected.

  | Stored value | Display name | Row fill | Text |
  |---|---|---|---|
  | `manis` | Manis | `#BFE3F2` | `#142D37` |
  | `strix` | Strix | `#F7D968` | `#142D37` |
  | `aonynx` | Aonynx | `#D3D7D5` | `#142D37` |
  | `orcaella` | Orcaella | `#F2B5CE` | `#142D37` |
  | `rusa` | Rusa | `#2F644F` | `#FFFDF8` |
  | `chelonia` | Chelonia | `#2E4F76` | `#FFFDF8` |
  | `panthera` | Panthera | `#E8873A` | `#142D37` |

- **Never edit `supabase/migrations/0001`–`0005`.** `0004_explicit_access_grants.sql` is a point-in-time hardening record. In particular do NOT edit the literal `15` in its protected-function loop, and do NOT edit its `('id', 'display_name', 'created_at')` player-column list. The new final schema is described in `tests/database/verify_migrations.sql` instead.
- **The new migration is `supabase/migrations/0006_house_onboarding.sql`**, wrapped in an explicit `begin; ... commit;` exactly as 0004 and 0005 are, because it carries assertion blocks that raise.
- **Selection is optional and never blocks a destination.** A failed house read during the callback redirects normally, without the marker.
- **The browser never supplies a player ID.** The server action calls `supabase.auth.getUser()` and passes that ID to the database. A forged `houseSetup=1` marker has no authority.
- **Permanence is enforced by the database**, not by hidden controls. The trigger applies to the service role and to direct operator updates.
- **Query marker:** exactly `houseSetup=1`. Adding it must not rewrite any other part of the destination, and removing it must remove only that one parameter.
- **Approved copy, verbatim:**
  - Title: `Choose your house`
  - Introduction: `Your house colours your leaderboard row and appears beside your name.`
  - Warning: `Choose carefully.` (bold) followed by ` Your house cannot be changed later.`
  - Confirm control: `Confirm [House]` (e.g. `Confirm Rusa`)
  - Busy label: `Saving...`
  - Defer control: `Choose later`
  - Ordinary failure: `We couldn't save your house. Try again.`
  - Race outcome: `Your house is already set to [House].`
  - Resolved control: `Done`
  - House-less leaderboard label: `No house yet`
  - Homepage action: `Choose your house`
- **No em dashes in user-facing copy.**
- **Do not activate the Form leaderboard.** `form_board` gains the `house` column as a data source only; the Form tab keeps its existing informational placeholder and still issues no query.
- **Do not change unrelated gameplay**, the notable-photo feature, `GameLive.tsx`, or the existing hand-gallery placement under Skill.
- **Tests needing a DOM must live under `tests/components/`.** The Vitest config gives jsdom to that directory only; everything else runs on node.
- **`src/lib/actions/*.ts` files begin with `'use server'`, where every export must be an async function.** Constants, types, and pure helpers belong in `src/lib/houses.ts`. Exporting a string or object from a `'use server'` module is a build error. (`export type` is erased at compile time and is safe.)
- **Release boundary:** build, verify, and commit locally only. Do not apply the hosted migration, push, or deploy without Bryan's separate approval.

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/houses.ts` (create) | The single application catalogue: seven ids, display names, and colour tokens, plus the id guard and lookup. No React, no network, no `'use server'`. |
| `supabase/migrations/0006_house_onboarding.sql` (create) | Column, check constraint, permanence trigger, `choose_house`, view rebuilds, grants, and this migration's own assertion blocks. |
| `tests/database/harness.sql` (modify) | Adds the `storage.buckets` stub that 0005 needs so a fresh database can replay every migration. |
| `tests/database/house_cases.sql` (create) | Single-connection database proofs: null allowed, seven accepted, invalid rejected, first write wins, trigger blocks change and null, same-value retry harmless, role matrix, view columns. |
| `tests/database/run-migrations.sh` (modify) | Replays 0005 and 0006 in every database, runs the house cases, and drives the two-connection race with independent `psql` sessions. |
| `tests/database/verify_migrations.sql` (modify) | The post-migration contract: player columns become `id, display_name, created_at, house`; protected-function list and board-view column checks describe the new final schema. |
| `src/lib/actions/house.ts` (create) | The one server action. Validates the identifier, derives the player from the session, calls `choose_house` with the service role, and maps the database answer to `saved` / `already` / `expired` / `failed`. |
| `src/app/auth/callback/route.ts` (modify) | After the existing code exchange, reads the player's house and appends the marker when it is null. Keeps `sameOriginPath` untouched. |
| `src/components/HousePromptModal.tsx` (create) | The pop-up dialog: seven choices, two-tap confirmation, focus trap, Escape and backdrop deferral, live-region announcements, and the three failure states. |
| `src/components/HousePromptProvider.tsx` (create) | Client provider mounted by the root layout. Owns open/closed state, reads and strips the marker, and refreshes server data after a save. Exposes `useHousePrompt()`. |
| `src/components/ChooseHouseAction.tsx` (create) | The compact homepage button that asks the provider to open. |
| `src/app/layout.tsx` (modify) | Mounts the provider around `children`. |
| `src/components/BoardRow.tsx` (create) | One leaderboard row, house-coloured or neutral. Shared by Lifetime and Skill now, and by Form when its product gate is removed later. |
| `src/app/page.tsx` (modify) | Reads the signed-in player's house, renders the action while it is null, and renders rows through `BoardRow`. |

---

### Task 1: The house catalogue

One TypeScript module is the application source for labels and visual tokens. The database constrains the stored values independently, so a drift between the two is caught by the migration assertions rather than by hoping both were edited together.

**Files:**
- Create: `src/lib/houses.ts`
- Test: `tests/houses.test.ts`

> This test runs in the `node` Vitest project. It is not a component test and must NOT live under `tests/components/`.

**Interfaces:**
- Consumes: nothing
- Produces:
  - `type HouseId = 'manis' | 'strix' | 'aonynx' | 'orcaella' | 'rusa' | 'chelonia' | 'panthera'`
  - `type House = { id: HouseId; name: string; fill: string; text: string }`
  - `const HOUSES: readonly House[]` — the seven, in the spec's table order
  - `const HOUSE_IDS: readonly HouseId[]`
  - `function isHouseId(value: unknown): value is HouseId`
  - `function findHouse(id: string | null | undefined): House | null`
  - `const HOUSE_SETUP_PARAM = 'houseSetup'`
  - `const NO_HOUSE_LABEL = 'No house yet'`

- [ ] **Step 1: Write the failing test**

Create `tests/houses.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { HOUSES, HOUSE_IDS, HOUSE_SETUP_PARAM, NO_HOUSE_LABEL, findHouse, isHouseId } from '../src/lib/houses';

/**
 * The palette is a product decision, not an implementation detail: softened and transparency
 * variants were explicitly rejected. Asserting the whole table by value is the point — a test
 * that only counted seven entries would stay green after someone "tidied" a hex code.
 */
describe('house catalogue', () => {
  it('contains exactly the seven approved mappings', () => {
    expect(HOUSES).toEqual([
      { id: 'manis', name: 'Manis', fill: '#BFE3F2', text: '#142D37' },
      { id: 'strix', name: 'Strix', fill: '#F7D968', text: '#142D37' },
      { id: 'aonynx', name: 'Aonynx', fill: '#D3D7D5', text: '#142D37' },
      { id: 'orcaella', name: 'Orcaella', fill: '#F2B5CE', text: '#142D37' },
      { id: 'rusa', name: 'Rusa', fill: '#2F644F', text: '#FFFDF8' },
      { id: 'chelonia', name: 'Chelonia', fill: '#2E4F76', text: '#FFFDF8' },
      { id: 'panthera', name: 'Panthera', fill: '#E8873A', text: '#142D37' },
    ]);
  });

  it('stores lowercase identifiers and shows capitalised display names', () => {
    for (const house of HOUSES) {
      expect(house.id).toBe(house.id.toLowerCase());
      expect(house.name).toBe(house.id[0].toUpperCase() + house.id.slice(1));
    }
  });

  it('lists the ids in catalogue order', () => {
    expect(HOUSE_IDS).toEqual(['manis', 'strix', 'aonynx', 'orcaella', 'rusa', 'chelonia', 'panthera']);
  });

  it('accepts only the seven identifiers', () => {
    for (const id of HOUSE_IDS) expect(isHouseId(id)).toBe(true);
    for (const bogus of ['MANIS', 'Manis', 'manis ', 'gryffindor', '', null, undefined, 7, {}]) {
      expect(isHouseId(bogus)).toBe(false);
    }
  });

  it('looks a house up, and answers null for no house at all', () => {
    expect(findHouse('rusa')).toEqual({ id: 'rusa', name: 'Rusa', fill: '#2F644F', text: '#FFFDF8' });
    expect(findHouse(null)).toBeNull();
    expect(findHouse(undefined)).toBeNull();
    expect(findHouse('gryffindor')).toBeNull();
  });

  it('names the marker and the house-less label once, here', () => {
    expect(HOUSE_SETUP_PARAM).toBe('houseSetup');
    expect(NO_HOUSE_LABEL).toBe('No house yet');
  });
});
```

- [ ] **Step 2: Run the test and watch it fail for the intended reason**

Run: `npx vitest run tests/houses.test.ts`
Expected: FAIL — `Failed to resolve import "../src/lib/houses"`. The failure must be the missing module, not a wrong colour.

- [ ] **Step 3: Write the catalogue**

Create `src/lib/houses.ts`:

```ts
/**
 * The application source for house labels and colours. The database constrains the STORED
 * values independently (see migration 0006), so this list and that check constraint are two
 * separate guards over the same seven identifiers; 0006's assertions fail loudly if they drift.
 *
 * No 'use server' here, and no React: this module is imported by the route handler, the server
 * action, server components, and client components alike.
 */
export type HouseId = 'manis' | 'strix' | 'aonynx' | 'orcaella' | 'rusa' | 'chelonia' | 'panthera';

export type House = { id: HouseId; name: string; fill: string; text: string };

/** Exact approved palette. Softened and transparency variants were rejected. Do not adjust. */
export const HOUSES: readonly House[] = [
  { id: 'manis', name: 'Manis', fill: '#BFE3F2', text: '#142D37' },
  { id: 'strix', name: 'Strix', fill: '#F7D968', text: '#142D37' },
  { id: 'aonynx', name: 'Aonynx', fill: '#D3D7D5', text: '#142D37' },
  { id: 'orcaella', name: 'Orcaella', fill: '#F2B5CE', text: '#142D37' },
  { id: 'rusa', name: 'Rusa', fill: '#2F644F', text: '#FFFDF8' },
  { id: 'chelonia', name: 'Chelonia', fill: '#2E4F76', text: '#FFFDF8' },
  { id: 'panthera', name: 'Panthera', fill: '#E8873A', text: '#142D37' },
];

export const HOUSE_IDS: readonly HouseId[] = HOUSES.map((house) => house.id);

/** The temporary marker the OAuth callback adds and the prompt provider strips. */
export const HOUSE_SETUP_PARAM = 'houseSetup';

export const NO_HOUSE_LABEL = 'No house yet';

export function isHouseId(value: unknown): value is HouseId {
  return typeof value === 'string' && (HOUSE_IDS as readonly string[]).includes(value);
}

export function findHouse(id: string | null | undefined): House | null {
  return HOUSES.find((house) => house.id === id) ?? null;
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run tests/houses.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/houses.ts tests/houses.test.ts
git commit -m "feat: add the seven-house catalogue"
```

---

### Task 2: Replay every migration, including 0005

`tests/database/run-migrations.sh` currently stops at `0004`. The spec requires a rebuild from every migration in order, and 0006 cannot be trusted on a database that never applied 0005. 0005 inserts into `storage.buckets`, which a plain `initdb` database does not have, so the harness needs a stub for it.

This task changes no application code and no schema. Its whole deliverable is that the replay covers the migrations that already exist.

**Files:**
- Modify: `tests/database/harness.sql`
- Modify: `tests/database/run-migrations.sh`

**Interfaces:**
- Consumes: nothing
- Produces: a replay that ends at `0005` in `rvmj_clean`, `rvmj_hosted_shape`, `rvmj_supabase_baseline`, and `rvmj_races`, so Task 3 can append `0006` to the same four databases.

- [ ] **Step 1: Prove the gap, then watch the replay fail for the intended reason**

Confirm 0005 is absent from the script:

```bash
grep -c '0005_notable_photos.sql' tests/database/run-migrations.sh
```

Expected: `0`.

Now add the `apply` line only, to `rvmj_clean`, before `verify_database rvmj_clean`:

```bash
apply rvmj_clean 0005_notable_photos.sql
```

Run: `bash tests/database/run-migrations.sh`
Expected: FAIL with `ERROR: schema "storage" does not exist`. That is the intended reason: the stub is missing, not the migration.

- [ ] **Step 2: Add the storage stub to the harness**

Append to `tests/database/harness.sql`:

```sql
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
```

- [ ] **Step 3: Run the replay and watch `rvmj_clean` get past 0005**

Run: `bash tests/database/run-migrations.sh`
Expected: PASS, ending in `Database migration, permission, preflight, and lock-race verification passed.`

- [ ] **Step 4: Apply 0005 in the other three databases too**

In `tests/database/run-migrations.sh`, add `apply <db> 0005_notable_photos.sql` immediately after the existing `apply <db> 0004_explicit_access_grants.sql` line for each of:

- `rvmj_hosted_shape` (before `verify_database rvmj_hosted_shape`)
- `rvmj_supabase_baseline` (before `verify_database rvmj_supabase_baseline`)
- `rvmj_races` (before the `race_fixtures.sql` load)

Leave `rvmj_preflight` alone: it exists to prove 0003 aborts on duplicate open games and never reaches 0004.

Also assert the bucket actually landed, once, in `rvmj_clean` — right after `verify_database rvmj_clean`:

```bash
# 0005's bucket row is the only thing in that migration a fresh database can observe.
[[ "$(scalar rvmj_clean "select b.public::text || '|' || b.file_size_limit::text from storage.buckets b where b.id = 'notable-photos'")" == "f|2097152" ]]
```

- [ ] **Step 5: Run the full replay**

Run: `bash tests/database/run-migrations.sh`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add tests/database/harness.sql tests/database/run-migrations.sh
git commit -m "test: replay migration 0005 in the database harness"
```

---

### Task 3: Migration 0006 — the database owns permanence

The database is the final authority. A later application bug must not be able to change a confirmed house, so the guard is a trigger that fires for the service role and for a human typing SQL into the dashboard, not a hidden button.

**Files:**
- Create: `supabase/migrations/0006_house_onboarding.sql`
- Create: `tests/database/house_cases.sql`
- Modify: `tests/database/run-migrations.sh`
- Modify: `tests/database/verify_migrations.sql`

**Interfaces:**
- Consumes: the seven identifiers from Task 1 (duplicated as SQL literals on purpose — the database must constrain its own values, and 0006's assertions fail if the two lists drift)
- Produces:
  - `players.house text` — nullable, checked against the seven
  - `choose_house(p_player_id uuid, p_house text) returns table (stored_house text, applied boolean)` — `security definer`, `service_role`/`postgres` only
  - `enforce_permanent_house() returns trigger` and trigger `players_house_permanent`
  - `lifetime_board`, `form_board`, `skill_board` each gain `house` as their final column

- [ ] **Step 1: Write the failing database cases**

Create `tests/database/house_cases.sql`:

```sql
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
  ('0a000000-0000-0000-0000-00000000000a', 'house-race@example.com',    '{"full_name":"Race Player"}');

-- Null is valid for every player, new or pre-existing. There is no default: assigning a house
-- automatically would violate the product decision that the player chooses it.
select house_test.assert_true(
  (select count(*) = 11 from players where id::text like '0a000000%' and house is null),
  'every player starts with no house'
);
select house_test.assert_true(
  (select attnotnull = false from pg_attribute
   where attrelid = 'public.players'::regclass and attname = 'house'),
  'players.house is nullable'
);
select house_test.assert_true(
  (select adbin is null from pg_attribute a
   left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
   where a.attrelid = 'public.players'::regclass and a.attname = 'house'),
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

-- An invalid identifier is rejected twice over: by the function, and by the column constraint
-- underneath it. Each block proves the guard it names, so the sentinel raise sits OUTSIDE the
-- handler; a bare `raise` inside would be caught by its own exception clause.
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
```

- [ ] **Step 2: Wire the cases into the replay and watch them fail for the intended reason**

In `tests/database/run-migrations.sh`, add a denial helper next to `assert_client_denied`:

```bash
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
```

Then add a dedicated house database immediately before the `rvmj_races` block:

```bash
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
[[ "$(scalar rvmj_house "set role authenticated; select count(*) from players where house is not null")" == "9" ]]
[[ "$(scalar rvmj_house "set role authenticated; select count(*) from (select id, display_name, house from lifetime_board) x")" == "0" ]]
[[ "$(scalar rvmj_house "set role authenticated; select count(*) from (select id, display_name, house from skill_board) x")" == "0" ]]
[[ "$(scalar rvmj_house "set role authenticated; select count(*) from (select id, display_name, house from form_board) x")" == "0" ]]

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
rg -q '^rusa\|t$' "$FIRST_HOUSE"
[[ "$SECOND_HOUSE" == "rusa|f" ]]
[[ "$(scalar rvmj_house "select house from players where id='$RACE_PLAYER'")" == "rusa" ]]
```

Also append `apply <db> 0006_house_onboarding.sql` after the `0005` line for `rvmj_clean`, `rvmj_hosted_shape`, `rvmj_supabase_baseline`, and `rvmj_races`, so the contract in `verify_migrations.sql` is checked against the final schema in all three shapes.

Run: `bash tests/database/run-migrations.sh`
Expected: FAIL with `ERROR: 0006_house_onboarding.sql: No such file or directory`. The failure must be the missing migration.

- [ ] **Step 3: Write migration 0006**

Create `supabase/migrations/0006_house_onboarding.sql`:

```sql
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
  if exists (
    select 1 from pg_attrdef d
    join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
    where d.adrelid = 'public.players'::regclass and a.attname = 'house'
  ) then
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
```

- [ ] **Step 4: Update the post-migration verification contract**

`tests/database/verify_migrations.sql` describes the FINAL schema, and the replay now ends at 0006. Make four edits. Do not touch `0004`.

1. Add `'house'` to the authenticated player-column list (around line 70):

```sql
          if has_column_privilege('authenticated', r.oid, col.attname, 'select')
             is distinct from (col.attname in ('id', 'display_name', 'created_at', 'house'))
```

2. Extend the protected-function list (around line 173) so it names every server-only function in the final schema:

```sql
      and p.proname in (
        'start_game', 'create_game_with_seat', 'propose_chip_counts',
        'confirm_chip_result', 'expire_game', 'expire_abandoned_game',
        'expire_abandoned_forming_game',
        'reopen_game', 'log_notable_claim', 'handle_new_user',
        'record_hand', 'void_hand', 'end_game', 'end_abandoned_game',
        'clear_notable_photo', 'choose_house'
      )
```

3. Immediately after that block, add the trigger function's separate contract — it is the one protected function the service role must NOT be able to call:

```sql
-- enforce_permanent_house is not in the list above on purpose: it is a trigger function, and a
-- trigger fires on the strength of the EXECUTE check made when the trigger was created. It
-- should therefore carry no execute grant at all, including for service_role.
select test_support.assert_true(
  not has_function_privilege('anon', 'public.enforce_permanent_house()', 'execute')
    and not has_function_privilege('authenticated', 'public.enforce_permanent_house()', 'execute')
    and not has_function_privilege('service_role', 'public.enforce_permanent_house()', 'execute'),
  'the house permanence trigger function carries no execute grant'
);
```

4. In the board-view block (around line 211), assert the new column alongside `security_invoker`:

```sql
    if not exists (
      select 1 from pg_attribute
      where attrelid = r.oid and attname = 'house' and attnum > 0 and not attisdropped
    ) then
      raise exception 'board view % does not expose house', r.relname;
    end if;
```

5. At the end of the file, name the column in the authenticated board reads so the check exercises the new grant rather than just counting rows:

```sql
-- Column-scoped player access still supports all three security-invoker boards, house included.
set role authenticated;
select count(*) from (select id, display_name, house from lifetime_board) x;
select count(*) from (select id, display_name, house from form_board) x;
select count(*) from (select id, display_name, house from skill_board) x;
reset role;
```

- [ ] **Step 5: Run the whole replay and watch it pass**

Run: `bash tests/database/run-migrations.sh`
Expected: PASS, ending in `Database migration, permission, preflight, and lock-race verification passed.`

If the run fails inside 0006's assertion blocks, read the raised message: each one names the exact drift. Do not weaken an assertion to make the run green.

- [ ] **Step 6: Confirm the migration is genuinely atomic**

A migration whose assertions fire must leave nothing behind. Prove it:

```bash
/opt/homebrew/opt/postgresql@16/bin/psql --version
```

Then temporarily append `do $$ begin raise exception 'deliberate abort'; end $$;` immediately before the final `commit;`, re-run `bash tests/database/run-migrations.sh`, and confirm it fails. Remove the temporary block and re-run to confirm green again. Do not commit the temporary block.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/0006_house_onboarding.sql tests/database/house_cases.sql \
        tests/database/run-migrations.sh tests/database/verify_migrations.sql
git commit -m "feat: make the house column permanent in the database"
```

---

### Task 4: The server action derives the player

The browser asks; the server decides who is asking. Nothing the browser sends identifies the account.

**Files:**
- Create: `src/lib/actions/house.ts`
- Test: `tests/actions/house.test.ts`

**Interfaces:**
- Consumes: `isHouseId`, `HouseId` from `src/lib/houses.ts`; `choose_house` from Task 3
- Produces:
  - `type ChooseHouseResult = { status: 'saved'; house: HouseId } | { status: 'already'; house: HouseId } | { status: 'expired' } | { status: 'failed' }`
  - `async function chooseHouse(house: string): Promise<ChooseHouseResult>`

> `src/lib/actions/house.ts` starts with `'use server'`, so every VALUE export must be an async function. `export type` is erased at compile time and is safe. The four-outcome union is exported as a type for the modal to consume.

- [ ] **Step 1: Write the failing test**

Create `tests/actions/house.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createServerSupabase: vi.fn(),
  createAdminClient: vi.fn(),
}));

vi.mock('../../src/lib/supabase/server', () => ({ createServerSupabase: mocks.createServerSupabase }));
vi.mock('../../src/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }));

import { chooseHouse } from '../../src/lib/actions/house';

const USER_ID = '33333333-3333-3333-3333-333333333333';
const OTHER_ID = '44444444-4444-4444-4444-444444444444';

/** PostgREST returns a `returns table` function as an array of rows. */
function arrange(user: { id: string } | null, rpcResult: { data: unknown; error: { message: string } | null }) {
  const rpc = vi.fn(async () => rpcResult);
  mocks.createServerSupabase.mockResolvedValue({
    auth: { getUser: vi.fn(async () => ({ data: { user } })) },
  });
  mocks.createAdminClient.mockReturnValue({ rpc });
  return { rpc };
}

beforeEach(() => vi.clearAllMocks());

describe('chooseHouse', () => {
  it('saves a valid choice for the signed-in player', async () => {
    const { rpc } = arrange({ id: USER_ID }, { data: [{ stored_house: 'rusa', applied: true }], error: null });

    await expect(chooseHouse('rusa')).resolves.toEqual({ status: 'saved', house: 'rusa' });
    expect(rpc).toHaveBeenCalledWith('choose_house', { p_player_id: USER_ID, p_house: 'rusa' });
  });

  /**
   * The security property of this whole feature in one test. `chooseHouse` takes a house and
   * nothing else, so there is no parameter through which a caller could nominate an account;
   * the id handed to the database is the session's, every time.
   */
  it('sends the session player id, never anything the caller could influence', async () => {
    const { rpc } = arrange({ id: USER_ID }, { data: [{ stored_house: 'manis', applied: true }], error: null });

    await chooseHouse('manis');

    const [, args] = rpc.mock.calls[0] as [string, { p_player_id: string }];
    expect(args.p_player_id).toBe(USER_ID);
    expect(args.p_player_id).not.toBe(OTHER_ID);
  });

  it('reports the stored house when the database says it was already set', async () => {
    arrange({ id: USER_ID }, { data: [{ stored_house: 'chelonia', applied: false }], error: null });

    await expect(chooseHouse('panthera')).resolves.toEqual({ status: 'already', house: 'chelonia' });
  });

  it('accepts a single-object payload as well as a one-row array', async () => {
    arrange({ id: USER_ID }, { data: { stored_house: 'strix', applied: true }, error: null });

    await expect(chooseHouse('strix')).resolves.toEqual({ status: 'saved', house: 'strix' });
  });

  it('rejects an identifier outside the seven without reaching the database', async () => {
    const { rpc } = arrange({ id: USER_ID }, { data: [{ stored_house: 'rusa', applied: true }], error: null });

    await expect(chooseHouse('gryffindor')).resolves.toEqual({ status: 'failed' });
    await expect(chooseHouse('RUSA')).resolves.toEqual({ status: 'failed' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('never converts an unauthenticated request into a write', async () => {
    const { rpc } = arrange(null, { data: [{ stored_house: 'rusa', applied: true }], error: null });

    await expect(chooseHouse('rusa')).resolves.toEqual({ status: 'expired' });
    expect(rpc).not.toHaveBeenCalled();
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it('reports a database error as a plain failure', async () => {
    arrange({ id: USER_ID }, { data: null, error: { message: 'permission denied for function choose_house' } });

    await expect(chooseHouse('rusa')).resolves.toEqual({ status: 'failed' });
  });

  it('treats an unrecognisable payload as a failure rather than guessing', async () => {
    arrange({ id: USER_ID }, { data: [], error: null });
    await expect(chooseHouse('rusa')).resolves.toEqual({ status: 'failed' });

    arrange({ id: USER_ID }, { data: [{ stored_house: 'gryffindor', applied: true }], error: null });
    await expect(chooseHouse('rusa')).resolves.toEqual({ status: 'failed' });
  });

  it('survives a thrown transport error', async () => {
    mocks.createServerSupabase.mockRejectedValue(new Error('fetch failed'));

    await expect(chooseHouse('rusa')).resolves.toEqual({ status: 'failed' });
  });
});
```

- [ ] **Step 2: Run the test and watch it fail for the intended reason**

Run: `npx vitest run tests/actions/house.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/lib/actions/house"`.

- [ ] **Step 3: Write the action**

Create `src/lib/actions/house.ts`:

```ts
'use server';
import { createServerSupabase } from '../supabase/server';
import { createAdminClient } from '../supabase/admin';
import { isHouseId, type HouseId } from '../houses';

/**
 * Four outcomes, because the modal shows four different things. `already` is not a failure: the
 * database is reporting the permanent truth, and the interface switches to it.
 */
export type ChooseHouseResult =
  | { status: 'saved'; house: HouseId }
  | { status: 'already'; house: HouseId }
  | { status: 'expired' }
  | { status: 'failed' };

/**
 * The trust boundary. Note what this function does NOT take: a player id. The browser can send
 * a forged houseSetup marker, a stale form, or a hand-rolled fetch, and still cannot nominate
 * an account — identity comes from the session cookie and nowhere else.
 *
 * The house string IS untrusted, so it is checked against the catalogue before the call. The
 * database checks it again; neither guard is load-bearing alone.
 */
export async function chooseHouse(house: string): Promise<ChooseHouseResult> {
  try {
    if (!isHouseId(house)) return { status: 'failed' };

    const supabase = await createServerSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { status: 'expired' };

    const { data, error } = await createAdminClient()
      .rpc('choose_house', { p_player_id: user.id, p_house: house });
    if (error) return { status: 'failed' };

    // A `returns table` function arrives as an array of rows through PostgREST, but a direct
    // composite call is a bare object. Accept both rather than depending on the transport.
    const row = (Array.isArray(data) ? data[0] : data) as
      { stored_house?: unknown; applied?: unknown } | null | undefined;
    if (!row || !isHouseId(row.stored_house)) return { status: 'failed' };

    return { status: row.applied === true ? 'saved' : 'already', house: row.stored_house };
  } catch {
    return { status: 'failed' };
  }
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run tests/actions/house.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/actions/house.ts tests/actions/house.test.ts
git commit -m "feat: derive the player server-side when choosing a house"
```

---

### Task 5: The callback marks a house-less sign-in

The callback already resolves an untrusted `next` to a same-origin path. That protection is not modified. The only change is one appended parameter, added textually so nothing else in the destination is rewritten.

**Files:**
- Modify: `src/lib/houses.ts`
- Modify: `src/app/auth/callback/route.ts`
- Test: `tests/houses.test.ts` (extend)
- Test: `tests/auth-callback.test.ts` (create)

**Interfaces:**
- Consumes: `HOUSE_SETUP_PARAM` from Task 1
- Produces:
  - `function appendHouseMarker(path: string): string` — appends `houseSetup=1` before any fragment
  - `function stripHouseMarker(search: string): string` — removes only that parameter, returns `''` or `?rest`

- [ ] **Step 1: Write the failing marker tests**

Append to `tests/houses.test.ts`:

```ts
import { appendHouseMarker, stripHouseMarker } from '../src/lib/houses';

/**
 * These are string surgery, not URL round-tripping, and that is deliberate. Passing the
 * destination through URLSearchParams would re-serialise every parameter, quietly turning
 * `?a` into `?a=` and reordering nothing but rewriting everything. The spec says adding or
 * removing the marker must not touch any unrelated part of the destination.
 */
describe('the houseSetup marker', () => {
  it('appends to a bare path', () => {
    expect(appendHouseMarker('/')).toBe('/?houseSetup=1');
    expect(appendHouseMarker('/chips')).toBe('/chips?houseSetup=1');
  });

  it('joins an existing query without rewriting it', () => {
    expect(appendHouseMarker('/?board=skill')).toBe('/?board=skill&houseSetup=1');
    expect(appendHouseMarker('/g?a&b=2')).toBe('/g?a&b=2&houseSetup=1');
  });

  it('stays in front of a fragment', () => {
    expect(appendHouseMarker('/g#seat-E')).toBe('/g?houseSetup=1#seat-E');
    expect(appendHouseMarker('/g?a=1#seat-E')).toBe('/g?a=1&houseSetup=1#seat-E');
  });

  it('removes only itself', () => {
    expect(stripHouseMarker('?houseSetup=1')).toBe('');
    expect(stripHouseMarker('?board=skill&houseSetup=1')).toBe('?board=skill');
    expect(stripHouseMarker('?houseSetup=1&board=skill')).toBe('?board=skill');
    expect(stripHouseMarker('?a&b=2&houseSetup=1')).toBe('?a&b=2');
  });

  it('leaves a destination that never carried the marker exactly as it was', () => {
    expect(stripHouseMarker('?board=skill')).toBe('?board=skill');
    expect(stripHouseMarker('')).toBe('');
    expect(stripHouseMarker('?')).toBe('');
  });

  it('removes a bare or re-valued marker too', () => {
    expect(stripHouseMarker('?houseSetup')).toBe('');
    expect(stripHouseMarker('?houseSetup=0&board=skill')).toBe('?board=skill');
  });
});
```

- [ ] **Step 2: Run it and watch it fail for the intended reason**

Run: `npx vitest run tests/houses.test.ts`
Expected: FAIL — `appendHouseMarker is not a function`.

- [ ] **Step 3: Add the two helpers**

Append to `src/lib/houses.ts`:

```ts
/**
 * Append the marker without disturbing the destination. Deliberately textual: URLSearchParams
 * would re-serialise the whole query, and the destination is a URL the app already sanitised.
 */
export function appendHouseMarker(path: string): string {
  const hashAt = path.indexOf('#');
  const beforeHash = hashAt === -1 ? path : path.slice(0, hashAt);
  const hash = hashAt === -1 ? '' : path.slice(hashAt);
  const separator = beforeHash.includes('?') ? '&' : '?';
  return `${beforeHash}${separator}${HOUSE_SETUP_PARAM}=1${hash}`;
}

/** Remove only the marker from a `location.search`, keeping every other parameter verbatim. */
export function stripHouseMarker(search: string): string {
  const kept = search.replace(/^\?/, '').split('&')
    .filter((part) => part !== '' && part.split('=')[0] !== HOUSE_SETUP_PARAM);
  return kept.length ? `?${kept.join('&')}` : '';
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run tests/houses.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Write the failing callback test**

Create `tests/auth-callback.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createServerSupabase: vi.fn(),
  createAdminClient: vi.fn(),
}));

vi.mock('../src/lib/supabase/server', () => ({ createServerSupabase: mocks.createServerSupabase }));
vi.mock('../src/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }));

import { GET } from '../src/app/auth/callback/route';

const USER_ID = '33333333-3333-3333-3333-333333333333';
const ORIGIN = 'https://rvmj.example';

function arrangeSignIn(user: { id: string } | null) {
  const exchange = vi.fn(async () => ({ data: { user }, error: null }));
  mocks.createServerSupabase.mockResolvedValue({ auth: { exchangeCodeForSession: exchange } });
  return exchange;
}

/** `.from('players').select('house').eq('id', ...).maybeSingle()` */
function arrangeHouse(result: { data: unknown; error: unknown }) {
  const query: Record<string, unknown> = {};
  for (const method of ['select', 'eq']) query[method] = () => query;
  query.maybeSingle = async () => result;
  const from = vi.fn(() => query);
  mocks.createAdminClient.mockReturnValue({ from });
  return from;
}

const callback = (search: string) => GET(new Request(`${ORIGIN}/auth/callback${search}`));
const locationOf = async (search: string) => (await callback(search)).headers.get('location');

beforeEach(() => {
  vi.clearAllMocks();
  arrangeSignIn({ id: USER_ID });
  arrangeHouse({ data: { house: null }, error: null });
});

describe('OAuth callback', () => {
  it('marks a house-less sign-in on the destination it already sanitised', async () => {
    expect(await locationOf('?code=abc')).toBe(`${ORIGIN}/?houseSetup=1`);
  });

  it('leaves a player who already has a house alone', async () => {
    arrangeHouse({ data: { house: 'rusa' }, error: null });

    expect(await locationOf('?code=abc')).toBe(`${ORIGIN}/`);
  });

  /**
   * The existing same-origin protection is the reason this handler exists at all. The URL
   * parser rewrites backslashes and strips tab/newline, so a prefix check on the raw string is
   * not enough; these are the cases that survive `startsWith('//')`.
   */
  it('keeps refusing an off-origin destination', async () => {
    for (const hostile of ['https://evil.com/x', '//evil.com', '/\\evil.com', '/\t//evil.com']) {
      const location = await locationOf(`?code=abc&next=${encodeURIComponent(hostile)}`);
      expect(location).toBe(`${ORIGIN}/?houseSetup=1`);
    }
  });

  it('preserves a same-origin destination, its query, and its fragment', async () => {
    expect(await locationOf(`?code=abc&next=${encodeURIComponent('/?board=skill')}`))
      .toBe(`${ORIGIN}/?board=skill&houseSetup=1`);
    expect(await locationOf(`?code=abc&next=${encodeURIComponent('/game/7#seat-E')}`))
      .toBe(`${ORIGIN}/game/7?houseSetup=1#seat-E`);
  });

  it('adds nothing at all without a code', async () => {
    const from = arrangeHouse({ data: { house: null }, error: null });

    expect(await locationOf(`?next=${encodeURIComponent('/chips')}`)).toBe(`${ORIGIN}/chips`);
    expect(from).not.toHaveBeenCalled();
  });

  it('does not mark a sign-in that failed', async () => {
    arrangeSignIn(null);

    expect(await locationOf('?code=abc')).toBe(`${ORIGIN}/`);
  });

  /**
   * A profile read is a convenience, not a gate. If it fails the player still lands where they
   * were going; the homepage action is the later route to selection.
   */
  it('never lets a failed house read block the destination', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    arrangeHouse({ data: null, error: { message: 'permission denied for table players' } });

    expect(await locationOf(`?code=abc&next=${encodeURIComponent('/chips')}`)).toBe(`${ORIGIN}/chips`);
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('never lets a thrown house read block the destination', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.createAdminClient.mockImplementation(() => { throw new Error('no service role key'); });

    expect(await locationOf('?code=abc')).toBe(`${ORIGIN}/`);
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
```

- [ ] **Step 6: Run it and watch it fail for the intended reason**

Run: `npx vitest run tests/auth-callback.test.ts`
Expected: FAIL — the first case redirects to `https://rvmj.example/` because no marker is added yet.

- [ ] **Step 7: Add the marker to the callback**

Replace the body of `GET` in `src/app/auth/callback/route.ts` and add the helper below it. `sameOriginPath` is NOT modified.

```ts
import { NextResponse } from 'next/server';
import { createServerSupabase } from '../../../lib/supabase/server';
import { createAdminClient } from '../../../lib/supabase/admin';
import { appendHouseMarker } from '../../../lib/houses';

/**
 * Resolve an untrusted `next` param to a same-origin path, falling back to '/'.
 *
 * Resolves against the real origin *before* deciding, because a prefix check on
 * the raw string is not enough: the URL parser rewrites backslashes to slashes
 * and strips tab/newline, so both "/\evil.com" and "/<TAB>//evil.com" survive a
 * `startsWith('//')` test and still resolve off-origin.
 */
function sameOriginPath(raw: string | null, origin: string): string {
  if (!raw) return '/';
  try {
    const resolved = new URL(raw, origin);
    if (resolved.origin !== origin) return '/';
    return `${resolved.pathname}${resolved.search}${resolved.hash}`;
  } catch {
    return '/';
  }
}

/**
 * True when this player has not chosen a house yet.
 *
 * A read failure answers false, deliberately: selection is optional and must never block the
 * destination a player asked for. The homepage action is the later route in, so the cost of a
 * failed read here is one missed prompt, not a stuck sign-in.
 */
async function needsHouseSetup(playerId: string): Promise<boolean> {
  try {
    const { data, error } = await createAdminClient()
      .from('players').select('house').eq('id', playerId).maybeSingle();
    if (error) {
      console.error('[house] profile read failed during callback', error.message);
      return false;
    }
    return (data?.house ?? null) === null;
  } catch (cause) {
    console.error('[house] profile read threw during callback', cause instanceof Error ? cause.message : cause);
    return false;
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  let next = sameOriginPath(url.searchParams.get('next'), url.origin);
  if (code) {
    const supabase = await createServerSupabase();
    const { data } = await supabase.auth.exchangeCodeForSession(code);
    // The marker is a hint for the interface, never an authority. A forged one opens the modal
    // and nothing more: the server still derives the player and the database still decides.
    if (data?.user && await needsHouseSetup(data.user.id)) next = appendHouseMarker(next);
  }
  return NextResponse.redirect(new URL(next, url.origin));
}
```

- [ ] **Step 8: Run it and watch it pass**

Run: `npx vitest run tests/auth-callback.test.ts tests/houses.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/lib/houses.ts src/app/auth/callback/route.ts tests/houses.test.ts tests/auth-callback.test.ts
git commit -m "feat: prompt for a house after a house-less sign-in"
```

---

### Task 6: The pop-up modal

A new component, not `FullScreenPanel`. That one fills the viewport by design; Bryan chose a pop-up that leaves the destination visible behind a dimmed backdrop.

**Files:**
- Create: `src/components/HousePromptModal.tsx`
- Test: `tests/components/HousePromptModal.test.tsx`

**Interfaces:**
- Consumes: `HOUSES`, `findHouse`, `HouseId` from `src/lib/houses.ts`; `chooseHouse` from Task 4; `Button`, `LiveRegion`, `ActionLink` from `src/components/ui.tsx`
- Produces: `function HousePromptModal({ onDefer, onSaved }: { onDefer: () => void; onSaved: () => void })`

> **Apostrophes:** write `We couldn’t save your house. Try again.` with a typographic apostrophe, matching `Couldn’t load the Lifetime board` in `src/app/page.tsx`. A straight `'` in JSX text trips `react/no-unescaped-entities`, and the lint budget for this branch is zero new warnings.

- [ ] **Step 1: Write the failing test**

Create `tests/components/HousePromptModal.test.tsx`:

```tsx
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ chooseHouse: vi.fn() }));
vi.mock('../../src/lib/actions/house', () => ({ chooseHouse: mocks.chooseHouse }));

import { HousePromptModal } from '../../src/components/HousePromptModal';

const onDefer = vi.fn();
const onSaved = vi.fn();
const show = () => render(<HousePromptModal onDefer={onDefer} onSaved={onSaved} />);
const confirmButton = () => screen.getByTestId('house-confirm');

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.chooseHouse.mockResolvedValue({ status: 'saved', house: 'rusa' });
});

describe('house prompt modal', () => {
  it('is a labelled modal dialog carrying the approved copy', () => {
    show();
    const dialog = screen.getByRole('dialog');

    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(screen.getByRole('heading', { name: 'Choose your house' })).toBeTruthy();
    expect(dialog.getAttribute('aria-labelledby'))
      .toBe(screen.getByRole('heading', { name: 'Choose your house' }).id);
    expect(screen.getByText('Your house colours your leaderboard row and appears beside your name.')).toBeTruthy();
    expect(screen.getByText('Choose carefully.')).toBeTruthy();
    expect(screen.getByText(/Your house cannot be changed later\./)).toBeTruthy();
  });

  it('offers all seven houses with their exact approved colours', () => {
    show();
    const expected = [
      ['Manis', 'rgb(191, 227, 242)', 'rgb(20, 45, 55)'],
      ['Strix', 'rgb(247, 217, 104)', 'rgb(20, 45, 55)'],
      ['Aonynx', 'rgb(211, 215, 213)', 'rgb(20, 45, 55)'],
      ['Orcaella', 'rgb(242, 181, 206)', 'rgb(20, 45, 55)'],
      ['Rusa', 'rgb(47, 100, 79)', 'rgb(255, 253, 248)'],
      ['Chelonia', 'rgb(46, 79, 118)', 'rgb(255, 253, 248)'],
      ['Panthera', 'rgb(232, 135, 58)', 'rgb(20, 45, 55)'],
    ];
    for (const [name, fill, text] of expected) {
      const choice = screen.getByRole('button', { name: new RegExp(`^${name}`) });
      expect(choice.style.backgroundColor).toBe(fill);
      expect(choice.style.color).toBe(text);
    }
    expect(screen.getAllByRole('button', { pressed: false })).toHaveLength(7);
  });

  it('preselects nothing and keeps confirmation disabled until a house is chosen', () => {
    show();

    expect(screen.queryAllByRole('button', { pressed: true })).toHaveLength(0);
    expect(confirmButton()).toHaveProperty('disabled', true);
  });

  it('names the chosen house on the confirmation control and marks the choice pressed', () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: /^Rusa/ }));

    expect(screen.getByRole('button', { name: /^Rusa/ }).getAttribute('aria-pressed')).toBe('true');
    expect(confirmButton()).toHaveProperty('disabled', false);
    expect(confirmButton().textContent).toBe('Confirm Rusa');
    // Colour is not the only signal: a check shows in the choice itself.
    expect(screen.getByRole('button', { name: /^Rusa/ }).textContent).toContain('✓');
  });

  it('requires two deliberate taps: choosing does not save', () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: /^Chelonia/ }));

    expect(mocks.chooseHouse).not.toHaveBeenCalled();
  });

  it('shows a busy label and blocks a repeat submission while saving', async () => {
    let release: (value: { status: string; house: string }) => void = () => {};
    mocks.chooseHouse.mockReturnValue(new Promise((resolve) => { release = resolve; }));
    show();
    fireEvent.click(screen.getByRole('button', { name: /^Rusa/ }));
    fireEvent.click(confirmButton());

    await waitFor(() => expect(confirmButton().textContent).toBe('Saving...'));
    fireEvent.click(confirmButton());
    fireEvent.click(confirmButton());
    expect(mocks.chooseHouse).toHaveBeenCalledTimes(1);

    release({ status: 'saved', house: 'rusa' });
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  });

  it('hands a successful save back to its owner', async () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: /^Panthera/ }));
    fireEvent.click(confirmButton());

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(mocks.chooseHouse).toHaveBeenCalledWith('panthera');
    expect(onDefer).not.toHaveBeenCalled();
  });

  it('keeps the choice and restores the control after an ordinary failure', async () => {
    mocks.chooseHouse.mockResolvedValue({ status: 'failed' });
    show();
    fireEvent.click(screen.getByRole('button', { name: /^Strix/ }));
    fireEvent.click(confirmButton());

    await waitFor(() => expect(screen.getByText('We couldn’t save your house. Try again.')).toBeTruthy());
    expect(screen.getByRole('button', { name: /^Strix/ }).getAttribute('aria-pressed')).toBe('true');
    expect(confirmButton().textContent).toBe('Confirm Strix');
    expect(confirmButton()).toHaveProperty('disabled', false);
    expect(screen.getByRole('button', { name: 'Choose later' })).toBeTruthy();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('explains an expired sign-in and offers a route back, without retrying the write', async () => {
    mocks.chooseHouse.mockResolvedValue({ status: 'expired' });
    show();
    fireEvent.click(screen.getByRole('button', { name: /^Manis/ }));
    fireEvent.click(confirmButton());

    await waitFor(() => expect(screen.getByText(/sign-in expired/i)).toBeTruthy());
    expect(screen.getByRole('link', { name: 'Sign in again' }).getAttribute('href')).toBe('/login');
    expect(screen.queryByTestId('house-confirm')).toBeNull();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('switches to the stored house when the database says it was already set', async () => {
    mocks.chooseHouse.mockResolvedValue({ status: 'already', house: 'chelonia' });
    show();
    fireEvent.click(screen.getByRole('button', { name: /^Rusa/ }));
    fireEvent.click(confirmButton());

    await waitFor(() => expect(screen.getByText('Your house is already set to Chelonia.')).toBeTruthy());
    // Retry controls disappear; only Done closes the resolved state.
    expect(screen.queryByTestId('house-confirm')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Rusa/ })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it('announces failures and race outcomes through a live region', async () => {
    mocks.chooseHouse.mockResolvedValue({ status: 'failed' });
    show();
    fireEvent.click(screen.getByRole('button', { name: /^Rusa/ }));
    fireEvent.click(confirmButton());

    await waitFor(() => {
      const live = document.querySelector('[aria-live]');
      expect(live?.textContent).toContain('We couldn’t save your house. Try again.');
    });
  });

  it('defers on Choose later, on Escape, and on a backdrop tap', () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Choose later' }));
    expect(onDefer).toHaveBeenCalledTimes(1);

    cleanup();
    show();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onDefer).toHaveBeenCalledTimes(2);

    cleanup();
    show();
    fireEvent.mouseDown(screen.getByTestId('house-backdrop'));
    expect(onDefer).toHaveBeenCalledTimes(3);
  });

  it('never treats a tap inside the dialog as a backdrop tap', () => {
    show();
    fireEvent.mouseDown(screen.getByRole('dialog'));
    fireEvent.mouseDown(screen.getByRole('heading', { name: 'Choose your house' }));
    fireEvent.mouseDown(screen.getByRole('button', { name: /^Rusa/ }));

    expect(onDefer).not.toHaveBeenCalled();
  });

  it('moves focus into the dialog on open and restores it on close', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    expect(document.activeElement).toBe(opener);

    const view = show();
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);

    view.unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it('keeps Tab inside the dialog', () => {
    show();
    const dialog = screen.getByRole('dialog');
    // Same selector the component uses: a disabled Confirm is not in its trap, so a test that
    // counted it would compare two different lists.
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]), a[href]'));
    const last = focusable[focusable.length - 1];

    last.focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(document.activeElement).toBe(focusable[0]);

    focusable[0].focus();
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });
});
```

- [ ] **Step 2: Run it and watch it fail for the intended reason**

Run: `npx vitest run tests/components/HousePromptModal.test.tsx`
Expected: FAIL — `Failed to resolve import "../../src/components/HousePromptModal"`.

- [ ] **Step 3: Write the modal**

Create `src/components/HousePromptModal.tsx`:

```tsx
'use client';

import type { KeyboardEvent, MouseEvent } from 'react';
import { useEffect, useId, useRef, useState } from 'react';
import { ActionLink, Button, LiveRegion } from './ui';
import { chooseHouse } from '../lib/actions/house';
import { HOUSES, findHouse, type HouseId } from '../lib/houses';

const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const SAVE_FAILED = 'We couldn’t save your house. Try again.';
const EXPIRED = 'Your sign-in expired before we could save your house.';

/**
 * The pop-up. Deliberately NOT FullScreenPanel: that component fills the viewport, and the
 * approved design keeps the destination visible behind a dimmed backdrop so the prompt reads as
 * an invitation rather than a gate.
 *
 * Four phases, because there are four things to show: choosing, saving, the resolved state when
 * another device got there first, and an expired session. `failed` is not a phase — a failure
 * returns to choosing with the selection intact, which is what "retains the selected house and
 * restores the confirmation control" means.
 */
export function HousePromptModal({ onDefer, onSaved }: { onDefer: () => void; onSaved: () => void }) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const submittingRef = useRef(false);

  const [selected, setSelected] = useState<HouseId | null>(null);
  const [phase, setPhase] = useState<'choosing' | 'saving' | 'resolved' | 'expired'>('choosing');
  const [message, setMessage] = useState<string>();

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    titleRef.current?.focus();
    return () => opener?.focus();
  }, []);

  const confirm = async () => {
    // The ref, not the phase, is the guard: two taps in the same tick both see the old state.
    if (!selected || submittingRef.current) return;
    submittingRef.current = true;
    setPhase('saving');
    setMessage(undefined);
    try {
      const result = await chooseHouse(selected);
      if (result.status === 'saved') {
        onSaved();
        return;
      }
      if (result.status === 'already') {
        setPhase('resolved');
        setMessage(`Your house is already set to ${findHouse(result.house)?.name ?? result.house}.`);
        return;
      }
      if (result.status === 'expired') {
        setPhase('expired');
        setMessage(EXPIRED);
        return;
      }
      setPhase('choosing');
      setMessage(SAVE_FAILED);
    } catch {
      setPhase('choosing');
      setMessage(SAVE_FAILED);
    } finally {
      submittingRef.current = false;
    }
  };

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      onDefer();
      return;
    }
    if (event.key !== 'Tab') return;

    const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) {
      event.preventDefault();
      titleRef.current?.focus();
      return;
    }
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!active || !focusable.includes(active)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
      return;
    }
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  // mousedown, not click: a drag that starts on a choice and ends on the backdrop still fires a
  // click on the backdrop, and dismissing a permanent decision on a stray drag is unforgivable.
  function handleBackdrop(event: MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) onDefer();
  }

  const chosen = selected ? findHouse(selected) : null;

  return (
    <div data-testid="house-backdrop" onMouseDown={handleBackdrop}
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-ink/60 p-4">
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={handleKeyDown}
        className="w-full max-w-md rounded-[16px] border-2 border-ink bg-surface p-5 shadow-[0_6px_0_#142D37] sm:p-6">
        <h2 ref={titleRef} tabIndex={-1} id={titleId} className="text-2xl font-extrabold tracking-[-0.04em]">
          Choose your house
        </h2>
        <p className="mt-2 text-sm leading-6 text-muted">
          Your house colours your leaderboard row and appears beside your name.
        </p>
        <p className="mt-4 rounded-[12px] border border-amber/30 bg-amber-soft px-4 py-3 text-sm leading-6 text-amber">
          <strong className="font-bold">Choose carefully.</strong> Your house cannot be changed later.
        </p>

        <div className="mt-4"><LiveRegion tone={phase === 'resolved' ? 'info' : 'error'} message={message} /></div>

        {phase === 'resolved' ? (
          <Button variant="primary" className="mt-5 w-full" onClick={onSaved}>Done</Button>
        ) : phase === 'expired' ? (
          <div className="mt-5 flex flex-col gap-3">
            <ActionLink href="/login" variant="primary">Sign in again</ActionLink>
            <Button variant="quiet" onClick={onDefer}>Choose later</Button>
          </div>
        ) : (
          <>
            <div className="mt-5 grid grid-cols-2 gap-3">
              {HOUSES.map((house) => (
                <button key={house.id} type="button" aria-pressed={selected === house.id}
                  disabled={phase === 'saving'}
                  onClick={() => setSelected(house.id)}
                  style={{ backgroundColor: house.fill, color: house.text }}
                  className={`flex min-h-16 items-center justify-center gap-2 rounded-[12px] border-2 px-3 py-3 text-base font-extrabold transition-[transform,box-shadow] active:translate-y-px disabled:cursor-not-allowed disabled:opacity-45 ${selected === house.id ? 'border-ink shadow-[0_3px_0_#142D37]' : 'border-transparent'}`}>
                  <span>{house.name}</span>
                  {/* aria-hidden: aria-pressed already tells a screen reader. This check is the
                      non-colour signal for everyone else. */}
                  {selected === house.id ? <span aria-hidden="true">✓</span> : null}
                </button>
              ))}
            </div>
            <Button data-testid="house-confirm" variant="primary" className="mt-5 w-full"
              disabled={!selected} busy={phase === 'saving'} busyLabel="Saving..." onClick={confirm}>
              {chosen ? `Confirm ${chosen.name}` : 'Confirm'}
            </Button>
            <Button variant="quiet" className="mt-2 w-full" onClick={onDefer}>Choose later</Button>
          </>
        )}
      </div>
    </div>
  );
}
```

> `Button` spreads `...props` onto the `<button>`, so `data-testid` passes straight through. The confirm control is found by test id rather than by name because its accessible name changes between `Confirm`, `Confirm Rusa`, and `Saving...`.

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run tests/components/HousePromptModal.test.tsx`
Expected: PASS, 14 tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/HousePromptModal.tsx tests/components/HousePromptModal.test.tsx
git commit -m "feat: add the house selection modal"
```

---

### Task 7: One prompt host for both entry points

The sign-in marker and the homepage action open the same modal. Shared state lives in a small provider mounted by the root layout, so the homepage launcher only has to ask.

**Files:**
- Create: `src/components/HousePromptProvider.tsx`
- Create: `src/components/ChooseHouseAction.tsx`
- Modify: `src/app/layout.tsx`
- Test: `tests/components/HousePromptProvider.test.tsx`

**Interfaces:**
- Consumes: `HousePromptModal` from Task 6; `HOUSE_SETUP_PARAM`, `stripHouseMarker` from Task 5
- Produces:
  - `function HousePromptProvider({ children }: { children: ReactNode })`
  - `function useHousePrompt(): { open: () => void }`
  - `function ChooseHouseAction()` — the compact homepage button

- [ ] **Step 1: Write the failing test**

Create `tests/components/HousePromptProvider.test.tsx`:

```tsx
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ chooseHouse: vi.fn(), refresh: vi.fn() }));
vi.mock('../../src/lib/actions/house', () => ({ chooseHouse: mocks.chooseHouse }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));

import { ChooseHouseAction } from '../../src/components/ChooseHouseAction';
import { HousePromptProvider } from '../../src/components/HousePromptProvider';

const at = (url: string) => window.history.replaceState({}, '', url);
const here = () => `${window.location.pathname}${window.location.search}${window.location.hash}`;

const mount = (withAction = false) => render(
  <HousePromptProvider>
    <p>destination</p>
    {withAction ? <ChooseHouseAction /> : null}
  </HousePromptProvider>,
);

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.chooseHouse.mockResolvedValue({ status: 'saved', house: 'rusa' });
  at('/');
});

describe('house prompt host', () => {
  it('opens over the destination when the marker is present', () => {
    at('/?houseSetup=1');
    mount();

    expect(screen.getByRole('dialog')).toBeTruthy();
    // The destination is still rendered underneath, not replaced.
    expect(screen.getByText('destination')).toBeTruthy();
  });

  it('stays shut without the marker', () => {
    mount();

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('a forged marker opens nothing more than the interface', () => {
    at('/?houseSetup=1');
    mount();

    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(mocks.chooseHouse).not.toHaveBeenCalled();
  });

  it('deferral closes the modal and removes only the marker', () => {
    at('/?board=skill&houseSetup=1#top');
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Choose later' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(here()).toBe('/?board=skill#top');
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it('Escape and the backdrop defer the same way', () => {
    at('/?houseSetup=1');
    mount();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(here()).toBe('/');

    cleanup();
    at('/?houseSetup=1');
    mount();
    fireEvent.mouseDown(screen.getByTestId('house-backdrop'));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(here()).toBe('/');
  });

  it('writes no deferral preference anywhere', () => {
    at('/?houseSetup=1');
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Choose later' }));

    expect(document.cookie).toBe('');
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });

  it('the homepage action opens the same modal with no marker in sight', () => {
    mount(true);
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Choose your house' }));

    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(here()).toBe('/');
  });

  it('a save closes the modal, clears the marker, and refreshes server data', async () => {
    at('/?houseSetup=1');
    mount();
    fireEvent.click(screen.getByRole('button', { name: /^Rusa/ }));
    fireEvent.click(screen.getByTestId('house-confirm'));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(here()).toBe('/');
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it('returns focus to the launcher after the modal closes', async () => {
    mount(true);
    const launcher = screen.getByRole('button', { name: 'Choose your house' });
    launcher.focus();
    fireEvent.click(launcher);
    fireEvent.click(screen.getByRole('button', { name: 'Choose later' }));

    await waitFor(() => expect(document.activeElement).toBe(launcher));
  });
});
```

- [ ] **Step 2: Run it and watch it fail for the intended reason**

Run: `npx vitest run tests/components/HousePromptProvider.test.tsx`
Expected: FAIL — `Failed to resolve import "../../src/components/ChooseHouseAction"`.

- [ ] **Step 3: Write the provider and the launcher**

Create `src/components/HousePromptProvider.tsx`:

```tsx
'use client';

import type { ReactNode } from 'react';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { HousePromptModal } from './HousePromptModal';
import { HOUSE_SETUP_PARAM, stripHouseMarker } from '../lib/houses';

type HousePrompt = { open: () => void };
const HousePromptContext = createContext<HousePrompt | null>(null);

export function useHousePrompt(): HousePrompt {
  const value = useContext(HousePromptContext);
  if (!value) throw new Error('useHousePrompt needs a HousePromptProvider above it');
  return value;
}

/**
 * Mounted once by the root layout, so one modal implementation serves both entry points.
 *
 * The marker is read from window.location in an effect rather than through useSearchParams:
 * the marker only ever arrives on a full document load from the OAuth callback, and reading it
 * this way keeps every static route in the app out of a client-side rendering bailout.
 */
export function HousePromptProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  useEffect(() => {
    if (new URLSearchParams(window.location.search).has(HOUSE_SETUP_PARAM)) setOpen(true);
  }, []);

  // replaceState, not a router navigation: deferring must leave the destination and its state
  // exactly as they were. Nothing is written to the database or the browser — a deferral is not
  // an opt-out, and the prompt is meant to return after the next sign-in.
  const close = useCallback(() => {
    setOpen(false);
    const search = stripHouseMarker(window.location.search);
    if (search === window.location.search) return;
    window.history.replaceState(
      window.history.state,
      '',
      `${window.location.pathname}${search}${window.location.hash}`,
    );
  }, []);

  const saved = useCallback(() => {
    close();
    router.refresh();
  }, [close, router]);

  const value = useMemo<HousePrompt>(() => ({ open: () => setOpen(true) }), []);

  return (
    <HousePromptContext.Provider value={value}>
      {children}
      {open ? <HousePromptModal onDefer={close} onSaved={saved} /> : null}
    </HousePromptContext.Provider>
  );
}
```

Create `src/components/ChooseHouseAction.tsx`:

```tsx
'use client';

import { Button } from './ui';
import { useHousePrompt } from './HousePromptProvider';

/**
 * The between-sign-ins route in. Compact and secondary on purpose: choosing a house is optional,
 * so this must not compete with the leaderboard it sits above.
 */
export function ChooseHouseAction() {
  const { open } = useHousePrompt();
  return (
    <Button variant="secondary" className="px-3 py-2 text-sm" onClick={open}>
      Choose your house
    </Button>
  );
}
```

- [ ] **Step 4: Mount the provider in the root layout**

In `src/app/layout.tsx`, import the provider and wrap `children`:

```tsx
import type { Metadata } from 'next';
import { Sora } from 'next/font/google';
import { HousePromptProvider } from '../components/HousePromptProvider';
import './globals.css';
```

```tsx
      <body className="min-h-full bg-canvas text-ink">
        <HousePromptProvider>{children}</HousePromptProvider>
      </body>
```

- [ ] **Step 5: Run it and watch it pass**

Run: `npx vitest run tests/components/HousePromptProvider.test.tsx`
Expected: PASS, 9 tests.

- [ ] **Step 6: Commit**

```bash
git add src/components/HousePromptProvider.tsx src/components/ChooseHouseAction.tsx \
        src/app/layout.tsx tests/components/HousePromptProvider.test.tsx
git commit -m "feat: host one house prompt for both entry points"
```

---

### Task 8: The leaderboard row

One renderer, used by Lifetime and Skill now and by Form when its product gate is removed later. The whole row is the house's colour, so nothing inside it may carry a colour class of its own.

**Files:**
- Create: `src/components/BoardRow.tsx`
- Test: `tests/components/BoardRow.test.tsx`

**Interfaces:**
- Consumes: `House`, `NO_HOUSE_LABEL` from `src/lib/houses.ts`
- Produces:
  - `function BoardRow({ rank, name, context, score, scoreTone, house }: { rank: number; name: string; context: string; score: string; scoreTone: 'gain' | 'loss' | 'neutral'; house: House | null })`

- [ ] **Step 1: Write the failing test**

Create `tests/components/BoardRow.test.tsx`:

```tsx
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { BoardRow } from '../../src/components/BoardRow';
import { HOUSES } from '../../src/lib/houses';

const row = (props: Partial<Parameters<typeof BoardRow>[0]> = {}) => render(
  <ol>
    <BoardRow rank={1} name="Ah Seng" context="3 games" score="+32" scoreTone="gain" house={null} {...props} />
  </ol>,
);

const hex = (value: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
};

afterEach(cleanup);

describe('leaderboard row', () => {
  it('paints the whole row and names the house', () => {
    row({ house: HOUSES.find((h) => h.id === 'rusa')! });
    const item = screen.getByRole('listitem');

    expect(item.style.backgroundColor).toBe('rgb(47, 100, 79)');
    expect(item.style.color).toBe('rgb(255, 253, 248)');
    expect(screen.getByText('Rusa')).toBeTruthy();
  });

  it('renders all seven mappings exactly', () => {
    for (const house of HOUSES) {
      cleanup();
      row({ house });
      const item = screen.getByRole('listitem');
      expect(item.style.backgroundColor).toBe(hex(house.fill));
      expect(item.style.color).toBe(hex(house.text));
      expect(screen.getByText(house.name)).toBeTruthy();
    }
  });

  /**
   * The rule that makes the palette safe: on a coloured row every piece of text is the house's
   * own text colour, so nothing inside may set its own. A stray `text-muted` here would put grey
   * on Rusa's dark green.
   */
  it('lets the house colour reach every piece of text on the row', () => {
    row({ house: HOUSES.find((h) => h.id === 'chelonia')!, score: '-12', scoreTone: 'loss' });
    const item = screen.getByRole('listitem');

    for (const node of Array.from(item.querySelectorAll('*'))) {
      expect(node.className).not.toMatch(/\btext-(ink|muted|gain|coral)\b/);
    }
  });

  it('keeps the sign so score direction never depends on colour', () => {
    row({ house: HOUSES.find((h) => h.id === 'strix')!, score: '+32', scoreTone: 'gain' });
    expect(screen.getByText('+32')).toBeTruthy();

    cleanup();
    row({ house: HOUSES.find((h) => h.id === 'strix')!, score: '-32', scoreTone: 'loss' });
    expect(screen.getByText('-32')).toBeTruthy();
  });

  it('leaves a house-less row neutral and says so', () => {
    row({ house: null });
    const item = screen.getByRole('listitem');

    expect(item.style.backgroundColor).toBe('');
    expect(screen.getByText('No house yet')).toBeTruthy();
    expect(screen.getByText('Ah Seng').className).toMatch(/text-ink/);
    expect(screen.getByText('3 games').className).toMatch(/text-muted/);
  });

  it('keeps signed score tones on a house-less row', () => {
    row({ house: null, score: '+32', scoreTone: 'gain' });
    expect(screen.getByText('+32').className).toMatch(/text-gain/);

    cleanup();
    row({ house: null, score: '-32', scoreTone: 'loss' });
    expect(screen.getByText('-32').className).toMatch(/text-coral/);

    cleanup();
    row({ house: null, score: '2', scoreTone: 'neutral' });
    expect(screen.getByText('2').className).toMatch(/text-muted/);
  });

  it('announces the rank', () => {
    row({ rank: 4 });
    expect(screen.getByLabelText('Rank 4').textContent).toBe('4');
  });
});
```

- [ ] **Step 2: Run it and watch it fail for the intended reason**

Run: `npx vitest run tests/components/BoardRow.test.tsx`
Expected: FAIL — `Failed to resolve import "../../src/components/BoardRow"`.

- [ ] **Step 3: Write the row**

Create `src/components/BoardRow.tsx`:

```tsx
import { NO_HOUSE_LABEL, type House } from '../lib/houses';

/**
 * One leaderboard row, house-coloured or neutral. A server component: no interactivity, so it
 * stays out of the client bundle and off the hydration path.
 *
 * On a house row the colour is set ONCE, on the li, and everything inherits it. That is why no
 * child carries a text-* class in that branch: the approved foreground/background pairs pass
 * contrast as pairs, and a leftover text-muted would quietly break one of them. Score direction
 * therefore rides on the plus or minus sign, never on red and green over a house colour.
 */
export function BoardRow({ rank, name, context, score, scoreTone, house }: {
  rank: number;
  name: string;
  context: string;
  score: string;
  scoreTone: 'gain' | 'loss' | 'neutral';
  house: House | null;
}) {
  const neutralScore = scoreTone === 'gain' ? 'text-gain' : scoreTone === 'loss' ? 'text-coral' : 'text-muted';
  return (
    <li
      style={house ? { backgroundColor: house.fill, color: house.text } : undefined}
      className={`grid min-h-16 grid-cols-[2rem_1fr_auto] items-center gap-3 rounded-[12px] px-3 py-3 ${house ? 'border-2 border-ink' : 'border border-divider bg-surface'}`}>
      <span className={`text-sm font-bold tabular-nums ${house ? '' : 'text-muted'}`} aria-label={`Rank ${rank}`}>{rank}</span>
      <div className="min-w-0">
        <p className={`truncate font-bold ${house ? '' : 'text-ink'}`}>{name}</p>
        <p className={`truncate text-xs font-semibold ${house ? '' : 'text-muted'}`}>{house ? house.name : NO_HOUSE_LABEL}</p>
        <p className={`truncate text-xs ${house ? '' : 'text-muted'}`}>{context}</p>
      </div>
      <span className={`text-xl font-extrabold tabular-nums ${house ? '' : neutralScore}`}>{score}</span>
    </li>
  );
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run tests/components/BoardRow.test.tsx`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/BoardRow.tsx tests/components/BoardRow.test.tsx
git commit -m "feat: give leaderboard rows a house treatment"
```

---

### Task 9: Wire the homepage

The homepage reads the signed-in player's house on the server, offers the compact action while it is null, and renders every row through `BoardRow`.

**Files:**
- Modify: `src/app/page.tsx`
- Test: `tests/components/HomeBoards.test.tsx` (extend, and update its admin mock)

**Interfaces:**
- Consumes: `ChooseHouseAction` (Task 7), `BoardRow` (Task 8), `findHouse` (Task 1)
- Produces: nothing new for later tasks

- [ ] **Step 1: Replace the admin mock so it can serve two query shapes**

The existing mock only knows `from().select().order().limit()`. Replace the `vi.mock('../../src/lib/supabase/admin', ...)` block and the `db` hoisted state in `tests/components/HomeBoards.test.tsx`:

```ts
const db = vi.hoisted(() => ({
  user: null as { id: string } | null,
  result: { data: null as Record<string, unknown>[] | null, error: null as { message: string } | null },
  house: { data: null as { house: string | null } | null, error: null as { message: string } | null },
  // `ascending` and `count` are recorded alongside the table and order column, not dropped: a
  // recorder that ignores them would stay green with the board ranked worst-player-first, or
  // truncated at a different depth. The direction is the product.
  queries: [] as { table: string; orderBy: string; ascending: boolean | undefined; count: number }[],
  profileReads: [] as string[],
}));

vi.mock('../../src/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const query: Record<string, unknown> = {};
      let orderBy = '';
      let ascending: boolean | undefined;
      query.select = () => query;
      query.eq = () => query;
      query.order = (column: string, opts?: { ascending?: boolean }) => {
        orderBy = column;
        ascending = opts?.ascending;
        return query;
      };
      query.limit = async (count: number) => {
        db.queries.push({ table, orderBy, ascending, count });
        return db.result;
      };
      query.maybeSingle = async () => {
        db.profileReads.push(table);
        return db.house;
      };
      return query;
    },
  }),
}));
```

And extend `beforeEach`:

```ts
beforeEach(() => {
  db.user = { id: 'u1' };
  db.result = { data: [], error: null };
  db.house = { data: { house: null }, error: null };
  db.queries = [];
  db.profileReads = [];
});
```

- [ ] **Step 2: Add the failing homepage tests**

Append these cases inside the existing `describe('boards home', ...)` in `tests/components/HomeBoards.test.tsx`:

```tsx
  it('offers the house action to a signed-in player who has not chosen', async () => {
    await renderHome();

    expect(screen.getByRole('button', { name: 'Choose your house' })).toBeTruthy();
    expect(db.profileReads).toEqual(['players']);
  });

  it('hides the house action once a house is set', async () => {
    db.house = { data: { house: 'rusa' }, error: null };
    await renderHome();

    expect(screen.queryByRole('button', { name: 'Choose your house' })).toBeNull();
  });

  it('never offers the house action to a signed-out visitor, and reads no profile', async () => {
    db.user = null;
    await renderHome();

    expect(screen.queryByRole('button', { name: 'Choose your house' })).toBeNull();
    expect(db.profileReads).toEqual([]);
  });

  // A failed read is not evidence that the player has no house, so the action stays hidden and
  // the board still renders. The next successful read offers the route back in.
  it('hides the action when the profile read fails, without breaking the page', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    db.house = { data: null, error: { message: 'permission denied for table players' } };
    await renderHome();

    expect(screen.queryByRole('button', { name: 'Choose your house' })).toBeNull();
    expect(screen.getByText('No finished games yet.')).toBeTruthy();
    consoleError.mockRestore();
  });

  it('paints a house row and leaves a house-less one neutral', async () => {
    db.result = {
      data: [
        { id: 'p1', display_name: 'Ah Seng', total_points: 32, games_played: 3, house: 'rusa' },
        { id: 'p2', display_name: 'Bryan', total_points: -32, games_played: 3, house: null },
      ],
      error: null,
    };
    await renderHome('lifetime');

    const [first, second] = screen.getAllByRole('listitem');
    expect(first.style.backgroundColor).toBe('rgb(47, 100, 79)');
    expect(first.style.color).toBe('rgb(255, 253, 248)');
    expect(screen.getByText('Rusa')).toBeTruthy();
    expect(second.style.backgroundColor).toBe('');
    expect(screen.getByText('No house yet')).toBeTruthy();
    // Signed scores still read correctly on both kinds of row.
    expect(screen.getByText('+32')).toBeTruthy();
    expect(screen.getByText('-32')).toBeTruthy();
  });

  it('paints Skill rows from the same catalogue', async () => {
    db.result = {
      data: [{ id: 'p9', display_name: 'Ah Huat', notable_wins: 2, total_tai: 0, house: 'panthera' }],
      error: null,
    };
    await renderHome('skill');

    expect(screen.getByRole('listitem').style.backgroundColor).toBe('rgb(232, 135, 58)');
    expect(screen.getByText('Panthera')).toBeTruthy();
    expect(screen.getByText('2 notable')).toBeTruthy();
  });

  it('ignores a house value the catalogue does not recognise', async () => {
    db.result = {
      data: [{ id: 'p1', display_name: 'Ah Seng', total_points: 1, games_played: 1, house: 'gryffindor' }],
      error: null,
    };
    await renderHome('lifetime');

    expect(screen.getByRole('listitem').style.backgroundColor).toBe('');
    expect(screen.getByText('No house yet')).toBeTruthy();
  });

  it('still issues no query for Form and still offers no scorekeeper', async () => {
    db.house = { data: { house: 'rusa' }, error: null };
    await renderHome('form');

    expect(db.queries).toEqual([]);
    expect(screen.getByText(/Form uses per-hand games/)).toBeDefined();
    expect(screen.queryByRole('button', { name: /scorekeeper/i })).toBeNull();
  });
```

- [ ] **Step 3: Run them and watch them fail for the intended reason**

Run: `npx vitest run tests/components/HomeBoards.test.tsx`
Expected: FAIL — no `Choose your house` button exists, and the rows carry no background colour.

- [ ] **Step 4: Wire the homepage**

In `src/app/page.tsx`, add the imports:

```tsx
import { BoardRow } from '../components/BoardRow';
import { ChooseHouseAction } from '../components/ChooseHouseAction';
import { findHouse } from '../lib/houses';
```

Add the profile read beside the existing promises, and await it with them:

```tsx
  // "Has no house" and "we could not find out" are different answers. Only the first offers the
  // action: selection is optional, and a failed read must not nag a player who already chose.
  const housePromise = userPromise.then(async (user) => {
    if (!user) return { house: null, known: false };
    try {
      const { data, error } = await createAdminClient()
        .from('players').select('house').eq('id', user.id).maybeSingle();
      if (error) {
        console.error('[house]', error.message);
        return { house: null, known: false };
      }
      return { house: findHouse(data?.house), known: true };
    } catch (cause) {
      console.error('[house]', cause instanceof Error ? cause.message : cause);
      return { house: null, known: false };
    }
  });
  const [user, myHouse, { data: rows, error }] = await Promise.all([userPromise, housePromise, rowsPromise]);
```

Insert the action between the signed-out section and the leaderboard nav:

```tsx
      {user && myHouse.known && !myHouse.house ? (
        <div className="mt-7"><ChooseHouseAction /></div>
      ) : null}
```

Replace the row map. The `<ol>` gains spacing because each row is now its own box:

```tsx
          <ol className="flex flex-col gap-2">
            {(rows ?? []).map((r: Record<string, unknown>, i: number) => {
              const value = Number(board === 'lifetime' ? r.total_points : r.notable_wins) || 0;
              const shown = board === 'lifetime' && value > 0 ? `+${value}` : String(value);
              const scoreTone = board !== 'lifetime' || value === 0 ? 'neutral' : value > 0 ? 'gain' : 'loss';
              const context = board === 'lifetime'
                ? `${Number(r.games_played) || 0} games`
                : `${value} notable${Number(r.total_tai) > 0 ? ` · ${r.total_tai} tai` : ''}`;
              return (
                <BoardRow key={String(r.id)} rank={i + 1} name={String(r.display_name)}
                  context={context} score={shown} scoreTone={scoreTone}
                  house={findHouse(typeof r.house === 'string' ? r.house : null)} />
              );
            })}
          </ol>
```

- [ ] **Step 5: Run the whole suite and watch it pass**

Run: `npm test`
Expected: PASS. Every pre-existing case in `HomeBoards.test.tsx` must still pass unchanged — in particular the gallery-under-Skill cases, the Form placeholder, and the query recorder assertions.

- [ ] **Step 6: Commit**

```bash
git add src/app/page.tsx tests/components/HomeBoards.test.tsx
git commit -m "feat: show houses and the choose action on the homepage"
```

---

### Task 10: Whole-project verification

Nothing here is new behaviour. It is the evidence that the branch is finished, and every claim below must be backed by output actually seen, not by inference from a green neighbour.

**Files:**
- No source changes expected. Fix whatever these checks surface.

- [ ] **Step 1: The complete test suite**

Run: `npm test`
Expected: PASS, and the total must be higher than the 299 baseline. Record the exact number.

- [ ] **Step 2: Generated types plus TypeScript**

Run: `npm run typecheck`
Expected: no output, exit 0. `next typegen` regenerates `.next/types`; `LayoutProps<'/'>` in `src/app/layout.tsx` comes from there, so a layout edit that broke the generated type shows up here and nowhere else.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: zero errors, and the only warning is the pre-existing `GameLive` one. Any new warning is a failure. `react/no-unescaped-entities` is the likely offender: check for a straight apostrophe in JSX text.

- [ ] **Step 4: Production build**

Run: `npm run build`
Expected: success. Watch specifically for a `server-only` violation — if `src/lib/supabase/admin.ts` reached a client component through the new imports, the build fails here rather than at runtime. `HousePromptModal` imports the ACTION, never the admin client.

- [ ] **Step 5: Full migration replay from scratch**

Run: `bash tests/database/run-migrations.sh`
Expected: PASS, ending in the verification line.

- [ ] **Step 6: Whitespace and unintended-diff review**

```bash
git diff --check main
git diff --stat main
git status --short
```

Expected: no whitespace complaints; the changed-file list matches the File Structure table and nothing else. Confirm explicitly that `supabase/migrations/0001`–`0005` are absent from the diff:

```bash
git diff --name-only main -- supabase/migrations/
```

Expected: only `supabase/migrations/0006_house_onboarding.sql`.

Also confirm the photo feature and the gallery placement are untouched:

```bash
git diff --name-only main -- src/app/game src/app/hands src/lib/image.ts
```

Expected: empty.

If `AGENTS.md` shows as modified, that is `next dev` rewriting its own block. Commit it with the work rather than reverting it, as `AGENTS.md` itself instructs.

- [ ] **Step 7: Browser verification with Playwright**

This runs against the LOCAL stack only. Production smoke testing is a separate, later decision, and no arbitrary permanent house may be assigned to Bryan or any other real player.

1. Start the local Supabase stack and apply migrations to it, then start the app:

```bash
npx supabase start
npx supabase db reset
npm run dev
```

`db reset` replays `supabase/migrations/` in order against the local database, which is the same 0001 through 0006 sequence the shell harness proves.

2. Seed two throwaway players through the real path (an `auth.users` insert fires `handle_new_user`), and confirm both start house-less.

3. Drive the flow with the Playwright MCP tools, checking `browser_console_messages` and `browser_network_requests` after each step:
   1. sign in as the first test user with a destination that carries its own query, and confirm the modal opens over that destination with the destination still visible behind it;
   2. press **Choose later**, and confirm the address keeps the destination and its query and loses only `houseSetup`;
   3. sign in again and confirm the prompt returns;
   4. press the homepage **Choose your house** action and confirm the same modal opens;
   5. select a house, confirm, and check that the modal closes, the action disappears, and the visible row is recoloured;
   6. check the Lifetime and Skill boards for the correct treatment on both a house row and a house-less row;
   7. drive the dialog by keyboard only: Tab through the choices, Escape to defer, and confirm focus returns to the launcher;
   8. confirm no unexpected console errors and no failed requests across the whole run.

4. If the local sign-in cannot be driven end to end, say so plainly and name exactly which of the eight checks were and were not performed. A partial browser run reported as complete is worse than no browser run. Do not substitute a production account to close the gap.

- [ ] **Step 8: Commit anything the checks changed**

```bash
git status --short
git add -A
git commit -m "chore: verification fixes for house onboarding"
```

Skip this commit if nothing changed.

---

## Release Order (awaiting Bryan's separate approval)

Do NOT perform any of this without Bryan saying so. It is recorded here so the sequence is not improvised later.

1. Confirm the hosted migration history still ends at `0005` and the local repository is on the intended commit.
2. Apply `0006_house_onboarding.sql` to hosted Supabase BEFORE pushing any application code that reads `players.house`.
3. Verify the hosted column, check constraint, trigger, function permissions, player-column grants, and all three views directly against the hosted database.
4. Only after those checks pass, push the application commits.
5. Confirm Vercel deployed that exact Git commit and that the public alias serves it.
6. Run the controlled production smoke test with an approved account and an approved permanent choice, then inspect runtime logs for errors.

The schema change is backward-compatible with the current production application because the column is nullable. If the application is rolled back, leave the schema and any permanent choices in place; never erase house assignments automatically.

## Out of Scope

- Changing or resetting a confirmed house, including an admin interface
- Random or automatic assignment
- House descriptions, crests, icons, lore, or separate house pages
- House-based scoring, filters, competitions, or private leaderboards
- Activating the Form leaderboard or app-mode scorekeeping
- Adding a top-level House navigation category
- Recording deferral as a durable preference
- Changing the approved palette
- The separate notable-photo manual checks and the photo replacement issue
