# Notable Win Page and Filtered Gallery — Release 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every notable win its own page reachable by tapping a row on the Notable wins board, and make the hand gallery honour the board's hand-type and year selection.

**Architecture:** A new server-rendered route at `/hands/[claimId]` reuses the archive's existing sign-in-and-return pattern: signed-out visitors are redirected to login with the board's year and hand filters encoded in the return address, then delivered to the win they tapped. Board rows become links carrying that same state. The archive at `/hands` gains real filtering — distinct from the return state it already receives — resolved in two explicit queries rather than an embedded join filter, so every label on each photo stays visible.

**Tech Stack:** Next.js 16.3 App Router (Server Components, `force-dynamic`), React 19.2, TypeScript, Tailwind, Supabase JS 2.112 (service-role reads server-side only), Vitest 4 + Testing Library.

**Spec:** `docs/superpowers/specs/2026-08-29-notable-win-page-and-filtered-gallery-design.md`

## Global Constraints

- **No database migration in this release.** The ranking query already returns `claim_id`. If a task appears to need a migration, stop and raise it.
- **No new client-side JavaScript.** Every file added here is a Server Component. The homepage currently ships zero client JS and must continue to.
- Service-role reads (`createAdminClient`) run server-side only. The browser never receives that credential.
- Return addresses are **rebuilt from parts, never carried whole**. A URL parameter used verbatim as an href is an open redirect.
- **An error state and an empty state must never render as the same thing.** Specifically: a photo that fails to sign must never render as "no photo was taken".
- **A win is never rendered with fewer labels than it carries.** Unreadable labels fail the page, matching `parseNotableWins` in `src/components/NotableWinRow.tsx`.
- House colours: set the pair **once** on the container via inline style; children in that branch carry **no** `text-*` class. The approved fill/text pairs pass contrast only as pairs. See the comment block in `src/components/BoardRow.tsx`.
- Dates render in `Asia/Singapore` via the existing `formatSingaporeWinDate`.
- Work happens in the worktree `/Users/bryan/Desktop/claude code/RVMJ/.worktrees/notable-win-page` on branch `feat/notable-win-page`. **Nothing is pushed or deployed** — that gate is Bryan's, after he has seen the suite pass.
- Run commands from the worktree root. Full check: `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/academic-year.ts` (modify) | Add the UTC window for an academic year. The year-boundary rule already lives here; this is one more expression of it. |
| `src/lib/notable-claim.ts` (create) | Reading one claim: UUID validation, the PostgREST embed-shape normaliser, and the strict label reader. |
| `src/lib/standings.ts` (modify) | Add `notableWinHref` beside the existing `standingsHref`. Board navigation lives here. |
| `src/components/NotableWinDetail.tsx` (create) | Presentational body of the win page. No data access, no auth — takes props, renders. |
| `src/app/hands/[claimId]/page.tsx` (create) | The route: auth gate, not-found handling, the claim read, photo signing, return addresses. |
| `src/components/NotableWinRow.tsx` (modify) | Row becomes a link to its win. |
| `src/app/page.tsx` (modify) | Build each row's href. |
| `src/app/hands/page.tsx` (modify) | Gallery gains hand-type and year filtering, the filtered notice, and the show-everything escape. |
| `src/app/hands/HandsGallery.tsx` (modify) | Filtered-empty message distinct from archive-empty. |

---

### Task 1: The academic year's UTC window

The gallery's year filter needs a date range to compare `games.ended_at` against. The boundary is Singapore midnight, which is 16:00 UTC the previous day — anchoring to UTC midnight would misfile every game played in that eight-hour window.

**Files:**
- Modify: `src/lib/academic-year.ts`
- Test: `tests/academic-year.test.ts`

**Interfaces:**
- Consumes: existing `academicYearStart(year: number): Date` from the same file.
- Produces: `academicYearRangeUtc(year: number): { start: string; end: string }` — half-open `[start, end)`, both ISO 8601 UTC strings.

- [ ] **Step 1: Write the failing tests**

Append to `tests/academic-year.test.ts`:

```ts
describe('academicYearRangeUtc', () => {
  /**
   * The window opens at SINGAPORE midnight, which is 16:00 UTC the day before. These are the
   * same two instants migration 0008 asserts on the SQL side: 2026-08-02 16:30Z is AY2026 and
   * 2026-08-02 15:59Z is AY2025. A window anchored to UTC midnight would put both in 2026.
   */
  it('opens at Singapore midnight of the first Monday of August', () => {
    expect(academicYearRangeUtc(2026).start).toBe('2026-08-02T16:00:00.000Z');
  });

  it('closes where the next year opens, so the two never overlap or gap', () => {
    expect(academicYearRangeUtc(2026).end).toBe(academicYearRangeUtc(2027).start);
  });

  /**
   * The window and academicYearOf are two readings of one rule and must agree exactly. An
   * instant one minute before the boundary belongs to the previous year by BOTH.
   */
  it('agrees with academicYearOf on both sides of the boundary', () => {
    const { start } = academicYearRangeUtc(2026);
    const justBefore = new Date(new Date(start).getTime() - 60_000);
    const atStart = new Date(start);
    expect(academicYearOf(justBefore)).toBe(2025);
    expect(academicYearOf(atStart)).toBe(2026);
  });
});
```

Add `academicYearRangeUtc` to the import on line 2 of that file.

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npm test -- tests/academic-year.test.ts`
Expected: FAIL — `academicYearRangeUtc is not a function`.

- [ ] **Step 3: Implement it**

In `src/lib/academic-year.ts`, after `academicYearOf`:

```ts
/**
 * The half-open UTC window `[start, end)` an academic year occupies, for querying a timestamptz
 * column directly.
 *
 * The boundary is SINGAPORE midnight of the year's first Monday, not UTC midnight of it. A game
 * ending at 00:30 that Monday is stored as 16:30 the previous afternoon, so a window anchored to
 * UTC midnight would file eight hours of real mahjong into the wrong year. This is the same
 * correction `academicYearOf` makes when reading a single instant, and the same one migration
 * 0008 makes in SQL.
 */
export function academicYearRangeUtc(year: number): { start: string; end: string } {
  const opensAt = (y: number) =>
    new Date(academicYearStart(y).getTime() - SGT_OFFSET_MS).toISOString();
  return { start: opensAt(year), end: opensAt(year + 1) };
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npm test -- tests/academic-year.test.ts`
Expected: PASS, existing cases still green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/academic-year.ts tests/academic-year.test.ts
git commit -m "feat: add the UTC window for an academic year"
```

---

### Task 2: Reading one claim

The win page reads a single claim through PostgREST, whose embeds arrive as an object or an array depending on how it reads the relationship. `src/app/hands/page.tsx:25` already has a private helper for that; this task promotes it to a shared module and adds the two readers the win page needs.

**Files:**
- Create: `src/lib/notable-claim.ts`
- Modify: `src/app/hands/page.tsx` (import `one` instead of defining it)
- Test: `tests/notable-claim.test.ts`

**Interfaces:**
- Consumes: `HandType` from `src/components/HandTypeFilter`.
- Produces:
  - `one<T>(value: T | T[] | null | undefined): T | null`
  - `isClaimId(value: unknown): value is string`
  - `parseClaimHandTypes(rows: unknown): HandType[] | null`

- [ ] **Step 1: Write the failing tests**

Create `tests/notable-claim.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { isClaimId, one, parseClaimHandTypes } from '../src/lib/notable-claim';

const label = (over: Record<string, unknown> = {}) => ({
  notable_hands: { id: 'h8', name: 'Pure Suit', local_name: '清一色', rarity: 'rare', ...over },
});

describe('one', () => {
  it('reads an embed that arrived as an object', () => {
    expect(one({ name: 'x' })).toEqual({ name: 'x' });
  });

  it('reads an embed that arrived as a one-element array', () => {
    expect(one([{ name: 'x' }])).toEqual({ name: 'x' });
  });

  it('answers null for an absent or empty embed', () => {
    expect(one(null)).toBeNull();
    expect(one(undefined)).toBeNull();
    expect(one([])).toBeNull();
  });
});

describe('isClaimId', () => {
  it('accepts a UUID', () => {
    expect(isClaimId('3f1a5e0c-0d7b-4a2e-9f1b-7c2d8e4a6b90')).toBe(true);
  });

  /**
   * Claim ids arrive from the address bar. Postgres answers a malformed uuid with an ERROR
   * rather than with no rows, so an unchecked value turns a typo into a failed page instead of
   * a not-found one.
   */
  it('refuses anything that is not a UUID', () => {
    expect(isClaimId('nope')).toBe(false);
    expect(isClaimId('3f1a5e0c-0d7b-4a2e-9f1b')).toBe(false);
    expect(isClaimId('')).toBe(false);
    expect(isClaimId(null)).toBe(false);
    expect(isClaimId(42)).toBe(false);
  });
});

describe('parseClaimHandTypes', () => {
  it('reads every label, whichever shape the embed arrived in', () => {
    const parsed = parseClaimHandTypes([
      label(),
      { notable_hands: [{ id: 'h7', name: 'All Pungs', local_name: '碰碰胡', rarity: 'uncommon' }] },
    ]);
    expect(parsed).toEqual([
      { id: 'h7', name: 'All Pungs', local_name: '碰碰胡', rarity: 'uncommon' },
      { id: 'h8', name: 'Pure Suit', local_name: '清一色', rarity: 'rare' },
    ]);
  });

  it('orders by name then id, matching the board', () => {
    const parsed = parseClaimHandTypes([
      label({ id: 'h2', name: 'Zi Mo', local_name: '自摸' }),
      label({ id: 'h1', name: 'Ping Hu', local_name: '平胡' }),
    ]);
    expect(parsed?.map((hand) => hand.name)).toEqual(['Ping Hu', 'Zi Mo']);
  });

  it('keeps a missing local name as null', () => {
    expect(parseClaimHandTypes([label({ local_name: null })])?.[0].local_name).toBeNull();
  });

  /**
   * null means "these labels cannot be read", never "this win has fewer labels than it does".
   * A win rendered a label short understates what somebody actually did at the table.
   */
  it('refuses a label whose fields are wrong rather than dropping it', () => {
    expect(parseClaimHandTypes([label(), { notable_hands: { id: 'h9', name: 'Broken' } }])).toBeNull();
    expect(parseClaimHandTypes([label({ rarity: 'mythic' })])).toBeNull();
    expect(parseClaimHandTypes([label({ name: 7 })])).toBeNull();
    expect(parseClaimHandTypes([label({ local_name: 7 })])).toBeNull();
    expect(parseClaimHandTypes([{ notable_hands: null }])).toBeNull();
  });

  /** The database groups labels per claim and cannot produce a win with none. */
  it('refuses an empty or non-array value', () => {
    expect(parseClaimHandTypes([])).toBeNull();
    expect(parseClaimHandTypes(null)).toBeNull();
    expect(parseClaimHandTypes('two labels')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npm test -- tests/notable-claim.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the module**

Create `src/lib/notable-claim.ts`:

```ts
import type { HandType } from '../components/HandTypeFilter';

/**
 * PostgREST returns an embed as an object or as an array depending on how it reads the
 * relationship, and the shape is not worth guessing at each call site.
 */
export const one = <T,>(value: T | T[] | null | undefined): T | null =>
  Array.isArray(value) ? (value[0] ?? null) : (value ?? null);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A claim id reaches the win page from the address bar. Postgres answers a malformed uuid with
 * an ERROR rather than with no rows, so checking the shape here is what turns a typo into the
 * app's not-found page instead of a failed read.
 */
export const isClaimId = (value: unknown): value is string =>
  typeof value === 'string' && UUID.test(value);

const RARITIES: ReadonlySet<string> = new Set(['uncommon', 'rare', 'legendary']);

/**
 * Read one claim's labels from its embedded rows.
 *
 * Every field is checked, and `null` means "these labels cannot be read" — never "this win has
 * fewer labels than it does". The board's `parseNotableWins` takes the same position for the same
 * reason: a win rendered a label short understates what somebody did at the table. An empty list
 * is refused too, because the database groups labels per claim and cannot produce a win with none.
 *
 * Ordered by name then id, so the page agrees with the board about label order.
 */
export function parseClaimHandTypes(rows: unknown): HandType[] | null {
  if (!Array.isArray(rows) || rows.length === 0) return null;

  const handTypes: HandType[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') return null;
    const hand = one((row as { notable_hands?: unknown }).notable_hands as Record<string, unknown> | Record<string, unknown>[] | null);
    if (!hand || typeof hand !== 'object') return null;
    const { id, name, local_name: localName, rarity } = hand;
    if (typeof id !== 'string' || typeof name !== 'string') return null;
    if (typeof rarity !== 'string' || !RARITIES.has(rarity)) return null;
    // A missing local name is normal; a local name that is not text is not.
    if (localName !== null && localName !== undefined && typeof localName !== 'string') return null;
    handTypes.push({
      id,
      name,
      local_name: typeof localName === 'string' ? localName : null,
      rarity: rarity as HandType['rarity'],
    });
  }
  return handTypes.sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
}
```

- [ ] **Step 4: Point the gallery at the shared helper**

In `src/app/hands/page.tsx`, delete the local `one` definition (line 25 and its comment) and add to the imports:

```ts
import { one } from '../../lib/notable-claim';
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `npm test -- tests/notable-claim.test.ts tests/pages/hands-page.test.ts`
Expected: PASS on both — the gallery's behaviour is unchanged.

- [ ] **Step 6: Commit**

```bash
git add src/lib/notable-claim.ts tests/notable-claim.test.ts src/app/hands/page.tsx
git commit -m "feat: add a strict reader for one notable claim"
```

---

### Task 3: The link to a win

**Files:**
- Modify: `src/lib/standings.ts`
- Test: `tests/standings.test.ts`

**Interfaces:**
- Produces: `notableWinHref({ claimId, year, handIds }: { claimId: string; year: YearSelection; handIds?: readonly string[] }): string`

- [ ] **Step 1: Write the failing tests**

Append to `tests/standings.test.ts`:

```ts
describe('notableWinHref', () => {
  it('addresses the win and carries the board state to come back to', () => {
    expect(notableWinHref({ claimId: 'c1', year: 2026, handIds: ['b', 'a'] }))
      .toBe('/hands/c1?year=2026&hand=a&hand=b');
  });

  it('carries an all-time selection', () => {
    expect(notableWinHref({ claimId: 'c1', year: 'all' })).toBe('/hands/c1?year=all');
  });

  /** Sorted and deduplicated, so one player's link is the same string as another's. */
  it('deduplicates and sorts the hand filters', () => {
    expect(notableWinHref({ claimId: 'c1', year: 'all', handIds: ['b', 'a', 'b'] }))
      .toBe('/hands/c1?year=all&hand=a&hand=b');
  });

  /** The id is encoded, so it can never escape the path segment it belongs to. */
  it('encodes the claim id', () => {
    expect(notableWinHref({ claimId: 'a/b?c', year: 'all' })).toBe('/hands/a%2Fb%3Fc?year=all');
  });
});
```

Add `notableWinHref` to that file's import from `../src/lib/standings`.

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npm test -- tests/standings.test.ts`
Expected: FAIL — `notableWinHref is not a function`.

- [ ] **Step 3: Implement it**

In `src/lib/standings.ts`, after `standingsHref`:

```ts
/**
 * One win's address, carrying the board state to come back TO — the same parts `/hands` already
 * receives, for the same reason: without them the win page's back link drops a player onto a bare
 * Notable wins board with their period and filters gone.
 *
 * The id is encoded rather than interpolated raw, so a value that is not a plain identifier
 * cannot escape its path segment.
 */
export function notableWinHref({ claimId, year, handIds = [] }: {
  claimId: string;
  year: YearSelection;
  handIds?: readonly string[];
}): string {
  const params = new URLSearchParams({ year: String(year) });
  for (const handId of [...new Set(handIds.filter((value): value is string => typeof value === 'string'))].sort()) {
    params.append('hand', handId);
  }
  return `/hands/${encodeURIComponent(claimId)}?${params.toString()}`;
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npm test -- tests/standings.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/standings.ts tests/standings.test.ts
git commit -m "feat: add the address of one notable win"
```

---

### Task 4: The win page body

Presentational only — no data access, no auth. Splitting it out is what makes every rendering rule in the spec directly testable without standing up a fake database.

**Files:**
- Create: `src/components/NotableWinDetail.tsx`
- Test: `tests/components/NotableWinDetail.test.tsx`

**Interfaces:**
- Consumes: `HandType` from `src/components/HandTypeFilter`; `House` and `NO_HOUSE_LABEL` from `src/lib/houses`; `formatSingaporeWinDate` from `src/lib/standings`.
- Produces:
```ts
type PhotoState =
  | { kind: 'none' }
  | { kind: 'failed' }
  | { kind: 'ready'; url: string };

function NotableWinDetail(props: {
  winnerName: string;
  house: House | null;
  wonAt: string;
  handTypes: HandType[];
  photo: PhotoState;
}): JSX.Element
```

- [ ] **Step 1: Write the failing tests**

Create `tests/components/NotableWinDetail.test.tsx`:

```tsx
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { NotableWinDetail } from '../../src/components/NotableWinDetail';
import type { HandType } from '../../src/components/HandTypeFilter';
import { findHouse } from '../../src/lib/houses';

const pure: HandType = { id: 'h8', name: 'Pure Suit', local_name: '清一色', rarity: 'rare' };
const thirteen: HandType = { id: 'h1', name: 'Thirteen Wonders', local_name: '十三幺', rarity: 'legendary' };
const noLocal: HandType = { id: 'h9', name: 'Nine Gates', local_name: null, rarity: 'legendary' };

afterEach(cleanup);

describe('NotableWinDetail', () => {
  /** 17:30 UTC is 01:30 the next morning in Singapore — the tail of a long night. */
  it('shows the winner and the Singapore date', () => {
    render(<NotableWinDetail winnerName="Ah Seng" house={null} wonAt="2026-08-27T17:30:00Z"
      handTypes={[pure]} photo={{ kind: 'none' }} />);

    expect(screen.getByText('Ah Seng')).toBeTruthy();
    expect(screen.getByText('28 Aug 2026')).toBeTruthy();
  });

  /** The board row shows English only; this page is where the local name fits. */
  it('shows every label with its local name', () => {
    render(<NotableWinDetail winnerName="Ah Seng" house={null} wonAt="2026-08-27T17:30:00Z"
      handTypes={[pure, thirteen]} photo={{ kind: 'none' }} />);

    expect(screen.getByText('Pure Suit')).toBeTruthy();
    expect(screen.getByText('清一色')).toBeTruthy();
    expect(screen.getByText('Thirteen Wonders')).toBeTruthy();
    expect(screen.getByText('十三幺')).toBeTruthy();
  });

  it('shows a label that has no local name without an empty bracket', () => {
    render(<NotableWinDetail winnerName="Ah Seng" house={null} wonAt="2026-08-27T17:30:00Z"
      handTypes={[noLocal]} photo={{ kind: 'none' }} />);

    expect(screen.getByText('Nine Gates')).toBeTruthy();
    expect(screen.queryByText('()')).toBeNull();
  });

  /**
   * The approved fill/text pairs pass contrast only AS PAIRS, so the colour is set once on the
   * container and no child in that branch carries a colour of its own. Same rule as BoardRow.
   */
  it('paints the winner in their house colour and names the house', () => {
    const { container } = render(<NotableWinDetail winnerName="Bryan Lim" house={findHouse('orcaella')}
      wonAt="2026-08-27T17:30:00Z" handTypes={[pure]} photo={{ kind: 'none' }} />);

    const painted = container.querySelector('[style*="background-color"]') as HTMLElement;
    expect(painted.style.backgroundColor).toBe('rgb(242, 181, 206)');
    expect(painted.style.color).toBe('rgb(20, 45, 55)');
    expect(screen.getByText('Orcaella')).toBeTruthy();
  });

  it('says so when the winner has no house', () => {
    render(<NotableWinDetail winnerName="rachel" house={null} wonAt="2026-08-27T17:30:00Z"
      handTypes={[pure]} photo={{ kind: 'none' }} />);

    expect(screen.getByText('No house yet')).toBeTruthy();
  });

  it('shows the photo when there is one', () => {
    render(<NotableWinDetail winnerName="Ah Seng" house={null} wonAt="2026-08-27T17:30:00Z"
      handTypes={[pure]} photo={{ kind: 'ready', url: 'https://signed.example/a.webp' }} />);

    const image = screen.getByRole('img', { name: /Pure Suit won by Ah Seng/ }) as HTMLImageElement;
    expect(image.src).toBe('https://signed.example/a.webp');
  });

  it('says no photo was taken when there is none', () => {
    render(<NotableWinDetail winnerName="Ah Seng" house={null} wonAt="2026-08-27T17:30:00Z"
      handTypes={[pure]} photo={{ kind: 'none' }} />);

    expect(screen.getByText(/No photo was taken/i)).toBeTruthy();
  });

  /**
   * The rule this component exists to enforce. A photo that failed to load is a DIFFERENT fact
   * from a win nobody photographed, and rendering them the same way would later invite someone to
   * "add" a photo to a win that already has one.
   */
  it('reports a failed photo and never falls through to the no-photo state', () => {
    render(<NotableWinDetail winnerName="Ah Seng" house={null} wonAt="2026-08-27T17:30:00Z"
      handTypes={[pure]} photo={{ kind: 'failed' }} />);

    expect(screen.getByText(/photo couldn’t be loaded/i)).toBeTruthy();
    expect(screen.queryByText(/No photo was taken/i)).toBeNull();
    expect(screen.queryByRole('img')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npm test -- tests/components/NotableWinDetail.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the component**

Create `src/components/NotableWinDetail.tsx`:

```tsx
import { formatSingaporeWinDate } from '../lib/standings';
import { NO_HOUSE_LABEL, type House } from '../lib/houses';
import { StatusMessage } from './ui';
import type { HandType } from './HandTypeFilter';

/**
 * Three states, never two. "No photo was taken" and "the photo could not be loaded" are different
 * facts about a win, and collapsing them would misreport the second as the first — which the
 * archive can afford to do across a wall of many photos, and a page about one win cannot.
 */
export type PhotoState =
  | { kind: 'none' }
  | { kind: 'failed' }
  | { kind: 'ready'; url: string };

/**
 * The body of one win's page. A Server Component: nothing here is interactive, so it stays out of
 * the client bundle entirely.
 *
 * On a house win the colour pair is set ONCE, on the panel, and everything inherits it — which is
 * why no child in that branch carries a text-* class. The approved foreground/background pairs
 * pass contrast as pairs, and a leftover text-muted would quietly break one of them. Same rule,
 * and the same reason, as BoardRow.
 */
export function NotableWinDetail({ winnerName, house, wonAt, handTypes, photo }: {
  winnerName: string;
  house: House | null;
  wonAt: string;
  handTypes: HandType[];
  photo: PhotoState;
}) {
  const described = `${handTypes.map((hand) => hand.name).join(', ')} won by ${winnerName}`;
  return (
    <>
      <section
        style={house ? { backgroundColor: house.fill, color: house.text } : undefined}
        className={`rounded-[14px] px-4 py-4 ${house ? 'border-2 border-ink' : 'border border-divider bg-surface'}`}>
        <p className={`text-2xl font-extrabold tracking-[-0.03em] ${house ? '' : 'text-ink'}`}>{winnerName}</p>
        <p className={`mt-1 text-xs font-semibold ${house ? '' : 'text-muted'}`}>{house ? house.name : NO_HOUSE_LABEL}</p>
        {/* Singapore time, always. A hand logged at 01:30 is the tail of the night before, and
            the date a player recognises is the one the table was sitting in. */}
        <p className={`mt-1 text-sm ${house ? '' : 'text-muted'}`}>{formatSingaporeWinDate(wonAt)}</p>
      </section>

      {/* `role="group"` because a bare div cannot carry an accessible name: without a role that
          takes one, this reads as a loose run of words with nothing saying what they are. */}
      <div role="group" aria-label="Hand types" className="mt-4 flex flex-col gap-2">
        {handTypes.map((hand) => (
          <div key={hand.id}
            className="flex min-h-11 items-center gap-2 rounded-[10px] border-2 border-divider bg-surface px-3 py-2">
            <span className="font-bold text-ink">{hand.name}</span>
            {hand.local_name ? <span className="text-muted">{hand.local_name}</span> : null}
          </div>
        ))}
      </div>

      <div className="mt-5">
        {photo.kind === 'ready' ? (
          /* Not next/image: these are short-lived signed URLs on a random path, so the optimizer
             cannot be given a remote pattern for them, and caching a private table photo in it is
             the wrong trade anyway. */
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={photo.url} alt={described}
            className="max-h-[70svh] w-full rounded-[12px] border-2 border-divider object-contain" />
        ) : photo.kind === 'failed' ? (
          <StatusMessage tone="warning">
            This hand has a photo, but the photo couldn’t be loaded just now. Refresh to try again.
          </StatusMessage>
        ) : (
          <StatusMessage tone="info">No photo was taken of this hand.</StatusMessage>
        )}
      </div>
    </>
  );
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npm test -- tests/components/NotableWinDetail.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/NotableWinDetail.tsx tests/components/NotableWinDetail.test.tsx
git commit -m "feat: add the body of one notable win's page"
```

---

### Task 5: The win page route

**Files:**
- Create: `src/app/hands/[claimId]/page.tsx`
- Test: `tests/pages/notable-win-page.test.ts`

**Interfaces:**
- Consumes: `isClaimId`, `one`, `parseClaimHandTypes` (Task 2); `NotableWinDetail`, `PhotoState` (Task 4); `standingsHref` and `formatSingaporeWinDate` from `src/lib/standings`; `parseYearParam` from `src/lib/academic-year`; `PHOTO_BUCKET`, `SIGNED_URL_TTL_SECONDS` from `src/lib/image`; `findHouse` from `src/lib/houses`.
- Produces: the default-exported async Server Component for `/hands/[claimId]`.

- [ ] **Step 1: Write the failing tests**

Create `tests/pages/notable-win-page.test.ts`, following `tests/pages/hands-page.test.ts`:

```ts
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A Server Component is an async function, so it can simply be called. The only fidelity that
 * matters is that `redirect()` and `notFound()` THROW the way the real ones do — a mock that
 * merely returned would let the page run on past its guard and read the claim anyway.
 */
const mocks = vi.hoisted(() => ({
  createServerSupabase: vi.fn(),
  createAdminClient: vi.fn(),
  redirect: vi.fn(),
  notFound: vi.fn(),
}));

vi.mock('../../src/lib/supabase/server', () => ({ createServerSupabase: mocks.createServerSupabase }));
vi.mock('../../src/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock('../../src/lib/telegram', () => ({ sendAlert: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect, notFound: mocks.notFound }));

import WinPage from '../../src/app/hands/[claimId]/page';

const USER_ID = '33333333-3333-3333-3333-333333333333';
const CLAIM_ID = '3f1a5e0c-0d7b-4a2e-9f1b-7c2d8e4a6b90';

const claimRow = (over: Record<string, unknown> = {}) => ({
  id: CLAIM_ID,
  created_at: '2026-08-27T17:30:00Z',
  photo_path: null,
  logged_by: USER_ID,
  game_id: 'g1',
  players: { display_name: 'Ah Seng', house: 'orcaella' },
  notable_claim_types: [
    { notable_hands: { id: 'h8', name: 'Pure Suit', local_name: '清一色', rarity: 'rare' } },
  ],
  ...over,
});

/** `.select().eq().maybeSingle()` — the claim read, awaited at its last link. */
function claim(row: unknown, signedUrl?: string | null) {
  const query: Record<string, unknown> = {};
  query.select = vi.fn(() => query);
  query.eq = vi.fn(() => query);
  query.maybeSingle = vi.fn(async () => ({ data: row, error: null }));
  const createSignedUrl = vi.fn(async () => ({
    data: signedUrl ? { signedUrl } : null,
    error: signedUrl ? null : { message: 'nope' },
  }));
  return {
    client: {
      from: vi.fn(() => query),
      storage: { from: vi.fn(() => ({ createSignedUrl })) },
    },
    query,
    createSignedUrl,
  };
}

const signedInAs = (user: { id: string } | null) => {
  mocks.createServerSupabase.mockResolvedValue({
    auth: { getUser: vi.fn(async () => ({ data: { user } })) },
  });
};

const render = (props: {
  params: Promise<{ claimId: string }>;
  searchParams?: Promise<Record<string, string | string[]>>;
}) => WinPage(props).then(renderToStaticMarkup);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.redirect.mockImplementation(() => { throw new Error('NEXT_REDIRECT'); });
  mocks.notFound.mockImplementation(() => { throw new Error('NEXT_NOT_FOUND'); });
  signedInAs({ id: USER_ID });
  mocks.createAdminClient.mockReturnValue(claim(claimRow()).client);
});

describe('/hands/[claimId] access', () => {
  it('redirects a signed-out visitor to login and reads no claim on the way', async () => {
    signedInAs(null);
    const read = claim(claimRow());
    mocks.createAdminClient.mockReturnValue(read.client);

    await expect(render({ params: Promise.resolve({ claimId: CLAIM_ID }) })).rejects.toThrow('NEXT_REDIRECT');

    expect(mocks.redirect).toHaveBeenCalledWith(`/login?next=%2Fhands%2F${CLAIM_ID}`);
    expect(read.query.maybeSingle).not.toHaveBeenCalled();
  });

  /** Without this the login wall eats the board state and returns the player to a reset board. */
  it('carries the year and hand filters through the login wall', async () => {
    signedInAs(null);

    await expect(render({
      params: Promise.resolve({ claimId: CLAIM_ID }),
      searchParams: Promise.resolve({ year: '2026', hand: ['b', 'a'] }),
    })).rejects.toThrow('NEXT_REDIRECT');

    expect(mocks.redirect).toHaveBeenCalledWith(
      `/login?next=${encodeURIComponent(`/hands/${CLAIM_ID}?year=2026&hand=a&hand=b`)}`,
    );
  });

  /** Postgres answers a malformed uuid with an error, so the shape is checked before the read. */
  it('renders not-found for a malformed id without querying', async () => {
    const read = claim(claimRow());
    mocks.createAdminClient.mockReturnValue(read.client);

    await expect(render({ params: Promise.resolve({ claimId: 'nope' }) })).rejects.toThrow('NEXT_NOT_FOUND');
    expect(read.query.maybeSingle).not.toHaveBeenCalled();
  });

  it('renders not-found for a well-formed id that matches no win', async () => {
    mocks.createAdminClient.mockReturnValue(claim(null).client);

    await expect(render({ params: Promise.resolve({ claimId: CLAIM_ID }) })).rejects.toThrow('NEXT_NOT_FOUND');
  });
});

describe('/hands/[claimId] content', () => {
  it('shows the winner, the Singapore date and every label with its local name', async () => {
    const html = await render({ params: Promise.resolve({ claimId: CLAIM_ID }) });

    expect(html).toContain('Ah Seng');
    expect(html).toContain('28 Aug 2026');
    expect(html).toContain('Pure Suit');
    expect(html).toContain('清一色');
  });

  it('returns the player to the exact board they left', async () => {
    const html = await render({
      params: Promise.resolve({ claimId: CLAIM_ID }),
      searchParams: Promise.resolve({ year: '2026', hand: ['b', 'a'] }),
    });

    expect(html).toContain('href="/?board=skill&amp;year=2026&amp;hand=a&amp;hand=b"');
  });

  /** A bare address — typed, bookmarked, or reached from anywhere that is not the board. */
  it('still renders with no return state, with a plain back link', async () => {
    const html = await render({ params: Promise.resolve({ claimId: CLAIM_ID }) });

    expect(html).toContain('href="/?board=skill"');
  });

  it('shows the photo when the link signs', async () => {
    mocks.createAdminClient.mockReturnValue(
      claim(claimRow({ photo_path: 'g1/a.webp' }), 'https://signed.example/a.webp').client,
    );

    const html = await render({ params: Promise.resolve({ claimId: CLAIM_ID }) });

    expect(html).toContain('https://signed.example/a.webp');
  });

  /**
   * The rule that matters most here. A photo that failed to sign must never be reported as a win
   * nobody photographed.
   */
  it('reports a failed photo rather than saying none was taken', async () => {
    mocks.createAdminClient.mockReturnValue(claim(claimRow({ photo_path: 'g1/a.webp' }), null).client);

    const html = await render({ params: Promise.resolve({ claimId: CLAIM_ID }) });

    expect(html).toContain('couldn’t be loaded');
    expect(html).not.toContain('No photo was taken');
  });

  it('says no photo was taken when the win has none', async () => {
    const html = await render({ params: Promise.resolve({ claimId: CLAIM_ID }) });

    expect(html).toContain('No photo was taken');
  });

  /** A win is never rendered a label short. */
  it('reports a failure when the labels cannot be read', async () => {
    mocks.createAdminClient.mockReturnValue(
      claim(claimRow({ notable_claim_types: [{ notable_hands: { id: 'h1', name: 'Broken' } }] })).client,
    );

    const html = await render({ params: Promise.resolve({ claimId: CLAIM_ID }) });

    expect(html).toContain('Couldn’t load this win');
    expect(html).not.toContain('Broken');
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npm test -- tests/pages/notable-win-page.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the route**

Create `src/app/hands/[claimId]/page.tsx`:

```tsx
import { notFound, redirect } from 'next/navigation';
import { createServerSupabase } from '../../../lib/supabase/server';
import { createAdminClient } from '../../../lib/supabase/admin';
import { parseYearParam } from '../../../lib/academic-year';
import { findHouse } from '../../../lib/houses';
import { PHOTO_BUCKET, SIGNED_URL_TTL_SECONDS } from '../../../lib/image';
import { isClaimId, one, parseClaimHandTypes } from '../../../lib/notable-claim';
import { standingsHref } from '../../../lib/standings';
import { AppFrame, PageHeader, StatusMessage } from '../../../components/ui';
import { NotableWinDetail, type PhotoState } from '../../../components/NotableWinDetail';

export const dynamic = 'force-dynamic';

/**
 * One notable win, up close. The board ranks wins but cannot show a photograph or a label's local
 * name; this is where both fit.
 *
 * The year and hand types in the address are RETURN STATE: they say which board to go back to, and
 * nothing on this page reads them otherwise. Every address built here is rebuilt from its parts
 * rather than carried whole, because a parameter used verbatim as an href is an open redirect —
 * and the login `next` below IS a redirect target.
 *
 * The page renders any real claim, including one from a game still in progress. Only claims from
 * ended games are reachable from the board, so such a page cannot be arrived at by browsing; it is
 * left readable because every signed-in viewer is a player here and already sees that claim on the
 * game screen. Blocking it would add a rule that protects nothing.
 */
export default async function NotableWinPage({ params, searchParams }: {
  params: Promise<{ claimId: string }>;
  searchParams?: Promise<{ year?: string | string[]; hand?: string | string[] }>;
}) {
  const { claimId } = await params;
  const { year: rawYear, hand: rawHand } = (await searchParams) ?? {};
  // Checked BEFORE the read: Postgres answers a malformed uuid with an error rather than with no
  // rows, so an unchecked value turns a typo into a failed page instead of a not-found one.
  if (!isClaimId(claimId)) notFound();

  const returnYear = parseYearParam(rawYear);
  // Deduplicated and sorted so both addresses below agree, and so one player's link is the same
  // string as another's from the same board.
  const handIds = [...new Set(
    Array.isArray(rawHand) ? rawHand : typeof rawHand === 'string' ? [rawHand] : [],
  )].sort();
  const backHref = returnYear === null
    ? '/?board=skill'
    : standingsHref({ board: 'skill', year: returnYear, handIds });

  // Where to come back to AFTER signing in. The board renders publicly, so a signed-out visitor can
  // arrive here from a filtered board; without this the login wall eats their selection.
  const returnQuery = new URLSearchParams();
  // The two parts stand on their own. An unusable year is no reason to drop the hand filters too.
  if (returnYear !== null) returnQuery.set('year', String(returnYear));
  for (const handId of handIds) returnQuery.append('hand', handId);
  const selfHref = returnQuery.toString()
    ? `/hands/${claimId}?${returnQuery.toString()}`
    : `/hands/${claimId}`;

  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  // Photos are for the people who play, never for a search engine. Same rule as the archive.
  if (!user) redirect(`/login?next=${encodeURIComponent(selfHref)}`);

  const admin = createAdminClient();
  // notable_claims has TWO foreign keys to players (player_id and logged_by), so the embed must
  // name the constraint or PostgREST cannot tell which relationship is meant.
  const { data, error } = await admin
    .from('notable_claims')
    .select(`
  id,
  created_at,
  photo_path,
  players!notable_claims_player_id_fkey(display_name, house),
  notable_claim_types(notable_hands(id, name, local_name, rarity))
`)
    .eq('id', claimId)
    .maybeSingle();

  // Vague on screen, specific in the logs: a named-constraint typo in the embed above would
  // otherwise be indistinguishable from a win that does not exist.
  if (error) console.error('[win]', error.message);
  if (!error && !data) notFound();

  const row = data as Record<string, unknown> | null;
  const winner = one(row?.players as { display_name?: unknown; house?: unknown } | null);
  const handTypes = row ? parseClaimHandTypes(row.notable_claim_types) : null;
  const winnerName = typeof winner?.display_name === 'string' ? winner.display_name : null;
  const wonAt = typeof row?.created_at === 'string' ? row.created_at : null;
  // A win rendered a label short understates what somebody did at the table, so an unreadable
  // label list fails the page rather than shortening it. Same position the board takes.
  if (handTypes === null) console.error('[win]', claimId, 'unreadable hand_types');
  const failed = Boolean(error) || handTypes === null || !winnerName || !wonAt
    || Number.isNaN(new Date(wonAt).getTime());

  let photo: PhotoState = { kind: 'none' };
  if (!failed && typeof row?.photo_path === 'string' && row.photo_path) {
    const { data: signed } = await admin.storage
      .from(PHOTO_BUCKET)
      .createSignedUrl(row.photo_path, SIGNED_URL_TTL_SECONDS);
    // A path that exists but will not sign is a FAILURE, never an absence. Reporting it as "no
    // photo was taken" would state something false about the win.
    photo = signed?.signedUrl ? { kind: 'ready', url: signed.signedUrl } : { kind: 'failed' };
  }

  return (
    <AppFrame>
      <PageHeader backHref={backHref} title="Notable win" />
      {failed || !handTypes || !winnerName || !wonAt ? (
        <StatusMessage tone="error">Couldn’t load this win</StatusMessage>
      ) : (
        <NotableWinDetail
          winnerName={winnerName}
          house={findHouse(typeof winner?.house === 'string' ? winner.house : null)}
          wonAt={wonAt}
          handTypes={handTypes}
          photo={photo} />
      )}
    </AppFrame>
  );
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npm test -- tests/pages/notable-win-page.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "src/app/hands/[claimId]/page.tsx" tests/pages/notable-win-page.test.ts
git commit -m "feat: add a page for one notable win"
```

---

### Task 6: Board rows become links

**Files:**
- Modify: `src/components/NotableWinRow.tsx:89-125`
- Modify: `src/app/page.tsx:259-264`
- Test: `tests/components/NotableWinRow.test.tsx`, `tests/components/HomeBoards.test.tsx`

**Interfaces:**
- Consumes: `notableWinHref` (Task 3).
- Produces: `NotableWinRow` gains a required `href: string` prop.

- [ ] **Step 1: Write the failing tests**

Append to `tests/components/NotableWinRow.test.tsx`:

```tsx
describe('NotableWinRow as a link', () => {
  it('links the whole row to that win', () => {
    render(<ol><NotableWinRow rank={3} winnerName="Ah Seng" wonAt="2026-08-27T17:30:00Z"
      handTypes={[pungs]} href="/hands/c1?year=2026" /></ol>);

    const link = screen.getByRole('link');
    expect(link.getAttribute('href')).toBe('/hands/c1?year=2026');
    // Everything the row said before is still inside the link, so nothing was lost to make it
    // tappable and the link's accessible name is the row itself.
    expect(link.textContent).toContain('Ah Seng');
    expect(link.textContent).toContain('All Pungs');
  });
});
```

Existing tests in that file must gain `href="/hands/c1"` on every `NotableWinRow` render — the prop is required.

Append to `tests/components/HomeBoards.test.tsx`, reusing that file's existing `win()` fixture and
`renderHome()` helper:

```tsx
describe('opening a ranked win', () => {
  /**
   * The tap has to carry the board with it. Without the period and the filters in the link, the
   * win page's back arrow returns the player to a reset board — which reads as the app having
   * thrown their selection away rather than as leaving a page.
   */
  it('links each ranked win to its own page, carrying the period and the filters', async () => {
    db.years = [2026];
    db.notableHands = [{ id: 'h8', name: 'Pure Suit', local_name: '清一色', rarity: 'rare' }];
    db.rpcResult = { data: [win('c1', 'Ah Seng', '2026-08-27T17:30:00Z', ['h8'])], error: null };

    await renderHome('skill', '2026', 'h8');

    expect(screen.getByRole('link', { name: /Ah Seng/ }).getAttribute('href'))
      .toBe('/hands/c1?year=2026&hand=h8');
  });

  it('carries an all-time board with no filters', async () => {
    db.rpcResult = { data: [win('c1', 'Ah Seng', '2026-08-27T17:30:00Z', ['h8'])], error: null };

    await renderHome('skill', 'all');

    expect(screen.getByRole('link', { name: /Ah Seng/ }).getAttribute('href'))
      .toBe('/hands/c1?year=all');
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npm test -- tests/components/NotableWinRow.test.tsx tests/components/HomeBoards.test.tsx`
Expected: FAIL — no link role found.

- [ ] **Step 3: Make the row a link**

In `src/components/NotableWinRow.tsx`, add the import and change the signature and markup:

```tsx
import Link from 'next/link';
```

```tsx
export function NotableWinRow({ rank, winnerName, wonAt, handTypes, href }: {
  rank: number;
  winnerName: string;
  wonAt: string;
  handTypes: HandType[];
  /** That win's own page, carrying the board state to come back to. */
  href: string;
}) {
  return (
    <li>
      {/* The whole row is the target: a row-sized tap area is what a thumb actually hits, and the
          link's accessible name is the row's own text, so nothing is said twice. The label group
          inside carries no interactive content, so it may sit within the link. */}
      <Link href={href}
        className="grid min-h-16 grid-cols-[2rem_1fr_auto] items-start gap-3 rounded-[12px] border border-divider bg-surface px-3 py-3 transition-[transform,box-shadow] hover:border-cobalt active:translate-y-px">
```

The three children (rank span, the `min-w-0` div, the count span) are unchanged. Close with `</Link></li>` in place of `</li>`.

- [ ] **Step 4: Build the href on the board**

In `src/app/page.tsx`, add `notableWinHref` to the existing import from `../lib/standings`, then in the notable-wins branch:

```tsx
{notableWins.map((notableWin, i) => (
  <NotableWinRow key={notableWin.claimId} rank={i + 1} winnerName={notableWin.winnerName}
    wonAt={notableWin.wonAt} handTypes={notableWin.handTypes}
    // The tap carries the player's board with it, so the win's back link returns them to the
    // period and filters they were looking at rather than to a reset board.
    href={notableWinHref({ claimId: notableWin.claimId, year: selectedYear, handIds: selectedHandIds })} />
))}
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `npm test -- tests/components/NotableWinRow.test.tsx tests/components/HomeBoards.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/NotableWinRow.tsx src/app/page.tsx tests/components/NotableWinRow.test.tsx tests/components/HomeBoards.test.tsx
git commit -m "feat: open a notable win from its board row"
```

---

### Task 7: The gallery honours the filter

**Files:**
- Modify: `src/app/hands/page.tsx`
- Modify: `src/app/hands/HandsGallery.tsx:36-38`
- Test: `tests/pages/hands-page.test.ts`, `tests/components/HandsGallery.test.tsx`

**Interfaces:**
- Consumes: `academicYearRangeUtc` (Task 1).
- Produces: `HandsGallery` gains an optional `filtered?: boolean` prop, defaulting to `false`.

**Behaviour to build:**

1. Hand-type filter resolves in **two queries**: first the claim ids carrying any selected hand type, then the archive restricted to that set. Not an `!inner` embed filter — that would restrict the labels shown on each photo to the matching ones, and every photo must keep showing all of its labels.
2. An empty first result skips the archive query entirely and renders the filtered-empty state.
3. Year filter adds `games!inner(ended_at)` with `.gte`/`.lt` on the window from Task 1. `year=all` and a missing year apply no window.
4. `all=1` in the address turns the gallery's own filtering off while leaving `backHref` and the login `next` untouched, so clearing the view never clears the board being returned to.
5. A filtered view shows a notice naming the selection with a link to `?…&all=1`; an unfiltered-by-escape view shows a notice with a link back to the filtered address.

- [ ] **Step 1: Replace the test helper so both queries can be observed**

In `tests/pages/hands-page.test.ts`, replace the existing `archive()` helper with one that serves
two tables and records the filter links. Keep the existing `SignedUrl` type and `signedInAs`.

```ts
/**
 * The gallery now runs up to TWO reads: `notable_claim_types` to resolve which claims carry a
 * selected hand type, then `notable_claims` for the archive itself. They are separate objects, so
 * `in` can be a chaining link on one and the awaited last link on the other.
 */
function gallery({ rows = [], matches = [], signed, matchError = null }: {
  rows?: unknown[];
  matches?: { claim_id: string }[];
  signed?: SignedUrl[];
  matchError?: { message: string } | null;
} = {}) {
  const archive: Record<string, unknown> = {};
  const chain = () => archive;
  archive.select = vi.fn(chain);
  archive.not = vi.fn(chain);
  archive.in = vi.fn(chain);
  archive.gte = vi.fn(chain);
  archive.lt = vi.fn(chain);
  archive.order = vi.fn(chain);
  archive.limit = vi.fn(async () => ({ data: rows, error: null }));

  const match: Record<string, unknown> = {};
  match.select = vi.fn(() => match);
  match.in = vi.fn(async () => ({ data: matches, error: matchError }));

  const signedData = signed ?? rows.map((row) => {
    const path = (row as { photo_path: string }).photo_path;
    return { path, signedUrl: `https://signed.example/${path}` };
  });
  const createSignedUrls = vi.fn(async (paths: string[], ttl: number) => ({ data: signedData, paths, ttl }));

  return {
    client: {
      from: vi.fn((table: string) => (table === 'notable_claim_types' ? match : archive)),
      storage: { from: vi.fn(() => ({ createSignedUrls })) },
    },
    archive,
    match,
    createSignedUrls,
  };
}

const photoRow = (over: Record<string, unknown> = {}) => ({
  id: 'c1',
  created_at: '2026-08-27T17:30:00Z',
  photo_path: 'g1/a.webp',
  logged_by: USER_ID,
  players: { display_name: 'Ah Seng' },
  notable_claim_types: [{ notable_hands: { name: 'Pure Suit' } }],
  ...over,
});

const view = (params: Record<string, string | string[]>) =>
  HandsPage({ searchParams: Promise.resolve(params) }).then(renderToStaticMarkup);
```

Update the existing tests in the file to call `gallery(...)` where they called `archive(...)`, and to
read `.archive` where they read the old query object. Their assertions are unchanged.

- [ ] **Step 2: Write the failing tests**

Append to `tests/pages/hands-page.test.ts`:

```ts
describe('/hands honours the board filter', () => {
  it('lists only photographed wins carrying a selected hand type', async () => {
    const read = gallery({ rows: [photoRow()], matches: [{ claim_id: 'c1' }, { claim_id: 'c1' }] });
    mocks.createAdminClient.mockReturnValue(read.client);

    await view({ year: 'all', hand: ['h8'] });

    expect(read.match.select).toHaveBeenCalledWith('claim_id');
    expect(read.match.in).toHaveBeenCalledWith('notable_hand_id', ['h8']);
    // Deduplicated: one claim carrying two selected labels is one claim, not two.
    expect(read.archive.in).toHaveBeenCalledWith('id', ['c1']);
  });

  /**
   * The board and the gallery describe different populations — the board ranks every win, the
   * gallery holds only photographed ones. A filter matching wins nobody photographed is an honest
   * empty answer, and must not read as a fault.
   */
  it('renders the filtered-empty message without running the archive query', async () => {
    const read = gallery({ matches: [] });
    mocks.createAdminClient.mockReturnValue(read.client);

    const html = await view({ year: 'all', hand: ['h8'] });

    expect(read.archive.limit).not.toHaveBeenCalled();
    expect(html).toContain('No photos of these hand types yet');
    expect(html).not.toContain('No photographed hands yet');
  });

  /** A failed filter read is a FAILURE, never an empty result. */
  it('reports a failed filter read rather than an empty archive', async () => {
    const read = gallery({ matches: [], matchError: { message: 'boom' } });
    mocks.createAdminClient.mockReturnValue(read.client);

    const html = await view({ year: 'all', hand: ['h8'] });

    expect(html).toContain('Couldn’t load the archive');
    expect(html).not.toContain('No photos of these hand types yet');
  });

  /**
   * The window opens at SINGAPORE midnight of the first Monday of August, which is 16:00 UTC the
   * day before. Anchored to UTC midnight it would swallow eight hours of the previous year — and
   * mahjong is played in exactly those hours.
   */
  it('restricts to the selected academic year using the Singapore boundary', async () => {
    const read = gallery({ rows: [photoRow()] });
    mocks.createAdminClient.mockReturnValue(read.client);

    await view({ year: '2026' });

    expect(read.archive.gte).toHaveBeenCalledWith('games.ended_at', '2026-08-02T16:00:00.000Z');
    expect(read.archive.lt).toHaveBeenCalledWith('games.ended_at', '2027-08-01T16:00:00.000Z');
  });

  it('applies no window for all time', async () => {
    const read = gallery({ rows: [photoRow()] });
    mocks.createAdminClient.mockReturnValue(read.client);

    await view({ year: 'all' });

    expect(read.archive.gte).not.toHaveBeenCalled();
    expect(read.archive.lt).not.toHaveBeenCalled();
  });

  /**
   * Clearing the gallery's own view must never clear the board being returned to — the player
   * asked to see more photos, not to lose their filter.
   */
  it('shows everything on the escape parameter while the back link keeps the filter', async () => {
    const read = gallery({ rows: [photoRow()] });
    mocks.createAdminClient.mockReturnValue(read.client);

    const html = await view({ year: '2026', hand: ['h8'], all: '1' });

    expect(read.archive.in).not.toHaveBeenCalled();
    expect(read.archive.gte).not.toHaveBeenCalled();
    expect(read.match.in).not.toHaveBeenCalled();
    expect(html).toContain('href="/?board=skill&amp;year=2026&amp;hand=h8"');
  });

  it('offers the escape from a filtered view and the way back from an unfiltered one', async () => {
    mocks.createAdminClient.mockReturnValue(gallery({ rows: [photoRow()] }).client);

    const filtered = await view({ year: '2026', hand: ['h8'] });
    expect(filtered).toContain('href="/hands?year=2026&amp;hand=h8&amp;all=1"');

    const everything = await view({ year: '2026', hand: ['h8'], all: '1' });
    expect(everything).toContain('href="/hands?year=2026&amp;hand=h8"');
  });
});
```

Append to `tests/components/HandsGallery.test.tsx`:

```tsx
it('distinguishes an empty filter result from an empty archive', () => {
  render(<HandsGallery photos={[]} filtered />);
  expect(screen.getByText(/No photos of these hand types yet/i)).toBeTruthy();
  expect(screen.queryByText(/No photographed hands yet/i)).toBeNull();
});

it('still says the archive is empty when nothing was filtered', () => {
  render(<HandsGallery photos={[]} />);
  expect(screen.getByText(/No photographed hands yet/i)).toBeTruthy();
});
```

Add to `tests/components/HandsGallery.test.tsx`:

```tsx
it('distinguishes an empty filter result from an empty archive', () => {
  render(<HandsGallery photos={[]} filtered />);
  expect(screen.getByText(/No photos of these hand types yet/i)).toBeTruthy();
  expect(screen.queryByText(/No photographed hands yet/i)).toBeNull();
});
```

- [ ] **Step 3: Run the tests and confirm they fail**

Run: `npm test -- tests/pages/hands-page.test.ts tests/components/HandsGallery.test.tsx`
Expected: FAIL — the filter links are never called and the filtered message is absent.

- [ ] **Step 4: Split the gallery's two empty states**

In `src/app/hands/HandsGallery.tsx`, change the signature and the empty branch:

```tsx
export function HandsGallery({ photos, filtered = false }: { photos: HandPhoto[]; filtered?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState<HandPhoto>();
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string>();

  // Two different facts. "Nothing matched what you picked" tells a player to loosen the filter;
  // "there are no photos" tells them to go and take one. Saying the second when the first is true
  // reads as the archive having lost their photos.
  if (photos.length === 0) {
    return (
      <StatusMessage tone="info">
        {filtered ? 'No photos of these hand types yet.' : 'No photographed hands yet.'}
      </StatusMessage>
    );
  }
```

Everything below that block is unchanged.

- [ ] **Step 5: Filter the archive**

Rewrite `src/app/hands/page.tsx`. The imports gain `Link`, `academicYearRangeUtc`, and the shared
`one` (Task 2); `Row` gains the optional embed the year filter adds:

```tsx
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createServerSupabase } from '../../lib/supabase/server';
import { createAdminClient } from '../../lib/supabase/admin';
import { academicYearRangeUtc, parseYearParam } from '../../lib/academic-year';
import { PHOTO_BUCKET, SIGNED_URL_TTL_SECONDS } from '../../lib/image';
import { one } from '../../lib/notable-claim';
import { standingsHref } from '../../lib/standings';
import { AppFrame, PageHeader, StatusMessage } from '../../components/ui';
import { HandsGallery, type HandPhoto } from './HandsGallery';

export const dynamic = 'force-dynamic';

type Row = {
  id: string;
  created_at: string;
  photo_path: string;
  logged_by: string;
  players: { display_name: string } | { display_name: string }[] | null;
  notable_claim_types: {
    notable_hands: { name: string } | { name: string }[] | null;
  }[] | null;
  /** Present only when the year filter is on, which is the only thing that embeds the game. */
  games?: { ended_at: string } | { ended_at: string }[] | null;
};
```

Replace the body from the `searchParams` read down to the `admin` query with:

```tsx
export default async function HandsPage({ searchParams }: {
  searchParams?: Promise<{ year?: string | string[]; hand?: string | string[]; all?: string | string[] }>;
} = {}) {
  const { year: rawYear, hand: rawHand, all: rawAll } = (await searchParams) ?? {};
  const returnYear = parseYearParam(rawYear);
  // Deduplicated and sorted so every address built below agrees, and so one player's link is the
  // same string as another's from the same board.
  const handIds = [...new Set(
    Array.isArray(rawHand) ? rawHand : typeof rawHand === 'string' ? [rawHand] : [],
  )].sort();
  // The escape hatch. It switches THIS page's filtering off and never touches the return state, so
  // a player who asks to see more photos does not also lose the board they came from.
  const showAll = (Array.isArray(rawAll) ? rawAll[0] : rawAll) === '1';

  const backHref = returnYear === null
    ? '/?board=skill'
    : standingsHref({ board: 'skill', year: returnYear, handIds });

  const returnQuery = new URLSearchParams();
  // The two parts stand on their own. An unusable year is no reason to drop the hand filters too.
  if (returnYear !== null) returnQuery.set('year', String(returnYear));
  for (const handId of handIds) returnQuery.append('hand', handId);
  const query = returnQuery.toString();
  const selfHref = query ? `/hands?${query}` : '/hands';
  const showAllHref = query ? `/hands?${query}&all=1` : '/hands?all=1';

  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  // Photos are for the people who play, never for a search engine.
  if (!user) redirect(`/login?next=${encodeURIComponent(showAll ? showAllHref : selfHref)}`);

  const admin = createAdminClient();

  // Which claims carry a selected hand type, resolved as its OWN query rather than as a filter on
  // the embedded label rows. Filtering the embed would also restrict WHICH labels each photo shows,
  // and a photo has to keep showing every label its hand earned.
  let matchingClaimIds: string[] | null = null;
  let filterFailed = false;
  if (!showAll && handIds.length > 0) {
    const { data: matches, error: matchError } = await admin
      .from('notable_claim_types')
      .select('claim_id')
      .in('notable_hand_id', handIds);
    if (matchError) {
      // A failed filter read is a FAILURE, never an empty result. Rendering it as "nothing matched"
      // would tell the player their filter is too narrow when the app simply could not ask.
      console.error('[hands]', matchError.message);
      filterFailed = true;
    } else {
      matchingClaimIds = [...new Set((matches ?? []).flatMap((row: Record<string, unknown>) =>
        typeof row.claim_id === 'string' ? [row.claim_id] : []))];
    }
  }

  // Half-open, and its edges are Singapore midnights expressed in UTC — see academicYearRangeUtc.
  const yearWindow = !showAll && typeof returnYear === 'number'
    ? academicYearRangeUtc(returnYear)
    : null;
  const filtering = !showAll && (handIds.length > 0 || yearWindow !== null);
  // Nothing matched, so there is nothing to ask the archive for.
  const nothingMatches = matchingClaimIds !== null && matchingClaimIds.length === 0;

  let error: { message: string } | null = null;
  let rows: Row[] = [];
  if (!filterFailed && !nothingMatches) {
    // notable_claims has TWO foreign keys to players (player_id and logged_by), so the embed must
    // name the constraint or PostgREST cannot tell which relationship is meant. The game is
    // embedded only when the year filter needs something to compare against.
    let archive = admin
      .from('notable_claims')
      .select(`
  id,
  created_at,
  photo_path,
  logged_by,
  players!notable_claims_player_id_fkey(display_name),
  notable_claim_types(notable_hands(name))${yearWindow ? ',\n  games!inner(ended_at)' : ''}
`)
      .not('photo_path', 'is', null);
    if (matchingClaimIds) archive = archive.in('id', matchingClaimIds);
    if (yearWindow) {
      archive = archive.gte('games.ended_at', yearWindow.start).lt('games.ended_at', yearWindow.end);
    }
    const answer = await archive.order('created_at', { ascending: false }).limit(60);
    // Vague on screen, specific in the logs: a named-constraint typo in the embed above would
    // otherwise be indistinguishable from an empty archive.
    if (answer.error) console.error('[hands]', answer.error.message);
    error = answer.error;
    rows = (answer.data ?? []) as Row[];
  }
```

The `photos` block that follows is unchanged apart from reading the `rows` variable declared above
rather than a fresh `const`. Replace the returned markup with:

```tsx
  const failed = Boolean(error) || filterFailed;
  return (
    <AppFrame>
      <PageHeader backHref={backHref} title="Notable hands"
        description="Every hand worth photographing, newest first." />
      {/* A player looking at a short archive can always see why it is short, and undo it, without
          going back to the board to do it. */}
      {!failed && filtering ? (
        <StatusMessage tone="info" className="mb-5">
          Showing only photos that match the board’s filter.{' '}
          <Link href={showAllHref} className="font-bold underline">Show every photographed hand</Link>
        </StatusMessage>
      ) : null}
      {!failed && showAll && query ? (
        <StatusMessage tone="info" className="mb-5">
          Showing every photographed hand.{' '}
          <Link href={selfHref} className="font-bold underline">Back to your filter</Link>
        </StatusMessage>
      ) : null}
      {failed ? (
        <StatusMessage tone="error">Couldn’t load the archive just now. Refresh to try again.</StatusMessage>
      ) : (
        <HandsGallery photos={photos} filtered={filtering} />
      )}
    </AppFrame>
  );
}
```

- [ ] **Step 6: Run the tests and confirm they pass**

Run: `npm test -- tests/pages/hands-page.test.ts tests/components/HandsGallery.test.tsx`
Expected: PASS, including every pre-existing case in both files.

- [ ] **Step 7: Commit**

```bash
git add src/app/hands/page.tsx src/app/hands/HandsGallery.tsx tests/pages/hands-page.test.ts tests/components/HandsGallery.test.tsx
git commit -m "feat: carry the board filter into the hand gallery"
```

---

### Task 8: Whole-branch verification

**Files:** none changed unless a check fails.

- [ ] **Step 1: The full suite**

Run: `npm test`
Expected: every test passes, count strictly greater than the 587 on `main`.

- [ ] **Step 2: Types**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: 0 errors. The pre-existing unused `_props` warning in `GameLive` is known and allowed; nothing new.

- [ ] **Step 4: Production build**

Run: `npm run build`
Expected: compiles, and `/hands/[claimId]` appears in the route list as dynamic.

- [ ] **Step 5: Whitespace**

Run: `git diff --check main...HEAD`
Expected: no output.

- [ ] **Step 6: Report to Bryan and STOP**

Report the counts and outcomes verbatim. **Do not push and do not deploy** — that gate is Bryan's, and it has not been given.

---

## Verification beyond the suite

The automated tests cover every rule in spec §10. Two things they cannot cover, both needing Bryan:

1. **A real tap on a phone.** That a row-sized link is comfortable to hit, that the pressed state reads, and that Back from the win page lands on the filtered board rather than the top of the list.
2. **A real photo rendering through a signed link on the win page.** The tests assert the URL reaches the markup; only a browser proves the private bucket serves it.

Both belong to the post-deploy acceptance pass, alongside RVMJ's existing open interactive checks.

## Out of scope — Release 2

Attaching a photo after the fact (spec §6), widening removal to match, and closing the gallery-panel seam (spec §9). Those need a database migration and their own gates, and get their own plan.
