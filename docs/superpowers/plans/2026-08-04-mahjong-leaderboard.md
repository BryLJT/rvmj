# RVMJ Mahjong Leaderboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the RVMJ mahjong leaderboard web app per `docs/superpowers/specs/2026-08-04-mahjong-leaderboard-design.md`: NFC tap → seat assignment → live game scoring with a server-side rules engine → lifetime/form/skill leaderboards.

**Architecture:** Next.js (App Router, TypeScript) on Vercel; Supabase for Postgres, Google auth, and realtime. The rules engine is a pure TypeScript module (`src/lib/engine/`) with zero I/O — the server computes all point movements; the client only reports what happened. All writes go through Postgres RPCs (single-transaction) with a deferred zero-sum constraint trigger as the database-level backstop.

**Tech Stack:** Next.js 15+, TypeScript (strict), @supabase/ssr + @supabase/supabase-js, Tailwind CSS, Vitest + fast-check, Supabase CLI for migrations.

## Global Constraints

- All point values are **integers**. No floats anywhere in scoring.
- Seat type is exactly `'E' | 'S' | 'W' | 'N'` everywhere (DB check constraints included).
- The engine (`src/lib/engine/`) imports nothing outside its own directory. No I/O, no Date, no random.
- Every scoring event's movements must sum to zero: asserted in the engine AND enforced by a deferred DB constraint trigger.
- Rules are snapshotted onto `games.rules` (jsonb) at start; the engine only ever reads rules from the game record, never from presets.
- Movement rows are written for **all four seats** on every event, zeros included (uniform participation counting).
- Clients never write tables directly: RLS allows `select` to authenticated users only; all writes go through server actions using the service-role client, calling RPCs.
- Secrets (`SUPABASE_SERVICE_ROLE_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`) live in env vars only. Never committed. `.env*` is already gitignored.
- Voiding never deletes: it inserts a `reversal` event with negated movements and sets `hands.voided = true`.
- Defaults (Bryan's table): taiToPoints `[0,1,2,4,8,16]`, minTai 1, taiCap 5, shooter off, start display 1000, bust line −3000.
- Commit after every task with a conventional-commit message. Run `npx tsc --noEmit` before each commit.

---

## File Structure

```
RVMJ/
├── docs/superpowers/{specs,plans}/          (exists)
├── package.json, tsconfig.json, next.config.ts, vitest.config.ts
├── .env.example                             (committed; names only)
├── .env.local                               (NOT committed)
├── middleware.ts                            — Supabase session refresh
├── supabase/
│   ├── config.toml                          (from `supabase init`)
│   └── migrations/
│       └── 0001_init.sql                    — schema, RLS, trigger, RPCs, seeds
├── src/
│   ├── lib/
│   │   ├── engine/                          — PURE. No imports from outside.
│   │   │   ├── types.ts                     — Seat, RulesConfig, events, Movements
│   │   │   ├── defaults.ts                  — DEFAULT_RULES
│   │   │   ├── scale.ts                     — taiToBase()
│   │   │   ├── win.ts                       — settleWin()
│   │   │   ├── bonus.ts                     — settleBonus()
│   │   │   └── engine.ts                    — settleEvent(), assertZeroSum()
│   │   ├── join.ts                          — decideJoin() (pure)
│   │   ├── supabase/
│   │   │   ├── client.ts                    — browser client
│   │   │   ├── server.ts                    — cookie-bound server client
│   │   │   └── admin.ts                     — service-role client (server only)
│   │   ├── telegram.ts                      — sendAlert()
│   │   └── actions/
│   │       ├── game.ts                      — startGame, recordHand, voidHand, endGame, reopenGame
│   │       └── presets.ts                   — savePreset
│   ├── app/
│   │   ├── layout.tsx, globals.css
│   │   ├── page.tsx                         — leaderboards (3 tabs)
│   │   ├── login/page.tsx                   — Google sign-in
│   │   ├── auth/callback/route.ts           — OAuth code exchange
│   │   ├── t/[secret]/page.tsx              — tap landing: validate + join
│   │   └── game/[id]/
│   │       ├── page.tsx                     — server shell (forming or active)
│   │       ├── FormingScreen.tsx            — players, rules form, start
│   │       ├── GameLive.tsx                 — totals, hands, realtime, void, end
│   │       └── RecordHandWizard.tsx         — bonus → outcome → preview → confirm
│   └── components/RulesForm.tsx             — shared rules editor (forming + presets)
└── tests/
    ├── engine/{scale,win,bonus,engine}.test.ts
    └── join.test.ts
```

---

### Task 1: Scaffold the project

**Files:**
- Create: Next.js scaffold at repo root (`package.json`, `tsconfig.json`, `next.config.ts`, `src/app/*`)
- Create: `vitest.config.ts`, `.env.example`
- Modify: `.gitignore` (verify `.env*` entries survive the scaffold)

**Interfaces:**
- Consumes: nothing (first task)
- Produces: a running Next.js app and a working `npm test` (Vitest) for every later task

- [ ] **Step 1: Scaffold Next.js into the existing repo**

```bash
cd "/Users/bryan/Desktop/claude code/RVMJ"
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --no-import-alias --use-npm
```

If it balks at the non-empty directory (docs/, .git), scaffold to a temp dir and move: `npx create-next-app@latest /tmp/rvmj-scaffold ... && rsync -a --ignore-existing /tmp/rvmj-scaffold/ .`

- [ ] **Step 2: Install dependencies**

```bash
npm install @supabase/supabase-js @supabase/ssr
npm install -D vitest fast-check
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
```

Add to `package.json` scripts: `"test": "vitest run", "test:watch": "vitest"`.

- [ ] **Step 4: Create `.env.example`** (names only — values live in `.env.local` and Vercel)

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

- [ ] **Step 5: Verify the app boots and tests run**

Run: `npm run dev` → loads at localhost:3000. Then `npm test` → "no test files found" exit 0 (or add a trivial passing test).
Check `.gitignore` still contains `.env` and `.env.local` and now also `node_modules/`, `.next/`.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "chore: scaffold Next.js + Vitest + Supabase deps"
```

---

### Task 2: Engine types, defaults, and the tai scale

**Files:**
- Create: `src/lib/engine/types.ts`, `src/lib/engine/defaults.ts`, `src/lib/engine/scale.ts`
- Test: `tests/engine/scale.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces (used by every later engine task and the server actions):
  - `type Seat = 'E'|'S'|'W'|'N'`; `const SEATS: Seat[]`
  - `interface RulesConfig { taiToPoints: number[]; minTai: number; taiCap: number; shooter: boolean; startingDisplayTotal: number; bustLine: number }`
  - `interface WinEvent { type:'win'; winner:Seat; winKind:'self_draw'|'discard'; discarder?:Seat; tai:number; notableHandId?:string|null }`
  - `interface BonusEvent { type:'bonus'; kind:'pair_dealt'|'pair_drawn'|'kong_concealed'|'kong_added'|'kong_exposed'; beneficiary:Seat; discarder?:Seat }`
  - `type ScoringEvent = WinEvent | BonusEvent`; `type Movements = Record<Seat, number>`
  - `class EngineError extends Error`
  - `const DEFAULT_RULES: RulesConfig`
  - `function taiToBase(tai:number, rules:RulesConfig): { base:number; clampedTai:number }` — throws `EngineError` below minTai, clamps at taiCap

- [ ] **Step 1: Write the failing test** — `tests/engine/scale.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { taiToBase } from '../../src/lib/engine/scale';
import { DEFAULT_RULES } from '../../src/lib/engine/defaults';
import { EngineError } from '../../src/lib/engine/types';

describe('taiToBase (doubling scale, cap 5, min 1)', () => {
  it.each([[1, 1], [2, 2], [3, 4], [4, 8], [5, 16]])('%i tai → base %i', (tai, base) => {
    expect(taiToBase(tai, DEFAULT_RULES)).toEqual({ base, clampedTai: tai });
  });
  it('clamps above the cap and reports the clamp', () => {
    expect(taiToBase(9, DEFAULT_RULES)).toEqual({ base: 16, clampedTai: 5 });
  });
  it('throws below the minimum', () => {
    expect(() => taiToBase(0, DEFAULT_RULES)).toThrow(EngineError);
  });
  it('throws on non-integer tai', () => {
    expect(() => taiToBase(2.5, DEFAULT_RULES)).toThrow(EngineError);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/engine/scale.test.ts` → FAIL (modules missing)

- [ ] **Step 3: Implement** — `src/lib/engine/types.ts`

```ts
export type Seat = 'E' | 'S' | 'W' | 'N';
export const SEATS: readonly Seat[] = ['E', 'S', 'W', 'N'] as const;

export interface RulesConfig {
  /** Base points per tai; index 0 unused. Doubling default: [0,1,2,4,8,16]. Length must be taiCap+1. */
  taiToPoints: number[];
  minTai: number;
  taiCap: number;
  shooter: boolean;
  startingDisplayTotal: number;
  bustLine: number;
}

export type WinKind = 'self_draw' | 'discard';
export type BonusKind = 'pair_dealt' | 'pair_drawn' | 'kong_concealed' | 'kong_added' | 'kong_exposed';

export interface WinEvent {
  type: 'win';
  winner: Seat;
  winKind: WinKind;
  discarder?: Seat;
  tai: number;
  notableHandId?: string | null;
}

export interface BonusEvent {
  type: 'bonus';
  kind: BonusKind;
  beneficiary: Seat;
  discarder?: Seat; // only valid for kong_exposed
}

export type ScoringEvent = WinEvent | BonusEvent;

/** One entry per seat, zeros included. Always sums to zero. */
export type Movements = Record<Seat, number>;

export class EngineError extends Error {}
```

`src/lib/engine/defaults.ts`:

```ts
import type { RulesConfig } from './types';

/** Bryan's table, confirmed 2026-08-04 (spec §6). */
export const DEFAULT_RULES: RulesConfig = {
  taiToPoints: [0, 1, 2, 4, 8, 16],
  minTai: 1,
  taiCap: 5,
  shooter: false,
  startingDisplayTotal: 1000,
  bustLine: -3000,
};
```

`src/lib/engine/scale.ts`:

```ts
import { EngineError, type RulesConfig } from './types';

export function taiToBase(tai: number, rules: RulesConfig): { base: number; clampedTai: number } {
  if (!Number.isInteger(tai)) throw new EngineError(`tai must be an integer, got ${tai}`);
  if (tai < rules.minTai) throw new EngineError(`tai ${tai} is below the minimum ${rules.minTai}`);
  const clampedTai = Math.min(tai, rules.taiCap);
  const base = rules.taiToPoints[clampedTai];
  if (base === undefined) throw new EngineError(`no point value configured for ${clampedTai} tai`);
  return { base, clampedTai };
}
```

- [ ] **Step 4: Run to verify pass** — `npx vitest run tests/engine/scale.test.ts` → PASS
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(engine): types, defaults, tai-to-base scale"`

---

### Task 3: Win settlement

**Files:**
- Create: `src/lib/engine/win.ts`
- Test: `tests/engine/win.test.ts`

**Interfaces:**
- Consumes: `taiToBase`, types from Task 2
- Produces: `function settleWin(event: WinEvent, rules: RulesConfig): Movements`

- [ ] **Step 1: Write the failing test** — the worked examples from spec §6.2 (4 tai → base 8), plus validation:

```ts
import { describe, it, expect } from 'vitest';
import { settleWin } from '../../src/lib/engine/win';
import { DEFAULT_RULES } from '../../src/lib/engine/defaults';
import { EngineError, type WinEvent } from '../../src/lib/engine/types';

const win = (o: Partial<WinEvent>): WinEvent =>
  ({ type: 'win', winner: 'E', winKind: 'discard', discarder: 'S', tai: 4, ...o });

describe('settleWin — spec §6.2 worked examples (4 tai, base 8)', () => {
  it('discard, shooter OFF: discarder 2×, others 1×, winner +4×', () => {
    expect(settleWin(win({}), DEFAULT_RULES)).toEqual({ E: 32, S: -16, W: -8, N: -8 });
  });
  it('discard, shooter ON: discarder funds all 4×', () => {
    expect(settleWin(win({}), { ...DEFAULT_RULES, shooter: true }))
      .toEqual({ E: 32, S: -32, W: 0, N: 0 });
  });
  it('self-draw: all three pay 2×, winner +6× (shooter irrelevant)', () => {
    const expected = { E: 48, S: -16, W: -16, N: -16 };
    expect(settleWin(win({ winKind: 'self_draw', discarder: undefined }), DEFAULT_RULES)).toEqual(expected);
    expect(settleWin(win({ winKind: 'self_draw', discarder: undefined }), { ...DEFAULT_RULES, shooter: true })).toEqual(expected);
  });
  it('cap applies: 9 tai settles as 5 tai (base 16)', () => {
    expect(settleWin(win({ tai: 9 }), DEFAULT_RULES)).toEqual({ E: 64, S: -32, W: -16, N: -16 });
  });
  it('rejects self-draw with a discarder', () => {
    expect(() => settleWin(win({ winKind: 'self_draw' }), DEFAULT_RULES)).toThrow(EngineError);
  });
  it('rejects discard win without a discarder, or discarder === winner', () => {
    expect(() => settleWin(win({ discarder: undefined }), DEFAULT_RULES)).toThrow(EngineError);
    expect(() => settleWin(win({ discarder: 'E' }), DEFAULT_RULES)).toThrow(EngineError);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/engine/win.test.ts` → FAIL
- [ ] **Step 3: Implement** — `src/lib/engine/win.ts`

```ts
import { EngineError, SEATS, type Movements, type RulesConfig, type WinEvent } from './types';
import { taiToBase } from './scale';

export function settleWin(event: WinEvent, rules: RulesConfig): Movements {
  const { base } = taiToBase(event.tai, rules);
  const m: Movements = { E: 0, S: 0, W: 0, N: 0 };

  if (event.winKind === 'self_draw') {
    if (event.discarder !== undefined) throw new EngineError('self-draw cannot have a discarder');
    for (const s of SEATS) if (s !== event.winner) m[s] = -2 * base;
    m[event.winner] = 6 * base;
    return m;
  }

  const d = event.discarder;
  if (!d || d === event.winner) throw new EngineError('discard win requires a discarder other than the winner');
  if (rules.shooter) {
    m[d] = -4 * base;
  } else {
    m[d] = -2 * base;
    for (const s of SEATS) if (s !== event.winner && s !== d) m[s] = -base;
  }
  m[event.winner] = 4 * base;
  return m;
}
```

- [ ] **Step 4: Run to verify pass** — PASS
- [ ] **Step 5: Commit** — `git commit -am "feat(engine): win settlement"`

---

### Task 4: Bonus settlement

**Files:**
- Create: `src/lib/engine/bonus.ts`
- Test: `tests/engine/bonus.test.ts`

**Interfaces:**
- Consumes: types from Task 2
- Produces: `function settleBonus(event: BonusEvent, rules: RulesConfig): Movements`

- [ ] **Step 1: Write the failing test** — every row of spec §6.3's resulting table:

```ts
import { describe, it, expect } from 'vitest';
import { settleBonus } from '../../src/lib/engine/bonus';
import { DEFAULT_RULES } from '../../src/lib/engine/defaults';
import { EngineError, type BonusEvent } from '../../src/lib/engine/types';

const bonus = (o: Partial<BonusEvent>): BonusEvent =>
  ({ type: 'bonus', kind: 'kong_concealed', beneficiary: 'W', ...o });
const SHOOTER = { ...DEFAULT_RULES, shooter: true };

describe('settleBonus — spec §6.3 table', () => {
  it('pair dealt: +6, 2 from each', () => {
    expect(settleBonus(bonus({ kind: 'pair_dealt' }), DEFAULT_RULES)).toEqual({ E: -2, S: -2, W: 6, N: -2 });
  });
  it('pair drawn: +3, 1 from each', () => {
    expect(settleBonus(bonus({ kind: 'pair_drawn' }), DEFAULT_RULES)).toEqual({ E: -1, S: -1, W: 3, N: -1 });
  });
  it('concealed kong: +6, 2 from each — shooter setting irrelevant', () => {
    const expected = { E: -2, S: -2, W: 6, N: -2 };
    expect(settleBonus(bonus({}), DEFAULT_RULES)).toEqual(expected);
    expect(settleBonus(bonus({}), SHOOTER)).toEqual(expected);
  });
  it('added kong (self-drawn, exposed): +3, 1 from each even with shooter on', () => {
    const expected = { E: -1, S: -1, W: 3, N: -1 };
    expect(settleBonus(bonus({ kind: 'kong_added' }), SHOOTER)).toEqual(expected);
  });
  it('exposed kong off a discard, shooter OFF: 1 from each', () => {
    expect(settleBonus(bonus({ kind: 'kong_exposed', discarder: 'N' }), DEFAULT_RULES))
      .toEqual({ E: -1, S: -1, W: 3, N: -1 });
  });
  it('exposed kong off a discard, shooter ON: discarder pays all 3', () => {
    expect(settleBonus(bonus({ kind: 'kong_exposed', discarder: 'N' }), SHOOTER))
      .toEqual({ E: 0, S: 0, W: 3, N: -3 });
  });
  it('rejects a discarder on self-drawn kinds', () => {
    expect(() => settleBonus(bonus({ kind: 'pair_dealt', discarder: 'N' }), DEFAULT_RULES)).toThrow(EngineError);
  });
  it('rejects exposed kong without a discarder, or discarder === beneficiary', () => {
    expect(() => settleBonus(bonus({ kind: 'kong_exposed' }), DEFAULT_RULES)).toThrow(EngineError);
    expect(() => settleBonus(bonus({ kind: 'kong_exposed', discarder: 'W' }), DEFAULT_RULES)).toThrow(EngineError);
  });
});
```

- [ ] **Step 2: Run to verify failure** — FAIL
- [ ] **Step 3: Implement** — `src/lib/engine/bonus.ts`

```ts
import { EngineError, SEATS, type BonusEvent, type BonusKind, type Movements, type RulesConfig } from './types';

/** Flat points per paying player, independent of the tai scale (spec §6.3). */
const BONUS_AMOUNT: Record<BonusKind, number> = {
  pair_dealt: 2,
  pair_drawn: 1,
  kong_concealed: 2,
  kong_added: 1,
  kong_exposed: 1,
};

export function settleBonus(event: BonusEvent, rules: RulesConfig): Movements {
  const amount = BONUS_AMOUNT[event.kind];
  const m: Movements = { E: 0, S: 0, W: 0, N: 0 };
  const b = event.beneficiary;

  // Amount is set by tile status; funding by whether a discarder exists (spec §6.3).
  if (event.kind === 'kong_exposed') {
    const d = event.discarder;
    if (!d || d === b) throw new EngineError('exposed kong requires a discarder other than the beneficiary');
    if (rules.shooter) {
      m[d] = -3 * amount;
    } else {
      for (const s of SEATS) if (s !== b) m[s] = -amount;
    }
  } else {
    if (event.discarder !== undefined) throw new EngineError(`${event.kind} is self-drawn and cannot have a discarder`);
    for (const s of SEATS) if (s !== b) m[s] = -amount;
  }
  m[b] = 3 * amount;
  return m;
}
```

- [ ] **Step 4: Run to verify pass** — PASS
- [ ] **Step 5: Commit** — `git commit -am "feat(engine): bonus settlement"`

---

### Task 5: Dispatcher and the zero-sum law

**Files:**
- Create: `src/lib/engine/engine.ts`
- Test: `tests/engine/engine.test.ts`

**Interfaces:**
- Consumes: `settleWin`, `settleBonus`, types
- Produces (the only engine entry point server actions use):
  - `function settleEvent(event: ScoringEvent, rules: RulesConfig): Movements`
  - `function assertZeroSum(m: Movements): void`

- [ ] **Step 1: Write the failing test** — dispatch + the fast-check property:

```ts
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { settleEvent, assertZeroSum } from '../../src/lib/engine/engine';
import { DEFAULT_RULES } from '../../src/lib/engine/defaults';
import { EngineError, SEATS, type RulesConfig, type ScoringEvent, type Seat } from '../../src/lib/engine/types';

const seatArb = fc.constantFrom<Seat>('E', 'S', 'W', 'N');

const rulesArb: fc.Arbitrary<RulesConfig> = fc
  .record({
    cap: fc.integer({ min: 1, max: 13 }),
    shooter: fc.boolean(),
    scale: fc.array(fc.integer({ min: 1, max: 1000 }), { minLength: 13, maxLength: 13 }),
  })
  .map(({ cap, shooter, scale }) => ({
    taiToPoints: [0, ...scale.slice(0, cap)],
    minTai: 1,
    taiCap: cap,
    shooter,
    startingDisplayTotal: 1000,
    bustLine: -3000,
  }));

const eventArb: fc.Arbitrary<ScoringEvent> = fc.oneof(
  fc
    .record({ winner: seatArb, discarder: seatArb, selfDraw: fc.boolean(), tai: fc.integer({ min: 1, max: 20 }) })
    .filter(({ winner, discarder, selfDraw }) => selfDraw || winner !== discarder)
    .map(({ winner, discarder, selfDraw, tai }) =>
      selfDraw
        ? ({ type: 'win', winner, winKind: 'self_draw', tai } as ScoringEvent)
        : ({ type: 'win', winner, winKind: 'discard', discarder, tai } as ScoringEvent),
    ),
  fc
    .record({
      kind: fc.constantFrom('pair_dealt', 'pair_drawn', 'kong_concealed', 'kong_added', 'kong_exposed' as const),
      beneficiary: seatArb,
      discarder: seatArb,
    })
    .filter(({ kind, beneficiary, discarder }) => kind !== 'kong_exposed' || beneficiary !== discarder)
    .map(({ kind, beneficiary, discarder }) =>
      ({ type: 'bonus', kind, beneficiary, ...(kind === 'kong_exposed' ? { discarder } : {}) }) as ScoringEvent,
    ),
);

describe('settleEvent', () => {
  it('dispatches wins and bonuses', () => {
    expect(settleEvent({ type: 'win', winner: 'E', winKind: 'self_draw', tai: 1 }, DEFAULT_RULES))
      .toEqual({ E: 6, S: -2, W: -2, N: -2 });
    expect(settleEvent({ type: 'bonus', kind: 'pair_drawn', beneficiary: 'S' }, DEFAULT_RULES))
      .toEqual({ E: -1, S: 3, W: -1, N: -1 });
  });

  it('LAW: every valid event settles to zero-sum, under any rules', () => {
    fc.assert(
      fc.property(eventArb, rulesArb, (event, rules) => {
        const m = settleEvent(event, rules);
        return SEATS.reduce((acc, s) => acc + m[s], 0) === 0;
      }),
      { numRuns: 5000 },
    );
  });
});

describe('assertZeroSum', () => {
  it('accepts balanced, rejects unbalanced', () => {
    expect(() => assertZeroSum({ E: 1, S: -1, W: 0, N: 0 })).not.toThrow();
    expect(() => assertZeroSum({ E: 1, S: 0, W: 0, N: 0 })).toThrow(EngineError);
  });
});
```

- [ ] **Step 2: Run to verify failure** — FAIL
- [ ] **Step 3: Implement** — `src/lib/engine/engine.ts`

```ts
import { EngineError, SEATS, type Movements, type RulesConfig, type ScoringEvent } from './types';
import { settleWin } from './win';
import { settleBonus } from './bonus';

export function assertZeroSum(m: Movements): void {
  const total = SEATS.reduce((acc, s) => acc + m[s], 0);
  if (total !== 0) throw new EngineError(`movements sum to ${total}, expected 0`);
}

/** The single entry point: settle any event and guarantee the zero-sum invariant. */
export function settleEvent(event: ScoringEvent, rules: RulesConfig): Movements {
  const m = event.type === 'win' ? settleWin(event, rules) : settleBonus(event, rules);
  assertZeroSum(m);
  return m;
}
```

- [ ] **Step 4: Run the full engine suite** — `npx vitest run tests/engine` → all PASS
- [ ] **Step 5: Commit** — `git commit -am "feat(engine): dispatcher + zero-sum property test (5000 runs)"`

---

### Task 6: Join decision logic (pure)

**Files:**
- Create: `src/lib/join.ts`
- Test: `tests/join.test.ts`

**Interfaces:**
- Consumes: `Seat` from engine types
- Produces (used by the tap route in Task 10):
  - `interface GameSnapshot { id: string; status: 'forming'|'active'; createdAt: Date; lastActivityAt: Date; seats: Partial<Record<Seat, string>> }`
  - `interface Tap { playerId: string; seat: Seat; now: Date }`
  - `type JoinDecision = { action:'create_forming' } | { action:'expire_and_create'; expireGameId:string } | { action:'end_stale_and_create'; endGameId:string } | { action:'claim_seat'; gameId:string } | { action:'move_seat'; gameId:string; fromSeat:Seat } | { action:'rejoin'; gameId:string } | { action:'reject'; reason:'seat_taken'|'game_in_progress' }`
  - `function decideJoin(game: GameSnapshot | null, tap: Tap): JoinDecision`
  - `const FORMING_TTL_MS = 30*60*1000`, `const ACTIVE_TTL_MS = 12*60*60*1000`

- [ ] **Step 1: Write the failing test** — every edge case from spec §10:

```ts
import { describe, it, expect } from 'vitest';
import { decideJoin, FORMING_TTL_MS, ACTIVE_TTL_MS, type GameSnapshot } from '../../src/lib/join';

const now = new Date('2026-08-04T12:00:00Z');
const tap = (playerId: string, seat: 'E' | 'S' | 'W' | 'N') => ({ playerId, seat, now });
const game = (o: Partial<GameSnapshot>): GameSnapshot => ({
  id: 'g1', status: 'forming', createdAt: now, lastActivityAt: now, seats: {}, ...o,
});

describe('decideJoin', () => {
  it('no game → create forming', () => {
    expect(decideJoin(null, tap('p1', 'E'))).toEqual({ action: 'create_forming' });
  });
  it('stale forming (>30min) → expire and create', () => {
    const stale = game({ createdAt: new Date(now.getTime() - FORMING_TTL_MS - 1) });
    expect(decideJoin(stale, tap('p1', 'E'))).toEqual({ action: 'expire_and_create', expireGameId: 'g1' });
  });
  it('forming, free seat → claim', () => {
    expect(decideJoin(game({ seats: { E: 'p1' } }), tap('p2', 'S'))).toEqual({ action: 'claim_seat', gameId: 'g1' });
  });
  it('forming, seat taken by someone else → reject', () => {
    expect(decideJoin(game({ seats: { E: 'p1' } }), tap('p2', 'E'))).toEqual({ action: 'reject', reason: 'seat_taken' });
  });
  it('forming, own seat re-tapped → rejoin (no duplicate claim)', () => {
    expect(decideJoin(game({ seats: { E: 'p1' } }), tap('p1', 'E'))).toEqual({ action: 'rejoin', gameId: 'g1' });
  });
  it('forming, player taps a different free seat → move (one account, one seat)', () => {
    expect(decideJoin(game({ seats: { E: 'p1' } }), tap('p1', 'S'))).toEqual({ action: 'move_seat', gameId: 'g1', fromSeat: 'E' });
  });
  it('active, participant re-taps → rejoin', () => {
    const g = game({ status: 'active', seats: { E: 'p1', S: 'p2', W: 'p3', N: 'p4' } });
    expect(decideJoin(g, tap('p3', 'W'))).toEqual({ action: 'rejoin', gameId: 'g1' });
    expect(decideJoin(g, tap('p3', 'E'))).toEqual({ action: 'rejoin', gameId: 'g1' }); // any tag rejoins; seats are locked
  });
  it('active, outsider (fifth player) → reject', () => {
    const g = game({ status: 'active', seats: { E: 'p1', S: 'p2', W: 'p3', N: 'p4' } });
    expect(decideJoin(g, tap('p5', 'E'))).toEqual({ action: 'reject', reason: 'game_in_progress' });
  });
  it('active but silent >12h → auto-end and create fresh', () => {
    const g = game({ status: 'active', seats: { E: 'p1' }, lastActivityAt: new Date(now.getTime() - ACTIVE_TTL_MS - 1) });
    expect(decideJoin(g, tap('p5', 'E'))).toEqual({ action: 'end_stale_and_create', endGameId: 'g1' });
  });
});
```

- [ ] **Step 2: Run to verify failure** — FAIL
- [ ] **Step 3: Implement** — `src/lib/join.ts`

```ts
import type { Seat } from './engine/types';

export interface GameSnapshot {
  id: string;
  status: 'forming' | 'active';
  createdAt: Date;
  lastActivityAt: Date;
  seats: Partial<Record<Seat, string>>; // seat → playerId
}

export interface Tap { playerId: string; seat: Seat; now: Date }

export type JoinDecision =
  | { action: 'create_forming' }
  | { action: 'expire_and_create'; expireGameId: string }
  | { action: 'end_stale_and_create'; endGameId: string }
  | { action: 'claim_seat'; gameId: string }
  | { action: 'move_seat'; gameId: string; fromSeat: Seat }
  | { action: 'rejoin'; gameId: string }
  | { action: 'reject'; reason: 'seat_taken' | 'game_in_progress' };

export const FORMING_TTL_MS = 30 * 60 * 1000;
export const ACTIVE_TTL_MS = 12 * 60 * 60 * 1000;

function seatOf(game: GameSnapshot, playerId: string): Seat | undefined {
  return (Object.entries(game.seats) as [Seat, string][]).find(([, p]) => p === playerId)?.[0];
}

export function decideJoin(game: GameSnapshot | null, tap: Tap): JoinDecision {
  if (!game) return { action: 'create_forming' };

  if (game.status === 'forming') {
    if (tap.now.getTime() - game.createdAt.getTime() > FORMING_TTL_MS)
      return { action: 'expire_and_create', expireGameId: game.id };
    const occupant = game.seats[tap.seat];
    if (occupant === tap.playerId) return { action: 'rejoin', gameId: game.id };
    if (occupant) return { action: 'reject', reason: 'seat_taken' };
    const current = seatOf(game, tap.playerId);
    if (current) return { action: 'move_seat', gameId: game.id, fromSeat: current };
    return { action: 'claim_seat', gameId: game.id };
  }

  // active
  if (tap.now.getTime() - game.lastActivityAt.getTime() > ACTIVE_TTL_MS)
    return { action: 'end_stale_and_create', endGameId: game.id };
  if (seatOf(game, tap.playerId)) return { action: 'rejoin', gameId: game.id };
  return { action: 'reject', reason: 'game_in_progress' };
}
```

- [ ] **Step 4: Run to verify pass** — PASS
- [ ] **Step 5: Commit** — `git commit -am "feat: pure join decision logic with lazy expiry"`

---

### Task 7: Supabase project + CLI + env  **(manual gates for Bryan)**

**Files:**
- Create: `supabase/config.toml` (via CLI), `.env.local` (never committed)

**Interfaces:**
- Consumes: nothing
- Produces: a linked hosted Supabase project; env vars every later task reads

- [ ] **Step 1 (BRYAN, in browser): create the Supabase project**
  - supabase.com → New project (free tier), region Singapore. Name: `rvmj`.
  - Project Settings → API: copy **Project URL**, **anon key**, **service_role key**.
- [ ] **Step 2 (BRYAN, in browser): enable Google auth**
  - Google Cloud Console → new project → OAuth consent screen (external, add yourself as test user) → Credentials → OAuth client ID (web). Authorized redirect URI: `https://<project-ref>.supabase.co/auth/v1/callback`.
  - Supabase → Authentication → Providers → Google: paste client ID + secret, enable.
- [ ] **Step 3: fill `.env.local`** with the three Supabase values (agent prompts Bryan to paste them in; NEVER echo the service key into chat or commit it).
- [ ] **Step 4: install + link the CLI**

```bash
npm install -D supabase
npx supabase init
npx supabase link --project-ref <project-ref>   # prompts for DB password (Bryan)
```

- [ ] **Step 5: Commit** (config.toml only — verify `git status` shows no env files)

```bash
git add supabase/config.toml package.json package-lock.json && git commit -m "chore: supabase CLI init + link"
```

---

### Task 8: Database migration — schema, RLS, zero-sum trigger, RPCs, seeds

**Files:**
- Create: `supabase/migrations/0001_init.sql`

**Interfaces:**
- Consumes: nothing (SQL is self-contained)
- Produces (used by all server actions):
  - Tables: `players`, `tables`, `table_seats`, `presets`, `games`, `game_players`, `hands`, `scoring_events`, `point_movements`, `notable_hands`
  - RPCs: `start_game(p_game_id uuid, p_rules jsonb)`, `record_hand(p_game_id uuid, p_recorded_by uuid, p_events jsonb) returns uuid`, `void_hand(p_hand_id uuid, p_by uuid)`, `end_game(p_game_id uuid) returns text` ('ended' | 'quarantined'), `reopen_game(p_game_id uuid)`
  - Views: `lifetime_board`, `form_board`, `skill_board`
  - `record_hand`'s `p_events` element shape: `{ "type": "win"|"bonus", "payload": <ScoringEvent JSON>, "winner_player_id": uuid|null, "tai": int|null, "notable_hand_id": uuid|null, "movements": [{ "player_id": uuid, "seat": "E", "points": int } ×4] }`

- [ ] **Step 1: Write `supabase/migrations/0001_init.sql`**

```sql
-- ============ TABLES ============
create table players (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  email text not null,
  created_at timestamptz not null default now()
);

create table tables (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  label text,
  created_at timestamptz not null default now()
);

create table table_seats (
  table_id uuid not null references tables(id) on delete cascade,
  seat text not null check (seat in ('E','S','W','N')),
  secret text unique not null,
  primary key (table_id, seat)
);

create table presets (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references players(id) on delete cascade,
  name text not null,
  rules jsonb not null,
  created_at timestamptz not null default now()
);

create table games (
  id uuid primary key default gen_random_uuid(),
  table_id uuid not null references tables(id),
  status text not null default 'forming'
    check (status in ('forming','active','ended','quarantined','expired')),
  rules jsonb,                       -- snapshot, set by start_game
  created_at timestamptz not null default now(),
  started_at timestamptz,
  ended_at timestamptz,
  last_activity_at timestamptz not null default now()
);

create table game_players (
  game_id uuid not null references games(id) on delete cascade,
  player_id uuid not null references players(id),
  seat text not null check (seat in ('E','S','W','N')),
  final_total int,
  primary key (game_id, seat),
  unique (game_id, player_id)
);

create table notable_hands (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  local_name text,
  rarity text not null check (rarity in ('uncommon','rare','legendary'))
);

create table hands (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references games(id) on delete cascade,
  seq int not null,
  recorded_by uuid not null references players(id),
  voided boolean not null default false,
  created_at timestamptz not null default now(),
  unique (game_id, seq)
);

create table scoring_events (
  id uuid primary key default gen_random_uuid(),
  hand_id uuid not null references hands(id) on delete cascade,
  type text not null check (type in ('win','bonus','reversal')),
  payload jsonb not null default '{}',
  winner_player_id uuid references players(id),
  tai int,
  notable_hand_id uuid references notable_hands(id),
  created_at timestamptz not null default now()
);

create table point_movements (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references scoring_events(id) on delete cascade,
  hand_id uuid not null references hands(id) on delete cascade,
  game_id uuid not null references games(id) on delete cascade,
  player_id uuid not null references players(id),
  seat text not null check (seat in ('E','S','W','N')),
  points int not null
);
create index on point_movements (game_id);
create index on point_movements (player_id);

-- ============ ZERO-SUM CONSTRAINT (spec §10 layer 2) ============
create or replace function check_event_zero_sum() returns trigger
language plpgsql as $$
declare v_event uuid; v_sum int;
begin
  v_event := coalesce(new.event_id, old.event_id);
  select coalesce(sum(points), 0) into v_sum from point_movements where event_id = v_event;
  if v_sum <> 0 then
    raise exception 'zero-sum violation: event % sums to %', v_event, v_sum;
  end if;
  return null;
end $$;

create constraint trigger event_zero_sum
  after insert or update or delete on point_movements
  deferrable initially deferred
  for each row execute function check_event_zero_sum();

-- ============ NEW-USER TRIGGER ============
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into players (id, display_name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    new.email
  )
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ============ RPCs (all writes go through these) ============
create or replace function start_game(p_game_id uuid, p_rules jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform 1 from games where id = p_game_id and status = 'forming' for update;
  if not found then raise exception 'game is not forming'; end if;
  if (select count(*) from game_players where game_id = p_game_id) <> 4 then
    raise exception 'need exactly 4 players to start';
  end if;
  update games set status = 'active', rules = p_rules, started_at = now(), last_activity_at = now()
  where id = p_game_id;
end $$;

create or replace function record_hand(p_game_id uuid, p_recorded_by uuid, p_events jsonb)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_hand_id uuid := gen_random_uuid();
  v_seq int;
  v_event jsonb;
  v_event_id uuid;
  v_mv jsonb;
begin
  perform 1 from games where id = p_game_id and status = 'active' for update;
  if not found then raise exception 'game is not active'; end if;
  select coalesce(max(seq), 0) + 1 into v_seq from hands where game_id = p_game_id;
  insert into hands (id, game_id, seq, recorded_by) values (v_hand_id, p_game_id, v_seq, p_recorded_by);
  for v_event in select * from jsonb_array_elements(p_events) loop
    v_event_id := gen_random_uuid();
    insert into scoring_events (id, hand_id, type, payload, winner_player_id, tai, notable_hand_id)
    values (
      v_event_id, v_hand_id, v_event->>'type', v_event->'payload',
      nullif(v_event->>'winner_player_id', '')::uuid,
      nullif(v_event->>'tai', '')::int,
      nullif(v_event->>'notable_hand_id', '')::uuid
    );
    for v_mv in select * from jsonb_array_elements(v_event->'movements') loop
      insert into point_movements (event_id, hand_id, game_id, player_id, seat, points)
      values (v_event_id, v_hand_id, p_game_id, (v_mv->>'player_id')::uuid, v_mv->>'seat', (v_mv->>'points')::int);
    end loop;
  end loop;
  update games set last_activity_at = now() where id = p_game_id;
  return v_hand_id;
end $$;

create or replace function void_hand(p_hand_id uuid, p_by uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_game uuid; v_event_id uuid := gen_random_uuid();
begin
  select game_id into v_game from hands where id = p_hand_id and not voided for update;
  if not found then raise exception 'hand not found or already voided'; end if;
  perform 1 from games where id = v_game and status = 'active';
  if not found then raise exception 'game is not active'; end if;
  insert into scoring_events (id, hand_id, type, payload)
  values (v_event_id, p_hand_id, 'reversal', jsonb_build_object('voided_by', p_by));
  insert into point_movements (event_id, hand_id, game_id, player_id, seat, points)
  select v_event_id, hand_id, game_id, player_id, seat, -points
  from point_movements where hand_id = p_hand_id and event_id <> v_event_id;
  update hands set voided = true where id = p_hand_id;
  update games set last_activity_at = now() where id = v_game;
end $$;

create or replace function end_game(p_game_id uuid) returns text
language plpgsql security definer set search_path = public as $$
declare v_total int; r record;
begin
  perform 1 from games where id = p_game_id and status = 'active' for update;
  if not found then raise exception 'game is not active'; end if;
  select coalesce(sum(points), 0) into v_total from point_movements where game_id = p_game_id;
  if v_total <> 0 then
    update games set status = 'quarantined', ended_at = now() where id = p_game_id;
    return 'quarantined';
  end if;
  for r in
    select gp.player_id, coalesce(sum(m.points), 0) as total
    from game_players gp
    left join point_movements m on m.game_id = gp.game_id and m.player_id = gp.player_id
    where gp.game_id = p_game_id
    group by gp.player_id
  loop
    update game_players set final_total = r.total
    where game_id = p_game_id and player_id = r.player_id;
  end loop;
  update games set status = 'ended', ended_at = now() where id = p_game_id;
  return 'ended';
end $$;

create or replace function reopen_game(p_game_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform 1 from games
  where id = p_game_id and status = 'ended' and ended_at > now() - interval '1 hour'
  for update;
  if not found then raise exception 'game cannot be reopened (not ended, or ended more than an hour ago)'; end if;
  update games set status = 'active', ended_at = null, last_activity_at = now() where id = p_game_id;
  update game_players set final_total = null where game_id = p_game_id;
end $$;

-- ============ LEADERBOARD VIEWS (spec §9) ============
-- Voided hands net to zero via their reversal events, so plain sums stay correct.
create view lifetime_board as
select p.id, p.display_name,
  coalesce(sum(m.points), 0) as total_points,
  count(distinct m.hand_id) as hands_played
from players p
join point_movements m on m.player_id = p.id
join games g on g.id = m.game_id and g.status = 'ended'
group by p.id, p.display_name;

create view form_board as
select id, display_name, total_points, hands_played,
  round(total_points::numeric / hands_played, 2) as avg_points_per_hand
from lifetime_board
where hands_played >= 100;

create view skill_board as
select p.id, p.display_name,
  coalesce(sum(least(e.tai, coalesce((g.rules->>'taiCap')::int, e.tai))), 0) as total_tai,
  count(*) filter (where e.notable_hand_id is not null) as notable_wins,
  count(*) as total_wins
from scoring_events e
join hands h on h.id = e.hand_id and not h.voided
join games g on g.id = h.game_id and g.status = 'ended'
join players p on p.id = e.winner_player_id
where e.type = 'win'
group by p.id, p.display_name;

-- ============ RLS ============
-- Reads: any signed-in user. Writes: none (service role bypasses RLS; all writes via RPCs above).
alter table players enable row level security;
alter table tables enable row level security;
alter table table_seats enable row level security;
alter table presets enable row level security;
alter table games enable row level security;
alter table game_players enable row level security;
alter table hands enable row level security;
alter table scoring_events enable row level security;
alter table point_movements enable row level security;
alter table notable_hands enable row level security;

create policy "read players" on players for select to authenticated using (true);
create policy "read tables" on tables for select to authenticated using (true);
-- table_seats holds tag secrets: NO select policy. Server-only via service role.
create policy "read own presets" on presets for select to authenticated using (owner = auth.uid());
create policy "read games" on games for select to authenticated using (true);
create policy "read game_players" on game_players for select to authenticated using (true);
create policy "read hands" on hands for select to authenticated using (true);
create policy "read scoring_events" on scoring_events for select to authenticated using (true);
create policy "read point_movements" on point_movements for select to authenticated using (true);
create policy "read notable_hands" on notable_hands for select to authenticated using (true);

-- ============ REALTIME ============
alter publication supabase_realtime add table hands, point_movements, games, game_players;

-- ============ SEEDS ============
insert into notable_hands (name, local_name, rarity) values
  ('Thirteen Wonders', '十三幺', 'legendary'),
  ('Heavenly Hand', '天糊', 'legendary'),
  ('Earthly Hand', '地糊', 'legendary'),
  ('Great Winds', '大四喜', 'legendary'),
  ('Big Three Dragons', '大三元', 'rare'),
  ('Small Three Dragons', '小三元', 'rare'),
  ('All Pungs', '碰碰胡', 'uncommon'),
  ('Pure Suit', '清一色', 'rare'),
  ('Mixed Suit', '混一色', 'uncommon'),
  ('Kong on Kong', '杠上开花', 'rare'),
  ('Robbing the Kong', '抢杠', 'rare'),
  ('Last Tile Catch', '海底捞月', 'rare');
```

- [ ] **Step 2: Push to the hosted project**

Run: `npx supabase db push`
Expected: migration applies cleanly.

- [ ] **Step 3: Verify the backstop actually fires**

In the Supabase SQL editor, run (as one statement — the deferred trigger checks at commit):

```sql
do $$
declare v_t uuid; v_g uuid; v_p uuid := gen_random_uuid(); v_h uuid; v_e uuid;
begin
  -- minimal fixture rows... intentionally unbalanced movement:
  insert into tables (code) values ('TEST') returning id into v_t;
  -- (cannot insert players without an auth user; use any existing player id, or skip in favour of:)
  raise notice 'fixture requires a real player id — run after first login, or trust the unit path';
end $$;
```

Practical check after first real login (Task 9): insert a hand with a single +1 movement via SQL editor and confirm `zero-sum violation` is raised on commit. Record the result in the task notes.

- [ ] **Step 4: Commit** — `git add supabase/migrations && git commit -m "feat(db): schema, zero-sum trigger, RPCs, boards, RLS, seeds"`

---

### Task 9: Supabase clients, middleware, login, OAuth callback

**Files:**
- Create: `src/lib/supabase/client.ts`, `src/lib/supabase/server.ts`, `src/lib/supabase/admin.ts`, `middleware.ts`, `src/app/login/page.tsx`, `src/app/auth/callback/route.ts`

**Interfaces:**
- Consumes: env vars from Task 7
- Produces:
  - `createClient()` (browser) — `src/lib/supabase/client.ts`
  - `createServerSupabase()` (async, cookie-bound) — `src/lib/supabase/server.ts`
  - `createAdminClient()` (service role; import only from server code) — `src/lib/supabase/admin.ts`
  - `/login?next=<path>` page; `/auth/callback` route

- [ ] **Step 1: Browser client** — `src/lib/supabase/client.ts`

```ts
import { createBrowserClient } from '@supabase/ssr';

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
```

- [ ] **Step 2: Server client** — `src/lib/supabase/server.ts` (check current @supabase/ssr docs if the API differs)

```ts
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function createServerSupabase() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (all) => {
          try {
            all.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch { /* called from a Server Component — middleware handles refresh */ }
        },
      },
    },
  );
}
```

- [ ] **Step 3: Admin client** — `src/lib/supabase/admin.ts`

```ts
import { createClient as createSupabaseClient } from '@supabase/supabase-js';

/** Service-role client. Bypasses RLS. NEVER import from client components. */
export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}
```

- [ ] **Step 4: Middleware** — `middleware.ts` (root) — standard @supabase/ssr session-refresh pattern:

```ts
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (all) => {
          all.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          all.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );
  await supabase.auth.getUser(); // refreshes the session cookie if stale
  return response;
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] };
```

- [ ] **Step 5: Login page** — `src/app/login/page.tsx`

```tsx
'use client';
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { createClient } from '../../lib/supabase/client';

function LoginInner() {
  const next = useSearchParams().get('next') ?? '/';
  const signIn = () => {
    const supabase = createClient();
    supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
    });
  };
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-2xl font-bold">RVMJ</h1>
      <p className="text-sm opacity-70">Sign in once — after this, tapping the table takes you straight in.</p>
      <button onClick={signIn} className="rounded-lg border px-6 py-3 font-medium">
        Sign in with Google
      </button>
    </main>
  );
}

export default function LoginPage() {
  return <Suspense><LoginInner /></Suspense>;
}
```

- [ ] **Step 6: Callback route** — `src/app/auth/callback/route.ts`

```ts
import { NextResponse } from 'next/server';
import { createServerSupabase } from '../../../lib/supabase/server';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const next = url.searchParams.get('next') ?? '/';
  if (code) {
    const supabase = await createServerSupabase();
    await supabase.auth.exchangeCodeForSession(code);
  }
  return NextResponse.redirect(new URL(next, url.origin));
}
```

- [ ] **Step 7: Verify manually** — `npm run dev`, visit `/login`, complete Google sign-in, confirm redirect and that a `players` row appeared (Supabase dashboard → Table editor). This also confirms the Task 8 new-user trigger.
- [ ] **Step 8: Run the Task 8 backstop check** now that a real player id exists (SQL editor: unbalanced insert → expect `zero-sum violation`; roll back).
- [ ] **Step 9: Commit** — `git add -A && git commit -m "feat(auth): supabase clients, session middleware, google login"`

---

### Task 10: The tap route

**Files:**
- Create: `src/app/t/[secret]/page.tsx`

**Interfaces:**
- Consumes: `decideJoin` (Task 6), `createServerSupabase` + `createAdminClient` (Task 9), tables from Task 8
- Produces: `GET /t/<secret>` — the URL burned onto every tag. Redirects to `/game/<id>` or `/login`, or renders a rejection message.

- [ ] **Step 1: Implement** — `src/app/t/[secret]/page.tsx` (server component; admin client because `table_seats` has no client read policy)

```tsx
import { redirect } from 'next/navigation';
import { createServerSupabase } from '../../../lib/supabase/server';
import { createAdminClient } from '../../../lib/supabase/admin';
import { decideJoin, type GameSnapshot } from '../../../lib/join';
import type { Seat } from '../../../lib/engine/types';

export const dynamic = 'force-dynamic';

const REJECT_COPY: Record<string, string> = {
  seat_taken: 'That seat is already taken. Tap a free seat, or ask its occupant to move.',
  game_in_progress: 'A game is in progress at this table. Wait for it to finish.',
};

export default async function TapPage({ params }: { params: Promise<{ secret: string }> }) {
  const { secret } = await params;
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/t/${secret}`)}`);

  const admin = createAdminClient();
  const { data: tagSeat } = await admin
    .from('table_seats').select('table_id, seat').eq('secret', secret).single();
  if (!tagSeat) {
    return <main className="p-8">Unknown tag. This sticker is not registered.</main>;
  }

  // Load the current open game at this table, if any
  const { data: g } = await admin
    .from('games')
    .select('id, status, created_at, last_activity_at, game_players(player_id, seat)')
    .eq('table_id', tagSeat.table_id)
    .in('status', ['forming', 'active'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const snapshot: GameSnapshot | null = g
    ? {
        id: g.id,
        status: g.status as 'forming' | 'active',
        createdAt: new Date(g.created_at),
        lastActivityAt: new Date(g.last_activity_at),
        seats: Object.fromEntries(
          (g.game_players ?? []).map((p: { player_id: string; seat: string }) => [p.seat, p.player_id]),
        ),
      }
    : null;

  const decision = decideJoin(snapshot, { playerId: user.id, seat: tagSeat.seat as Seat, now: new Date() });

  switch (decision.action) {
    case 'reject':
      return <main className="p-8">{REJECT_COPY[decision.reason]}</main>;
    case 'rejoin':
      redirect(`/game/${decision.gameId}`);
      break;
    case 'claim_seat':
      await admin.from('game_players').insert({ game_id: decision.gameId, player_id: user.id, seat: tagSeat.seat });
      redirect(`/game/${decision.gameId}`);
      break;
    case 'move_seat':
      await admin.from('game_players')
        .update({ seat: tagSeat.seat })
        .eq('game_id', decision.gameId).eq('player_id', user.id);
      redirect(`/game/${decision.gameId}`);
      break;
    case 'expire_and_create':
      await admin.from('games').update({ status: 'expired' }).eq('id', decision.expireGameId);
      break; // fall through to create below
    case 'end_stale_and_create':
      await admin.rpc('end_game', { p_game_id: decision.endGameId });
      break; // fall through to create below
    case 'create_forming':
      break;
  }

  // create a fresh forming game with this player in this seat
  const { data: newGame, error } = await admin
    .from('games').insert({ table_id: tagSeat.table_id }).select('id').single();
  if (error || !newGame) throw new Error(`could not create game: ${error?.message}`);
  await admin.from('game_players').insert({ game_id: newGame.id, player_id: user.id, seat: tagSeat.seat });
  redirect(`/game/${newGame.id}`);
}
```

- [ ] **Step 2: Verify manually** — insert a test table + four seats in the SQL editor:

```sql
insert into tables (code, label) values ('DEV1', 'Dev table');
insert into table_seats (table_id, seat, secret)
select id, s.seat, 'dev-' || lower(s.seat)
from tables, (values ('E'),('S'),('W'),('N')) as s(seat)
where code = 'DEV1';
```

Visit `localhost:3000/t/dev-e` → forming game created, redirected to `/game/<id>` (404 until Task 11 — the redirect happening is the pass signal). Check `games` + `game_players` rows in the dashboard. Visit `/t/dev-e` again → same game (rejoin, no duplicate).

- [ ] **Step 3: Run full test suite + typecheck** — `npm test && npx tsc --noEmit` → clean
- [ ] **Step 4: Commit** — `git commit -am "feat: NFC tap route — validate secret, join/create via decideJoin"`

---

### Task 11: Game page shell, forming screen, rules form, start

**Files:**
- Create: `src/app/game/[id]/page.tsx`, `src/app/game/[id]/FormingScreen.tsx`, `src/components/RulesForm.tsx`, `src/lib/actions/game.ts` (startGame only — extended in later tasks)

**Interfaces:**
- Consumes: `DEFAULT_RULES`, `RulesConfig`, server/admin clients, `start_game` RPC
- Produces:
  - `/game/[id]` — renders FormingScreen (forming) or GameLive (active, Task 13; render a placeholder `<div>active</div>` until then)
  - Server action `startGame(gameId: string, rules: RulesConfig): Promise<{ error?: string }>`
  - `<RulesForm value={RulesConfig} onChange={(r: RulesConfig) => void} />` — controlled client component

- [ ] **Step 1: Server action** — `src/lib/actions/game.ts`

```ts
'use server';
import { createServerSupabase } from '../supabase/server';
import { createAdminClient } from '../supabase/admin';
import type { RulesConfig } from '../engine/types';

async function requireUser() {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('not signed in');
  return user;
}

async function requireParticipant(gameId: string, userId: string) {
  const admin = createAdminClient();
  const { data } = await admin.from('game_players')
    .select('seat').eq('game_id', gameId).eq('player_id', userId).single();
  if (!data) throw new Error('you are not in this game');
  return { admin, seat: data.seat as 'E' | 'S' | 'W' | 'N' };
}

export async function startGame(gameId: string, rules: RulesConfig): Promise<{ error?: string }> {
  try {
    const user = await requireUser();
    const { admin } = await requireParticipant(gameId, user.id);
    const { error } = await admin.rpc('start_game', { p_game_id: gameId, p_rules: rules });
    if (error) return { error: error.message };
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'failed to start' };
  }
}
```

- [ ] **Step 2: Rules form** — `src/components/RulesForm.tsx`

```tsx
'use client';
import type { RulesConfig } from '../lib/engine/types';

export function RulesForm({ value, onChange }: { value: RulesConfig; onChange: (r: RulesConfig) => void }) {
  const set = (patch: Partial<RulesConfig>) => onChange({ ...value, ...patch });
  const setCap = (cap: number) => {
    // keep taiToPoints in step with the cap: extend by doubling, or truncate
    const pts = [...value.taiToPoints];
    while (pts.length < cap + 1) pts.push(pts[pts.length - 1] * 2);
    pts.length = cap + 1;
    set({ taiCap: cap, taiToPoints: pts });
  };
  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4">
      <label className="flex items-center justify-between">
        <span>Shooter</span>
        <input type="checkbox" checked={value.shooter} onChange={(e) => set({ shooter: e.target.checked })} />
      </label>
      <label className="flex items-center justify-between">
        <span>Minimum tai to win</span>
        <input type="number" min={1} max={value.taiCap} className="w-20 rounded border px-2 py-1 text-right"
          value={value.minTai} onChange={(e) => set({ minTai: Number(e.target.value) })} />
      </label>
      <label className="flex items-center justify-between">
        <span>Tai cap</span>
        <input type="number" min={1} max={13} className="w-20 rounded border px-2 py-1 text-right"
          value={value.taiCap} onChange={(e) => setCap(Number(e.target.value))} />
      </label>
      <div className="text-sm opacity-70">
        Scale: {value.taiToPoints.slice(1).map((p, i) => `${i + 1}t=${p}`).join('  ')}
      </div>
      <label className="flex items-center justify-between">
        <span>Starting display total</span>
        <input type="number" step={100} className="w-24 rounded border px-2 py-1 text-right"
          value={value.startingDisplayTotal} onChange={(e) => set({ startingDisplayTotal: Number(e.target.value) })} />
      </label>
      <label className="flex items-center justify-between">
        <span>Bust line (displayed)</span>
        <input type="number" step={100} className="w-24 rounded border px-2 py-1 text-right"
          value={value.bustLine} onChange={(e) => set({ bustLine: Number(e.target.value) })} />
      </label>
    </div>
  );
}
```

- [ ] **Step 3: Game page shell** — `src/app/game/[id]/page.tsx`

```tsx
import { redirect } from 'next/navigation';
import { createServerSupabase } from '../../../lib/supabase/server';
import { FormingScreen } from './FormingScreen';
import { GameLive } from './GameLive';

export const dynamic = 'force-dynamic';

export default async function GamePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/game/${id}`)}`);

  const { data: game } = await supabase
    .from('games')
    .select('id, status, rules, table_id, game_players(player_id, seat, players(display_name))')
    .eq('id', id).single();
  if (!game) return <main className="p-8">Game not found.</main>;

  const players = (game.game_players ?? []).map(
    (gp: { player_id: string; seat: string; players: { display_name: string } | { display_name: string }[] | null }) => ({
      playerId: gp.player_id,
      seat: gp.seat as 'E' | 'S' | 'W' | 'N',
      name: Array.isArray(gp.players) ? gp.players[0]?.display_name ?? '?' : gp.players?.display_name ?? '?',
    }),
  );

  if (game.status === 'forming') return <FormingScreen gameId={game.id} players={players} />;
  if (game.status === 'active' || game.status === 'ended' || game.status === 'quarantined')
    return <GameLive gameId={game.id} status={game.status} rules={game.rules} players={players} me={user.id} />;
  return <main className="p-8">This game has expired.</main>;
}
```

(Until Task 13 exists, stub `GameLive.tsx` as `export function GameLive(props: never) { return <div>active</div>; }` — replace in Task 13. Keep the prop signature above in mind: Task 13 must export exactly `GameLive({ gameId, status, rules, players, me })`.)

- [ ] **Step 4: Forming screen** — `src/app/game/[id]/FormingScreen.tsx`

```tsx
'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { RulesForm } from '../../../components/RulesForm';
import { DEFAULT_RULES } from '../../../lib/engine/defaults';
import type { RulesConfig } from '../../../lib/engine/types';
import { startGame } from '../../../lib/actions/game';
import { createClient } from '../../../lib/supabase/client';

type P = { playerId: string; seat: 'E' | 'S' | 'W' | 'N'; name: string };

export function FormingScreen({ gameId, players }: { gameId: string; players: P[] }) {
  const router = useRouter();
  const [rules, setRules] = useState<RulesConfig>(DEFAULT_RULES);
  const [error, setError] = useState<string>();
  const full = players.length === 4;

  // refresh when other players tap in, or the game starts
  useEffect(() => {
    const supabase = createClient();
    const ch = supabase
      .channel(`forming-${gameId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'game_players', filter: `game_id=eq.${gameId}` },
        () => router.refresh())
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'games', filter: `id=eq.${gameId}` },
        () => router.refresh())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [gameId, router]);

  const onStart = async () => {
    const res = await startGame(gameId, rules);
    if (res.error) setError(res.error);
    else router.refresh();
  };

  return (
    <main className="mx-auto flex max-w-md flex-col gap-4 p-6">
      <h1 className="text-xl font-bold">Forming game</h1>
      <ul className="rounded-lg border p-4">
        {(['E', 'S', 'W', 'N'] as const).map((s) => {
          const p = players.find((x) => x.seat === s);
          return <li key={s} className="flex justify-between py-1"><span className="font-mono">{s}</span><span>{p ? p.name : '— tap to join —'}</span></li>;
        })}
      </ul>
      <h2 className="font-semibold">Rules for this game</h2>
      <RulesForm value={rules} onChange={setRules} />
      <button onClick={onStart} disabled={!full}
        className="rounded-lg border px-6 py-3 font-medium disabled:opacity-40">
        {full ? 'Start game' : `Waiting for players (${players.length}/4)`}
      </button>
      {error && <p className="text-red-600">{error}</p>}
    </main>
  );
}
```

- [ ] **Step 5: Verify manually** — tap `/t/dev-e` in one browser and `/t/dev-s`, `/t/dev-w`, `/t/dev-n` in three others (normal + incognito + a second profile + phone, all signed into different Google accounts — or temporarily test with fewer by inserting `game_players` rows via SQL). All four named on screen, rules visible on every screen, Start enabled only at 4/4, starting flips everyone to the (stub) active view via realtime refresh.
- [ ] **Step 6: Typecheck + commit** — `npx tsc --noEmit && git add -A && git commit -m "feat: forming screen with live roster, rules form, start"`

---

### Task 12: Record-hand — server action + wizard

**Files:**
- Modify: `src/lib/actions/game.ts` (add `recordHand`)
- Create: `src/app/game/[id]/RecordHandWizard.tsx`

**Interfaces:**
- Consumes: `settleEvent` (Task 5), `record_hand` RPC (Task 8), `requireUser`/`requireParticipant` (Task 11)
- Produces:
  - Server action `recordHand(gameId: string, events: ScoringEvent[]): Promise<{ error?: string }>` — empty `events` = washed-out hand with no bonuses; still records the hand (a seq'd record of the wash-out)
  - `<RecordHandWizard players={P[]} rules={RulesConfig} notableHands={{id,name,local_name}[]} onSubmit={(events: ScoringEvent[]) => Promise<void>} onClose={() => void} />`
  - Client-side preview uses the same engine (`settleEvent`) — display only; the server recomputes authoritatively

- [ ] **Step 1: Server action** — append to `src/lib/actions/game.ts`

```ts
import { settleEvent } from '../engine/engine';
import { SEATS, type RulesConfig as Rules, type ScoringEvent, type Seat } from '../engine/types';

export async function recordHand(gameId: string, events: ScoringEvent[]): Promise<{ error?: string }> {
  try {
    const user = await requireUser();
    const { admin } = await requireParticipant(gameId, user.id);

    const { data: game } = await admin.from('games').select('status, rules').eq('id', gameId).single();
    if (!game || game.status !== 'active') return { error: 'game is not active' };
    const rules = game.rules as Rules; // snapshot — the only rules source (spec §5)

    const { data: gps } = await admin.from('game_players').select('player_id, seat').eq('game_id', gameId);
    const seatToPlayer = Object.fromEntries((gps ?? []).map((g) => [g.seat, g.player_id])) as Record<Seat, string>;

    // Server-side authority: compute movements with the engine (zero-sum asserted inside)
    const payload = events.map((event) => {
      const movements = settleEvent(event, rules);
      return {
        type: event.type,
        payload: event,
        winner_player_id: event.type === 'win' ? seatToPlayer[event.winner] : null,
        tai: event.type === 'win' ? event.tai : null,
        notable_hand_id: event.type === 'win' ? (event.notableHandId ?? null) : null,
        movements: SEATS.map((seat) => ({ player_id: seatToPlayer[seat], seat, points: movements[seat] })),
      };
    });

    const { error } = await admin.rpc('record_hand', {
      p_game_id: gameId, p_recorded_by: user.id, p_events: payload,
    });
    if (error) return { error: error.message };
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'failed to record hand' };
  }
}
```

- [ ] **Step 2: Wizard** — `src/app/game/[id]/RecordHandWizard.tsx`

```tsx
'use client';
import { useState } from 'react';
import { settleEvent } from '../../../lib/engine/engine';
import { EngineError, SEATS, type BonusKind, type RulesConfig, type ScoringEvent, type Seat } from '../../../lib/engine/types';

type P = { playerId: string; seat: Seat; name: string };
type NH = { id: string; name: string; local_name: string | null };
const BONUS_LABELS: Record<BonusKind, string> = {
  pair_dealt: 'Pair — complete at the deal (+2 each)',
  pair_drawn: 'Pair — completed during play (+1 each)',
  kong_concealed: 'Kong — concealed (+2 each)',
  kong_added: 'Kong — added, self-drawn (+1 each)',
  kong_exposed: 'Kong — exposed off a discard (+1)',
};

export function RecordHandWizard({ players, rules, notableHands, onSubmit, onClose }: {
  players: P[]; rules: RulesConfig; notableHands: NH[];
  onSubmit: (events: ScoringEvent[]) => Promise<void>; onClose: () => void;
}) {
  const [bonuses, setBonuses] = useState<ScoringEvent[]>([]);
  const [bonusDraft, setBonusDraft] = useState<{ kind: BonusKind; beneficiary?: Seat; discarder?: Seat } | null>(null);
  const [outcome, setOutcome] = useState<'pending' | 'washout' | 'win'>('pending');
  const [winner, setWinner] = useState<Seat>();
  const [winKind, setWinKind] = useState<'self_draw' | 'discard'>();
  const [discarder, setDiscarder] = useState<Seat>();
  const [tai, setTai] = useState<number>();
  const [notable, setNotable] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  const name = (s: Seat) => players.find((p) => p.seat === s)?.name ?? s;

  const events: ScoringEvent[] = [...bonuses];
  let preview: Record<Seat, number> | null = null;
  let previewError: string | null = null;
  const winReady = outcome === 'washout' ||
    (outcome === 'win' && winner && tai !== undefined && (winKind === 'self_draw' || (winKind === 'discard' && discarder)));
  if (winReady && outcome === 'win') {
    events.push({
      type: 'win', winner: winner!, winKind: winKind!, tai: tai!,
      ...(winKind === 'discard' ? { discarder } : {}), notableHandId: notable,
    });
  }
  if (winReady) {
    try {
      preview = { E: 0, S: 0, W: 0, N: 0 };
      for (const ev of events) {
        const m = settleEvent(ev, rules); // display-only; server recomputes
        for (const s of SEATS) preview[s] += m[s];
      }
    } catch (e) {
      preview = null;
      previewError = e instanceof EngineError ? e.message : 'invalid hand';
    }
  }

  const SeatButtons = ({ value, onPick, exclude }: { value?: Seat; onPick: (s: Seat) => void; exclude?: Seat }) => (
    <div className="flex gap-2">
      {SEATS.filter((s) => s !== exclude).map((s) => (
        <button key={s} onClick={() => onPick(s)}
          className={`rounded border px-3 py-2 ${value === s ? 'bg-black text-white dark:bg-white dark:text-black' : ''}`}>
          {name(s)}
        </button>
      ))}
    </div>
  );

  return (
    <div className="fixed inset-0 z-10 overflow-y-auto bg-white p-6 dark:bg-neutral-900">
      <div className="mx-auto flex max-w-md flex-col gap-5">
        <div className="flex justify-between">
          <h2 className="text-lg font-bold">Record hand</h2>
          <button onClick={onClose} className="opacity-60">Cancel</button>
        </div>

        <section className="flex flex-col gap-2">
          <h3 className="font-semibold">1 · Bonus events</h3>
          {bonuses.map((b, i) => b.type === 'bonus' && (
            <div key={i} className="flex justify-between rounded border px-3 py-2 text-sm">
              <span>{BONUS_LABELS[b.kind]} — {name(b.beneficiary)}</span>
              <button onClick={() => setBonuses(bonuses.filter((_, j) => j !== i))}>✕</button>
            </div>
          ))}
          {bonusDraft ? (
            <div className="flex flex-col gap-2 rounded border p-3">
              <select value={bonusDraft.kind}
                onChange={(e) => setBonusDraft({ ...bonusDraft, kind: e.target.value as BonusKind, discarder: undefined })}
                className="rounded border px-2 py-2">
                {(Object.keys(BONUS_LABELS) as BonusKind[]).map((k) => <option key={k} value={k}>{BONUS_LABELS[k]}</option>)}
              </select>
              <span className="text-sm">Who benefits?</span>
              <SeatButtons value={bonusDraft.beneficiary} onPick={(s) => setBonusDraft({ ...bonusDraft, beneficiary: s })} />
              {bonusDraft.kind === 'kong_exposed' && bonusDraft.beneficiary && (
                <>
                  <span className="text-sm">Who discarded?</span>
                  <SeatButtons value={bonusDraft.discarder} exclude={bonusDraft.beneficiary}
                    onPick={(s) => setBonusDraft({ ...bonusDraft, discarder: s })} />
                </>
              )}
              <button
                disabled={!bonusDraft.beneficiary || (bonusDraft.kind === 'kong_exposed' && !bonusDraft.discarder)}
                onClick={() => {
                  setBonuses([...bonuses, {
                    type: 'bonus', kind: bonusDraft.kind, beneficiary: bonusDraft.beneficiary!,
                    ...(bonusDraft.kind === 'kong_exposed' ? { discarder: bonusDraft.discarder } : {}),
                  }]);
                  setBonusDraft(null);
                }}
                className="rounded border px-3 py-2 disabled:opacity-40">Add</button>
            </div>
          ) : (
            <button onClick={() => setBonusDraft({ kind: 'pair_drawn' })} className="rounded border px-3 py-2 text-sm">
              + Add bonus (pairs, kongs)
            </button>
          )}
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="font-semibold">2 · Outcome</h3>
          <div className="flex gap-2">
            <button onClick={() => setOutcome('win')}
              className={`rounded border px-3 py-2 ${outcome === 'win' ? 'bg-black text-white dark:bg-white dark:text-black' : ''}`}>Win</button>
            <button onClick={() => { setOutcome('washout'); setWinner(undefined); }}
              className={`rounded border px-3 py-2 ${outcome === 'washout' ? 'bg-black text-white dark:bg-white dark:text-black' : ''}`}>Washed out</button>
          </div>
          {outcome === 'win' && (
            <>
              <span className="text-sm">Who won?</span>
              <SeatButtons value={winner} onPick={setWinner} />
              <span className="text-sm">How?</span>
              <div className="flex gap-2">
                <button onClick={() => { setWinKind('self_draw'); setDiscarder(undefined); }}
                  className={`rounded border px-3 py-2 ${winKind === 'self_draw' ? 'bg-black text-white dark:bg-white dark:text-black' : ''}`}>Self-draw</button>
                <button onClick={() => setWinKind('discard')}
                  className={`rounded border px-3 py-2 ${winKind === 'discard' ? 'bg-black text-white dark:bg-white dark:text-black' : ''}`}>Off a discard</button>
              </div>
              {winKind === 'discard' && winner && (
                <>
                  <span className="text-sm">Who discarded?</span>
                  <SeatButtons value={discarder} exclude={winner} onPick={setDiscarder} />
                </>
              )}
              <span className="text-sm">How many tai? (min {rules.minTai}, cap {rules.taiCap})</span>
              <div className="flex flex-wrap gap-2">
                {Array.from({ length: rules.taiCap - rules.minTai + 1 }, (_, i) => rules.minTai + i).map((t) => (
                  <button key={t} onClick={() => setTai(t)}
                    className={`rounded border px-3 py-2 ${tai === t ? 'bg-black text-white dark:bg-white dark:text-black' : ''}`}>{t}</button>
                ))}
              </div>
              <span className="text-sm">Anything special?</span>
              <select value={notable ?? ''} onChange={(e) => setNotable(e.target.value || null)} className="rounded border px-2 py-2">
                <option value="">Nothing special</option>
                {notableHands.map((h) => (
                  <option key={h.id} value={h.id}>{h.name}{h.local_name ? ` (${h.local_name})` : ''}</option>
                ))}
              </select>
            </>
          )}
        </section>

        {winReady && (
          <section className="flex flex-col gap-2">
            <h3 className="font-semibold">3 · Preview</h3>
            {previewError && <p className="text-red-600">{previewError}</p>}
            {preview && (
              <ul className="rounded border p-3">
                {SEATS.map((s) => (
                  <li key={s} className="flex justify-between py-0.5">
                    <span>{name(s)}</span>
                    <span className={preview![s] > 0 ? 'text-green-600' : preview![s] < 0 ? 'text-red-600' : 'opacity-50'}>
                      {preview![s] > 0 ? '+' : ''}{preview![s]}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {outcome === 'washout' && events.length === 0 && (
              <p className="text-sm opacity-70">Washed out, no bonuses — records an empty hand.</p>
            )}
            <button
              disabled={!preview && events.length > 0}
              onClick={async () => {
                setError(undefined);
                try { await onSubmit(events); } catch (e) { setError(e instanceof Error ? e.message : 'failed'); }
              }}
              className="rounded-lg border px-6 py-3 font-medium disabled:opacity-40">Confirm</button>
            {error && <p className="text-red-600">{error}</p>}
          </section>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck** — `npx tsc --noEmit` → clean (wizard is exercised end-to-end in Task 13)
- [ ] **Step 4: Commit** — `git commit -am "feat: record-hand server action + wizard with engine preview"`

---

### Task 13: Live game screen — totals, realtime, void, bust banner

**Files:**
- Create (replacing the Task 11 stub): `src/app/game/[id]/GameLive.tsx`
- Modify: `src/lib/actions/game.ts` (add `voidHand`)
- Modify: `src/app/game/[id]/page.tsx` (pass notable hands list)

**Interfaces:**
- Consumes: `recordHand` (Task 12), `void_hand` RPC, realtime channels, `RecordHandWizard`
- Produces:
  - `voidHand(handId: string, gameId: string): Promise<{ error?: string }>`
  - `GameLive({ gameId, status, rules, players, me, notableHands })` — add `notableHands` to the Task 11 shell's props and query: `const { data: notableHands } = await supabase.from('notable_hands').select('id, name, local_name').order('name');` passed as `notableHands={notableHands ?? []}`

- [ ] **Step 1: Add `voidHand`** to `src/lib/actions/game.ts`

```ts
export async function voidHand(handId: string, gameId: string): Promise<{ error?: string }> {
  try {
    const user = await requireUser();
    const { admin } = await requireParticipant(gameId, user.id);
    const { error } = await admin.rpc('void_hand', { p_hand_id: handId, p_by: user.id });
    if (error) return { error: error.message };
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'failed to void' };
  }
}
```

- [ ] **Step 2: Implement `GameLive.tsx`**

```tsx
'use client';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '../../../lib/supabase/client';
import { SEATS, type RulesConfig, type ScoringEvent, type Seat } from '../../../lib/engine/types';
import { recordHand, voidHand } from '../../../lib/actions/game';
import { RecordHandWizard } from './RecordHandWizard';
import { EndGamePanel } from './EndGamePanel';

type P = { playerId: string; seat: Seat; name: string };
type NH = { id: string; name: string; local_name: string | null };
type HandRow = { id: string; seq: number; voided: boolean };

export function GameLive({ gameId, status, rules, players, me, notableHands }: {
  gameId: string; status: 'active' | 'ended' | 'quarantined';
  rules: RulesConfig; players: P[]; me: string; notableHands: NH[];
}) {
  const router = useRouter();
  const [totals, setTotals] = useState<Record<Seat, number>>({ E: 0, S: 0, W: 0, N: 0 });
  const [hands, setHands] = useState<HandRow[]>([]);
  const [wizardOpen, setWizardOpen] = useState(false);
  const supabase = createClient();

  const reload = useCallback(async () => {
    const [{ data: movements }, { data: handRows }] = await Promise.all([
      supabase.from('point_movements').select('seat, points').eq('game_id', gameId),
      supabase.from('hands').select('id, seq, voided').eq('game_id', gameId).order('seq'),
    ]);
    const t: Record<Seat, number> = { E: 0, S: 0, W: 0, N: 0 };
    for (const m of movements ?? []) t[m.seat as Seat] += m.points;
    setTotals(t);
    setHands(handRows ?? []);
  }, [gameId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    reload();
    const ch = supabase
      .channel(`game-${gameId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'hands', filter: `game_id=eq.${gameId}` }, reload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'point_movements', filter: `game_id=eq.${gameId}` }, reload)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'games', filter: `id=eq.${gameId}` },
        () => router.refresh())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [gameId, reload, router]); // eslint-disable-line react-hooks/exhaustive-deps

  const display = (s: Seat) => rules.startingDisplayTotal + totals[s];
  const busted = SEATS.filter((s) => display(s) <= rules.bustLine);
  const name = (s: Seat) => players.find((p) => p.seat === s)?.name ?? s;

  return (
    <main className="mx-auto flex max-w-md flex-col gap-4 p-6">
      <h1 className="text-xl font-bold">
        {status === 'active' ? 'Game on' : status === 'ended' ? 'Game over' : 'Game quarantined'}
      </h1>
      {status === 'quarantined' && (
        <p className="rounded border border-amber-500 p-3 text-sm">
          This game has a scoring discrepancy and is being looked at. It does not count toward the leaderboard yet.
        </p>
      )}
      <ul className="rounded-lg border p-4">
        {SEATS.map((s) => (
          <li key={s} className="flex justify-between py-1">
            <span>{name(s)}{players.find((p) => p.seat === s)?.playerId === me ? ' (you)' : ''}</span>
            <span className={`font-mono ${display(s) < rules.startingDisplayTotal ? 'text-red-600' : ''}`}>{display(s)}</span>
          </li>
        ))}
      </ul>
      {busted.length > 0 && status === 'active' && (
        <p className="rounded border border-red-600 p-3 text-sm">
          {busted.map(name).join(', ')} has hit the bust line ({rules.bustLine}). Consider ending the game.
        </p>
      )}
      {status === 'active' && (
        <button onClick={() => setWizardOpen(true)} className="rounded-lg border px-6 py-3 font-medium">Record hand</button>
      )}
      <section>
        <h2 className="mb-1 font-semibold">Hands</h2>
        <ul className="flex flex-col gap-1">
          {hands.filter((h) => !h.voided).map((h) => (
            <li key={h.id} className="flex justify-between rounded border px-3 py-2 text-sm">
              <span>Hand {h.seq}</span>
              {status === 'active' && (
                <button className="text-red-600" onClick={async () => {
                  if (confirm(`Void hand ${h.seq}? Its points will be reversed.`)) await voidHand(h.id, gameId);
                }}>void</button>
              )}
            </li>
          ))}
        </ul>
      </section>
      {status !== 'quarantined' && <EndGamePanel gameId={gameId} status={status} players={players} display={display} />}
      {wizardOpen && (
        <RecordHandWizard players={players} rules={rules} notableHands={notableHands}
          onClose={() => setWizardOpen(false)}
          onSubmit={async (events: ScoringEvent[]) => {
            const res = await recordHand(gameId, events);
            if (res.error) throw new Error(res.error);
            setWizardOpen(false);
          }} />
      )}
    </main>
  );
}
```

(Until Task 14 exists, stub `EndGamePanel.tsx` as a component rendering `null` with the exact props above — replaced in Task 14.)

- [ ] **Step 3: Verify manually, two browsers** — record a 4-tai discard win in browser A → totals update in browser B within ~a second without refresh; preview matched the committed movements; void the hand → totals return to start in both; `hands.voided` true, movements doubled (originals + reversal) in the dashboard; recorded rows survive a full page reload.
- [ ] **Step 4: Typecheck + tests + commit** — `npx tsc --noEmit && npm test`, then `git add -A && git commit -m "feat: live game screen — realtime totals, void, bust banner"`

---

### Task 14: End game, quarantine, Telegram alert, reopen

**Files:**
- Create: `src/lib/telegram.ts`, `src/app/game/[id]/EndGamePanel.tsx` (replacing stub)
- Modify: `src/lib/actions/game.ts` (add `endGame`, `reopenGame`)

**Interfaces:**
- Consumes: `end_game` / `reopen_game` RPCs, `sendAlert`
- Produces:
  - `sendAlert(text: string): Promise<void>` — no-throw; no-op when env vars absent
  - `endGame(gameId: string): Promise<{ error?: string; result?: 'ended'|'quarantined' }>`
  - `reopenGame(gameId: string): Promise<{ error?: string }>`
  - `EndGamePanel({ gameId, status, players, display })`

- [ ] **Step 1: Telegram** — `src/lib/telegram.ts`

```ts
/** Fire-and-forget alert to Bryan's private bot chat. Alert failure must never break game flow. */
export async function sendAlert(text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return; // alerting not configured — silently disabled
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
  } catch (e) {
    console.error('telegram alert failed:', e);
  }
}
```

- [ ] **Step 2: Actions** — append to `src/lib/actions/game.ts`

```ts
import { sendAlert } from '../telegram';

export async function endGame(gameId: string): Promise<{ error?: string; result?: 'ended' | 'quarantined' }> {
  try {
    const user = await requireUser();
    const { admin } = await requireParticipant(gameId, user.id);
    const { data, error } = await admin.rpc('end_game', { p_game_id: gameId });
    if (error) return { error: error.message };
    const result = data as 'ended' | 'quarantined';

    if (result === 'quarantined') {
      // Should-never-happen path (spec §10): quarantine + alert with full context
      const [{ data: game }, { data: gps }, { data: sum }] = await Promise.all([
        admin.from('games').select('table_id, started_at, tables(label, code)').eq('id', gameId).single(),
        admin.from('game_players').select('players(display_name, email)').eq('game_id', gameId),
        admin.from('point_movements').select('points').eq('game_id', gameId),
      ]);
      const total = (sum ?? []).reduce((a, r) => a + r.points, 0);
      const t = game?.tables as { label: string | null; code: string } | { label: string | null; code: string }[] | null;
      const tbl = Array.isArray(t) ? t[0] : t;
      const who = (gps ?? [])
        .map((g) => { const p = Array.isArray(g.players) ? g.players[0] : g.players; return p ? `${p.display_name} <${p.email}>` : '?'; })
        .join('\n');
      await sendAlert(
        `⚠️ RVMJ ZERO-SUM FAILURE\n` +
        `Table: ${tbl?.label ?? tbl?.code ?? game?.table_id}\n` +
        `Started: ${game?.started_at}\nDiscrepancy: ${total} points\n` +
        `Players:\n${who}\n` +
        `${process.env.NEXT_PUBLIC_SITE_URL}/game/${gameId}`,
      );
    }
    return { result };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'failed to end game' };
  }
}

export async function reopenGame(gameId: string): Promise<{ error?: string }> {
  try {
    const user = await requireUser();
    const { admin } = await requireParticipant(gameId, user.id);
    const { error } = await admin.rpc('reopen_game', { p_game_id: gameId });
    if (error) return { error: error.message };
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'failed to reopen' };
  }
}
```

- [ ] **Step 3: Panel** — `src/app/game/[id]/EndGamePanel.tsx`

```tsx
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Seat } from '../../../lib/engine/types';
import { endGame, reopenGame } from '../../../lib/actions/game';

type P = { playerId: string; seat: Seat; name: string };

export function EndGamePanel({ gameId, status, players, display }: {
  gameId: string; status: 'active' | 'ended'; players: P[]; display: (s: Seat) => number;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string>();

  if (status === 'ended') {
    return (
      <button className="rounded border px-4 py-2 text-sm"
        onClick={async () => {
          const res = await reopenGame(gameId);
          if (res.error) setError(res.error); else router.refresh();
        }}>
        Reopen (within 1 hour of ending){error && ` — ${error}`}
      </button>
    );
  }

  return confirming ? (
    <div className="flex flex-col gap-2 rounded-lg border border-red-600 p-4">
      <p className="font-semibold">End the game with these totals?</p>
      <ul>
        {players.map((p) => (
          <li key={p.seat} className="flex justify-between py-0.5">
            <span>{p.name}</span><span className="font-mono">{display(p.seat)}</span>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <button className="rounded border px-4 py-2"
          onClick={async () => {
            const res = await endGame(gameId);
            if (res.error) setError(res.error); else router.refresh();
          }}>End game</button>
        <button className="rounded border px-4 py-2 opacity-60" onClick={() => setConfirming(false)}>Keep playing</button>
      </div>
      {error && <p className="text-red-600">{error}</p>}
    </div>
  ) : (
    <button onClick={() => setConfirming(true)} className="rounded border px-4 py-2 text-sm opacity-70">End game…</button>
  );
}
```

- [ ] **Step 4 (BRYAN): create the Telegram bot** — BotFather → `/newbot` → copy token into `.env.local` as `TELEGRAM_BOT_TOKEN`. Message the bot once, then `curl "https://api.telegram.org/bot<TOKEN>/getUpdates"` → `chat.id` → `TELEGRAM_CHAT_ID`.
- [ ] **Step 5: Verify manually** — end a dev game normally → `final_total`s written, status `ended`, boards-facing data intact, Reopen appears and works within the hour. Then force a quarantine: SQL-insert a lone unbalanced movement with the trigger disabled via a direct `set constraints all immediate`-free session (or temporarily `alter table point_movements disable trigger event_zero_sum`, insert `+1`, re-enable) → `endGame` → status `quarantined`, Telegram message arrives with players + link, banner shows. Clean up the test row and the game.
- [ ] **Step 6: Typecheck + commit** — `npx tsc --noEmit && git add -A && git commit -m "feat: end game, quarantine + telegram alert, one-hour reopen"`

---

### Task 15: Leaderboards home page

**Files:**
- Modify: `src/app/page.tsx` (replace scaffold home)

**Interfaces:**
- Consumes: `lifetime_board`, `form_board`, `skill_board` views (Task 8)
- Produces: `/` with three tabs via `?board=lifetime|form|skill` (default lifetime)

- [ ] **Step 1: Implement** — `src/app/page.tsx`

```tsx
import Link from 'next/link';
import { createServerSupabase } from '../lib/supabase/server';

export const dynamic = 'force-dynamic';

const BOARDS = {
  lifetime: { title: 'Lifetime', view: 'lifetime_board', order: 'total_points' },
  form: { title: 'Form', view: 'form_board', order: 'avg_points_per_hand' },
  skill: { title: 'Skill', view: 'skill_board', order: 'total_tai' },
} as const;
type BoardKey = keyof typeof BOARDS;

export default async function Home({ searchParams }: { searchParams: Promise<{ board?: string }> }) {
  const { board: raw } = await searchParams;
  const board: BoardKey = raw === 'form' || raw === 'skill' ? raw : 'lifetime';
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: rows } = user
    ? await supabase.from(BOARDS[board].view).select('*').order(BOARDS[board].order, { ascending: false }).limit(50)
    : { data: null };

  return (
    <main className="mx-auto flex max-w-md flex-col gap-4 p-6">
      <h1 className="text-2xl font-bold">RVMJ Leaderboard</h1>
      {!user ? (
        <p>
          <Link className="underline" href="/login">Sign in</Link> to see the boards. To play, tap your seat at the table.
        </p>
      ) : (
        <>
          <nav className="flex gap-2">
            {(Object.keys(BOARDS) as BoardKey[]).map((k) => (
              <Link key={k} href={`/?board=${k}`}
                className={`rounded border px-3 py-1 ${k === board ? 'bg-black text-white dark:bg-white dark:text-black' : ''}`}>
                {BOARDS[k].title}
              </Link>
            ))}
          </nav>
          <table className="w-full text-sm">
            <tbody>
              {(rows ?? []).map((r: Record<string, unknown>, i: number) => (
                <tr key={String(r.id)} className="border-b">
                  <td className="py-2 pr-2 opacity-50">{i + 1}</td>
                  <td className="py-2">{String(r.display_name)}</td>
                  <td className="py-2 text-right font-mono">
                    {board === 'lifetime' && `${r.total_points} pts · ${r.hands_played} hands`}
                    {board === 'form' && `${r.avg_points_per_hand} / hand`}
                    {board === 'skill' && `${r.total_tai} tai · ${r.notable_wins} notable`}
                  </td>
                </tr>
              ))}
              {(rows ?? []).length === 0 && (
                <tr><td className="py-4 opacity-60">
                  {board === 'form' ? 'Nobody has 100 hands yet.' : 'No finished games yet.'}
                </td></tr>
              )}
            </tbody>
          </table>
        </>
      )}
    </main>
  );
}
```

- [ ] **Step 2: Verify manually** — after ending at least one dev game: lifetime shows totals matching the game's final tallies; form empty (under 100 hands) with the explanatory line; skill counts tai + notables from win events only.
- [ ] **Step 3: Typecheck + commit** — `npx tsc --noEmit && git add -A && git commit -m "feat: three leaderboards on the home page"`

---

### Task 16: Presets — pick at forming, save from a game

**Files:**
- Create: `src/lib/actions/presets.ts`
- Modify: `src/app/game/[id]/FormingScreen.tsx` (preset picker), `src/app/game/[id]/page.tsx` (fetch presets), `src/app/game/[id]/GameLive.tsx` (save-these-rules button)

**Interfaces:**
- Consumes: `presets` table, `RulesConfig`
- Produces:
  - `savePreset(name: string, rules: RulesConfig): Promise<{ error?: string }>`
  - FormingScreen gains prop `presets: { id: string; name: string; rules: RulesConfig }[]` (the current user's, fetched in page.tsx via `supabase.from('presets').select('id, name, rules').order('created_at')` — RLS scopes to own)
  - GameLive gains a "Save these rules as a preset" button (prompt for name → `savePreset`)

- [ ] **Step 1: Action** — `src/lib/actions/presets.ts`

```ts
'use server';
import { createServerSupabase } from '../supabase/server';
import { createAdminClient } from '../supabase/admin';
import type { RulesConfig } from '../engine/types';

export async function savePreset(name: string, rules: RulesConfig): Promise<{ error?: string }> {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'not signed in' };
  if (!name.trim()) return { error: 'preset needs a name' };
  const admin = createAdminClient();
  const { error } = await admin.from('presets').insert({ owner: user.id, name: name.trim(), rules });
  return error ? { error: error.message } : {};
}
```

- [ ] **Step 2: Preset picker in FormingScreen** — above `<RulesForm>`, large buttons per spec §8.1 ("short list of large buttons, not a dropdown"):

```tsx
{presets.length > 0 && (
  <div className="flex flex-col gap-2">
    <h2 className="font-semibold">Your presets</h2>
    {presets.map((p) => (
      <button key={p.id} onClick={() => setRules(p.rules)}
        className="rounded-lg border px-4 py-3 text-left">
        <span className="font-medium">{p.name}</span>
        <span className="block text-sm opacity-60">
          {p.rules.shooter ? 'Shooter' : 'Normal'} · min {p.rules.minTai} · cap {p.rules.taiCap}
        </span>
      </button>
    ))}
  </div>
)}
```

(Add `presets` to the component props; tweaking a loaded preset in the RulesForm below affects only this game — the snapshot, not the saved preset.)

- [ ] **Step 3: Save-from-game in GameLive** — under the totals list:

```tsx
<button className="rounded border px-4 py-2 text-sm opacity-70"
  onClick={async () => {
    const nm = prompt('Preset name?');
    if (nm) { const r = await savePreset(nm, rules); if (r.error) alert(r.error); else alert('Saved.'); }
  }}>
  Save these rules as a preset
</button>
```

- [ ] **Step 4: Verify manually** — save a preset mid-game; start a new forming game → it appears as a button; tapping it fills the form; starting snapshots the (possibly tweaked) values onto `games.rules` while the preset row is unchanged.
- [ ] **Step 5: Typecheck + tests + commit** — `git commit -am "feat: rule presets — pick at forming, save from a live game"`

---

### Task 17: Deploy to Vercel + production smoke test

**Files:**
- None new (configuration + verification)

**Interfaces:**
- Consumes: everything
- Produces: the live app; burned production tags become possible

- [ ] **Step 1 (BRYAN gates): Vercel project**
  - `npx vercel link` (or import the repo in the Vercel dashboard — repo will need a GitHub remote first: `gh repo create` per Bryan's call on public/private).
  - Set env vars in Vercel (Production): all six from `.env.example`, with `NEXT_PUBLIC_SITE_URL` = the real domain.
- [ ] **Step 2 (BRYAN): OAuth for production**
  - Google Cloud Console → OAuth client → add the production domain to authorized origins (the redirect URI stays the `*.supabase.co` callback).
  - Supabase → Authentication → URL Configuration → set Site URL to the production domain and add `https://<domain>/auth/callback` to Redirect URLs.
- [ ] **Step 3: Deploy** — `npx vercel --prod` (or git push if repo-connected). Build must pass with zero type errors.
- [ ] **Step 4: Production smoke test (phones, real Google accounts)**
  - `/t/<dev secret>` on a phone → login once → forming → 4 accounts in → start → record a win → all phones update live → void it → record again → end game → leaderboard shows the result.
  - Kill the browser mid-game and re-tap → rejoin with state intact.
- [ ] **Step 5 (BRYAN): burn the real tags** — create the real table row + 4 secrets (spec §7 provisioning), write `https://<domain>/t/<secret>` to each NTAG213 with NFC Tools, stick them on the table.
- [ ] **Step 6: Commit any config touch-ups** — `git commit -am "chore: production deploy config"`

---

## Self-Review (completed at plan time)

**Spec coverage check:**
- §4 architecture/stack → Tasks 1, 7, 9, 17. §5 data model → Task 8 (all nine entities; `table_seats` carries the tag secrets). §6 rules engine → Tasks 2–5 (every table row is a test case; §6.6 display/bust → Task 13). §7 NFC gate → Task 10 (secret validation; verification isolated in the tap route; provisioning manual per spec). §8 flows → Tasks 10–14, 16 (forming/start 11, record 12, live+void 13, end/reopen 14, presets 16, session persistence 9). §9 boards → Tasks 8 (views) + 15 (UI). §10 error handling → trigger (8), quarantine+alert (14), lazy expiry (6/10), copy for rejections (10). §11 testing → worked examples (3, 4), property law (5), join races (6). §12/§13 open items and decisions → no tasks needed (foreign flower pairs stays KIV).
- Known deliberate gaps, matching the spec's non-goals: no guests, no dealer tracking, no liability, no in-place edit, no admin UI, no nightly re-verify job (spec marks it optional — add later as a Vercel cron if wanted).
- "X is recording" presence indicator (spec §10 edge case): NOT in v1 tasks — duplicate hands remain visible/voidable on four screens, which the spec names as the actual safety net. Deferred consciously; revisit if simultaneous recording happens in practice.

**Placeholder scan:** no TBDs; every code step has real code. Task 8's Step 3 verification is explicitly deferred to Task 9 Step 8 (needs a real player row) — that's sequencing, not a placeholder.

**Type consistency check:** `RulesConfig` fields match spec §6.1 + §6.6 (camelCase in TS and inside `games.rules` jsonb — the skill_board view reads `rules->>'taiCap'` accordingly). `GameLive` props match between the Task 11 shell and Task 13 implementation (`notableHands` added in 13's page.tsx modification). `EndGamePanel` props match between the Task 13 stub note and Task 14. `record_hand` payload shape matches between Task 8 (SQL) and Task 12 (action). `decideJoin`'s `JoinDecision` variants are exhaustively handled in Task 10's switch.
