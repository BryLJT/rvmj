# Academic-Year Standings and the Account Page — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let players slice the Lifetime board by NUS academic year, and let a signed-in player change the name the boards display.

**Architecture:** One additive migration (`0008`) adds two pure date functions, a per-year board view, a view listing years that contain games, and a rename RPC. The leaderboard gains a year-pill row under its existing tabs; a settings icon in the header opens a new `/account` page. Every write goes through the existing locked path: a `security definer` function the browser cannot execute, called by a server action that takes no player id.

**Tech Stack:** Next.js 16.3 (App Router, Server Components), React 19.2, Supabase (PostgreSQL + auth), Tailwind 4, Vitest 4 + Testing Library.

**Spec:** `docs/superpowers/specs/2026-08-27-academic-year-and-account-design.md`

## Global Constraints

- **Migration `0008` is ADDITIVE ONLY.** No existing column, view, or function is altered or dropped. Database goes to production first; code follows behind a separate approval gate.
- **Every academic-year calculation converts to `Asia/Singapore` before taking a date.** `ended_at` is UTC and mahjong runs late; a game ending 00:30 Singapore on the Monday a year opens is 16:30 UTC the previous day. Spec §3.1.
- **The academic year is a RULE, never a table of dates.** AY N/N+1 runs from the first Monday of August in year N up to, but not including, the first Monday of August in N+1. Never introduce a lookup table of start dates.
- **`academic_year_of` returns the STARTING year.** AY26/27 is `2026`. The `AY26/27` label is formed in TypeScript, never in SQL.
- **Touch targets are 44x44 minimum** — `min-h-11 min-w-11`, the contract `ActionLink` carries and `ChipLive.test.tsx` already asserts.
- **Server actions never take a player id.** Identity comes from the session cookie alone.
- **Every new database object gets the `0004`/`0006` hardening:** `security_invoker` re-applied to views (`create or replace view` discards reloptions), and revoke-then-grant on functions.
- **No em dashes in user-facing copy.** Use periods, commas, or colons.
- **The tab keeps the name "Lifetime".** Renaming was offered and declined. Spec §2.
- Run from repo root: `npx vitest run <path>`, `npm run typecheck`, `npm run lint`, `npm run build`.

---

### Task 1: The academic-year rule in TypeScript

The app must decide "which academic year is it now" to pick the default pill, and must render `2026` as `AY26/27`. This is a pure module with no dependencies so it can be tested exhaustively, including the two edge years and the Singapore-midnight boundary.

**Files:**
- Create: `src/lib/academic-year.ts`
- Test: `tests/academic-year.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `academicYearStart(year: number): Date` — UTC-midnight Date of the first Monday of August in `year`.
  - `academicYearOf(when: Date): number` — the starting year of the academic year containing `when`, evaluated in Singapore.
  - `academicYearLabel(year: number): string` — `2026` to `'AY26/27'`.
  - `parseYearParam(value: string | string[] | undefined): number | 'all' | null` — `null` means "absent or unusable, apply the default".

- [ ] **Step 1: Write the failing test**

Create `tests/academic-year.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { academicYearLabel, academicYearOf, academicYearStart, parseYearParam } from '../src/lib/academic-year';

/**
 * NUS Office of the University Registrar, footnote 1, verbatim: "Commences on first Monday of
 * August each year." Implemented as a rule and asserted at both edges of that rule, because a
 * lookup table of start dates would need a row every year and the forgotten year would file
 * games into the wrong bucket with nothing failing and nothing logging.
 */
describe('academicYearStart', () => {
  it('finds the first Monday of August in an ordinary year', () => {
    expect(academicYearStart(2026).toISOString().slice(0, 10)).toBe('2026-08-03');
  });

  // The two edges of the rule. 7 August is the latest the first Monday can fall, and 1 August
  // the earliest, so these are the only two cases the arithmetic can get wrong.
  it('returns 7 August when 7 August IS the Monday', () => {
    expect(academicYearStart(2023).toISOString().slice(0, 10)).toBe('2023-08-07');
  });

  it('returns 1 August when 7 August is a Sunday', () => {
    expect(academicYearStart(2022).toISOString().slice(0, 10)).toBe('2022-08-01');
  });

  it('agrees with an independent scan of 1-7 August for forty years', () => {
    for (let y = 2020; y <= 2060; y++) {
      const start = academicYearStart(y);
      expect(start.getUTCDay()).toBe(1);          // a Monday
      expect(start.getUTCMonth()).toBe(7);        // August
      expect(start.getUTCDate()).toBeLessThanOrEqual(7);
    }
  });
});

describe('academicYearOf', () => {
  it('files a game played mid-year under that year', () => {
    expect(academicYearOf(new Date('2026-11-15T12:00:00Z'))).toBe(2026);
  });

  it('files the day the year opens under the new year', () => {
    expect(academicYearOf(new Date('2026-08-03T04:00:00Z'))).toBe(2026);
  });

  it('files the day before it opens under the old year', () => {
    expect(academicYearOf(new Date('2026-08-02T04:00:00Z'))).toBe(2025);
  });

  /**
   * The trap. 16:30 UTC on 2 August is 00:30 on 3 August in Singapore, which is the first day
   * of AY26/27. Read in UTC this is the last day of AY25/26. Mahjong runs late, so this is a
   * real night of play and not a hypothetical.
   */
  it('files a late-night game by the Singapore date, not the UTC date', () => {
    expect(academicYearOf(new Date('2026-08-02T16:30:00Z'))).toBe(2026);
  });

  it('files the last instant before midnight Singapore under the old year', () => {
    expect(academicYearOf(new Date('2026-08-02T15:59:00Z'))).toBe(2025);
  });
});

describe('academicYearLabel', () => {
  it('renders the two-digit span', () => {
    expect(academicYearLabel(2026)).toBe('AY26/27');
  });

  it('pads a single-digit second year', () => {
    expect(academicYearLabel(2008)).toBe('AY08/09');
  });

  it('rolls the century without producing AY99/100', () => {
    expect(academicYearLabel(2099)).toBe('AY99/00');
  });
});

describe('parseYearParam', () => {
  it('reads a year', () => {
    expect(parseYearParam('2026')).toBe(2026);
  });

  it('reads the explicit all-time request', () => {
    expect(parseYearParam('all')).toBe('all');
  });

  it('treats an absent parameter as "apply the default"', () => {
    expect(parseYearParam(undefined)).toBeNull();
  });

  // Fail soft, exactly as `board` already does: an unusable value is not an error page.
  it.each([['junk'], ['20261'], ['-2026'], ['1999'], ['3001'], ['']])(
    'treats %s as absent rather than erroring', (value) => {
      expect(parseYearParam(value)).toBeNull();
    });

  it('reads the first value when the parameter is repeated', () => {
    expect(parseYearParam(['2026', 'all'])).toBe(2026);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/academic-year.test.ts`
Expected: FAIL with `Cannot find module '../src/lib/academic-year'`

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/academic-year.ts`:

```ts
/**
 * The NUS academic year, as a rule.
 *
 * Primary source, the Office of the University Registrar's academic calendar, footnote 1
 * verbatim: "Commences on first Monday of August each year." So AY N/N+1 runs from the first
 * Monday of August in year N up to, but not including, the first Monday of August in N+1.
 *
 * Implemented as a RULE and never as a table of start dates. A table needs a new row every
 * August, and the year somebody forgets files games into the wrong bucket with nothing failing
 * and nothing logging. This file must stay computable for any year, forever.
 *
 * This is the TypeScript half of a rule that also lives in SQL (migration 0008,
 * `academic_year_start` / `academic_year_of`). The two must agree exactly: SQL files the games,
 * this decides which pill the app opens on, and a disagreement would default the board to a
 * year whose games were filed elsewhere. tests/academic-year.test.ts and the migration's own
 * assertions check the same cases on both sides.
 */

/** Singapore is UTC+8 with no daylight saving, ever. */
const SGT_OFFSET_MS = 8 * 60 * 60 * 1000;

/**
 * The first Monday of August. Exactly one of 1-7 August is a Monday, so stepping back from
 * 7 August to the Monday of its week always lands on it: if the 7th is itself a Monday we stay
 * put, and if it is a Sunday we step back the full six days to the 1st.
 */
export function academicYearStart(year: number): Date {
  const seventh = new Date(Date.UTC(year, 7, 7));
  const daysSinceMonday = (seventh.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(year, 7, 7 - daysSinceMonday));
}

/**
 * Which academic year an instant falls in, judged in SINGAPORE. `ended_at` is stored in UTC and
 * mahjong runs late: a game finishing at 00:30 on the Monday a year opens is recorded as 16:30
 * the previous afternoon in UTC, and read naively would be filed a whole year early.
 */
export function academicYearOf(when: Date): number {
  const local = new Date(when.getTime() + SGT_OFFSET_MS);
  const year = local.getUTCFullYear();
  const localMidnight = Date.UTC(year, local.getUTCMonth(), local.getUTCDate());
  return localMidnight >= academicYearStart(year).getTime() ? year : year - 1;
}

/** 2026 to "AY26/27". The modulo is what keeps the century roll from reading AY99/100. */
export function academicYearLabel(year: number): string {
  const pad = (n: number) => String(n % 100).padStart(2, '0');
  return `AY${pad(year)}/${pad(year + 1)}`;
}

/** RVMJ's first game was August 2026; a century of headroom is more than the app will need. */
const EARLIEST_YEAR = 2020;
const LATEST_YEAR = 2120;

/**
 * `null` means "absent or unusable, apply the default" rather than "error". Same fail-soft
 * posture the `board` parameter already takes: a hand-typed address should land somewhere
 * sensible, not on an error page.
 */
export function parseYearParam(value: string | string[] | undefined): number | 'all' | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return null;
  if (raw === 'all') return 'all';
  if (!/^\d{4}$/.test(raw)) return null;
  const year = Number(raw);
  return year >= EARLIEST_YEAR && year <= LATEST_YEAR ? year : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/academic-year.test.ts`
Expected: PASS, all cases green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/academic-year.ts tests/academic-year.test.ts
git commit -m "feat: the NUS academic year as a rule, evaluated in Singapore"
```

---

### Task 2: Migration `0008`

Additive only. Two date functions, two views, one rename function, hardening, and assertions that abort the transaction rather than leaving a half-migrated database.

**Files:**
- Create: `supabase/migrations/0008_academic_year_and_rename.sql`
- Test: `tests/database/migration-0008.test.ts` (follow the shape of the existing files in `tests/database/`)

**Interfaces:**
- Consumes: `academic_year_start`, `academic_year_of` mirror `src/lib/academic-year.ts` from Task 1.
- Produces:
  - view `lifetime_board_by_year (id, display_name, academic_year, total_points, games_played, house)`
  - view `academic_years (academic_year)`
  - function `set_display_name(p_player_id uuid, p_name text) returns table (stored_name text, applied boolean)`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0008_academic_year_and_rename.sql`:

```sql
-- ============================================================================
-- 0008 — academic-year standings and player rename
--
-- Wrapped in an explicit transaction, matching 0004 through 0007. This migration carries
-- assertion blocks that raise; without the wrapper a firing assertion would leave the functions
-- created and the views half-built. Do not remove the begin/commit.
--
-- ADDITIVE ONLY. Nothing existing is altered or dropped: lifetime_board, form_board and
-- skill_board are untouched, and no column changes. That is what makes the ordinary
-- database-first release order safe here, unlike 0007 which removed functions the deployed app
-- still called and therefore had to go out code-first.
-- ============================================================================
begin;

-- ============ THE ACADEMIC YEAR, AS A RULE ============
-- NUS Office of the University Registrar, footnote 1, verbatim: "Commences on first Monday of
-- August each year." Never store a table of start dates: it would need a row every August, and
-- the year somebody forgets files games into the wrong bucket silently.
--
-- Exactly one of 1-7 August is a Monday, so truncating the week containing 7 August always
-- lands on the first Monday of that August. date_trunc('week', ...) returns the MONDAY of the
-- containing week.
create or replace function academic_year_start(p_year int) returns date
language sql immutable set search_path = public as $$
  select date_trunc('week', make_date(p_year, 8, 7))::date
$$;

-- STABLE, not IMMUTABLE. Converting a timestamptz to a local date depends on the timezone
-- database, which PostgreSQL treats as mutable across sessions; marking it immutable would be a
-- lie that permits indexing a value which could change.
--
-- The Asia/Singapore conversion is load-bearing, not cosmetic. ended_at is UTC and mahjong runs
-- late: a game finishing 00:30 on the Monday a year opens is stored as 16:30 the previous
-- afternoon, and would be filed a whole year early without it.
create or replace function academic_year_of(p_when timestamptz) returns int
language sql stable set search_path = public as $$
  select case
           when d >= academic_year_start(extract(year from d)::int)
           then extract(year from d)::int
           else extract(year from d)::int - 1
         end
  from (select (p_when at time zone 'Asia/Singapore')::date as d) s
$$;

-- ============ BOARDS ============
-- A SEPARATE view, not a replacement for lifetime_board. "All time" must keep reading the
-- existing view, so the default path is provably untouched by this migration.
create or replace view lifetime_board_by_year as
select p.id, p.display_name,
  academic_year_of(g.ended_at) as academic_year,
  coalesce(sum(gp.final_total), 0) as total_points,
  count(gp.game_id) as games_played,
  p.house
from players p
join game_players gp on gp.player_id = p.id
join games g on g.id = gp.game_id and g.status = 'ended'
group by p.id, p.display_name, academic_year_of(g.ended_at), p.house;

-- Which pills to render. A view rather than a distinct-select in the application, so the pill
-- row and the board it filters can never disagree about which years exist.
create or replace view academic_years as
select distinct academic_year_of(g.ended_at) as academic_year
from games g
where g.status = 'ended';

-- ============ RENAME ============
-- Shaped exactly like choose_house: explicit player id, row lock, (stored, applied) return so a
-- no-op retry reports honestly rather than claiming to have written.
--
-- Unlike house, a display name is NOT permanent and has no trigger guarding it. Nothing in the
-- model joins on it, so a rename is retroactive by construction: every board reads the name
-- live, and a renamed player appears under the new name in games from months ago. That is the
-- confirmed product decision, not an oversight.
create or replace function set_display_name(p_player_id uuid, p_name text)
returns table (stored_name text, applied boolean)
language plpgsql security definer set search_path = public as $$
declare v_clean text; v_current text;
begin
  v_clean := btrim(coalesce(p_name, ''));
  if v_clean = '' then raise exception 'display name may not be blank'; end if;
  if length(v_clean) > 40 then raise exception 'display name may not exceed 40 characters'; end if;

  select p.display_name into v_current from players p where p.id = p_player_id for update;
  if not found then raise exception 'no such player'; end if;

  if v_clean = v_current then
    return query select v_current, false;
    -- `return query` APPENDS to the result set; it does not return. Without this bare return the
    -- function falls through and emits a second, bogus row. Exactly the trap 0006 documented.
    return;
  end if;

  update players set display_name = v_clean where id = p_player_id;
  return query select v_clean, true;
end $$;

-- ============ HARDENING ============
-- 0008 carries its own, because an applied migration cannot be extended. `create or replace
-- view` DISCARDS reloptions, so security_invoker must be applied here or the views read base
-- tables with RLS bypassed.
alter view public.lifetime_board_by_year set (security_invoker = true);
alter view public.academic_years          set (security_invoker = true);

revoke all on public.lifetime_board_by_year, public.academic_years from anon, authenticated;
grant select on public.lifetime_board_by_year, public.academic_years to authenticated;

revoke all privileges on function public.set_display_name(uuid, text) from public, anon, authenticated;
grant execute on function public.set_display_name(uuid, text) to service_role, postgres;

-- The two date functions are pure calculations over supplied arguments. They read no table and
-- are reachable only through views that are themselves revoked from browser roles.

-- ============ ASSERTIONS ============
-- Everything below aborts the transaction rather than leaving a half-migrated database.

-- 1. Every ended game carries an ended_at. Both new views file games by it, so a null would drop
-- a real night of play from every year pill while leaving it in the all-time total, and the two
-- boards would quietly disagree. True by reading 0001, 0003 and 0007 -- every path setting
-- status='ended' sets ended_at=now(), and reopen_game nulls it while returning status to
-- 'active'. Asserted anyway; that is what makes it an invariant rather than a coincidence.
do $$
begin
  if exists (select 1 from games where status = 'ended' and ended_at is null) then
    raise exception 'ended game with no ended_at: the per-year boards would silently drop it';
  end if;
end $$;

-- 2. The year rule lands on the known answers, at BOTH edges. The edge years are named rather
-- than spot-checked so the assertion cannot quietly test the easy case twice.
do $$
begin
  if academic_year_start(2026) <> date '2026-08-03' then
    raise exception 'academic_year_start(2026) = %, expected 2026-08-03', academic_year_start(2026);
  end if;
  -- 7 August 2023 IS a Monday: the truncation must return the 7th itself.
  if academic_year_start(2023) <> date '2023-08-07' then
    raise exception 'academic_year_start(2023) = %, expected 2023-08-07', academic_year_start(2023);
  end if;
  -- 7 August 2022 is a Sunday: the furthest the truncation ever reaches back.
  if academic_year_start(2022) <> date '2022-08-01' then
    raise exception 'academic_year_start(2022) = %, expected 2022-08-01', academic_year_start(2022);
  end if;
end $$;

-- 3. Boundary filing across the timezone. 16:30 UTC on 2 August is 00:30 on 3 August in
-- Singapore, the first day of AY26/27. This is the likeliest defect in the whole feature.
do $$
begin
  if academic_year_of(timestamptz '2026-08-02 16:30+00') <> 2026 then
    raise exception 'late-night game filed by UTC date, not Singapore date';
  end if;
  if academic_year_of(timestamptz '2026-08-02 15:59+00') <> 2025 then
    raise exception 'a game before Singapore midnight was filed into the new year';
  end if;
end $$;

-- 4. Per-year totals reconcile with the all-time total, for every player. One assertion that
-- catches a filing bug, a dropped game and a double-count together.
do $$
declare v_bad int;
begin
  select count(*) into v_bad from (
    select l.id from lifetime_board l
    join (select id, sum(total_points) as t, sum(games_played) as g
          from lifetime_board_by_year group by id) y on y.id = l.id
    where y.t <> l.total_points or y.g <> l.games_played
  ) s;
  if v_bad > 0 then
    raise exception 'per-year totals disagree with the all-time board for % player(s)', v_bad;
  end if;
  -- And nobody appears on one board but not the other.
  if (select count(*) from lifetime_board) <>
     (select count(distinct id) from lifetime_board_by_year) then
    raise exception 'a player appears on one lifetime board but not the other';
  end if;
end $$;

-- 5. Browser roles cannot execute the rename, and cannot read the new views.
do $$
begin
  if has_function_privilege('anon', 'public.set_display_name(uuid, text)', 'execute')
     or has_function_privilege('authenticated', 'public.set_display_name(uuid, text)', 'execute') then
    raise exception 'set_display_name must not be executable by a browser role';
  end if;
  if has_table_privilege('anon', 'public.lifetime_board_by_year', 'select')
     or has_table_privilege('anon', 'public.academic_years', 'select') then
    raise exception 'anon must not read the new views';
  end if;
end $$;

commit;
```

- [ ] **Step 2: Write the failing test**

Create `tests/database/migration-0008.test.ts`, matching the shape of the existing files in that directory (read one first for the harness it uses):

```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * 0008 is additive, and that property is what makes the ordinary database-first release order
 * safe. It is asserted here rather than trusted, because "additive" is a claim about the whole
 * file that is easy to break with one well-meant edit -- and the cost of breaking it is a live
 * app calling something that no longer exists, which is exactly what 0007 cost.
 */
const sql = readFileSync(
  fileURLToPath(new URL('../../supabase/migrations/0008_academic_year_and_rename.sql', import.meta.url)),
  'utf8',
);

describe('migration 0008 is additive', () => {
  it('drops nothing', () => {
    expect(sql).not.toMatch(/\bdrop\s+(table|view|function|column|trigger)\b/i);
  });

  it('alters no table', () => {
    expect(sql).not.toMatch(/\balter\s+table\b/i);
  });

  it('does not replace the boards the default view still reads', () => {
    expect(sql).not.toMatch(/create\s+or\s+replace\s+view\s+lifetime_board\b/i);
    expect(sql).not.toMatch(/create\s+or\s+replace\s+view\s+form_board\b/i);
    expect(sql).not.toMatch(/create\s+or\s+replace\s+view\s+skill_board\b/i);
  });

  it('runs inside an explicit transaction so a firing assertion rolls the whole thing back', () => {
    expect(sql.trimStart()).toMatch(/^--[\s\S]*?\bbegin;/);
    expect(sql.trimEnd()).toMatch(/commit;$/);
  });
});

describe('migration 0008 hardening', () => {
  it('re-applies security_invoker to both new views', () => {
    expect(sql).toMatch(/alter view public\.lifetime_board_by_year set \(security_invoker = true\)/);
    expect(sql).toMatch(/alter view public\.academic_years\s+set \(security_invoker = true\)/);
  });

  it('keeps the rename function away from browser roles', () => {
    expect(sql).toMatch(/revoke all privileges on function public\.set_display_name\(uuid, text\) from public, anon, authenticated/);
    expect(sql).toMatch(/grant execute on function public\.set_display_name\(uuid, text\) to service_role, postgres/);
  });
});

describe('migration 0008 states the rule, not a table of dates', () => {
  it('computes the year start rather than listing start dates', () => {
    expect(sql).toMatch(/date_trunc\('week', make_date\(p_year, 8, 7\)\)/);
  });

  it('converts to Singapore before taking the date', () => {
    expect(sql).toMatch(/at time zone 'Asia\/Singapore'/);
  });

  it('asserts both edges of the first-Monday rule, not just the easy case', () => {
    expect(sql).toContain("academic_year_start(2023) <> date '2023-08-07'");
    expect(sql).toContain("academic_year_start(2022) <> date '2022-08-01'");
  });

  it('asserts the late-night boundary in both directions', () => {
    expect(sql).toContain("academic_year_of(timestamptz '2026-08-02 16:30+00') <> 2026");
    expect(sql).toContain("academic_year_of(timestamptz '2026-08-02 15:59+00') <> 2025");
  });
});
```

- [ ] **Step 3: Run test to verify it passes**

Run: `npx vitest run tests/database/migration-0008.test.ts`
Expected: PASS. (The migration was written in Step 1, so these guard it rather than drive it. They exist to stop a later edit breaking the additive property.)

- [ ] **Step 4: Replay the migrations from scratch against the local stack**

Run the project's existing full-replay check (the same one used for `0006` and `0007`; see `tests/database/` and `projects/rvmj.md` for the command in use). Expected: every migration `0001` through `0008` applies cleanly and every assertion in `0008` passes.

If the local Supabase stack is not running, start it before this step. **Do not skip this step** — the assertions are the entire value of the migration and they only run when it is actually applied.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0008_academic_year_and_rename.sql tests/database/migration-0008.test.ts
git commit -m "feat(db): academic-year boards and a player rename function"
```

---

### Task 3: Year pills on the leaderboard

**Files:**
- Create: `src/components/YearPills.tsx`
- Modify: `src/app/page.tsx`
- Test: `tests/components/YearPills.test.tsx`, and extend `tests/components/HomeBoards.test.tsx`

**Interfaces:**
- Consumes: `academicYearLabel`, `academicYearOf`, `parseYearParam` (Task 1); views `academic_years` and `lifetime_board_by_year` (Task 2).
- Produces: `<YearPills years={number[]} selected={number | 'all'} />`.

- [ ] **Step 1: Write the failing component test**

Create `tests/components/YearPills.test.tsx`:

```tsx
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { YearPills } from '../../src/components/YearPills';

afterEach(cleanup);

describe('YearPills', () => {
  it('offers All time first, then years newest first', () => {
    render(<YearPills years={[2025, 2026]} selected="all" />);
    const labels = screen.getAllByRole('link').map((a) => a.textContent);
    expect(labels).toEqual(['All time', 'AY26/27', 'AY25/26']);
  });

  it('marks the selected year for assistive technology', () => {
    render(<YearPills years={[2026]} selected={2026} />);
    expect(screen.getByRole('link', { name: 'AY26/27' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'All time' }).getAttribute('aria-current')).toBeNull();
  });

  it('names itself distinctly from the board tabs above it', () => {
    render(<YearPills years={[2026]} selected="all" />);
    expect(screen.getByRole('navigation', { name: 'Academic year' })).toBeDefined();
  });

  // All time must stay reachable now that it is no longer the default.
  it('points All time at an explicit request, not at a bare address', () => {
    render(<YearPills years={[2026]} selected={2026} />);
    expect(screen.getByRole('link', { name: 'All time' }).getAttribute('href'))
      .toBe('/?board=lifetime&year=all');
  });

  it('points a year pill at that year', () => {
    render(<YearPills years={[2026]} selected="all" />);
    expect(screen.getByRole('link', { name: 'AY26/27' }).getAttribute('href'))
      .toBe('/?board=lifetime&year=2026');
  });

  it('renders nothing at all when no year has games yet', () => {
    const { container } = render(<YearPills years={[]} selected="all" />);
    expect(container.firstChild).toBeNull();
  });

  it('gives every pill a real touch target', () => {
    render(<YearPills years={[2026]} selected="all" />);
    for (const link of screen.getAllByRole('link')) {
      expect(link.className.split(' ')).toContain('min-h-11');
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/YearPills.test.tsx`
Expected: FAIL with `Cannot find module '../../src/components/YearPills'`

- [ ] **Step 3: Write the component**

Create `src/components/YearPills.tsx`:

```tsx
import Link from 'next/link';
import { academicYearLabel } from '../lib/academic-year';

/**
 * A second, subordinate row under the board tabs. Deliberately quieter than the tabs above it:
 * those choose WHAT is ranked, these choose WHEN, and the tabs stay the primary control.
 *
 * Renders nothing when no year has games. An empty row would read as "no years exist" rather
 * than "nothing has been played yet", and the board's own empty state already says the latter.
 *
 * The row scrolls inside itself so it cannot widen the page as years accumulate. The body must
 * never scroll sideways.
 */
export function YearPills({ years, selected }: { years: number[]; selected: number | 'all' }) {
  if (years.length === 0) return null;

  const pill = (key: string, href: string, label: string, isSelected: boolean) => (
    <Link key={key} href={href} prefetch
      aria-current={isSelected ? 'page' : undefined}
      className={`inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-[9px] px-3 text-xs font-bold ${
        isSelected ? 'bg-ink text-surface' : 'text-muted'
      }`}>
      {label}
    </Link>
  );

  return (
    <nav aria-label="Academic year" className="mt-2 flex gap-1 overflow-x-auto">
      {pill('all', '/?board=lifetime&year=all', 'All time', selected === 'all')}
      {[...years].sort((a, b) => b - a).map((year) =>
        pill(String(year), `/?board=lifetime&year=${year}`, academicYearLabel(year), selected === year),
      )}
    </nav>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/components/YearPills.test.tsx`
Expected: PASS

- [ ] **Step 5: Write the failing page test for default resolution**

Add to `tests/components/HomeBoards.test.tsx`, inside `describe('boards home', ...)`. Extend the existing `db` mock so `academic_years` and `lifetime_board_by_year` can be stubbed; follow the recording style already in that file.

```tsx
  /**
   * Spec §4.1. The default is the CURRENT academic year, EXCEPT while that year is still empty.
   * Without the fallback, RVMJ greets everyone with "No finished games yet" on the first morning
   * of every new academic year -- a board that looks like it has lost four months of history, on
   * the night the group most wants to play.
   */
  it('opens on the current academic year once it has games', async () => {
    db.years = [2026];
    await renderHome();
    expect(screen.getByRole('link', { name: 'AY26/27' }).getAttribute('aria-current')).toBe('page');
  });

  it('falls back to all time while the current year is still empty', async () => {
    db.years = [2025];
    await renderHome();
    expect(screen.getByRole('link', { name: 'All time' }).getAttribute('aria-current')).toBe('page');
  });

  it('honours an explicit all-time request', async () => {
    db.years = [2026];
    await renderHome(undefined, 'all');
    expect(screen.getByRole('link', { name: 'All time' }).getAttribute('aria-current')).toBe('page');
  });

  it('treats a malformed year as absent rather than erroring', async () => {
    db.years = [2026];
    await renderHome(undefined, 'not-a-year');
    expect(screen.getByRole('link', { name: 'AY26/27' }).getAttribute('aria-current')).toBe('page');
  });

  it('reads the per-year board when a year is selected and the all-time board otherwise', async () => {
    db.years = [2026];
    await renderHome(undefined, 'all');
    expect(db.queries.map((q) => q.table)).toContain('lifetime_board');

    db.queries = [];
    await renderHome(undefined, '2026');
    expect(db.queries.map((q) => q.table)).toContain('lifetime_board_by_year');
  });

  // A failed read of the year list must not read as "no years exist".
  it('still renders the board when the year list cannot be read', async () => {
    db.yearsError = { message: 'boom' };
    await renderHome();
    expect(screen.queryByRole('navigation', { name: 'Academic year' })).toBeNull();
    expect(screen.getByRole('navigation', { name: 'Leaderboard' })).toBeDefined();
  });
```

Update `renderHome` to take a second argument:

```tsx
const renderHome = async (board?: string, year?: string) => render(
  <HousePromptProvider>
    {await Home({ searchParams: Promise.resolve({ ...(board ? { board } : {}), ...(year ? { year } : {}) }) })}
  </HousePromptProvider>,
);
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run tests/components/HomeBoards.test.tsx`
Expected: FAIL — no year navigation is rendered.

- [ ] **Step 7: Wire it into the page**

In `src/app/page.tsx`:

1. Import `YearPills`, and `academicYearOf` / `parseYearParam` from `../lib/academic-year`.
2. Widen the `searchParams` type to `Promise<{ board?: string; year?: string }>`.
3. After reading `board`, resolve the year. **Read the clock once**, and only here:

```tsx
  // Spec §4.1. The default is the current academic year, EXCEPT while that year is still empty:
  // otherwise every new academic year opens RVMJ on "No finished games yet", which reads as the
  // app having lost the history rather than the year not having started.
  const requestedYear = parseYearParam(raw.year);
  const yearsPromise = createAdminClient().from('academic_years').select('academic_year');
```

4. Resolve `years` alongside the existing `Promise.all`, defaulting to `[]` on error and logging like the boards do.
5. Compute the selection:

```tsx
  const years = (yearRows ?? []).map((r) => Number(r.academic_year)).filter(Number.isFinite);
  const currentYear = academicYearOf(new Date());
  const selectedYear: number | 'all' =
    requestedYear === 'all' ? 'all'
    : typeof requestedYear === 'number' && years.includes(requestedYear) ? requestedYear
    : years.includes(currentYear) ? currentYear
    : 'all';
```

6. Choose the board query from `selectedYear`: `lifetime_board` for `'all'`, otherwise `lifetime_board_by_year` filtered with `.eq('academic_year', selectedYear)`. Both order by `total_points` descending and limit 50, exactly as now.
7. Render `<YearPills years={years} selected={selectedYear} />` immediately after the existing board `<nav>`, only when `board === 'lifetime'`.

**Note on ordering:** the board query depends on `selectedYear`, which depends on the years read. That is one added round trip in sequence. It is acceptable: measured on 2026-08-27, adding three queries to this page moved its response time by roughly nothing (84ms with none, 83ms with three), because the functions now run beside the database in Singapore.

- [ ] **Step 8: Run tests to verify they pass**

Run: `npx vitest run tests/components/HomeBoards.test.tsx tests/components/YearPills.test.tsx`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/components/YearPills.tsx src/app/page.tsx tests/components/YearPills.test.tsx tests/components/HomeBoards.test.tsx
git commit -m "feat: slice the lifetime board by NUS academic year"
```

---

### Task 4: The settings icon

**Files:**
- Create: `src/components/SettingsLink.tsx`
- Modify: `src/app/page.tsx` (header only)
- Test: `tests/components/SettingsLink.test.tsx`, extend `tests/components/HomeBoards.test.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `<SettingsLink />`, a link to `/account`.

- [ ] **Step 1: Write the failing test**

Create `tests/components/SettingsLink.test.tsx`:

```tsx
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { SettingsLink } from '../../src/components/SettingsLink';

afterEach(cleanup);

describe('SettingsLink', () => {
  it('leads to the account page', () => {
    render(<SettingsLink />);
    expect(screen.getByRole('link', { name: 'Account settings' }).getAttribute('href')).toBe('/account');
  });

  /**
   * An icon is not a label. Without an accessible name this control announces as "link" and is
   * unusable with a screen reader, which is the one failure mode a purely visual review never
   * catches.
   */
  it('carries a real name for assistive technology, and hides the decorative glyph', () => {
    const { container } = render(<SettingsLink />);
    expect(screen.getByRole('link', { name: 'Account settings' })).toBeDefined();
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('is a real touch target', () => {
    render(<SettingsLink />);
    const classes = screen.getByRole('link', { name: 'Account settings' }).className.split(' ');
    expect(classes).toContain('min-h-11');
    expect(classes).toContain('min-w-11');
    expect(classes).toContain('inline-flex');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/SettingsLink.test.tsx`
Expected: FAIL with `Cannot find module`

- [ ] **Step 3: Write the component**

Create `src/components/SettingsLink.tsx`:

```tsx
import Link from 'next/link';

/**
 * The gear is drawn inline rather than pulled from an icon set: RVMJ has no icon dependency and
 * one control does not justify adding one. The border and hard offset shadow match BrandMark and
 * the card header badges, so it reads as part of the same object language.
 *
 * The glyph is hidden from assistive technology and the LINK carries the name. An icon-only
 * control with no accessible name announces as "link" and is unusable with a screen reader,
 * which no amount of visual review would catch.
 */
export function SettingsLink() {
  return (
    <Link href="/account" aria-label="Account settings"
      className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-[11px] border-2 border-ink bg-surface shadow-[3px_3px_0_#142D37]">
      <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5" fill="none"
        stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3.25" />
        <path d="M12 2.5v2.2M12 19.3v2.2M21.5 12h-2.2M4.7 12H2.5M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6M18.7 18.7l-1.6-1.6M6.9 6.9L5.3 5.3" />
      </svg>
    </Link>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/components/SettingsLink.test.tsx`
Expected: PASS

- [ ] **Step 5: Write the failing visibility test**

Add to `tests/components/HomeBoards.test.tsx`:

```tsx
  // It leads to a page about your own account, so offering it signed out leads only to a wall.
  it('offers account settings to a signed-in player', async () => {
    db.user = { id: 'u1' };
    await renderHome();
    expect(screen.getByRole('link', { name: 'Account settings' })).toBeDefined();
  });

  it('does not offer account settings to a signed-out visitor', async () => {
    db.user = null;
    await renderHome();
    expect(screen.queryByRole('link', { name: 'Account settings' })).toBeNull();
  });
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run tests/components/HomeBoards.test.tsx`
Expected: FAIL — no such link.

- [ ] **Step 7: Put it in the header**

In `src/app/page.tsx`, the header becomes a row with the brand mark left and the control right:

```tsx
      <header>
        <div className="flex items-start justify-between gap-4">
          <BrandMark />
          {user ? <SettingsLink /> : null}
        </div>
        <h1 className="mt-8 text-4xl font-extrabold tracking-[-0.04em]">Table standings</h1>
      </header>
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npx vitest run tests/components/HomeBoards.test.tsx tests/components/SettingsLink.test.tsx`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/components/SettingsLink.tsx src/app/page.tsx tests/components/SettingsLink.test.tsx tests/components/HomeBoards.test.tsx
git commit -m "feat: reach account settings from the leaderboard header"
```

---

### Task 5: The account page and the rename action

**Files:**
- Create: `src/lib/actions/account.ts`, `src/app/account/page.tsx`, `src/app/account/RenameForm.tsx`
- Test: `tests/actions/account.test.ts`, `tests/pages/account-page.test.ts`, `tests/components/RenameForm.test.tsx`

**Interfaces:**
- Consumes: `set_display_name` (Task 2); `findHouse` and `NO_HOUSE_LABEL` from `src/lib/houses`.
- Produces: `renameMe(name: string): Promise<RenameResult>` where

```ts
export const MAX_DISPLAY_NAME = 40;
export type RenameResult =
  | { status: 'saved'; name: string }
  | { status: 'unchanged'; name: string }
  | { status: 'invalid'; reason: 'blank' | 'too_long' }
  | { status: 'expired' }
  | { status: 'failed' };
```

- [ ] **Step 1: Write the failing action test**

Create `tests/actions/account.test.ts`, following the mocking shape of the existing files in `tests/actions/`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createServerSupabase: vi.fn(),
  createAdminClient: vi.fn(),
}));
vi.mock('../../src/lib/supabase/server', () => ({ createServerSupabase: mocks.createServerSupabase }));
vi.mock('../../src/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }));

import { renameMe } from '../../src/lib/actions/account';

const USER = '33333333-3333-3333-3333-333333333333';
const signedInAs = (user: { id: string } | null) =>
  mocks.createServerSupabase.mockResolvedValue({ auth: { getUser: vi.fn(async () => ({ data: { user } })) } });
const rpcReturning = (result: unknown) => {
  const rpc = vi.fn(async () => result);
  mocks.createAdminClient.mockReturnValue({ rpc });
  return rpc;
};

beforeEach(() => { vi.clearAllMocks(); signedInAs({ id: USER }); });

describe('renameMe', () => {
  it('saves a new name', async () => {
    rpcReturning({ data: [{ stored_name: 'Orca', applied: true }], error: null });
    expect(await renameMe('Orca')).toEqual({ status: 'saved', name: 'Orca' });
  });

  // Not a failure. The database is honestly reporting that the submitted name is already stored.
  it('reports an unchanged name without claiming to have written', async () => {
    rpcReturning({ data: [{ stored_name: 'Orca', applied: false }], error: null });
    expect(await renameMe('Orca')).toEqual({ status: 'unchanged', name: 'Orca' });
  });

  it('refuses a blank name without calling the database', async () => {
    const rpc = rpcReturning({ data: null, error: null });
    expect(await renameMe('   ')).toEqual({ status: 'invalid', reason: 'blank' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('refuses an over-long name without calling the database', async () => {
    const rpc = rpcReturning({ data: null, error: null });
    expect(await renameMe('x'.repeat(41))).toEqual({ status: 'invalid', reason: 'too_long' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('reports an expired session rather than failing opaquely', async () => {
    signedInAs(null);
    expect(await renameMe('Orca')).toEqual({ status: 'expired' });
  });

  it('reports a database error as a failure', async () => {
    rpcReturning({ data: null, error: { message: 'boom' } });
    expect(await renameMe('Orca')).toEqual({ status: 'failed' });
  });

  /**
   * The trust boundary. The browser can send anything, and still cannot nominate an account:
   * the id handed to the database comes from the session and nowhere else.
   */
  it('names the account from the session, never from the caller', async () => {
    const rpc = rpcReturning({ data: [{ stored_name: 'Orca', applied: true }], error: null });
    await renameMe('Orca');
    expect(rpc).toHaveBeenCalledWith('set_display_name', { p_player_id: USER, p_name: 'Orca' });
  });

  it('accepts a composite row as well as an array', async () => {
    rpcReturning({ data: { stored_name: 'Orca', applied: true }, error: null });
    expect(await renameMe('Orca')).toEqual({ status: 'saved', name: 'Orca' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/actions/account.test.ts`
Expected: FAIL with `Cannot find module '../../src/lib/actions/account'`

- [ ] **Step 3: Write the action**

Create `src/lib/actions/account.ts`:

```ts
'use server';
import { createServerSupabase } from '../supabase/server';
import { createAdminClient } from '../supabase/admin';

export const MAX_DISPLAY_NAME = 40;

/**
 * `unchanged` is not a failure: it is the database honestly reporting that the submitted name is
 * the one already stored, which a no-op retry must be able to say without claiming to have
 * written.
 */
export type RenameResult =
  | { status: 'saved'; name: string }
  | { status: 'unchanged'; name: string }
  | { status: 'invalid'; reason: 'blank' | 'too_long' }
  | { status: 'expired' }
  | { status: 'failed' };

/**
 * The trust boundary. Note what this does NOT take: a player id. A forged form, a stale page or
 * a hand-rolled fetch still cannot nominate somebody else's account, because identity comes from
 * the session cookie and nowhere else.
 *
 * The NAME is untrusted, so it is trimmed and measured here. The database checks again; neither
 * guard is load-bearing alone.
 */
export async function renameMe(name: string): Promise<RenameResult> {
  try {
    const clean = (name ?? '').trim();
    if (clean === '') return { status: 'invalid', reason: 'blank' };
    if (clean.length > MAX_DISPLAY_NAME) return { status: 'invalid', reason: 'too_long' };

    const supabase = await createServerSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { status: 'expired' };

    const { data, error } = await createAdminClient()
      .rpc('set_display_name', { p_player_id: user.id, p_name: clean });
    if (error) return { status: 'failed' };

    // A `returns table` function arrives as an array of rows through PostgREST, but a direct
    // composite call is a bare object. Accept both rather than depending on the transport.
    const row = (Array.isArray(data) ? data[0] : data) as
      { stored_name?: unknown; applied?: unknown } | null | undefined;
    if (!row || typeof row.stored_name !== 'string') return { status: 'failed' };

    return { status: row.applied === true ? 'saved' : 'unchanged', name: row.stored_name };
  } catch {
    return { status: 'failed' };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/actions/account.test.ts`
Expected: PASS

- [ ] **Step 5: Write the failing page-access test**

Create `tests/pages/account-page.test.ts`, mirroring `tests/pages/hands-page.test.ts`:

```ts
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createServerSupabase: vi.fn(),
  createAdminClient: vi.fn(),
  redirect: vi.fn(),
}));
vi.mock('../../src/lib/supabase/server', () => ({ createServerSupabase: mocks.createServerSupabase }));
vi.mock('../../src/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock('../../src/lib/actions/account', () => ({ renameMe: vi.fn(), MAX_DISPLAY_NAME: 40 }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect, useRouter: () => ({ refresh: vi.fn() }) }));

import AccountPage from '../../src/app/account/page';

const USER = '33333333-3333-3333-3333-333333333333';
const profile = (row: unknown) => {
  const query: Record<string, unknown> = {};
  query.select = () => query;
  query.eq = () => query;
  query.maybeSingle = async () => ({ data: row, error: null });
  return { from: vi.fn(() => query) };
};
const signedInAs = (user: { id: string } | null) =>
  mocks.createServerSupabase.mockResolvedValue({ auth: { getUser: vi.fn(async () => ({ data: { user } })) } });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.redirect.mockImplementation(() => { throw new Error('NEXT_REDIRECT'); });
  mocks.createAdminClient.mockReturnValue(profile({ display_name: 'Bryan Lim', house: 'orcaella' }));
});

describe('/account access', () => {
  it('redirects a signed-out visitor to login and reads no profile on the way', async () => {
    signedInAs(null);
    await expect(AccountPage()).rejects.toThrow('NEXT_REDIRECT');
    expect(mocks.redirect).toHaveBeenCalledWith('/login?next=%2Faccount');
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it('shows a signed-in player their name and house', async () => {
    signedInAs({ id: USER });
    const html = renderToStaticMarkup(await AccountPage());
    expect(html).toContain('Bryan Lim');
    expect(html).toContain('Orcaella');
  });

  it('says so plainly when a player has no house', async () => {
    signedInAs({ id: USER });
    mocks.createAdminClient.mockReturnValue(profile({ display_name: 'rachel', house: null }));
    const html = renderToStaticMarkup(await AccountPage());
    expect(html).toContain('No house yet');
  });

  it('returns to the leaderboard', async () => {
    signedInAs({ id: USER });
    expect(renderToStaticMarkup(await AccountPage())).toContain('href="/"');
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run tests/pages/account-page.test.ts`
Expected: FAIL with `Cannot find module '../../src/app/account/page'`

- [ ] **Step 7: Write the page and the form**

Create `src/app/account/RenameForm.tsx`:

```tsx
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, LiveRegion } from '../../components/ui';
import { MAX_DISPLAY_NAME, renameMe, type RenameResult } from '../../lib/actions/account';

const MESSAGES: Record<string, { tone: 'success' | 'info' | 'error'; text: string }> = {
  saved: { tone: 'success', text: 'Saved. The boards will show your new name.' },
  unchanged: { tone: 'info', text: 'That is already your name, so nothing changed.' },
  blank: { tone: 'error', text: 'Your name cannot be empty.' },
  too_long: { tone: 'error', text: `Keep it to ${MAX_DISPLAY_NAME} characters or fewer.` },
  expired: { tone: 'error', text: 'Your sign-in expired. Sign in again and your typing will still be here.' },
  failed: { tone: 'error', text: 'Could not save that just now. Try again.' },
};

export function RenameForm({ current }: { current: string }) {
  const router = useRouter();
  const [name, setName] = useState(current);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RenameResult>();

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    const outcome = await renameMe(name);
    setResult(outcome);
    setBusy(false);
    // The typed value is deliberately NOT cleared on any outcome: a failed save that also
    // discarded the name would make the player retype it to find out whether it was a fluke.
    if (outcome.status === 'saved') router.refresh();
  };

  const key = result?.status === 'invalid' ? result.reason : result?.status;
  const message = key ? MESSAGES[key] : undefined;

  return (
    <form onSubmit={submit} className="mt-5 flex flex-col gap-3">
      <label htmlFor="display-name" className="text-sm font-bold">Display name</label>
      <input id="display-name" name="display-name" value={name} maxLength={MAX_DISPLAY_NAME}
        onChange={(e) => setName(e.target.value)} autoComplete="nickname"
        className="min-h-11 rounded-[10px] border-2 border-ink bg-surface px-4 font-bold" />
      <p className="text-xs leading-5 text-muted">
        This is the name every board shows, including games you have already played.
        Changing it renames you everywhere.
      </p>
      <Button type="submit" busy={busy} busyLabel="Saving…" disabled={name.trim() === ''}>Save</Button>
      <LiveRegion tone={message?.tone ?? 'info'} message={message?.text} />
    </form>
  );
}
```

Create `src/app/account/page.tsx`:

```tsx
import { redirect } from 'next/navigation';
import { createServerSupabase } from '../../lib/supabase/server';
import { createAdminClient } from '../../lib/supabase/admin';
import { findHouse, NO_HOUSE_LABEL } from '../../lib/houses';
import { AppFrame, PageHeader, StatusMessage } from '../../components/ui';
import { RenameForm } from './RenameForm';

export const dynamic = 'force-dynamic';

/**
 * The house is shown and NOT editable. It is permanent by design (0006's trigger enforces it),
 * and a control that cannot do anything is worse than a plain line of text.
 */
export default async function AccountPage() {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent('/account')}`);

  const { data, error } = await createAdminClient()
    .from('players').select('display_name, house').eq('id', user.id).maybeSingle();
  if (error) console.error('[account]', error.message);

  const house = findHouse(data?.house);

  return (
    <AppFrame>
      <PageHeader backHref="/" title="Your account"
        description="The name here is the one every board shows." />
      {!data ? (
        <StatusMessage tone="error">Couldn’t load your account just now. Refresh to try again.</StatusMessage>
      ) : (
        <>
          <dl className="rounded-[14px] border border-divider bg-surface p-5">
            <dt className="text-xs font-bold uppercase tracking-[0.18em] text-muted">House</dt>
            <dd className="mt-1 font-bold">{house ? house.name : NO_HOUSE_LABEL}</dd>
          </dl>
          <RenameForm current={data.display_name} />
        </>
      )}
    </AppFrame>
  );
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npx vitest run tests/pages/account-page.test.ts tests/actions/account.test.ts`
Expected: PASS

- [ ] **Step 9: Write and pass the form test**

Create `tests/components/RenameForm.test.tsx`. Mock `../../src/lib/actions/account` and `next/navigation`. Cover: the current name is pre-filled; Save is disabled on a blank field; a `saved` result announces success; an `unchanged` result announces neutrally and not as an error; a `failed` result keeps the typed value rather than discarding it.

Run: `npx vitest run tests/components/RenameForm.test.tsx`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add src/lib/actions/account.ts src/app/account tests/actions/account.test.ts tests/pages/account-page.test.ts tests/components/RenameForm.test.tsx
git commit -m "feat: an account page where a player renames themselves"
```

---

### Task 6: Full verification and the release gate

- [ ] **Step 1: Run everything**

```bash
npx vitest run && npm run typecheck && npm run lint && npm run build
```

Expected: all tests pass; typecheck clean; lint 0 errors (the known `GameLive` `_props` warning is expected and pre-existing); build compiles.

- [ ] **Step 2: Verify in a real browser against a local production build**

```bash
npm run build && npx next start -p 3410
```

Check, signed in: the board opens on the current academic year when it has games; "All time" is reachable and matches today's board exactly; switching a pill re-ranks; the settings icon opens `/account`; a rename saves and the renamed player appears under the new name on both the all-time and per-year boards.

- [ ] **Step 3: STOP. Two gates, both Bryan's.**

Do NOT apply the migration to hosted, and do NOT push, without explicit approval for each.

Release order (spec §11): apply `0008` to hosted and verify it against the live database function by function; then Bryan's separate approval to push code; then push and confirm Vercel Ready on the exact commit sha, filtered on sha and never accepted on age; then re-check the browser list above against production.

---

## Self-Review

**Spec coverage.** §2 product rules: default year and empty-year fallback (Task 3), settings icon top-right (Task 4), retroactive rename (Task 2 + 5), non-unique names (no uniqueness constraint anywhere), free changes (no trigger), "Lifetime" name kept (untouched). §3 year rule: Tasks 1 and 2, both edges asserted. §3.1 timezone: asserted on both sides. §4.1 four-branch resolution: Task 3 Step 5. §4.2/4.3: Tasks 4 and 5. §5: Task 2. §6 server boundary: Task 5. §7 interface: Tasks 3, 4, 5. §8 failure handling: Task 5 `MESSAGES`, plus the year-list read failure in Task 3. §9 accessibility: named nav, `aria-current`, icon label, real `<label>`. §10 verification: Task 6. §11 release order: Task 6 Step 3.

**Placeholder scan.** One deliberate prose-only step: Task 5 Step 9 names the five cases for `RenameForm.test.tsx` rather than writing them out, and Task 2 Step 4 refers to the existing replay command rather than inventing one. Everything else carries real code.

**Type consistency.** `academicYearOf`/`academicYearLabel`/`parseYearParam` are used in Tasks 1 and 3 with matching signatures. `YearPills` takes `years: number[]` and `selected: number | 'all'` in both its own test and the page. `renameMe` returns the same five-status union in the action, its test, and the form. `MAX_DISPLAY_NAME` is 40 in the action, the form, the page test mock, and the migration.
