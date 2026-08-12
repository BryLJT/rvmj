# RVMJ Mahjong Leaderboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **REVISED 2026-08-08 for the chip-first build order (Bryan's call).** Chip mode is the default and ships first as a complete deployed app — the **CHIP-ONLY MILESTONE** after Task 17 — with app mode (per-hand recording) built second, additively, on the live product. Tasks 1–6 predate the revision and are complete on `feat/v1`; Task 7 amends their outputs (three-way shooter, chip-set defaults). Old Tasks 7–17 are replaced by Tasks 7–23 below; the SDD ledger maps old→new numbering.

> **⚠️ SUPERSEDED 2026-08-13 — abandoned games are CONFIRMED, not auto-cleared (Bryan's call, made against the running app).** Wherever this plan says a stale ACTIVE game is silently auto-ended and replaced (`end_stale_and_create`, Task 11 §596/667/696, Task 12 §1624, Task 18 Step 2 §2833), **that is no longer the shipped behaviour.** Those task bodies are kept as the historical record of what was built at the time; the current design is spec §8.1 and §10, and the shipped code is `feat/v1` @ `9a50c7a`. In brief: a stale FORMING game still clears silently (nothing recorded, nothing to lose); a stale ACTIVE game is a match that was played, so the tapper is shown what is lost and chooses — view it, resume it (participants only, which writes `last_activity_at`), or void it behind a two-step confirmation. The decision is renamed `end_stale_and_create` → **`confirm_end_stale { staleGameId }`**. Also from the same pass: the create-race loser is now seated into the winner's game instead of getting an error page. **Tasks 19–23 must be read against the spec, not against these superseded snippets.**

**Goal:** Build the RVMJ mahjong leaderboard web app per `docs/superpowers/specs/2026-08-04-mahjong-leaderboard-design.md` (revised 2026-08-07/08, and 2026-08-13 for §8.1/§10 abandoned-match handling): NFC tap → seat assignment → **chip-mode games as the default spine** (physical settlement; end-of-game per-denomination counts with two-level conservation checking) plus app-mode per-hand scoring with the server-side rules engine → lifetime/form/skill leaderboards.

**Architecture:** Next.js (App Router, TypeScript) on Vercel; Supabase for Postgres, Google auth, and realtime. The rules engine is a pure TypeScript module (`src/lib/engine/`) with zero I/O; the chip module (`src/lib/chips.ts`) is equally pure. Two per-game modes converge on one output: four `final_total`s summing to zero, and the boards read that field mode-blind. All writes go through Postgres RPCs (single-transaction). **Two migrations:** 0001 is the chip spine (deployed at the milestone); 0002 adds app mode (hands/events/movements + the deferred zero-sum trigger) additively on the live DB.

**Tech Stack:** Next.js 15+, TypeScript (strict), @supabase/ssr + @supabase/supabase-js, Tailwind CSS, Vitest + fast-check (+ jsdom/@testing-library from Task 13), Supabase CLI for migrations.

## Global Constraints

- All point values are **integers**. No floats anywhere in scoring.
- Seat type is exactly `'E' | 'S' | 'W' | 'N'` everywhere (DB check constraints included).
- The engine (`src/lib/engine/`) imports nothing outside its own directory. No I/O, no Date, no random. Same for `src/lib/chips.ts`.
- Every scoring event's movements must sum to zero: asserted in the engine AND (from migration 0002) enforced by a deferred DB constraint trigger. Chip-mode integrity is per-denomination conservation, enforced in the finalize RPC + row-level CHECK constraints.
- **The standard chip set is ONE config object** (`STANDARD_CHIP_SET`, Task 8): $1/$10/$50/$100 worth 1/10/50/100 points, qty 10/9/4/1 per player, stack 400; table totals 40/36/16/4 = 1600. Every derived value (400, 1600, per-denomination totals) is computed from it — never hard-coded a second time, in TS or SQL comments.
- **Chip-mode conservation failure is user-facing**: a recount prompt naming the failing denomination(s). Never quarantine, never an error page (spec §10). Quarantine is app-mode-only and structurally unreachable for chip games (`end_game` asserts `mode='app'`).
- `games.mode` is snapshotted at start like rules. Rules are snapshotted onto `games.rules` (jsonb, app mode only); the engine only ever reads rules from the game record, never from presets.
- Movement rows are written for **all four seats** on every event, zeros included (app mode).
- Clients never write tables directly: RLS allows `select` to authenticated users only; all writes go through server actions using the service-role client, calling RPCs.
- Secrets (`SUPABASE_SERVICE_ROLE_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`) live in env vars only. Never committed. `.env*` is already gitignored.
- Voiding never deletes: it inserts a `reversal` event with negated movements and sets `hands.voided = true`.
- Defaults (Bryan's table, revised 2026-08-07): taiToPoints `[0,1,2,4,8,16]`, minTai 1, taiCap 5, shooter `'off'` (three-way `'off' | 'half' | 'full'`), start display 400, bust line −1200.
- **KIV guards — the plan must NOT assume answers Bryan hasn't got yet:** no rebuy affordance anywhere (failed conservation = miscount, recount); HALF × exposed-kong funding = everyone pays (a FLAGGED ASSUMPTION with a dedicated test, Task 7); foreign flower pairs untouched.
- **Guard-must-fail rule (SDD ledger, global):** every invariant-guard assertion must be shown to FAIL against guard-removed code before it counts as coverage.
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
│   ├── config.toml                          (from `supabase init`, Task 9)
│   └── migrations/
│       ├── 0001_chip_spine.sql              — Task 10: players/tables/seats/games(mode)/game_players(chip cols)/
│       │                                      notable_hands + notable_claims, chip RPCs, boards v1, RLS, realtime, seeds
│       └── 0002_app_mode.sql                — Task 18: hands/scoring_events/point_movements, zero-sum trigger,
│                                              presets, app RPCs, form_board + skill_board v2
├── src/
│   ├── lib/
│   │   ├── engine/                          — PURE. No imports from outside. (Tasks 2–5; REVISED by Task 7)
│   │   │   ├── types.ts                     — Seat, RulesConfig (shooter: ShooterMode), events, Movements
│   │   │   ├── defaults.ts                  — DEFAULT_RULES (400 / −1200 / 'off')
│   │   │   ├── scale.ts                     — taiToBase()
│   │   │   ├── win.ts                       — settleWin() (three-way shooter)
│   │   │   ├── bonus.ts                     — settleBonus() (HALF=OFF for kong funding — flagged assumption)
│   │   │   ├── validate.ts                  — validateRulesConfig() (Task 19)
│   │   │   └── engine.ts                    — settleEvent(), assertZeroSum()
│   │   ├── chips.ts                         — Task 8: STANDARD_CHIP_SET, checkConservation, deriveFinalTotals (PURE)
│   │   ├── join.ts                          — decideJoin() (pure; Task 6, UNCHANGED by the revision)
│   │   ├── supabase/
│   │   │   ├── client.ts                    — browser client
│   │   │   ├── server.ts                    — cookie-bound server client
│   │   │   └── admin.ts                     — service-role client (server only)
│   │   ├── telegram.ts                      — sendAlert() (Task 15)
│   │   └── actions/
│   │       ├── game.ts                      — startGame + chip actions (13/14/15); app actions appended (20/21/22)
│   │       └── presets.ts                   — savePreset (Task 19)
│   ├── app/
│   │   ├── layout.tsx, globals.css
│   │   ├── page.tsx                         — leaderboards (3 tabs; Task 16, form tab live in Task 23)
│   │   ├── chips/page.tsx                   — the standard chip set rule page (Task 13)
│   │   ├── login/page.tsx                   — Google sign-in
│   │   ├── auth/callback/route.ts           — OAuth code exchange
│   │   ├── t/[secret]/page.tsx              — tap landing: validate + join (Task 12, mode-aware stale handling)
│   │   └── game/[id]/
│   │       ├── page.tsx                     — server shell: forming | chip live | app live | expired
│   │       ├── FormingScreen.tsx            — roster + MODE PICKER, chips preselected (13; App enabled in 19)
│   │       ├── ChipLive.tsx                 — quiet chip screen: notable log, end, results, reopen (Task 14)
│   │       ├── NotableLogger.tsx            — log a notable claim (Task 14)
│   │       ├── ChipEndFlow.tsx              — per-denom entry, conservation recount loop, confirms (Task 15)
│   │       ├── GameLive.tsx                 — app-mode live screen (Task 21)
│   │       ├── RecordHandWizard.tsx         — bonus → outcome → preview → confirm (Task 20)
│   │       └── EndGamePanel.tsx             — app-mode end + quarantine banner (Task 22)
│   └── components/
│       ├── ChipSetCard.tsx                  — §6.7 table from chips.ts (Task 13; also the /chips page body)
│       └── RulesForm.tsx                    — app-mode rules editor, three-way shooter control (Task 19)
└── tests/
    ├── engine/{scale,win,bonus,engine}.test.ts   (revised in Task 7)
    ├── chips.test.ts                        (Task 8)
    ├── join.test.ts
    └── components/                          (jsdom + @testing-library, set up in Task 13)
        ├── ChipSetCard.test.tsx             (Task 13 — proves the jsdom setup)
        └── ChipEndFlow.test.tsx             (Task 15 — the recount loop)
```

---

## ✅ Tasks 1–6: COMPLETE (pre-revision)

Done on `feat/v1`, commits `cd8c679..1787872`, 54/54 tests green, review-clean. Their text below is **frozen as history** — it describes what was built, in the pre-revision shape. **Task 7 amends their outputs** (shooter widens to three-way; defaults move to 400/−1200): read Task 7 before treating any code block in Tasks 2–5 as current. One shipped delta vs the text below: `decideJoin`'s reject reasons already include `'table_full'` (added in commit `1787872` under Task 5's authorized-extension review).

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

> **⚠️ SUPERSEDED 2026-08-13 (behaviour, not structure).** `end_stale_and_create { endGameId }` no longer exists. A stale ACTIVE game now returns **`confirm_end_stale { staleGameId }`**, and clearing it requires the tapper's explicit confirmation — see spec §8.1. Stale FORMING behaviour (`expire_and_create`) is unchanged. The snippets below are the historical record; shipped truth is `src/lib/join.ts` @ `9a50c7a`, which also adds shared `OPEN_GAME_SELECT` and `toSnapshot()`.

**Files:**
- Create: `src/lib/join.ts`
- Test: `tests/join.test.ts`

**Interfaces:**
- Consumes: `Seat` from engine types
- Produces (used by the tap route in Task 12):
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

## Phase A — gate-free pure work (Tasks 7–8 run while Bryan does Task 9)

### Task 7: Engine revision — three-way shooter + chip-set defaults

**Files:**
- Modify: `src/lib/engine/types.ts`, `src/lib/engine/defaults.ts`, `src/lib/engine/win.ts`, `src/lib/engine/bonus.ts`
- Modify: `tests/engine/win.test.ts`, `tests/engine/bonus.test.ts`, `tests/engine/engine.test.ts`

**Interfaces:**
- Consumes: everything Tasks 2–5 produced
- Produces (every later engine consumer relies on these):
  - `type ShooterMode = 'off' | 'half' | 'full'` exported from `types.ts`
  - `RulesConfig.shooter: ShooterMode` (was `boolean` — a deliberate breaking change; the compiler finds every use site)
  - `DEFAULT_RULES = { taiToPoints: [0,1,2,4,8,16], minTai: 1, taiCap: 5, shooter: 'off', startingDisplayTotal: 400, bustLine: -1200 }`
  - `settleWin` / `settleBonus` / `settleEvent` signatures unchanged

**Why this task exists and why it is dangerous:** `'half'` is a truthy string. The boolean→union type change makes the old `if (rules.shooter)` a compile error, but a careless rewrite to `if (rules.shooter !== 'off')` compiles cleanly and silently treats HALF like FULL — which happens to be **wrong for wins** (winner take must drop to 2×) AND **wrong for exposed-kong funding** (HALF must behave like OFF: everyone pays). The tests below are constructed so that any implementation lumping HALF with FULL fails loudly.

- [ ] **Step 1: Write the failing tests**

In `tests/engine/win.test.ts`: migrate every `shooter: true` to `'full'` and `shooter: false` to `'off'` (most rows use `DEFAULT_RULES`, which becomes `'off'` via Step 3). Add:

```ts
const HALF = { ...DEFAULT_RULES, shooter: 'half' as const };
const FULL = { ...DEFAULT_RULES, shooter: 'full' as const };

it('discard, shooter HALF: discarder pays only their own 2×, others 0, winner takes 2× (spec §6.2 worked row)', () => {
  // 4 tai, base 8: discarder −16, others 0, winner +16 — NOT +32.
  expect(settleWin(win({}), HALF)).toEqual({ E: 16, S: -16, W: 0, N: 0 });
});
it('self-draw is identical under off, half, and full', () => {
  const expected = { E: 48, S: -16, W: -16, N: -16 };
  for (const shooter of ['off', 'half', 'full'] as const) {
    expect(settleWin(win({ winKind: 'self_draw', discarder: undefined }), { ...DEFAULT_RULES, shooter })).toEqual(expected);
  }
});
```

In `tests/engine/bonus.test.ts`: migrate the `SHOOTER` constant to `{ ...DEFAULT_RULES, shooter: 'full' as const }`. Add the trap-closing row:

```ts
it('exposed kong, shooter HALF behaves like OFF — everyone pays (⚠️ ASSUMPTION, spec §6.3: Bryan verifying with his group)', () => {
  // An implementation that treats HALF like FULL returns { E: 0, S: 0, W: 3, N: -3 } and FAILS here.
  expect(settleBonus(bonus({ kind: 'kong_exposed', discarder: 'N' }), { ...DEFAULT_RULES, shooter: 'half' as const }))
    .toEqual({ E: -1, S: -1, W: 3, N: -1 });
});
```

In `tests/engine/engine.test.ts`: widen the property arbitrary so the zero-sum law now covers HALF, and align the arbitrary's display defaults:

```ts
// in rulesArb:  shooter: fc.constantFrom<ShooterMode>('off', 'half', 'full'),
// and the mapped record gains  startingDisplayTotal: 400, bustLine: -1200,
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/engine` → type errors on every `shooter: boolean` fixture (that's the migration guide) and, once fixtures compile, the three new behaviour tests FAIL against the old two-way logic.

- [ ] **Step 3: Implement**

`src/lib/engine/types.ts` — add the mode type, change one field:

```ts
export type ShooterMode = 'off' | 'half' | 'full';
// in RulesConfig:
//   shooter: ShooterMode;
```

`src/lib/engine/defaults.ts`:

```ts
import type { RulesConfig } from './types';

/** Bryan's table, confirmed 2026-08-04; display defaults aligned to the standard chip set 2026-08-07 (spec §6.1/§6.7). */
export const DEFAULT_RULES: RulesConfig = {
  taiToPoints: [0, 1, 2, 4, 8, 16],
  minTai: 1,
  taiCap: 5,
  shooter: 'off',
  startingDisplayTotal: 400,  // = the physical starting stack
  bustLine: -1200,            // displayed; a fall of four stacks
};
```

`src/lib/engine/win.ts` — the discard branch becomes an explicit three-way switch (no truthiness anywhere):

```ts
  const d = event.discarder;
  if (!d || d === event.winner) throw new EngineError('discard win requires a discarder other than the winner');
  switch (rules.shooter) {
    case 'off':
      m[d] = -2 * base;
      for (const s of SEATS) if (s !== event.winner && s !== d) m[s] = -base;
      m[event.winner] = 4 * base;
      break;
    case 'full':
      m[d] = -4 * base;
      m[event.winner] = 4 * base;
      break;
    case 'half':
      // HALF protects the other two entirely, so the winner's take drops to 2×.
      // This DELIBERATELY breaks the "shooter never changes the winner's take" invariant
      // (spec §6.2, confirmed by Bryan 2026-08-07).
      m[d] = -2 * base;
      m[event.winner] = 2 * base;
      break;
  }
  return m;
```

`src/lib/engine/bonus.ts` — only FULL redirects kong funding:

```ts
    if (rules.shooter === 'full') {
      m[d] = -3 * amount;
    } else {
      // 'off' AND 'half': everyone pays.
      // ⚠️ ASSUMPTION (spec §6.3): Bryan described half-shooter for WINS only; kong funding
      // under HALF is assumed to behave like OFF. He is verifying with his group. If the
      // answer changes, this branch and its one test row are the only things to touch.
      for (const s of SEATS) if (s !== b) m[s] = -amount;
    }
```

- [ ] **Step 4: Run to verify pass** — `npx vitest run tests/engine` → all green (54 existing + new rows); `npx tsc --noEmit` clean; `grep -rn "shooter: \(true\|false\)" tests/ src/` → no hits.

- [ ] **Step 5: Guard-must-fail check (ledger global rule)** — temporarily edit `win.ts` so `case 'half'` falls through to the `'full'` behaviour → the HALF win test must FAIL. Revert. Temporarily edit `bonus.ts` to `if (rules.shooter !== 'off')` → the HALF kong test must FAIL. Revert. Both reversions verified by a final green run.

- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat(engine)!: three-way shooter (off/half/full) + chip-set display defaults (400/-1200)"`

---

### Task 8: The standard chip set + conservation checker (pure)

**Files:**
- Create: `src/lib/chips.ts`
- Test: `tests/chips.test.ts`

**Interfaces:**
- Consumes: `Seat` type from `src/lib/engine/types` (types only — the module stays pure: no I/O, no Date, no random)
- Produces (consumed by Tasks 13, 15; mirrored as literals in Task 10's SQL):
  - `const DENOMS = [1, 10, 50, 100] as const`; `type Denom`; `type ChipCounts = Record<Denom, number>`
  - `const PER_PLAYER: ChipCounts` — `{ 1: 10, 10: 9, 50: 4, 100: 1 }`, THE single source of truth (spec §6.7)
  - Derived, never hard-coded twice: `STACK_TOTAL` (400), `TABLE_QTY` (40/36/16/4), `TABLE_TOTAL` (1600)
  - `class ChipsError extends Error`
  - `function validateCounts(input: unknown): ChipCounts` — trust boundary: non-negative integers, all four keys
  - `function stackTotal(counts: ChipCounts): number`
  - `type ConservationResult = { ok: true } | { ok: false; failedDenominations: Denom[]; grandTotalOff: boolean }`
  - `function checkConservation(table: Record<Seat, ChipCounts>): ConservationResult`
  - `function deriveFinalTotals(table: Record<Seat, ChipCounts>): Record<Seat, number>` — counted − 400; throws `ChipsError` unless conservation holds

**KIV guard:** the API has NO rebuy affordance. A failed check is a miscount; the copy everywhere is "recount" (spec §3/§10).

- [ ] **Step 1: Write the failing test** — `tests/chips.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import {
  DENOMS, PER_PLAYER, STACK_TOTAL, TABLE_QTY, TABLE_TOTAL,
  stackTotal, checkConservation, deriveFinalTotals, validateCounts, ChipsError,
  type ChipCounts,
} from '../src/lib/chips';
import type { Seat } from '../src/lib/engine/types';

const startAll = (): Record<Seat, ChipCounts> =>
  ({ E: { ...PER_PLAYER }, S: { ...PER_PLAYER }, W: { ...PER_PLAYER }, N: { ...PER_PLAYER } });

describe('the standard chip set (spec §6.7)', () => {
  it('derived constants pin the spec numbers: stack 400, table 1600, per-denomination 40/36/16/4', () => {
    expect(STACK_TOTAL).toBe(400);
    expect(TABLE_TOTAL).toBe(1600);
    expect(TABLE_QTY).toEqual({ 1: 40, 10: 36, 50: 16, 100: 4 });
  });
  it('stackTotal: chip worth = printed number', () => {
    expect(stackTotal(PER_PLAYER)).toBe(400);
    expect(stackTotal({ 1: 3, 10: 0, 50: 1, 100: 2 })).toBe(253);
  });
});

describe('checkConservation', () => {
  it('accepts the untouched table', () => {
    expect(checkConservation(startAll())).toEqual({ ok: true });
  });
  it('accepts any redistribution that conserves every denomination', () => {
    const c = startAll();
    c.E = { ...c.E, 100: 2 }; c.S = { ...c.S, 100: 0 };   // S paid E one $100
    c.E = { ...c.E, 10: 4 };  c.S = { ...c.S, 10: 14 };   // E paid S five $10s
    expect(checkConservation(c)).toEqual({ ok: true });
  });
  it('THE must-reject case (spec §11): grand total balances but denominations are off — and it NAMES them', () => {
    const c = startAll();
    // E "traded" ten $1 chips for a phantom extra $10: stack still totals 400, table still 1600.
    c.E = { 1: 0, 10: 10, 50: 4, 100: 1 };
    expect(stackTotal(c.E)).toBe(400); // proves a totals-only checker would wave this through
    expect(checkConservation(c)).toEqual({ ok: false, failedDenominations: [1, 10], grandTotalOff: false });
  });
  it('plain miscount: denomination named AND grand total off', () => {
    const c = startAll();
    c.N = { ...c.N, 50: 3 };
    expect(checkConservation(c)).toEqual({ ok: false, failedDenominations: [50], grandTotalOff: true });
  });
});

describe('deriveFinalTotals', () => {
  it('counted − 400 per seat; zero-sum by construction on a conserving table', () => {
    const c = startAll();
    c.E = { ...c.E, 100: 2 }; c.S = { ...c.S, 100: 0 };
    const totals = deriveFinalTotals(c);
    expect(totals).toEqual({ E: 100, S: -100, W: 0, N: 0 });
    expect(Object.values(totals).reduce((a, b) => a + b, 0)).toBe(0);
  });
  it('refuses to derive from a non-conserving table', () => {
    const c = startAll();
    c.W = { ...c.W, 1: 9 };
    expect(() => deriveFinalTotals(c)).toThrow(ChipsError);
  });
});

describe('validateCounts (trust boundary)', () => {
  it('accepts non-negative integers with all four keys', () => {
    expect(validateCounts({ 1: 0, 10: 2, 50: 0, 100: 16 })).toEqual({ 1: 0, 10: 2, 50: 0, 100: 16 });
  });
  it.each([
    ['negative', { 1: -1, 10: 9, 50: 4, 100: 1 }],
    ['float', { 1: 1.5, 10: 9, 50: 4, 100: 1 }],
    ['missing key', { 1: 10, 10: 9, 50: 4 }],
    ['non-number', { 1: '10', 10: 9, 50: 4, 100: 1 }],
    ['null', null],
  ])('rejects %s', (_label, bad) => {
    expect(() => validateCounts(bad)).toThrow(ChipsError);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/chips.test.ts` → FAIL (module missing)

- [ ] **Step 3: Implement** — `src/lib/chips.ts`

```ts
import type { Seat } from './engine/types';

export class ChipsError extends Error {}

export const DENOMS = [1, 10, 50, 100] as const;
export type Denom = (typeof DENOMS)[number];
/** Counts per denomination, keyed by printed value: { 1: n, 10: n, 50: n, 100: n }. Chip worth = printed number (spec §6.7). */
export type ChipCounts = Record<Denom, number>;

/** THE single source of truth for the standard set (spec §6.7). Everything below is derived from it. */
export const PER_PLAYER: ChipCounts = { 1: 10, 10: 9, 50: 4, 100: 1 };

export const STACK_TOTAL = DENOMS.reduce((sum, d) => sum + d * PER_PLAYER[d], 0);                                  // 400
export const TABLE_QTY = Object.fromEntries(DENOMS.map((d) => [d, PER_PLAYER[d] * 4])) as ChipCounts;              // 40/36/16/4
export const TABLE_TOTAL = STACK_TOTAL * 4;                                                                        // 1600

/** Trust boundary: raw client input → validated counts. Non-negative integers, all four denominations present. */
export function validateCounts(input: unknown): ChipCounts {
  if (typeof input !== 'object' || input === null) throw new ChipsError('chip counts must be an object');
  const rec = input as Record<string, unknown>;
  const out = {} as ChipCounts;
  for (const d of DENOMS) {
    const v = rec[String(d)];
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0)
      throw new ChipsError(`count for the $${d} chip must be a non-negative whole number`);
    out[d] = v;
  }
  return out;
}

export function stackTotal(counts: ChipCounts): number {
  return DENOMS.reduce((sum, d) => sum + d * counts[d], 0);
}

export type ConservationResult =
  | { ok: true }
  | { ok: false; failedDenominations: Denom[]; grandTotalOff: boolean };

/**
 * Two-level conservation (spec §8.6): each denomination must conserve across the table
 * (40 × $1, 36 × $10, 16 × $50, 4 × $100). Per-denomination conservation implies the
 * 1600 grand total; grandTotalOff is reported separately so the UI can say which kind
 * of miscount happened. A failure is a MISCOUNT — the only remedy is a recount (rebuy: KIV).
 */
export function checkConservation(table: Record<Seat, ChipCounts>): ConservationResult {
  const seats = Object.values(table);
  const failed = DENOMS.filter((d) => seats.reduce((s, c) => s + c[d], 0) !== TABLE_QTY[d]);
  if (failed.length === 0) return { ok: true };
  const grand = seats.reduce((s, c) => s + stackTotal(c), 0);
  return { ok: false, failedDenominations: failed, grandTotalOff: grand !== TABLE_TOTAL };
}

/** Net result per seat: counted − 400. Only defined on a conserving table, so zero-sum holds by construction. */
export function deriveFinalTotals(table: Record<Seat, ChipCounts>): Record<Seat, number> {
  const check = checkConservation(table);
  if (!check.ok)
    throw new ChipsError(`conservation failed for: ${check.failedDenominations.map((d) => `$${d}`).join(', ')} — recount`);
  return Object.fromEntries(
    (Object.entries(table) as [Seat, ChipCounts][]).map(([seat, c]) => [seat, stackTotal(c) - STACK_TOTAL]),
  ) as Record<Seat, number>;
}
```

- [ ] **Step 4: Run to verify pass** — `npx vitest run tests/chips.test.ts` → PASS; full suite + `npx tsc --noEmit` clean.

- [ ] **Step 5: Guard-must-fail check** — temporarily rewrite `checkConservation` to compare only the grand total (`grand === TABLE_TOTAL ? ok : ...`) → the must-reject test FAILS (it would wave the balanced miscount through). Revert; green run.

- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat(chips): standard chip set + two-level conservation checker (pure)"`

---

## Phase B — the chip spine (Task 9 gates everything from 10 on)

### Task 9: Supabase project + CLI + env  **(BRYAN GATE A — manual, in browser; blocks Tasks 10–23)**

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

### Task 10: Migration 0001 — the chip spine: schema, chip RPCs, boards v1, RLS, seeds

**Files:**
- Create: `supabase/migrations/0001_chip_spine.sql`

**Interfaces:**
- Consumes: a linked Supabase project (Task 9). The chip numbers mirror `src/lib/chips.ts` (Task 8) — SQL cannot import TS, so the literals appear here WITH a source comment, and `tests/chips.test.ts` pins the derived values so drift is caught on the TS side.
- Produces (used by all later server actions):
  - Tables: `players`, `tables`, `table_seats`, `games` (with `mode`, `pending_counts`, `pending_confirmed`), `game_players` (with per-denomination chip columns + derivation CHECK), `notable_hands`, `notable_claims`
  - RPCs: `start_game(p_game_id, p_mode, p_rules default null)`, `create_game_with_seat(p_table_id, p_player_id, p_seat) returns uuid`, `propose_chip_counts(p_game_id, p_counts)`, `confirm_chip_result(p_game_id, p_player_id) returns text`, `expire_game(p_game_id)`, `reopen_game(p_game_id)`, `log_notable_claim(p_game_id, p_player_id, p_notable_hand_id, p_logged_by) returns uuid`
  - Views: `lifetime_board` (mode-blind, sums `game_players.final_total`), `skill_board` v1 (notable claims only; Task 18 replaces it)
  - `propose_chip_counts`' `p_counts` shape: `{ "E": {"1":n,"10":n,"50":n,"100":n}, "S": {...}, "W": {...}, "N": {...} }`

**Integrity design (spec §10, damage-map 15):** chip conservation is enforced in THREE layers, none of which is a cross-row trigger: (1) the server action pre-checks with the pure TS checker and renders failures as a user-facing recount prompt; (2) `propose_chip_counts` re-validates conservation in SQL and raises (backstop — should never fire); (3) the `game_players` row CHECK makes `final_total` = derivation-from-counts tamper-proof even against dashboard edits, and `confirm_chip_result` asserts the four totals sum to zero at finalize. All writes go through RPCs, so RPC-internal checks cover every write path; a deferred trigger over four rows would duplicate the same SQL while complicating reopen.

- [ ] **Step 1: Write `supabase/migrations/0001_chip_spine.sql`**

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

create table games (
  id uuid primary key default gen_random_uuid(),
  table_id uuid not null references tables(id),
  mode text not null default 'chips' check (mode in ('chips','app')),
  status text not null default 'forming'
    check (status in ('forming','active','ended','quarantined','expired')),
  rules jsonb,                                    -- app mode only; stays null for chip games
  pending_counts jsonb,                           -- chip mode: proposed per-seat counts awaiting confirmation
  pending_confirmed uuid[] not null default '{}', -- players who confirmed the pending counts
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
  -- chip mode only. Numbers mirror src/lib/chips.ts PER_PLAYER (the single source of truth).
  chip_1 int check (chip_1 >= 0),
  chip_10 int check (chip_10 >= 0),
  chip_50 int check (chip_50 >= 0),
  chip_100 int check (chip_100 >= 0),
  -- all-or-none: either no chip columns are set (forming / app mode) or all four are
  check (
    (chip_1 is null and chip_10 is null and chip_50 is null and chip_100 is null)
    or (chip_1 is not null and chip_10 is not null and chip_50 is not null and chip_100 is not null)
  ),
  -- tamper backstop: when counts exist, final_total MUST be their derivation (counted − 400),
  -- even against direct dashboard edits
  check (
    chip_1 is null
    or final_total = chip_1 + 10 * chip_10 + 50 * chip_50 + 100 * chip_100 - 400
  ),
  primary key (game_id, seat),
  unique (game_id, player_id)   -- ledger carry: backs one-account-one-seat
);

create table notable_hands (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  local_name text,
  rarity text not null check (rarity in ('uncommon','rare','legendary'))
);

-- Chip-mode glory log (spec §5, §8.7): standalone, movement-free BY CONSTRUCTION.
-- Deliberately NOT a relaxed scoring_events row — those stay hands-only with balancing
-- movements when they arrive in migration 0002.
create table notable_claims (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references games(id) on delete cascade,
  player_id uuid not null references players(id),
  notable_hand_id uuid not null references notable_hands(id),
  logged_by uuid not null references players(id),
  created_at timestamptz not null default now()
);
create index on notable_claims (game_id);
create index on notable_claims (player_id);

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
create or replace function start_game(p_game_id uuid, p_mode text, p_rules jsonb default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_mode not in ('chips','app') then raise exception 'unknown mode %', p_mode; end if;
  if p_mode = 'chips' and p_rules is not null then raise exception 'chip mode takes no rules config'; end if;
  if p_mode = 'app' and p_rules is null then raise exception 'app mode requires a rules config'; end if;
  perform 1 from games where id = p_game_id and status = 'forming' for update;
  if not found then raise exception 'game is not forming'; end if;
  if (select count(*) from game_players where game_id = p_game_id) <> 4 then
    raise exception 'need exactly 4 players to start';
  end if;
  update games set status = 'active', mode = p_mode, rules = p_rules,
    started_at = now(), last_activity_at = now()
  where id = p_game_id;
end $$;

-- Atomic create-game-plus-first-seat (ledger carry: multi-row writes made atomic)
create or replace function create_game_with_seat(p_table_id uuid, p_player_id uuid, p_seat text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  insert into games (table_id) values (p_table_id) returning id into v_id;
  insert into game_players (game_id, player_id, seat) values (v_id, p_player_id, p_seat);
  return v_id;
end $$;

-- Chip-mode end, phase 1: propose the counted stacks. Re-proposal RESETS confirmations (spec §8.6).
create or replace function propose_chip_counts(p_game_id uuid, p_counts jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v_seat text; v_sum int; r record;
begin
  perform 1 from games where id = p_game_id and status = 'active' and mode = 'chips' for update;
  if not found then raise exception 'game is not an active chip game'; end if;
  -- shape check: four seats, four non-negative integer counts each
  foreach v_seat in array array['E','S','W','N'] loop
    if p_counts->v_seat is null then raise exception 'missing counts for seat %', v_seat; end if;
    for r in select * from (values ('1'),('10'),('50'),('100')) as t(denom) loop
      if (p_counts->v_seat->>r.denom) is null or (p_counts->v_seat->>r.denom)::int < 0 then
        raise exception 'bad count for seat % denomination $%', v_seat, r.denom;
      end if;
    end loop;
  end loop;
  -- conservation backstop. Table totals mirror src/lib/chips.ts TABLE_QTY (40/36/16/4).
  -- The server action pre-checks with the TS checker and turns failures into a recount
  -- prompt; this raise should never fire in normal flow.
  for r in select * from (values ('1',40),('10',36),('50',16),('100',4)) as t(denom, expected) loop
    select sum((p_counts->s->>r.denom)::int) into v_sum
    from unnest(array['E','S','W','N']) as s;
    if v_sum <> r.expected then
      raise exception 'conservation failed: $% count is %, expected % — recount', r.denom, v_sum, r.expected;
    end if;
  end loop;
  update games set pending_counts = p_counts, pending_confirmed = '{}', last_activity_at = now()
  where id = p_game_id;
end $$;

-- Chip-mode end, phase 2: per-player confirmation. The FOURTH confirmation finalizes atomically.
create or replace function confirm_chip_result(p_game_id uuid, p_player_id uuid) returns text
language plpgsql security definer set search_path = public as $$
declare v_game games%rowtype; v_seat text; v_stack int; v_zero int;
begin
  select * into v_game from games
  where id = p_game_id and status = 'active' and mode = 'chips' for update;
  if not found then raise exception 'game is not an active chip game'; end if;
  if v_game.pending_counts is null then raise exception 'no proposed counts to confirm'; end if;
  perform 1 from game_players where game_id = p_game_id and player_id = p_player_id;
  if not found then raise exception 'player is not in this game'; end if;
  if not (p_player_id = any(v_game.pending_confirmed)) then
    update games set pending_confirmed = pending_confirmed || p_player_id
    where id = p_game_id
    returning * into v_game;
  end if;
  if coalesce(array_length(v_game.pending_confirmed, 1), 0) < 4 then
    return 'pending_' || coalesce(array_length(v_game.pending_confirmed, 1), 0);
  end if;
  -- finalize: write counts + derived totals for all four seats, one transaction
  foreach v_seat in array array['E','S','W','N'] loop
    v_stack := (v_game.pending_counts->v_seat->>'1')::int
             + 10  * (v_game.pending_counts->v_seat->>'10')::int
             + 50  * (v_game.pending_counts->v_seat->>'50')::int
             + 100 * (v_game.pending_counts->v_seat->>'100')::int;
    update game_players set
      chip_1   = (v_game.pending_counts->v_seat->>'1')::int,
      chip_10  = (v_game.pending_counts->v_seat->>'10')::int,
      chip_50  = (v_game.pending_counts->v_seat->>'50')::int,
      chip_100 = (v_game.pending_counts->v_seat->>'100')::int,
      final_total = v_stack - 400
    where game_id = p_game_id and seat = v_seat;
  end loop;
  -- should-never-happen backstop: conservation at propose time guarantees this sums to zero;
  -- if it does not, something bypassed propose_chip_counts. The caller alerts Telegram.
  select sum(final_total) into v_zero from game_players where game_id = p_game_id;
  if v_zero <> 0 then
    raise exception 'should-never-happen: chip finalize sums to % (expected 0)', v_zero;
  end if;
  update games set status = 'ended', ended_at = now(), pending_counts = null, pending_confirmed = '{}'
  where id = p_game_id;
  return 'ended';
end $$;

-- Stale chip games expire WITHOUT results (spec §10: no counts to settle with)
create or replace function expire_game(p_game_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform 1 from games where id = p_game_id and status in ('forming','active') for update;
  if not found then raise exception 'game cannot expire (not forming or active)'; end if;
  update games set status = 'expired', ended_at = now(), pending_counts = null, pending_confirmed = '{}'
  where id = p_game_id;
end $$;

create or replace function reopen_game(p_game_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform 1 from games
  where id = p_game_id and status = 'ended' and ended_at > now() - interval '1 hour'
  for update;
  if not found then raise exception 'game cannot be reopened (not ended, or ended more than an hour ago)'; end if;
  update games set status = 'active', ended_at = null, last_activity_at = now(),
    pending_counts = null, pending_confirmed = '{}'
  where id = p_game_id;
  update game_players set final_total = null,
    chip_1 = null, chip_10 = null, chip_50 = null, chip_100 = null
  where game_id = p_game_id;
end $$;

create or replace function log_notable_claim(p_game_id uuid, p_player_id uuid, p_notable_hand_id uuid, p_logged_by uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform 1 from games where id = p_game_id and status = 'active' for update;
  if not found then raise exception 'game is not active'; end if;
  perform 1 from game_players where game_id = p_game_id and player_id = p_player_id;
  if not found then raise exception 'claimed player is not in this game'; end if;
  perform 1 from game_players where game_id = p_game_id and player_id = p_logged_by;
  if not found then raise exception 'logger is not in this game'; end if;
  insert into notable_claims (game_id, player_id, notable_hand_id, logged_by)
  values (p_game_id, p_player_id, p_notable_hand_id, p_logged_by)
  returning id into v_id;
  update games set last_activity_at = now() where id = p_game_id;
  return v_id;
end $$;

-- ============ BOARDS v1 (spec §9; Task 16 renders, Task 18 upgrades) ============
-- Mode-blind: both modes converge on game_players.final_total.
create view lifetime_board as
select p.id, p.display_name,
  coalesce(sum(gp.final_total), 0) as total_points,
  count(gp.game_id) as games_played
from players p
join game_players gp on gp.player_id = p.id
join games g on g.id = gp.game_id and g.status = 'ended'
group by p.id, p.display_name;

-- v1: notable claims only. total_tai goes live in migration 0002 (app mode).
create view skill_board as
select p.id, p.display_name,
  0::bigint as total_tai,
  count(nc.id) as notable_wins
from players p
join notable_claims nc on nc.player_id = p.id
join games g on g.id = nc.game_id and g.status = 'ended'
group by p.id, p.display_name;

-- ============ RLS ============
-- Reads: any signed-in user. Writes: none (service role bypasses RLS; all writes via RPCs above).
alter table players enable row level security;
alter table tables enable row level security;
alter table table_seats enable row level security;
alter table games enable row level security;
alter table game_players enable row level security;
alter table notable_hands enable row level security;
alter table notable_claims enable row level security;

create policy "read players" on players for select to authenticated using (true);
create policy "read tables" on tables for select to authenticated using (true);
-- table_seats holds tag secrets: NO select policy. Server-only via service role.
create policy "read games" on games for select to authenticated using (true);
create policy "read game_players" on game_players for select to authenticated using (true);
create policy "read notable_hands" on notable_hands for select to authenticated using (true);
create policy "read notable_claims" on notable_claims for select to authenticated using (true);

-- ============ REALTIME ============
alter publication supabase_realtime add table games, game_players, notable_claims;

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

- [ ] **Step 3: Static backstop review (live-fire lands later)** — the `game_players` derivation CHECK and the RPC conservation raises are declarative; their live-fire drills run where real rows first exist: the tamper test in Task 15's verification (update an ended chip game's `final_total` via SQL editor → expect a check violation) and the recount loop in Task 15's component test. Note this forward reference in the task notes — do not silently skip the drills.

- [ ] **Step 4: Commit** — `git add supabase/migrations && git commit -m "feat(db): chip-spine schema — games.mode, chip columns + derivation check, chip RPCs, boards v1, RLS, seeds"`

---

### Task 11: Supabase clients, middleware, login, OAuth callback

**Files:**
- Create: `src/lib/supabase/client.ts`, `src/lib/supabase/server.ts`, `src/lib/supabase/admin.ts`, `middleware.ts`, `src/app/login/page.tsx`, `src/app/auth/callback/route.ts`

**Interfaces:**
- Consumes: env vars from Task 9 (Gate A); the new-user trigger from Task 10
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

- [ ] **Step 7: Verify manually** — `npm run dev`, visit `/login`, complete Google sign-in, confirm redirect and that a `players` row appeared (Supabase dashboard → Table editor). This also confirms the Task 10 new-user trigger.
- [ ] **Step 8: Commit** — `git add -A && git commit -m "feat(auth): supabase clients, session middleware, google login"`

---

### Task 12: The tap route — mode-aware, with atomic writes and full rejection copy

> **⚠️ SUPERSEDED 2026-08-13.** The `end_stale_and_create` case below (silently expiring a chip game / ending an app game, then creating a replacement) is **not** the shipped route. A played match is never cleared without confirmation, the redundant second `mode` lookup shown below is GONE (mode comes from the main select, and its dropped error was a real defect), and the create now retries into the winner's game on a `23505` conflict instead of throwing. Shipped truth: `src/app/t/[secret]/page.tsx` @ `9a50c7a` and spec §8.1.

**Files:**
- Create: `src/app/t/[secret]/page.tsx`

**Interfaces:**
- Consumes: `decideJoin` (Task 6 — pure, mode-blind, UNCHANGED), `createServerSupabase` + `createAdminClient` (Task 11), tables + `create_game_with_seat` / `expire_game` RPCs (Task 10)
- Produces: `GET /t/<secret>` — the URL burned onto every tag. Redirects to `/game/<id>` or `/login`, or renders a rejection message.

**Ledger directives applied here:** `REJECT_COPY` has a **third entry** for `table_full` with copy distinct from `game_in_progress` · game creation + first seat is **one atomic RPC** (`create_game_with_seat`) · the open-game query is deterministic (`order … limit 1`) · seat-claim races resolve via the DB constraints, never a silent overwrite. Cross-call note: `expire_and_create` is two RPC calls (expire, then create); a crash between them leaves an expired game and no new one, which the next tap heals — accepted, documented, no partial rows possible within either call.

- [ ] **Step 1: Implement** — `src/app/t/[secret]/page.tsx` (server component; admin client because `table_seats` has no client read policy)

```tsx
import { redirect } from 'next/navigation';
import { createServerSupabase } from '../../../lib/supabase/server';
import { createAdminClient } from '../../../lib/supabase/admin';
import { decideJoin, type GameSnapshot } from '../../../lib/join';
import type { Seat } from '../../../lib/engine/types';

export const dynamic = 'force-dynamic';

// Ledger carry: three DISTINCT rejection copies — a fifth player at a full forming table
// must not read the same message as an outsider tapping a running game.
const REJECT_COPY: Record<string, string> = {
  seat_taken: 'That seat is already taken. Tap a free seat, or ask its occupant to move.',
  game_in_progress: 'A game started without you. Wait for it to finish.',
  table_full: 'Table full — four players are already in this game. Wait for the next one.',
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

  // Deterministic select (ledger carry): at most one non-terminal game per table, newest first.
  const { data: g } = await admin
    .from('games')
    .select('id, status, mode, created_at, last_activity_at, game_players(player_id, seat)')
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
    case 'claim_seat': {
      // Race safety: PK (game_id, seat) + unique (game_id, player_id) make the second
      // phone's insert FAIL — it gets the seat_taken copy, never a silent overwrite.
      const { error: claimError } = await admin.from('game_players')
        .insert({ game_id: decision.gameId, player_id: user.id, seat: tagSeat.seat });
      if (claimError) return <main className="p-8">{REJECT_COPY.seat_taken}</main>;
      redirect(`/game/${decision.gameId}`);
      break;
    }
    case 'move_seat':
      await admin.from('game_players')
        .update({ seat: tagSeat.seat })
        .eq('game_id', decision.gameId).eq('player_id', user.id);
      redirect(`/game/${decision.gameId}`);
      break;
    case 'expire_and_create':
      await admin.rpc('expire_game', { p_game_id: decision.expireGameId });
      break; // fall through to create below
    case 'end_stale_and_create': {
      // Mode-aware stale handling (spec §10): a silent CHIP game expires WITHOUT results —
      // there are no counts to settle it with. An APP game auto-ends with its recorded totals.
      const { data: stale } = await admin.from('games').select('mode').eq('id', decision.endGameId).single();
      if (stale?.mode === 'chips') {
        await admin.rpc('expire_game', { p_game_id: decision.endGameId });
      } else {
        // `end_game` arrives with migration 0002; Task 18 replaces this throw with the RPC call.
        // Until app mode exists this branch is unreachable — fail loudly, never mis-end silently.
        throw new Error('stale app-mode game found before app mode shipped — investigate');
      }
      break; // fall through to create below
    }
    case 'create_forming':
      break;
  }

  // Atomic create: game row + first seat in one RPC (ledger carry).
  const { data: newGameId, error } = await admin.rpc('create_game_with_seat', {
    p_table_id: tagSeat.table_id, p_player_id: user.id, p_seat: tagSeat.seat,
  });
  if (error || !newGameId) throw new Error(`could not create game: ${error?.message}`);
  redirect(`/game/${newGameId}`);
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

Visit `localhost:3000/t/dev-e` → forming game + seat row created **atomically** (check both rows in the dashboard), redirected to `/game/<id>` (404 until Task 13 — the redirect happening is the pass signal). Visit `/t/dev-e` again → same game (rejoin, no duplicate). With four seats filled (SQL-insert extra `game_players` rows if short of accounts), a fifth account tapping any seat gets the **table_full** copy — verify it reads differently from the mid-game rejection.

- [ ] **Step 3: Run full test suite + typecheck** — `npm test && npx tsc --noEmit` → clean
- [ ] **Step 4: Commit** — `git commit -am "feat: NFC tap route — atomic join/create, mode-aware stale expiry, full rejection copy"`

---

### Task 13: Game shell, forming screen with mode picker (chips preselected), chip-set rule page, jsdom setup

**Files:**
- Modify: `vitest.config.ts`, `package.json` (component-test dependencies)
- Create: `src/lib/actions/game.ts` (`requireUser`, `requireParticipant`, `startGame`), `src/components/ChipSetCard.tsx`, `src/app/chips/page.tsx`, `src/app/game/[id]/page.tsx`, `src/app/game/[id]/FormingScreen.tsx`, stubs `src/app/game/[id]/ChipLive.tsx` + `src/app/game/[id]/GameLive.tsx`
- Test: `tests/components/ChipSetCard.test.tsx`

**Interfaces:**
- Consumes: chips module (Task 8), `start_game` RPC (Task 10), clients (Task 11)
- Produces:
  - Server action `startGame(gameId: string, mode: 'chips' | 'app', rules?: RulesConfig): Promise<{ error?: string }>` — Task 13 ships the chips path; Task 19 activates `'app'`
  - `requireUser()` / `requireParticipant(gameId, userId)` in `src/lib/actions/game.ts` — Tasks 14, 15, 20, 21, 22 append to this file
  - `<ChipSetCard />` — the §6.7 table, rendered from `chips.ts` (single source of truth; also the `/chips` rule page body)
  - `/game/[id]` shell routing: forming → FormingScreen · expired → message · chips → ChipLive · app → GameLive
  - Stub prop signatures Tasks 14/21 must keep EXACTLY (spelled out in Step 6)
- **Ledger carry (I1):** jsdom env + @testing-library deps + `resolve.alias` for `@/` land HERE, before the first `.tsx` test in the repo.

- [ ] **Step 1: Component-test toolchain**

```bash
npm install -D jsdom @testing-library/react @vitejs/plugin-react
```

`vitest.config.ts` becomes:

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } }, // ledger I1: BEFORE any .tsx test
  test: {
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    environmentMatchGlobs: [['tests/components/**', 'jsdom']],
  },
});
```

- [ ] **Step 2: Write the failing component test** — `tests/components/ChipSetCard.test.tsx` (this test also proves the jsdom setup works)

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ChipSetCard } from '../../src/components/ChipSetCard';

describe('ChipSetCard', () => {
  it('renders every denomination and the derived totals from chips.ts', () => {
    render(<ChipSetCard />);
    expect(screen.getByText('$50')).toBeDefined();
    expect(screen.getByText('400 pts')).toBeDefined();   // stack — derived, not hard-coded in the component
    expect(screen.getByText('1600 pts')).toBeDefined();  // table total
  });
});
```

- [ ] **Step 3: Run to verify failure** — `npx vitest run tests/components` → FAIL (component missing)

- [ ] **Step 4: Implement the card + rule page**

`src/components/ChipSetCard.tsx`:

```tsx
import { DENOMS, PER_PLAYER, STACK_TOTAL, TABLE_QTY, TABLE_TOTAL } from '../lib/chips';

/** Spec §6.7 — rendered entirely from chips.ts so the page can never drift from the checker. */
export function ChipSetCard() {
  return (
    <div className="rounded-lg border p-4">
      <h2 className="mb-2 font-semibold">The standard chip set</h2>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left opacity-60">
            <th>Chip</th><th className="text-right">Worth</th>
            <th className="text-right">Per player</th><th className="text-right">On the table</th>
          </tr>
        </thead>
        <tbody>
          {DENOMS.map((d) => (
            <tr key={d} className="border-t">
              <td className="py-1">${d}</td>
              <td className="text-right">{d} pt{d > 1 ? 's' : ''}</td>
              <td className="text-right">{PER_PLAYER[d]}</td>
              <td className="text-right">{TABLE_QTY[d]}</td>
            </tr>
          ))}
          <tr className="border-t font-medium">
            <td className="py-1">Stack</td><td />
            <td className="text-right">{STACK_TOTAL} pts</td>
            <td className="text-right">{TABLE_TOTAL} pts</td>
          </tr>
        </tbody>
      </table>
      <p className="mt-2 text-xs opacity-60">Chip worth = printed number. Every payment the rules can name is payable in chips.</p>
    </div>
  );
}
```

`src/app/chips/page.tsx`:

```tsx
import { ChipSetCard } from '../../components/ChipSetCard';

export default function ChipsPage() {
  return (
    <main className="mx-auto flex max-w-md flex-col gap-4 p-6">
      <h1 className="text-2xl font-bold">Table setup</h1>
      <p className="text-sm opacity-70">
        Every table uses the same chip composition, so end-of-game counts are comparable and the
        app can check the math. Deal each player this stack before the first hand.
      </p>
      <ChipSetCard />
    </main>
  );
}
```

- [ ] **Step 5: Server action** — `src/lib/actions/game.ts`

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

export async function startGame(gameId: string, mode: 'chips' | 'app', rules?: RulesConfig): Promise<{ error?: string }> {
  try {
    const user = await requireUser();
    const { admin } = await requireParticipant(gameId, user.id);
    if (mode === 'app') return { error: 'App scorekeeper mode arrives in a later release' }; // Task 19 replaces this line with rules validation
    void rules;
    const { error } = await admin.rpc('start_game', { p_game_id: gameId, p_mode: 'chips', p_rules: null });
    if (error) return { error: error.message };
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'failed to start' };
  }
}
```

- [ ] **Step 6: Shell + forming screen + stubs**

`src/app/game/[id]/page.tsx`:

```tsx
import { redirect } from 'next/navigation';
import { createServerSupabase } from '../../../lib/supabase/server';
import { FormingScreen } from './FormingScreen';
import { ChipLive } from './ChipLive';
import { GameLive } from './GameLive';

export const dynamic = 'force-dynamic';

export default async function GamePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/game/${id}`)}`);

  const { data: game } = await supabase
    .from('games')
    .select('id, status, mode, rules, table_id, game_players(player_id, seat, players(display_name))')
    .eq('id', id).single();
  if (!game) return <main className="p-8">Game not found.</main>;
  if (game.status === 'expired') return <main className="p-8">This game expired without results.</main>;

  const players = (game.game_players ?? []).map(
    (gp: { player_id: string; seat: string; players: { display_name: string } | { display_name: string }[] | null }) => ({
      playerId: gp.player_id,
      seat: gp.seat as 'E' | 'S' | 'W' | 'N',
      name: Array.isArray(gp.players) ? gp.players[0]?.display_name ?? '?' : gp.players?.display_name ?? '?',
    }),
  );

  if (game.status === 'forming') return <FormingScreen gameId={game.id} players={players} />;

  const { data: notableHands } = await supabase.from('notable_hands').select('id, name, local_name').order('name');

  if (game.mode === 'chips')
    // chip games are never quarantined (end_game asserts app mode), so the cast is safe
    return <ChipLive gameId={game.id} status={game.status as 'active' | 'ended'} players={players}
      me={user.id} notableHands={notableHands ?? []} />;
  return <GameLive gameId={game.id} status={game.status as 'active' | 'ended' | 'quarantined'} rules={game.rules}
    players={players} me={user.id} notableHands={notableHands ?? []} />;
}
```

`src/app/game/[id]/FormingScreen.tsx`:

```tsx
'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChipSetCard } from '../../../components/ChipSetCard';
import { startGame } from '../../../lib/actions/game';
import { createClient } from '../../../lib/supabase/client';

type P = { playerId: string; seat: 'E' | 'S' | 'W' | 'N'; name: string };

export function FormingScreen({ gameId, players }: { gameId: string; players: P[] }) {
  const router = useRouter();
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
    const res = await startGame(gameId, 'chips');
    if (res.error) setError(res.error);
    else router.refresh();
  };

  return (
    <main className="mx-auto flex max-w-md flex-col gap-4 p-6">
      <h1 className="text-xl font-bold">Forming game</h1>
      <ul className="rounded-lg border p-4">
        {(['E', 'S', 'W', 'N'] as const).map((s) => {
          const p = players.find((x) => x.seat === s);
          return (
            <li key={s} className="flex justify-between py-1">
              <span className="font-mono">{s}</span><span>{p ? p.name : '— tap to join —'}</span>
            </li>
          );
        })}
      </ul>

      <h2 className="font-semibold">Mode</h2>
      <div className="flex gap-2">
        {/* Chips is the PRESELECTED DEFAULT (spec §8.1, Bryan 2026-08-08). Task 19 makes App a live option. */}
        <button className="flex-1 rounded-lg border-2 border-black px-4 py-3 font-medium dark:border-white">
          Chips ✓
        </button>
        <button disabled title="coming soon" className="flex-1 rounded-lg border px-4 py-3 opacity-40">
          App scorekeeper
        </button>
      </div>
      <ChipSetCard />

      <button onClick={onStart} disabled={!full}
        className="rounded-lg border px-6 py-3 font-medium disabled:opacity-40">
        {full ? 'Start game' : `Waiting for players (${players.length}/4)`}
      </button>
      {error && <p className="text-red-600">{error}</p>}
    </main>
  );
}
```

Stubs (replaced in Tasks 14 and 21 — later tasks must keep these props EXACTLY):

```tsx
// src/app/game/[id]/ChipLive.tsx — stub, replaced in Task 14
export function ChipLive(_props: {
  gameId: string; status: 'active' | 'ended';
  players: { playerId: string; seat: 'E' | 'S' | 'W' | 'N'; name: string }[];
  me: string; notableHands: { id: string; name: string; local_name: string | null }[];
}) { return <div className="p-8">chip game</div>; }
```

```tsx
// src/app/game/[id]/GameLive.tsx — stub, replaced in Task 21
import type { RulesConfig } from '../../../lib/engine/types';
export function GameLive(_props: {
  gameId: string; status: 'active' | 'ended' | 'quarantined'; rules: RulesConfig;
  players: { playerId: string; seat: 'E' | 'S' | 'W' | 'N'; name: string }[];
  me: string; notableHands: { id: string; name: string; local_name: string | null }[];
}) { return <div className="p-8">app game</div>; }
```

- [ ] **Step 7: Run tests** — `npx vitest run` → ChipSetCard test PASSES alongside the full suite.
- [ ] **Step 8: Verify manually** — tap `/t/dev-e` … `/t/dev-n` with four accounts (or SQL-insert `game_players` rows). All four named on screen; **Chips shows preselected; App is visibly disabled**; the chip-set table matches spec §6.7 exactly; `/chips` renders the same card standalone. Start at 4/4 → everyone flips to the ChipLive stub via realtime refresh; `games.mode = 'chips'`, `rules` null in the dashboard.
- [ ] **Step 9: Typecheck + commit** — `npx tsc --noEmit && git add -A && git commit -m "feat: game shell, forming screen with chips-default mode picker, chip-set rule page, jsdom toolchain"`

---

### Task 14: Chip-mode live screen + notable-hand logging

**Files:**
- Create (replacing the Task 13 stub): `src/app/game/[id]/ChipLive.tsx`
- Create: `src/app/game/[id]/NotableLogger.tsx`, stub `src/app/game/[id]/ChipEndFlow.tsx`
- Modify: `src/lib/actions/game.ts` (add `logNotable`)

**Interfaces:**
- Consumes: `log_notable_claim` RPC (Task 10), realtime channels, `requireUser`/`requireParticipant` (Task 13)
- Produces:
  - `logNotable(gameId: string, playerId: string, notableHandId: string): Promise<{ error?: string }>`
  - `ChipLive` with the EXACT Task 13 stub props
  - `ChipEndFlow` stub with props Task 15 must keep: `{ gameId: string; players: P[]; me: string; onClose: () => void }`

The design intent (spec §8.7): this screen is deliberately QUIET. The table settles hands physically; the app offers exactly two actions during play. No totals ticker — chip mode has nothing to tick.

- [ ] **Step 1: Add `logNotable`** to `src/lib/actions/game.ts`

```ts
export async function logNotable(gameId: string, playerId: string, notableHandId: string): Promise<{ error?: string }> {
  try {
    const user = await requireUser();
    const { admin } = await requireParticipant(gameId, user.id);
    const { error } = await admin.rpc('log_notable_claim', {
      p_game_id: gameId, p_player_id: playerId, p_notable_hand_id: notableHandId, p_logged_by: user.id,
    });
    if (error) return { error: error.message };
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'failed to log' };
  }
}
```

- [ ] **Step 2: Implement `ChipLive.tsx`**

```tsx
'use client';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '../../../lib/supabase/client';
import type { Seat } from '../../../lib/engine/types';
import { NotableLogger } from './NotableLogger';
import { ChipEndFlow } from './ChipEndFlow';

type P = { playerId: string; seat: Seat; name: string };
type NH = { id: string; name: string; local_name: string | null };
type Claim = { id: string; player_id: string; notable_hand_id: string };

export function ChipLive({ gameId, status, players, me, notableHands }: {
  gameId: string; status: 'active' | 'ended'; players: P[]; me: string; notableHands: NH[];
}) {
  const router = useRouter();
  const [claims, setClaims] = useState<Claim[]>([]);
  const [finals, setFinals] = useState<Record<string, number> | null>(null);
  const [loggerOpen, setLoggerOpen] = useState(false);
  const [endOpen, setEndOpen] = useState(false);
  const supabase = createClient();

  const reload = useCallback(async () => {
    const { data } = await supabase.from('notable_claims')
      .select('id, player_id, notable_hand_id').eq('game_id', gameId).order('created_at');
    setClaims(data ?? []);
    if (status === 'ended') {
      const { data: gps } = await supabase.from('game_players')
        .select('player_id, final_total').eq('game_id', gameId);
      setFinals(Object.fromEntries((gps ?? []).map((g) => [g.player_id, g.final_total ?? 0])));
    }
  }, [gameId, status]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    reload();
    const ch = supabase
      .channel(`chip-${gameId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notable_claims', filter: `game_id=eq.${gameId}` }, reload)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'games', filter: `id=eq.${gameId}` },
        () => router.refresh())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [gameId, reload, router]); // eslint-disable-line react-hooks/exhaustive-deps

  const name = (playerId: string) => players.find((p) => p.playerId === playerId)?.name ?? '?';
  const handName = (id: string) => notableHands.find((h) => h.id === id)?.name ?? '?';

  return (
    <main className="mx-auto flex max-w-md flex-col gap-4 p-6">
      <h1 className="text-xl font-bold">{status === 'active' ? 'Chip game on' : 'Game over'}</h1>
      {status === 'active' && (
        <p className="text-sm opacity-70">
          Settle every hand with chips as usual — the app stays out of the way.{' '}
          <Link className="underline" href="/chips">The standard set</Link>
        </p>
      )}
      <ul className="rounded-lg border p-4">
        {players.map((p) => (
          <li key={p.seat} className="flex justify-between py-1">
            <span>{p.name}{p.playerId === me ? ' (you)' : ''}</span>
            {finals ? (
              <span className={`font-mono ${(finals[p.playerId] ?? 0) < 0 ? 'text-red-600' : (finals[p.playerId] ?? 0) > 0 ? 'text-green-600' : 'opacity-50'}`}>
                {(finals[p.playerId] ?? 0) > 0 ? '+' : ''}{finals[p.playerId] ?? 0}
              </span>
            ) : (
              <span className="font-mono opacity-40">{p.seat}</span>
            )}
          </li>
        ))}
      </ul>
      {claims.length > 0 && (
        <section>
          <h2 className="mb-1 font-semibold">Notable hands</h2>
          <ul className="flex flex-col gap-1">
            {claims.map((c) => (
              <li key={c.id} className="rounded border px-3 py-2 text-sm">
                🏆 {name(c.player_id)} — {handName(c.notable_hand_id)}
              </li>
            ))}
          </ul>
        </section>
      )}
      {status === 'active' && (
        <>
          <button onClick={() => setLoggerOpen(true)} className="rounded-lg border px-6 py-3">Log notable hand</button>
          <button onClick={() => setEndOpen(true)} className="rounded-lg border px-6 py-3 font-medium">
            End game — count chips
          </button>
        </>
      )}
      {loggerOpen && (
        <NotableLogger players={players} notableHands={notableHands} gameId={gameId}
          onClose={() => setLoggerOpen(false)} />
      )}
      {endOpen && status === 'active' && (
        <ChipEndFlow gameId={gameId} players={players} me={me} onClose={() => setEndOpen(false)} />
      )}
    </main>
  );
}
```

- [ ] **Step 3: Implement `NotableLogger.tsx`** — five seconds, whole table watching (spec §8.7)

```tsx
'use client';
import { useState } from 'react';
import type { Seat } from '../../../lib/engine/types';
import { logNotable } from '../../../lib/actions/game';

type P = { playerId: string; seat: Seat; name: string };
type NH = { id: string; name: string; local_name: string | null };

export function NotableLogger({ players, notableHands, gameId, onClose }: {
  players: P[]; notableHands: NH[]; gameId: string; onClose: () => void;
}) {
  const [playerId, setPlayerId] = useState<string>();
  const [handId, setHandId] = useState<string>();
  const [error, setError] = useState<string>();
  return (
    <div className="fixed inset-0 z-10 overflow-y-auto bg-white p-6 dark:bg-neutral-900">
      <div className="mx-auto flex max-w-md flex-col gap-4">
        <div className="flex justify-between">
          <h2 className="text-lg font-bold">Log notable hand</h2>
          <button onClick={onClose} className="opacity-60">Cancel</button>
        </div>
        <span className="text-sm">Who won it?</span>
        <div className="flex flex-wrap gap-2">
          {players.map((p) => (
            <button key={p.playerId} onClick={() => setPlayerId(p.playerId)}
              className={`rounded border px-3 py-2 ${playerId === p.playerId ? 'bg-black text-white dark:bg-white dark:text-black' : ''}`}>
              {p.name}
            </button>
          ))}
        </div>
        <span className="text-sm">Which hand?</span>
        <select value={handId ?? ''} onChange={(e) => setHandId(e.target.value || undefined)} className="rounded border px-2 py-2">
          <option value="">Pick a hand…</option>
          {notableHands.map((h) => (
            <option key={h.id} value={h.id}>{h.name}{h.local_name ? ` (${h.local_name})` : ''}</option>
          ))}
        </select>
        <button disabled={!playerId || !handId}
          onClick={async () => {
            const res = await logNotable(gameId, playerId!, handId!);
            if (res.error) setError(res.error); else onClose();
          }}
          className="rounded-lg border px-6 py-3 font-medium disabled:opacity-40">
          Log it
        </button>
        {error && <p className="text-red-600">{error}</p>}
      </div>
    </div>
  );
}
```

Stub `ChipEndFlow.tsx` for now (Task 15 replaces it; keep these props EXACTLY):

```tsx
// src/app/game/[id]/ChipEndFlow.tsx — stub, replaced in Task 15
import type { Seat } from '../../../lib/engine/types';
export function ChipEndFlow(_props: {
  gameId: string; players: { playerId: string; seat: Seat; name: string }[];
  me: string; onClose: () => void;
}) { return null; }
```

- [ ] **Step 4: Verify manually, two browsers** — start a dev chip game; log a notable in browser A → 🏆 line appears in browser B within ~a second; the claim row exists in `notable_claims` with `logged_by` = A's account; the End button opens (a blank stub — fine).
- [ ] **Step 5: Typecheck + tests + commit** — `npx tsc --noEmit && npm test`, then `git add -A && git commit -m "feat: quiet chip-mode live screen + standalone notable-hand logging"`

---

### Task 15: Chip end flow — per-denomination entry, conservation recount loop, all-four confirm, finalize

**Files:**
- Create: `src/lib/telegram.ts`
- Create (replacing the Task 14 stub): `src/app/game/[id]/ChipEndFlow.tsx`
- Modify: `src/lib/actions/game.ts` (add `proposeChipCounts`, `confirmChipResult`, `reopenChipGame`), `src/app/game/[id]/ChipLive.tsx` (Reopen button on the ended view)
- Test: `tests/components/ChipEndFlow.test.tsx`

**Interfaces:**
- Consumes: chips module (Task 8), `propose_chip_counts` / `confirm_chip_result` / `reopen_game` RPCs (Task 10)
- Produces:
  - `proposeChipCounts(gameId, rawCounts): Promise<{ error?: string; conservation?: ConservationFailure }>` — a conservation failure is a RESULT, not an error: the UI renders it as a recount prompt
  - `confirmChipResult(gameId): Promise<{ error?: string; result?: string }>`
  - `reopenChipGame(gameId): Promise<{ error?: string }>`
  - `sendAlert(text: string): Promise<void>` — no-throw; no-op when env vars absent (Task 22 reuses it)

**This task is the whole cost of chip mode** (spec §8.6): one entry moment per session. Get the recount loop right — it is the difference between "the app caught our miscount" and "the app blocked our night".

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
import { validateCounts, checkConservation, type ChipCounts } from '../chips';
import type { Seat } from '../engine/types';
import { sendAlert } from '../telegram';

export type ConservationFailure = { failedDenominations: number[]; grandTotalOff: boolean };

export async function proposeChipCounts(
  gameId: string,
  rawCounts: Record<string, Record<string, number>>,
): Promise<{ error?: string; conservation?: ConservationFailure }> {
  try {
    const user = await requireUser();
    const { admin } = await requireParticipant(gameId, user.id);
    // Trust boundary: validate every count before any arithmetic (non-negative integers, all four denoms)
    let table: Record<Seat, ChipCounts>;
    try {
      table = {
        E: validateCounts(rawCounts.E), S: validateCounts(rawCounts.S),
        W: validateCounts(rawCounts.W), N: validateCounts(rawCounts.N),
      };
    } catch (e) {
      return { error: e instanceof Error ? e.message : 'bad counts' };
    }
    // USER-FACING recount path (spec §10): a failed check is a miscount, never an error page.
    const check = checkConservation(table);
    if (!check.ok) {
      return { conservation: { failedDenominations: [...check.failedDenominations], grandTotalOff: check.grandTotalOff } };
    }
    const { error } = await admin.rpc('propose_chip_counts', { p_game_id: gameId, p_counts: table });
    if (error) return { error: error.message };
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'failed to propose counts' };
  }
}

export async function confirmChipResult(gameId: string): Promise<{ error?: string; result?: string }> {
  try {
    const user = await requireUser();
    const { admin } = await requireParticipant(gameId, user.id);
    const { data, error } = await admin.rpc('confirm_chip_result', { p_game_id: gameId, p_player_id: user.id });
    if (error) {
      if (error.message.includes('should-never-happen')) {
        // The finalize backstop fired: conservation passed at propose time but the totals
        // did not sum to zero — a bug or tampering, exactly what the alert channel is for.
        await sendAlert(`⚠️ RVMJ chip finalize failed the zero-sum backstop\nGame: ${process.env.NEXT_PUBLIC_SITE_URL}/game/${gameId}\n${error.message}`);
      }
      return { error: error.message };
    }
    return { result: data as string };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'failed to confirm' };
  }
}

export async function reopenChipGame(gameId: string): Promise<{ error?: string }> {
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

- [ ] **Step 3: Write the failing component test** — `tests/components/ChipEndFlow.test.tsx`

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ChipEndFlow } from '../../src/app/game/[id]/ChipEndFlow';

vi.mock('../../src/lib/actions/game', () => ({
  proposeChipCounts: vi.fn(async () => ({ conservation: { failedDenominations: [1, 10], grandTotalOff: false } })),
  confirmChipResult: vi.fn(async () => ({})),
}));
vi.mock('../../src/lib/supabase/client', () => ({
  createClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { pending_counts: null, pending_confirmed: [], status: 'active' } }) }) }) }),
    channel: () => { const ch = { on: () => ch, subscribe: () => ch }; return ch; },
    removeChannel: () => {},
  }),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const players = [
  { playerId: 'p1', seat: 'E' as const, name: 'Ah Seng' },
  { playerId: 'p2', seat: 'S' as const, name: 'Bryan' },
  { playerId: 'p3', seat: 'W' as const, name: 'Ah Beng' },
  { playerId: 'p4', seat: 'N' as const, name: 'Ah Huat' },
];

describe('ChipEndFlow recount loop (spec §8.6/§10)', () => {
  it('renders a recount prompt that NAMES each failed denomination', async () => {
    render(<ChipEndFlow gameId="g1" players={players} me="p2" onClose={() => {}} />);
    fireEvent.click(screen.getByText(/Check & propose/));
    await waitFor(() => {
      // Must name BOTH $1 and $10. A generic "count doesn't balance" message fails this
      // assertion — that is the guard-must-fail property, verified in Step 6.
      expect(screen.getByText(/\$1 and \$10/)).toBeDefined();
    });
  });
});
```

- [ ] **Step 4: Implement `ChipEndFlow.tsx`**

```tsx
'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '../../../lib/supabase/client';
import { DENOMS, PER_PLAYER, STACK_TOTAL, stackTotal, type ChipCounts } from '../../../lib/chips';
import type { Seat } from '../../../lib/engine/types';
import { proposeChipCounts, confirmChipResult, type ConservationFailure } from '../../../lib/actions/game';

type P = { playerId: string; seat: Seat; name: string };
type Pending = { counts: Record<Seat, ChipCounts>; confirmed: string[] } | null;

const emptyCounts = (): ChipCounts => ({ 1: 0, 10: 0, 50: 0, 100: 0 });

export function ChipEndFlow({ gameId, players, me, onClose }: {
  gameId: string; players: P[]; me: string; onClose: () => void;
}) {
  const router = useRouter();
  const [counts, setCounts] = useState<Record<Seat, ChipCounts>>(
    { E: emptyCounts(), S: emptyCounts(), W: emptyCounts(), N: emptyCounts() });
  const [pending, setPending] = useState<Pending>(null);
  const [failure, setFailure] = useState<ConservationFailure | null>(null);
  const [error, setError] = useState<string>();
  const supabase = createClient();

  // The proposal is SERVER-persisted (games.pending_counts) and mirrored to all four phones
  // via realtime; each player confirms on their own phone (spec §8.6).
  useEffect(() => {
    const load = async () => {
      const { data } = await supabase.from('games')
        .select('pending_counts, pending_confirmed, status').eq('id', gameId).single();
      if (data?.status === 'ended') { router.refresh(); return; }
      setPending(data?.pending_counts
        ? { counts: data.pending_counts as Record<Seat, ChipCounts>, confirmed: data.pending_confirmed ?? [] }
        : null);
    };
    load();
    const ch = supabase
      .channel(`chip-end-${gameId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'games', filter: `id=eq.${gameId}` }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [gameId]); // eslint-disable-line react-hooks/exhaustive-deps

  const name = (s: Seat) => players.find((p) => p.seat === s)?.name ?? s;

  if (pending) {
    const nets = (['E', 'S', 'W', 'N'] as const)
      .map((seat) => [seat, stackTotal(pending.counts[seat]) - STACK_TOTAL] as const);
    const iConfirmed = pending.confirmed.includes(me);
    return (
      <div className="fixed inset-0 z-10 overflow-y-auto bg-white p-6 dark:bg-neutral-900">
        <div className="mx-auto flex max-w-md flex-col gap-4">
          <h2 className="text-lg font-bold">Confirm the count</h2>
          <ul className="rounded border p-3">
            {nets.map(([seat, net]) => (
              <li key={seat} className="flex justify-between py-0.5">
                <span>{name(seat)}</span>
                <span className={`font-mono ${net > 0 ? 'text-green-600' : net < 0 ? 'text-red-600' : 'opacity-50'}`}>
                  {net > 0 ? '+' : ''}{net}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-sm opacity-70">{pending.confirmed.length}/4 confirmed. The fourth confirmation locks the game.</p>
          <button disabled={iConfirmed}
            onClick={async () => {
              const res = await confirmChipResult(gameId);
              if (res.error) setError(res.error);
              if (res.result === 'ended') router.refresh();
            }}
            className="rounded-lg border px-6 py-3 font-medium disabled:opacity-40">
            {iConfirmed ? 'You confirmed — waiting for the others' : 'Confirm my count'}
          </button>
          <button className="rounded border px-4 py-2 text-sm opacity-70" onClick={() => setPending(null)}>
            Something is wrong — recount
          </button>
          {error && <p className="text-red-600">{error}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-10 overflow-y-auto bg-white p-6 dark:bg-neutral-900">
      <div className="mx-auto flex max-w-md flex-col gap-4">
        <div className="flex justify-between">
          <h2 className="text-lg font-bold">Count chips</h2>
          <button onClick={onClose} className="opacity-60">Cancel</button>
        </div>
        <p className="text-sm opacity-70">Count each stack by denomination — the app does the math.</p>
        {failure && (
          <p className="rounded border border-amber-500 p-3 text-sm">
            The count doesn&apos;t balance. Recount the{' '}
            <strong>{failure.failedDenominations.map((d) => `$${d}`).join(' and ')}</strong> chips
            {failure.grandTotalOff ? '.' : ' — the totals balance, so two stacks are miscounted against each other.'}
          </p>
        )}
        {(['E', 'S', 'W', 'N'] as const).map((seat) => (
          <fieldset key={seat} className="rounded border p-3">
            <legend className="px-1 text-sm font-medium">{name(seat)}</legend>
            <div className="grid grid-cols-4 gap-2">
              {DENOMS.map((d) => (
                <label key={d} className="flex flex-col text-xs">
                  <span className="opacity-60">${d} (start {PER_PLAYER[d]})</span>
                  <input type="number" min={0} inputMode="numeric"
                    className="rounded border px-2 py-2 text-right"
                    value={counts[seat][d]}
                    onChange={(e) => setCounts({ ...counts, [seat]: { ...counts[seat], [d]: Number(e.target.value) } })} />
                </label>
              ))}
            </div>
            <p className="mt-1 text-right font-mono text-sm">= {stackTotal(counts[seat])} pts</p>
          </fieldset>
        ))}
        <button
          onClick={async () => {
            setError(undefined); setFailure(null);
            const res = await proposeChipCounts(gameId, counts);
            if (res.conservation) setFailure(res.conservation);
            else if (res.error) setError(res.error);
            // on success the realtime UPDATE flips every phone (this one included) to the confirm view
          }}
          className="rounded-lg border px-6 py-3 font-medium">
          Check &amp; propose
        </button>
        {error && <p className="text-red-600">{error}</p>}
      </div>
    </div>
  );
}
```

(Local "recount" only hides the pending view on this phone; the next successful propose overwrites the server-side proposal and **resets all confirmations** — that reset lives in the `propose_chip_counts` RPC, not the client.)

- [ ] **Step 5: Reopen button** — in `ChipLive.tsx`, add under the ended-view totals list:

```tsx
{status === 'ended' && (
  <button className="rounded border px-4 py-2 text-sm"
    onClick={async () => {
      const res = await reopenChipGame(gameId);
      if (res.error) alert(res.error); else router.refresh();
    }}>
    Reopen (within 1 hour of ending)
  </button>
)}
```

with `import { reopenChipGame } from '../../../lib/actions/game';` added to ChipLive's imports.

- [ ] **Step 6: Run tests + guard-must-fail** — `npx vitest run` → all green. Then temporarily replace the failure copy with a generic "The count doesn't balance — recount." (no denomination names) → the component test must FAIL. Revert; green run.

- [ ] **Step 7 (BRYAN, OPTIONAL mini-gate): Telegram bot** — BotFather → `/newbot` → token into `.env.local` as `TELEGRAM_BOT_TOKEN`. Message the bot once, then `curl "https://api.telegram.org/bot<TOKEN>/getUpdates"` → `chat.id` → `TELEGRAM_CHAT_ID`. Alerting no-ops until this is done; nothing else blocks on it.

- [ ] **Step 8: Verify manually, two browsers** — full loop on a dev chip game:
  1. Browser A: End game — count chips. Enter the deliberate balanced miscount: seat E `{$1: 0, $10: 10, $50: 4, $100: 1}` (= 400 exactly), everyone else their true starting stacks → the prompt names **$1 and $10**, and says the totals balance.
  2. Correct E to the true counts → propose succeeds → browser B flips to the confirm view by itself, showing the same four net results.
  3. Confirm on all four accounts (SQL-update `pending_confirmed` for accounts you don't have logged in) → game ends on the fourth, both browsers show final totals, `chip_*` columns + `final_total` written, `final_total`s sum to zero.
  4. Reopen within the hour → back to active, chip columns and totals cleared.
  5. **Tamper drill (Task 10's row CHECK, live-fire):** in the SQL editor, on the re-ended game: `update game_players set final_total = 999 where game_id = '<id>' and seat = 'E';` → expect a check-constraint violation. Record the result in the task notes.

- [ ] **Step 9: Typecheck + commit** — `npx tsc --noEmit && git add -A && git commit -m "feat: chip end flow — per-denomination entry, named-denomination recount loop, four-phone confirm, finalize + reopen"`

---

### Task 16: Boards v1 — Lifetime + Skill (notables), honest Form placeholder

**Files:**
- Modify: `src/app/page.tsx` (replace the scaffold home)

**Interfaces:**
- Consumes: `lifetime_board` + `skill_board` views (Task 10)
- Produces: `/` with three tabs via `?board=lifetime|form|skill` (default lifetime). The Form tab renders an empty state WITHOUT querying — `form_board` does not exist until migration 0002; Task 23 switches it live.

- [ ] **Step 1: Implement** — `src/app/page.tsx`

```tsx
import Link from 'next/link';
import { createServerSupabase } from '../lib/supabase/server';

export const dynamic = 'force-dynamic';

const BOARDS = { lifetime: { title: 'Lifetime' }, form: { title: 'Form' }, skill: { title: 'Skill' } } as const;
type BoardKey = keyof typeof BOARDS;

export default async function Home({ searchParams }: { searchParams: Promise<{ board?: string }> }) {
  const { board: raw } = await searchParams;
  const board: BoardKey = raw === 'form' || raw === 'skill' ? raw : 'lifetime';
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();

  // Form ranks per-hand play and goes live with app mode (Task 23). Until then: no query at all.
  const { data: rows } = user && board !== 'form'
    ? await supabase.from(board === 'lifetime' ? 'lifetime_board' : 'skill_board').select('*')
        .order(board === 'lifetime' ? 'total_points' : 'notable_wins', { ascending: false }).limit(50)
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
          {board === 'form' ? (
            <p className="py-4 text-sm opacity-60">
              Form ranks app-scorekeeper games (average points per hand, minimum 20 hands). None played yet.
            </p>
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {(rows ?? []).map((r: Record<string, unknown>, i: number) => (
                  <tr key={String(r.id)} className="border-b">
                    <td className="py-2 pr-2 opacity-50">{i + 1}</td>
                    <td className="py-2">{String(r.display_name)}</td>
                    <td className="py-2 text-right font-mono">
                      {board === 'lifetime' && `${r.total_points} pts · ${r.games_played} games`}
                      {board === 'skill' && `${r.notable_wins} notable${Number(r.total_tai) > 0 ? ` · ${r.total_tai} tai` : ''}`}
                    </td>
                  </tr>
                ))}
                {(rows ?? []).length === 0 && (
                  <tr><td className="py-4 opacity-60">No finished games yet.</td></tr>
                )}
              </tbody>
            </table>
          )}
          <p className="text-sm"><Link className="underline" href="/chips">Table setup — the standard chip set</Link></p>
        </>
      )}
    </main>
  );
}
```

- [ ] **Step 2: Verify manually** — after the Task 15 dev game ended: Lifetime shows four rows whose points match the chip results and sum to zero across the table; Skill shows the notable logged in Task 14; Form shows the explanatory empty state; the chip-set page link works.
- [ ] **Step 3: Typecheck + commit** — `npx tsc --noEmit && git add -A && git commit -m "feat: leaderboards home — lifetime + skill from final_total/claims, honest form placeholder"`

---

### Task 17: Deploy to Vercel + production chip-night smoke test + burn tags  **(BRYAN GATE B — the milestone gate)**

**Files:**
- None new (configuration + verification)

**Interfaces:**
- Consumes: everything up to Task 16
- Produces: the live app on the real domain; burned production tags; **the chip-only milestone**

- [ ] **Step 1 (BRYAN, in browser): Vercel project**
  - `npx vercel link` (or import the repo in the Vercel dashboard — repo will need a GitHub remote first: `gh repo create` per Bryan's call on public/private).
  - Set env vars in Vercel (Production): all six from `.env.example`, with `NEXT_PUBLIC_SITE_URL` = the real domain. (`TELEGRAM_*` may stay empty if Task 15's optional mini-gate was skipped — alerting no-ops.)
- [ ] **Step 2 (BRYAN, in browser): OAuth for production**
  - Google Cloud Console → OAuth client → add the production domain to authorized origins (the redirect URI stays the `*.supabase.co` callback).
  - Supabase → Authentication → URL Configuration → set Site URL to the production domain and add `https://<domain>/auth/callback` to Redirect URLs.
- [ ] **Step 3: Deploy** — `npx vercel --prod` (or git push if repo-connected). Build must pass with zero type errors.
- [ ] **Step 4: Production chip-night smoke test (phones, real Google accounts)**
  1. `/t/<dev secret>` on each phone → login once each → forming screen, **Chips preselected, App visibly disabled** → Start at 4/4.
  2. Log a notable hand → 🏆 appears on all four phones within a second.
  3. End game — count chips → enter the **deliberate balanced miscount** (seat E: `$1×0, $10×10, $50×4, $100×1` = 400; everyone else their true stacks) → the app must name **$1 and $10** and ask for a recount.
  4. Correct the counts → propose → every phone flips to the confirm view → confirm on all four → game locks.
  5. Home page: Lifetime shows the four results; Skill shows the notable.
  6. Kill the browser mid-game on one phone next game and re-tap → rejoin with state intact.
- [ ] **Step 5 (BRYAN): burn the real tags** — create the real table row + 4 secrets (spec §7 provisioning), write `https://<domain>/t/<secret>` to each NTAG213 with NFC Tools, stick them on the table.
- [ ] **Step 6: Commit any config touch-ups** — `git commit -am "chore: production deploy config"`

---

## ★ CHIP-ONLY MILESTONE — reached after Task 17

The app is deployed, tagged to the real table, and runs a complete real game night end to end: tap-to-join → chips-default start → notable logging → per-denomination count with named-denomination conservation checking → four-phone confirm → Lifetime + Skill boards. Everything after this line is additive: app mode lands on a LIVE product, dark behind the disabled App button until Task 19 switches it on.

---

## Phase C — app mode (additive on the live product)

### Task 18: Migration 0002 — app mode: hands, events, movements, zero-sum trigger, presets, app RPCs, board upgrades

> **⚠️ TWO CORRECTIONS, both already applied in the shipped code.**
> **(1) Numbering:** the migration shipped as **`0003_app_mode.sql`**, not `0002` — `0002` is `0002_chip_spine_hardening.sql`, written after this plan. Every `0002_app_mode` reference below is stale naming only.
> **(2) SUPERSEDED 2026-08-13:** Step 2's "wire the stale-app branch" no longer applies as written. A played match is not auto-ended; `end_game` is reached only through the explicit confirm path. Its returned `'quarantined'` **must be alerted** — the Task 18 review found the return discarded at its only call site, and Task 22's planned alert does NOT cover it (that alert lives in the `endGame()` server action, which this route does not call). See the Task 22 note.
> Also found by that review and fixed in this migration: the plan's `form_board` counted VOIDED hands.

**Files:**
- Create: `supabase/migrations/0002_app_mode.sql`
- Modify: `src/app/t/[secret]/page.tsx` (the stale-app branch placed in Task 12)

**Interfaces:**
- Consumes: migration 0001 (Task 10). Purely additive — no ALTERs of live chip tables.
- Produces:
  - Tables: `presets`, `hands`, `scoring_events` (strict: `hand_id NOT NULL`, types `win/bonus/reversal` — chip glory lives in `notable_claims`, NOT here), `point_movements`
  - The deferred zero-sum constraint trigger (spec §10 layer 2)
  - RPCs: `record_hand`, `void_hand`, `end_game` (**asserts `mode='app'` — quarantine is structurally unreachable for chip games**)
  - Views: `form_board` (threshold **20** hands — spec §9; the pre-revision plan's 100 was stale), `skill_board` v2 (tai from win events UNION notable claims)
  - `record_hand`'s `p_events` element shape: `{ "type": "win"|"bonus", "payload": <ScoringEvent JSON>, "winner_player_id": uuid|null, "tai": int|null, "notable_hand_id": uuid|null, "movements": [{ "player_id": uuid, "seat": "E", "points": int } ×4] }`

- [ ] **Step 1: Write `supabase/migrations/0002_app_mode.sql`**

```sql
-- ============ TABLES ============
create table presets (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references players(id) on delete cascade,
  name text not null,
  rules jsonb not null,
  created_at timestamptz not null default now()
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

-- Strict by design: every scoring event belongs to a hand and its movements sum to zero.
-- No glory type here — chip-mode notables are notable_claims rows (migration 0001).
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

-- ============ RPCs ============
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
  perform 1 from games where id = p_game_id and status = 'active' and mode = 'app' for update;
  if not found then raise exception 'game is not an active app-mode game'; end if;
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

-- App-mode end ONLY. A chip game can never reach the quarantine branch (spec §10:
-- a chip conservation failure is a user-facing recount, not a system failure).
create or replace function end_game(p_game_id uuid) returns text
language plpgsql security definer set search_path = public as $$
declare v_total int; r record;
begin
  perform 1 from games where id = p_game_id and status = 'active' and mode = 'app' for update;
  if not found then raise exception 'game is not an active app-mode game'; end if;
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

-- reopen_game from 0001 already serves app games: it clears final_total (correct — end_game
-- rewrites it) and the chip columns (null for app games; a no-op). No change needed.

-- ============ BOARD UPGRADES (spec §9) ============
-- Form: average points per hand, minimum 20 hands (app-mode games only — chip games have no hands).
create view form_board as
select p.id, p.display_name,
  coalesce(sum(m.points), 0) as total_points,
  count(distinct m.hand_id) as hands_played,
  round(coalesce(sum(m.points), 0)::numeric / count(distinct m.hand_id), 2) as avg_points_per_hand
from players p
join point_movements m on m.player_id = p.id
join games g on g.id = m.game_id and g.status = 'ended'
group by p.id, p.display_name
having count(distinct m.hand_id) >= 20;

-- Skill v2: tai from app-mode win events, notables from BOTH sources (win events ∪ notable_claims).
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
  coalesce(a.notable_wins, 0) + coalesce(c.claim_count, 0) as notable_wins
from players p
left join app_wins a on a.player_id = p.id
left join claims c on c.player_id = p.id
where a.player_id is not null or c.player_id is not null;

-- ============ RLS ============
alter table presets enable row level security;
alter table hands enable row level security;
alter table scoring_events enable row level security;
alter table point_movements enable row level security;

create policy "read own presets" on presets for select to authenticated using (owner = auth.uid());
create policy "read hands" on hands for select to authenticated using (true);
create policy "read scoring_events" on scoring_events for select to authenticated using (true);
create policy "read point_movements" on point_movements for select to authenticated using (true);

-- ============ REALTIME ============
alter publication supabase_realtime add table hands, point_movements;
```

- [ ] **Step 2: Wire the stale-app branch** — in `src/app/t/[secret]/page.tsx`, replace the Task 12 placeholder throw:

```tsx
      } else {
        // A silent app game auto-ends after 12h with whatever was recorded (spec §10).
        await admin.rpc('end_game', { p_game_id: decision.endGameId });
      }
```

- [ ] **Step 3: Push** — `npx supabase db push` → applies cleanly against the LIVE database (additive only; the running chip app is untouched — verify by loading the production home page after the push).

- [ ] **Step 4: Zero-sum trigger live-fire drill** (deferred here from the pre-revision plan; real player ids exist now). SQL editor, one statement so the deferred trigger checks at commit:

```sql
do $$
declare v_g uuid; v_p uuid; v_h uuid := gen_random_uuid(); v_e uuid := gen_random_uuid();
begin
  select id into v_p from players limit 1;
  select id into v_g from games limit 1;
  insert into hands (id, game_id, seq, recorded_by) values (v_h, v_g, 999, v_p);
  insert into scoring_events (id, hand_id, type) values (v_e, v_h, 'bonus');
  insert into point_movements (event_id, hand_id, game_id, player_id, seat, points)
  values (v_e, v_h, v_g, v_p, 'E', 1);   -- deliberately unbalanced: +1 with no offset
end $$;
-- EXPECTED: "zero-sum violation: event ... sums to 1" and the whole block rolls back.
```

Confirm the error, confirm no rows persisted (`select count(*) from hands where seq = 999;` → 0). Record the result in the task notes.

- [ ] **Step 5: Typecheck + commit** — `npx tsc --noEmit && git add -A && git commit -m "feat(db): app-mode schema — hands/events/movements, zero-sum trigger, app RPCs, form + skill v2 boards"`

---

### Task 19: App-mode forming — rules form (three-way shooter), validation, presets, enable the App picker

**Files:**
- Create: `src/lib/engine/validate.ts`, `src/components/RulesForm.tsx`, `src/lib/actions/presets.ts`
- Modify: `src/lib/actions/game.ts` (`startGame` app path), `src/app/game/[id]/FormingScreen.tsx` (mode state + App enabled), `src/app/game/[id]/page.tsx` (fetch the user's presets for forming)
- Test: `tests/engine/validate.test.ts`

**Interfaces:**
- Consumes: revised engine types (Task 7), `presets` table (Task 18), `start_game` RPC (Task 10)
- Produces:
  - `validateRulesConfig(rules: RulesConfig): string | null` — null when valid, else user-readable copy. **Ledger carry (M4): rules are validated BEFORE the engine or DB ever sees them**, and integer-only scale entries close the fractional-but-balanced hole deferred from Task 5.
  - `<RulesForm value onChange />` with a three-option segmented shooter control (off / half / full)
  - `savePreset(name: string, rules: RulesConfig): Promise<{ error?: string }>`
  - `startGame(gameId, 'app', rules)` goes live; the App picker button enables; **chips stays the preselected default**

- [ ] **Step 1: Write the failing validation test** — `tests/engine/validate.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { validateRulesConfig } from '../../src/lib/engine/validate';
import { DEFAULT_RULES } from '../../src/lib/engine/defaults';

describe('validateRulesConfig (trust boundary for rules)', () => {
  it('accepts the defaults', () => {
    expect(validateRulesConfig(DEFAULT_RULES)).toBeNull();
  });
  it.each([
    ['fractional scale entry (the fractional-but-balanced hole from Task 5)', { ...DEFAULT_RULES, taiToPoints: [0, 1, 2, 4, 8, 16.5] }],
    ['zero scale entry', { ...DEFAULT_RULES, taiToPoints: [0, 0, 2, 4, 8, 16] }],
    ['scale length ≠ taiCap+1', { ...DEFAULT_RULES, taiToPoints: [0, 1, 2, 4] }],
    ['taiCap below minTai', { ...DEFAULT_RULES, taiCap: 0 }],
    ['minTai below 1', { ...DEFAULT_RULES, minTai: 0 }],
    ['fractional display total', { ...DEFAULT_RULES, startingDisplayTotal: 400.5 }],
    ['unknown shooter', { ...DEFAULT_RULES, shooter: 'double' as never }],
  ])('rejects %s with a user-readable message', (_label, rules) => {
    expect(validateRulesConfig(rules)).toEqual(expect.any(String));
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/engine/validate.test.ts` → FAIL (module missing)

- [ ] **Step 3: Implement** — `src/lib/engine/validate.ts`

```ts
import type { RulesConfig } from './types';

/** Ledger carry (M4): validate a rules config BEFORE the engine or DB sees it. Null = valid. */
export function validateRulesConfig(rules: RulesConfig): string | null {
  if (!Number.isInteger(rules.minTai) || rules.minTai < 1) return 'minimum tai must be a whole number of at least 1';
  if (!Number.isInteger(rules.taiCap) || rules.taiCap < rules.minTai) return 'tai cap must be a whole number at or above the minimum tai';
  if (rules.taiToPoints.length !== rules.taiCap + 1) return 'the points scale needs exactly one entry per tai up to the cap';
  if (rules.taiToPoints.some((p, i) => i > 0 && (!Number.isInteger(p) || p < 1)))
    return 'every scale entry must be a whole number of at least 1'; // integers only: closes the fractional-but-balanced hole
  if (!Number.isInteger(rules.startingDisplayTotal) || !Number.isInteger(rules.bustLine))
    return 'display totals must be whole numbers';
  if (!['off', 'half', 'full'].includes(rules.shooter)) return 'unknown shooter mode';
  return null;
}
```

- [ ] **Step 4: Run to verify pass** — `npx vitest run tests/engine/validate.test.ts` → PASS

- [ ] **Step 5: Rules form** — `src/components/RulesForm.tsx`

```tsx
'use client';
import type { RulesConfig, ShooterMode } from '../lib/engine/types';

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
      <div className="flex flex-col gap-1">
        <span>Shooter</span>
        <div className="flex gap-2">
          {(['off', 'half', 'full'] as ShooterMode[]).map((s) => (
            <button key={s} type="button" onClick={() => set({ shooter: s })}
              className={`flex-1 rounded border px-3 py-2 capitalize ${value.shooter === s ? 'bg-black text-white dark:bg-white dark:text-black' : ''}`}>
              {s}
            </button>
          ))}
        </div>
        <span className="text-xs opacity-60">
          Off: everyone pays, discarder double. Half: discarder pays only their share, winner takes half. Full: discarder pays everything.
        </span>
      </div>
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

- [ ] **Step 6: Preset action** — `src/lib/actions/presets.ts`

```ts
'use server';
import { createServerSupabase } from '../supabase/server';
import { createAdminClient } from '../supabase/admin';
import { validateRulesConfig } from '../engine/validate';
import type { RulesConfig } from '../engine/types';

export async function savePreset(name: string, rules: RulesConfig): Promise<{ error?: string }> {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'not signed in' };
  if (!name.trim()) return { error: 'preset needs a name' };
  const problem = validateRulesConfig(rules);
  if (problem) return { error: problem };
  const admin = createAdminClient();
  const { error } = await admin.from('presets').insert({ owner: user.id, name: name.trim(), rules });
  return error ? { error: error.message } : {};
}
```

- [ ] **Step 7: Activate the app path in `startGame`** — replace the Task 13 guard line in `src/lib/actions/game.ts`:

```ts
import { validateRulesConfig } from '../engine/validate';

export async function startGame(gameId: string, mode: 'chips' | 'app', rules?: RulesConfig): Promise<{ error?: string }> {
  try {
    const user = await requireUser();
    const { admin } = await requireParticipant(gameId, user.id);
    if (mode === 'app') {
      if (!rules) return { error: 'app mode needs a rules config' };
      const problem = validateRulesConfig(rules);   // ledger M4: BEFORE the engine or DB sees them
      if (problem) return { error: problem };
    }
    const { error } = await admin.rpc('start_game', {
      p_game_id: gameId, p_mode: mode, p_rules: mode === 'app' ? rules : null,
    });
    if (error) return { error: error.message };
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'failed to start' };
  }
}
```

- [ ] **Step 8: FormingScreen with a live mode picker** — full replacement of `src/app/game/[id]/FormingScreen.tsx`:

```tsx
'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChipSetCard } from '../../../components/ChipSetCard';
import { RulesForm } from '../../../components/RulesForm';
import { DEFAULT_RULES } from '../../../lib/engine/defaults';
import type { RulesConfig } from '../../../lib/engine/types';
import { startGame } from '../../../lib/actions/game';
import { createClient } from '../../../lib/supabase/client';

type P = { playerId: string; seat: 'E' | 'S' | 'W' | 'N'; name: string };
type Preset = { id: string; name: string; rules: RulesConfig };

export function FormingScreen({ gameId, players, presets }: { gameId: string; players: P[]; presets: Preset[] }) {
  const router = useRouter();
  const [mode, setMode] = useState<'chips' | 'app'>('chips'); // chips is the PRESELECTED DEFAULT (Bryan 2026-08-08)
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
    const res = await startGame(gameId, mode, mode === 'app' ? rules : undefined);
    if (res.error) setError(res.error);
    else router.refresh();
  };

  return (
    <main className="mx-auto flex max-w-md flex-col gap-4 p-6">
      <h1 className="text-xl font-bold">Forming game</h1>
      <ul className="rounded-lg border p-4">
        {(['E', 'S', 'W', 'N'] as const).map((s) => {
          const p = players.find((x) => x.seat === s);
          return (
            <li key={s} className="flex justify-between py-1">
              <span className="font-mono">{s}</span><span>{p ? p.name : '— tap to join —'}</span>
            </li>
          );
        })}
      </ul>

      <h2 className="font-semibold">Mode</h2>
      <div className="flex gap-2">
        <button onClick={() => setMode('chips')}
          className={`flex-1 rounded-lg border px-4 py-3 font-medium ${mode === 'chips' ? 'border-2 border-black dark:border-white' : 'opacity-60'}`}>
          Chips{mode === 'chips' ? ' ✓' : ''}
        </button>
        <button onClick={() => setMode('app')}
          className={`flex-1 rounded-lg border px-4 py-3 font-medium ${mode === 'app' ? 'border-2 border-black dark:border-white' : 'opacity-60'}`}>
          App scorekeeper{mode === 'app' ? ' ✓' : ''}
        </button>
      </div>

      {mode === 'chips' ? (
        <ChipSetCard />
      ) : (
        <>
          {presets.length > 0 && (
            <div className="flex flex-col gap-2">
              <h2 className="font-semibold">Your presets</h2>
              {/* spec §8.1: a short list of LARGE buttons, not a dropdown */}
              {presets.map((p) => (
                <button key={p.id} onClick={() => setRules(p.rules)}
                  className="rounded-lg border px-4 py-3 text-left">
                  <span className="font-medium">{p.name}</span>
                  <span className="block text-sm opacity-60">
                    shooter {p.rules.shooter} · min {p.rules.minTai} · cap {p.rules.taiCap}
                  </span>
                </button>
              ))}
            </div>
          )}
          <h2 className="font-semibold">Rules for this game</h2>
          {/* tweaking a loaded preset here affects only this game — the snapshot, not the saved preset */}
          <RulesForm value={rules} onChange={setRules} />
        </>
      )}

      <button onClick={onStart} disabled={!full}
        className="rounded-lg border px-6 py-3 font-medium disabled:opacity-40">
        {full ? 'Start game' : `Waiting for players (${players.length}/4)`}
      </button>
      {error && <p className="text-red-600">{error}</p>}
    </main>
  );
}
```

And in `src/app/game/[id]/page.tsx`, fetch the current user's presets for the forming branch (RLS scopes the read to their own):

```tsx
  if (game.status === 'forming') {
    const { data: presets } = await supabase.from('presets').select('id, name, rules').order('created_at');
    return <FormingScreen gameId={game.id} players={players} presets={presets ?? []} />;
  }
```

- [ ] **Step 9: Verify manually** — forming screen: chips still preselected on load; switching to App swaps the chip card for the rules form; the shooter control shows off/half/full with off active by default; entering a fractional scale value and starting → the validation copy appears and nothing starts; valid rules → `games.mode='app'`, `games.rules` snapshot present, shooter stored as a string. Chips path unchanged (regression check).
- [ ] **Step 10: Typecheck + tests + commit** — `npx tsc --noEmit && npm test && git add -A && git commit -m "feat: app-mode forming — three-way shooter rules form, validation, presets, live mode picker"`

---

### Task 20: Record-hand — server action + wizard (app mode)

> **⚠️ CARRIED FROM THE TASK 18 REVIEW — three things this task must not skip.**
> **(1) Nobody validates the actors yet.** `record_hand` never checks that `p_recorded_by` is seated in the game, and — worse — never checks that each movement's `player_id` is in `game_players` for that game. `void_hand` never checks `p_by` at all. A movement pair naming two people who are not at the table passes the zero-sum trigger cleanly and lands on both boards. 0001's `log_notable_claim` validates both the claimed player and the logger; the app-mode RPCs dropped that convention. **Decide explicitly where this lives — the RPC or this server action — and write it down. Silently having neither is how the leaderboard gets a phantom entry.**
> **(2) Keep the zero-value movement rows.** `settleWin` returns all four seats, with `0` for players protected under shooter FULL/HALF. `form_board` counts a hand for a player only if that player has a movement row in it, so filtering zeros out would silently give protected players a smaller denominator — and therefore a different qualifying threshold — than the winner.
> **(3) `least()` skips NULL in Postgres.** Already fixed in `skill_board`, but the same trap applies anywhere this task caps a value: `least(NULL, cap)` is `cap`, not NULL. A win recorded without a tai would otherwise score the full cap.

**Files:**
- Modify: `src/lib/actions/game.ts` (add `recordHand`)
- Create: `src/app/game/[id]/RecordHandWizard.tsx`

**Interfaces:**
- Consumes: `settleEvent` (Task 5, revised by Task 7), `record_hand` RPC (Task 18), `requireUser`/`requireParticipant` (Task 13)
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

    // Trust boundary (SDD ledger): the events crossed the network. Validate enums BEFORE the
    // engine sees them, and map JSON null → undefined for discarder — JSON has no undefined,
    // and settleWin throws on a null discarder read back for a self-draw.
    const WIN_KINDS = new Set(['self_draw', 'discard']);
    const BONUS_KINDS = new Set(['pair_dealt', 'pair_drawn', 'kong_concealed', 'kong_added', 'kong_exposed']);
    const SEAT_SET = new Set<string>(SEATS);
    const sanitize = (raw: ScoringEvent): ScoringEvent => {
      const d = (raw as { discarder?: Seat | null }).discarder ?? undefined; // null → undefined
      if (d !== undefined && !SEAT_SET.has(d)) throw new Error(`bad discarder ${d}`);
      if (raw.type === 'win') {
        if (!SEAT_SET.has(raw.winner) || !WIN_KINDS.has(raw.winKind)) throw new Error('bad win event');
        if (!Number.isInteger(raw.tai)) throw new Error('tai must be an integer');
        return { ...raw, discarder: d };
      }
      if (raw.type === 'bonus') {
        if (!SEAT_SET.has(raw.beneficiary) || !BONUS_KINDS.has(raw.kind)) throw new Error('bad bonus event');
        return { ...raw, discarder: d };
      }
      throw new Error('unknown event type');
    };

    // Server-side authority: compute movements with the engine (zero-sum asserted inside)
    const payload = events.map((rawEvent) => {
      const event = sanitize(rawEvent);
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

- [ ] **Step 3: Typecheck** — `npx tsc --noEmit` → clean (wizard is exercised end-to-end in Task 21)
- [ ] **Step 4: Commit** — `git commit -am "feat: record-hand server action + wizard with engine preview"`

---

### Task 21: App-mode live screen — totals, realtime, void, bust banner, save-preset

> **⚠️ CARRIED FROM THE TASK 18 REVIEW — notable hands can double-count the moment app mode ships.**
> `skill_board` adds win-event notables to `notable_claims` rows. `log_notable_claim` guards on `status = 'active'` but **not** on `mode = 'chips'`. So if this screen reuses the existing "Log notable hand" action instead of setting `notable_hand_id` on the win event, every app-mode notable is counted twice. Either set it on the win event, or add a `mode = 'chips'` assertion to `log_notable_claim`.
> **Also:** `void_hand` takes no `for update` on the games row — the only write RPC that doesn't (`record_hand`, `end_game`, and 0001's `log_notable_claim` all do). It locks `hands`, and `end_game` never touches `hands`, so the two have no mutual exclusion at all. A void racing an end writes `final_total`s that predate the void; the game still sums to zero, so **layer 3 never fires** and the two boards disagree permanently with nothing marking which is right. Since this task builds the void UI, fix the lock here if it has not already been done.

**Files:**
- Create (replacing the Task 13 stub): `src/app/game/[id]/GameLive.tsx`
- Modify: `src/lib/actions/game.ts` (add `voidHand`)

**Interfaces:**
- Consumes: `recordHand` + `RecordHandWizard` (Task 20), `void_hand` RPC (Task 18), `savePreset` (Task 19), realtime channels
- Produces:
  - `voidHand(handId: string, gameId: string): Promise<{ error?: string }>`
  - `GameLive({ gameId, status, rules, players, me, notableHands })` — the Task 13 shell already fetches and passes these exact props; this task replaces the stub

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

(Until Task 22 exists, stub `EndGamePanel.tsx` as a component rendering `null` with the exact props above — replaced in Task 22.)

- [ ] **Step 3: Save-these-rules button** — under the totals list in `GameLive.tsx` (add `import { savePreset } from '../../../lib/actions/presets';`):

```tsx
<button className="rounded border px-4 py-2 text-sm opacity-70"
  onClick={async () => {
    const nm = prompt('Preset name?');
    if (nm) { const r = await savePreset(nm, rules); if (r.error) alert(r.error); else alert('Saved.'); }
  }}>
  Save these rules as a preset
</button>
```

(A tweaked-then-saved rule set becomes a NEW preset; the game's own snapshot is already frozen on `games.rules`.)

- [ ] **Step 4: Verify manually, two browsers** — record a 4-tai discard win in browser A → totals update in browser B within ~a second without refresh; preview matched the committed movements; void the hand → totals return to start in both; `hands.voided` true, movements doubled (originals + reversal) in the dashboard; recorded rows survive a full page reload.
- [ ] **Step 5: Typecheck + tests + commit** — `npx tsc --noEmit && npm test`, then `git add -A && git commit -m "feat: live game screen — realtime totals, void, bust banner"`

---

### Task 22: App-mode end — quarantine, Telegram alert, reopen

> **⚠️ CARRIED FROM THE TASK 18 REVIEW — the alert as planned covers only ONE of two call sites.**
> This task puts the Telegram alert inside the `endGame()` **server action**. The tap route's stale-app branch does not call that action; it calls `admin.rpc('end_game')` directly and **discards the returned `'ended' | 'quarantined'`**. So after this task ships, a user-initiated end alerts and an abandoned-match end still does not — silently quarantining a game with nobody told. Spec §10 is explicit that layer 4 is quarantine **and** alert, and that an unread should-never-happen check is the same as no check. **Cover both call sites**, either by routing the tap route through `endGame()` or by alerting at both.
> **Also here:** `end_game` has no `sum(final_total) = 0` backstop, unlike its chip twin `confirm_chip_result`. Its layer-3 check reads ALL movements for the game while the per-seat write reads movements joined to `game_players` — different sets, so the check can pass while the four written totals do not sum to zero. Add the backstop (quarantine on failure) while touching this area.

**Files:**
- Create: `src/app/game/[id]/EndGamePanel.tsx` (replacing the Task 21 stub)
- Modify: `src/lib/actions/game.ts` (add `endGame`, `reopenGame`)

**Interfaces:**
- Consumes: `end_game` / `reopen_game` RPCs (Task 18), `sendAlert` (Task 15)
- Produces:
  - `endGame(gameId: string): Promise<{ error?: string; result?: 'ended'|'quarantined' }>`
  - `reopenGame(gameId: string): Promise<{ error?: string }>`
  - `EndGamePanel({ gameId, status, players, display })`

- [ ] **Step 1: Actions** — append to `src/lib/actions/game.ts`

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

- [ ] **Step 2: Panel** — `src/app/game/[id]/EndGamePanel.tsx`

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

- [ ] **Step 3 (BRYAN — skip if already done in Task 15's optional mini-gate): create the Telegram bot** — BotFather → `/newbot` → copy token into `.env.local` as `TELEGRAM_BOT_TOKEN`. Message the bot once, then `curl "https://api.telegram.org/bot<TOKEN>/getUpdates"` → `chat.id` → `TELEGRAM_CHAT_ID`.
- [ ] **Step 4: Verify manually** — end a dev game normally → `final_total`s written, status `ended`, boards-facing data intact, Reopen appears and works within the hour. Then force a quarantine: SQL-insert a lone unbalanced movement with the trigger disabled via a direct `set constraints all immediate`-free session (or temporarily `alter table point_movements disable trigger event_zero_sum`, insert `+1`, re-enable) → `endGame` → status `quarantined`, Telegram message arrives with players + link, banner shows. Clean up the test row and the game.
- [ ] **Step 5: Typecheck + commit** — `npx tsc --noEmit && git add -A && git commit -m "feat: end game, quarantine + telegram alert, one-hour reopen"`

---

### Task 23: Boards v2 live + production smoke test #2 (the app-mode night)

**Files:**
- Modify: `src/app/page.tsx` (Form tab goes live; Skill shows tai)

**Interfaces:**
- Consumes: `form_board` + `skill_board` v2 (Task 18), everything shipped through Task 22
- Produces: the complete two-mode product, verified in production

- [ ] **Step 1: Switch the Form tab live** — in `src/app/page.tsx`, replace the Task 16 query block with:

```tsx
  const VIEWS = { lifetime: 'lifetime_board', form: 'form_board', skill: 'skill_board' } as const;
  const ORDERS = { lifetime: 'total_points', form: 'avg_points_per_hand', skill: 'total_tai' } as const;
  const { data: rows } = user
    ? await supabase.from(VIEWS[board]).select('*').order(ORDERS[board], { ascending: false }).limit(50)
    : { data: null };
```

and replace the `board === 'form' ? <empty state> : <table>` branch with one table for all three boards, whose row cell reads:

```tsx
                    <td className="py-2 text-right font-mono">
                      {board === 'lifetime' && `${r.total_points} pts · ${r.games_played} games`}
                      {board === 'form' && `${r.avg_points_per_hand} / hand · ${r.hands_played} hands`}
                      {board === 'skill' && `${r.total_tai} tai · ${r.notable_wins} notable`}
                    </td>
```

and whose empty-state row reads:

```tsx
                {(rows ?? []).length === 0 && (
                  <tr><td className="py-4 opacity-60">
                    {board === 'form' ? 'Nobody has 20 hands yet.' : 'No finished games yet.'}
                  </td></tr>
                )}
```

- [ ] **Step 2: Deploy** — git push (the Vercel-linked repo auto-deploys) or `npx vercel --prod`. Zero type errors.

- [ ] **Step 3: Production smoke test #2 — a full app-mode game on phones**
  1. Tap in with four accounts → switch the picker to **App scorekeeper** (confirm chips was still the preselected default) → pick or configure rules (shooter off/half/full control) → Start; all four phones show the rules in force.
  2. Record a discard win (preview → confirm) → totals update on every phone within ~a second.
  3. Record a hand with a bonus event; void the first hand → totals reverse everywhere; the voided hand disappears from the list.
  4. End game → final totals written, status `ended`.
  5. Play one quick CHIP game at the same table → both games appear in Lifetime, points blending across modes; Form now shows app-mode averages (or the under-20-hands empty state — either is a pass if it matches the hand count); Skill shows tai from the app game plus every notable from both modes.
  6. Save the app game's rules as a preset; start another forming game → the preset appears as a large button.
- [ ] **Step 4: Commit** — `git commit -am "feat: form board live, skill tai display — boards v2 complete"`

---

## Self-Review (completed at revision time, 2026-08-08)

**Spec coverage check (revised spec, 2026-08-07/08):**
- §1/§3 dual mode, chips default → Tasks 10 (mode column), 13 (picker, chips preselected), 19 (App opt-in). §4 architecture → Tasks 1, 9, 11, 17. §5 data model, ten entities → Tasks 10 (chip spine incl. `notable_claims`) + 18 (app tables); rules + mode snapshotted at start (`start_game`). §6 rules engine → Tasks 2–5 revised by 7 (three-way shooter, HALF rows, 400/−1200); §6.7 chip set → Task 8 (module) + 13 (card + `/chips` page). §7 NFC gate → Task 12. §8.1 forming → 13/19; §8.2–8.5 app flows → 20/21/22; §8.6 chip end → 15 (entry, named-denomination recount, per-phone confirm, re-proposal resets — RPC-enforced); §8.7 notable claims → 14. §9 boards → 10 (v1 views) + 16 (UI) + 18 (v2 views) + 23 (UI); Lifetime mode-blind on `final_total`; Form threshold 20; Skill unions claims with win events. §10 → conservation failure = user-facing recount (15), quarantine app-only (`end_game` asserts mode, 18/22), chip games expire without results (12), zero-sum layers (18 trigger + drill, 22 alert), chip integrity layers (10: action pre-check / RPC backstop / row CHECK, drilled in 15). §11 → worked examples (3/4/7), property law over three shooter modes (7), conservation must-reject case (8), join races (6/12).
- §12 KIVs honoured: no rebuy affordance (8/15 copy = recount) · HALF×kong = everyone-pays assumption in one branch + one named test (7) · foreign flower pairs appear nowhere.
- Deliberate non-goals unchanged: no guests, dealer tracking, liability, in-place edit, admin UI, nightly re-verify (optional in spec), "X is recording" indicator (deferred consciously pre-revision; unchanged).

**Damage-map coverage (from the 2026-08-08 revision review):** 1,2,3 → T7 · 4 → T18 (view) + T23 (UI) · 5,6 → T10 · 7,8 → T13 (+T19 completes the picker) · 9 → T8+T15 · 10 → T8 · 11 → T10+T14 · 12 → T10 (lifetime v1) + T16 + T18 (skill v2) · 13 → T15 (recount) + T18 (`end_game` mode assert) · 14 → T12 · 15 → T10 (backstop decision) + T13/T19 (rules/presets scoped to app mode).

**SDD-ledger directives placed:** REJECT_COPY third entry + atomic create + deterministic select → T12 · unique(game_id, player_id) → T10 · jsdom/alias before first .tsx test → T13 · rules validation before engine (M4) + integer-scale (fractional-but-balanced) → T19 · null→undefined discarder mapping + enum trust boundary → T20 · guard-must-fail drills called out explicitly in T7, T8, T15 and inherited globally.

**Type consistency:** `ShooterMode` defined in T7, consumed by T19 (RulesForm) and T20 (sanitize) · `ChipCounts`/`ConservationResult` (T8) consumed by T15 and mirrored in T10 SQL with a source comment + pinning test · stub props pinned in T13 match implementations in T14 (ChipLive) and T21 (GameLive, `rules: RulesConfig`); ChipEndFlow stub props (T14) match T15 · `startGame(gameId, mode, rules?)` signature constant across T13→T19 · `record_hand` payload shape matches between T18 SQL and T20 action · `create_game_with_seat`/`expire_game`/`propose_chip_counts`/`confirm_chip_result`/`log_notable_claim` names match between T10 SQL and their T12/T14/T15 callers.

**Placeholder scan:** no TBDs; every code step carries real code. Forward-deferred verifications are explicit, not placeholders: T10's CHECK live-fire → T15 Step 8; the zero-sum trigger drill → T18 Step 4 (needs real players, which exist by then).

**Frozen-history note:** Tasks 1–6 text is pre-revision; Task 7 is the bridge. The one shipped delta (table_full in `decideJoin`, commit `1787872`) is flagged in the done-banner and consumed by T12's REJECT_COPY.
