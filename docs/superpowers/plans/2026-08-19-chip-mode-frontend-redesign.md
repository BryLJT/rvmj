# RVMJ Chip-Mode Frontend Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the rejected frontend with the approved Refined Tile Club interface across RVMJ's complete chip-mode journey while preserving the existing auth, NFC, realtime, chip arithmetic, database, and recovery behaviour.

**Architecture:** Keep async route components and their existing data reads as the server boundary, and keep the current client components responsible for realtime state and server-action calls. Add a small shared presentation layer, then recompose each screen around it; split the oversized chip-ending component into a controlled count form and a proposal-confirmation panel without moving any authoritative calculation into the browser.

**Tech Stack:** Next.js 16.3 App Router, React 19.2.8, TypeScript 5, Tailwind CSS 4, Supabase SSR/client/realtime, Vitest 4.1.10, Testing Library, Vercel

**Spec:** `docs/superpowers/specs/2026-08-19-chip-mode-frontend-design.md`

## Global Constraints

- Read the complete design spec before starting Task 1 and keep it open during every visual review.
- The existing uncommitted dark-green felt/brass draft is rejected. Replace its palette, typography, decorative language, and component treatment; do not preserve it as a baseline.
- Use exactly this approved palette: canvas `#F7F2E9`, surface `#FFFDF8`, ink `#142D37`, muted `#68797D`, divider `#D9D1C5`, cobalt `#2F6FE4`, soft cobalt `#E7EEFC`, coral `#ED6048`, soft coral `#FCE7E2`, gain green `#24715D`, soft green `#DEF1E9`, amber `#9A6315`, soft amber `#FBEFD2`.
- Use Sora through `next/font/google`; the browser must not fetch fonts from Google.
- Use the coral RVMJ tile as the single signature device. Keep information-dense and high-stakes screens otherwise flat and restrained.
- Ship chip mode only. Remove the disabled App scorekeeper choice from the forming screen, but leave server support and app-mode source files untouched.
- Keep one-phone entry of all four chip stacks followed by four-player confirmation.
- Do not change database schema, auth, NFC security, join decisions, chip arithmetic, permissions, RPC contracts, or server redirects.
- Do not add a package. Use React, Tailwind, Next.js, Supabase, and the existing test stack only.
- Keep all four players and all sixteen count fields on one scrollable page at 360 pixels wide without horizontal scrolling.
- Recount must clone the latest server proposal into the form on every phone; it must never start from zero when a proposal exists.
- Expected failures render inline, keep input, and restore the action. Do not use `window.alert` or `alert`.
- Every action blocks duplicate activation and communicates pending state. Destructive actions stay two-step.
- Realtime resubscribe and foreground visibility both trigger a fresh read before stale actions become usable.
- Full-screen panels use labelled modal semantics, initial focus, Escape dismissal where safe, tab containment, and focus restoration.
- Touch targets are at least 44 by 44 pixels, focus is cobalt and visible, colour is never the only state cue, and reduced-motion preferences are honored.
- Preserve all existing tests unless approved copy or structure requires a targeted assertion change; add regression coverage before changing behaviour.
- Next.js pages and layouts stay Server Components unless state, event handlers, browser APIs, or React hooks require a Client Component.
- Vitest unit tests may invoke synchronous components and explicitly awaited async page functions, but do not use Vitest to render a new async Server Component through React.
- The supported production build command in this environment is `npm run build -- --webpack` because Turbopack's local CSS worker cannot bind its port here.
- Add `.superpowers/` to `.gitignore`; never commit brainstorming output.
- `next-env.d.ts` is generated churn. Restore its committed `.next/types/` imports after verification and never stage it.
- Preserve unrelated user changes. Stage exact paths for every commit; never use `git add .`, `git reset --hard`, or `git checkout --`.
- Before the final push, Bryan must explicitly confirm the target branch. The currently planned target is `origin/main`, but no push occurs until that gate is answered.
- Run the four-session rehearsal against local or disposable test data. Do not create, void, reopen, or settle a production game unless Bryan explicitly approves production-data mutation.

---

## File map

### New shared files

| File | Responsibility |
|---|---|
| `src/components/ui.tsx` | Server-safe static interface primitives: frame, brand, header, buttons, seat/player rows, status/live region, and state page |
| `src/components/FullScreenPanel.tsx` | Client-only accessible full-screen dialog, focus containment, Escape handling, and focus restoration |
| `src/components/FormActionButton.tsx` | Client-only pending state for buttons nested in server-action forms |
| `src/app/game/[id]/chip-view.ts` | Shared frontend-only player, proposal, and four-seat count types/helpers |
| `src/app/game/[id]/ChipCountForm.tsx` | Controlled sixteen-field count overview and sticky summary/action |
| `src/app/game/[id]/ChipConfirmPanel.tsx` | Shared proposal review, named confirmation progress, and confirm/recount actions |
| `src/app/game/[id]/ReopenGameControl.tsx` | Two-step reopen control with inline failure and pending states |
| `src/app/loading.tsx` | Branded route loading state |
| `src/app/error.tsx` | Branded recoverable route error state using Next's `retry()` contract |
| `src/app/not-found.tsx` | Branded global not-found state |

### New tests

| File | Responsibility |
|---|---|
| `tests/components/SharedUi.test.tsx` | Shared primitive semantics, pending state, seats, and status roles |
| `tests/components/FullScreenPanel.test.tsx` | Dialog naming, focus entry, Escape, tab containment, and focus return |
| `tests/components/AppStates.test.tsx` | Loading, route-error retry, and not-found actions |
| `tests/components/LoginPage.test.tsx` | OAuth return address, pending lock, and inline sign-in failure |
| `tests/components/FormingScreen.test.tsx` | Stable seats, chip-only mode, start gating, and failed start recovery |
| `tests/components/NotableLogger.test.tsx` | Selection gating, input preservation, failure recovery, and success close |
| `tests/components/ChipCountForm.test.tsx` | Sixteen labelled fields, totals, sticky action, and validation copy |
| `tests/components/ChipConfirmPanel.test.tsx` | Signed results, named progress, confirm gating, failure recovery, and recount callback |
| `tests/components/ReopenGameControl.test.tsx` | Two-step reopen, pending lock, failure recovery, and success callback |

### Existing files intentionally modified

- `.gitignore`
- `src/app/layout.tsx`
- `src/app/globals.css`
- `src/app/page.tsx`
- `src/app/login/page.tsx`
- `src/app/chips/page.tsx`
- `src/components/ChipSetCard.tsx`
- `src/app/t/[secret]/page.tsx`
- `src/app/t/[secret]/StartNewMatch.tsx`
- `src/app/game/[id]/page.tsx`
- `src/app/game/[id]/GameTopBar.tsx`
- `src/app/game/[id]/FormingScreen.tsx`
- `src/app/game/[id]/ChipLive.tsx`
- `src/app/game/[id]/NotableLogger.tsx`
- `src/app/game/[id]/ChipEndFlow.tsx`
- `tests/components/HomeBoards.test.tsx`
- `tests/components/ChipSetCard.test.tsx`
- `tests/components/GameTopBar.test.tsx`
- `tests/components/StartNewMatch.test.tsx`
- `tests/components/ChipLive.test.tsx`
- `tests/components/ChipEndFlow.test.tsx`

`src/lib/actions/game.ts`, `src/lib/chips.ts`, `src/lib/join.ts`, Supabase helpers, migrations, middleware, and `GameLive.tsx` are read-only for this plan.

---

### Task 1: Refined Tile Club foundation and shared primitives

**Files:**
- Modify: `.gitignore`
- Modify: `src/app/layout.tsx`
- Modify: `src/app/globals.css`
- Create: `src/components/ui.tsx`
- Create: `src/components/FullScreenPanel.tsx`
- Test: `tests/components/SharedUi.test.tsx`
- Test: `tests/components/FullScreenPanel.test.tsx`

**Interfaces:**
- Consumes: React's standard element attributes and `Seat` from `src/lib/engine/types.ts`.
- Produces: `AppFrame`, `BrandMark`, `PageHeader`, `Button`, `ActionLink`, `SeatBadge`, `PlayerRow`, `StatusMessage`, `LiveRegion`, and `StatePage` from `src/components/ui.tsx`.
- Produces: `FullScreenPanel({ title, eyebrow?, onDismiss?, children, footer? })` from `src/components/FullScreenPanel.tsx`.
- `Button` accepts native button props plus `variant?: 'primary' | 'secondary' | 'destructive' | 'quiet'`, `busy?: boolean`, and `busyLabel?: string`.
- `StatusMessage` accepts `tone: 'info' | 'success' | 'warning' | 'error'`, optional `title`, and children; the error variant uses `role="alert"`, all others use `role="status"`.

- [ ] **Step 1: Write failing shared-primitive tests**

Create `tests/components/SharedUi.test.tsx` with focused assertions:

```tsx
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { BrandMark, Button, PlayerRow, StatusMessage } from '../../src/components/ui';

afterEach(cleanup);

describe('Refined Tile Club primitives', () => {
  it('gives the brand tile one accessible RVMJ name', () => {
    render(<BrandMark />);
    expect(screen.getByRole('img', { name: 'RVMJ' })).toBeDefined();
  });

  it('locks a busy action and announces its operation', () => {
    const onClick = vi.fn();
    render(<Button busy busyLabel="Checking counts…" onClick={onClick}>Check all counts</Button>);
    const button = screen.getByRole('button', { name: 'Checking counts…' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('names a seat and marks the local player in words', () => {
    render(<PlayerRow seat="E" name="Bryan" isMe trailing={<span>+120</span>} />);
    expect(screen.getByText('East')).toBeDefined();
    expect(screen.getByText('Bryan (you)')).toBeDefined();
    expect(screen.getByText('+120')).toBeDefined();
  });

  it('uses alert semantics only for failures', () => {
    const { rerender } = render(<StatusMessage tone="warning">Recount the $10 chips.</StatusMessage>);
    expect(screen.getByRole('status')).toBeDefined();
    rerender(<StatusMessage tone="error">Could not reach the table.</StatusMessage>);
    expect(screen.getByRole('alert')).toBeDefined();
  });

  it('mounts a live region before its message changes', () => {
    const { container, rerender } = render(<LiveRegion tone="error" />);
    const region = container.querySelector('[aria-live="assertive"]');
    expect(region?.textContent).toBe('');
    rerender(<LiveRegion tone="error" message="Could not reach the table." />);
    expect(container.querySelector('[aria-live="assertive"]')).toBe(region);
    expect(region?.textContent).toContain('Could not reach the table.');
  });
});
```

Add `LiveRegion` to the imports in this test.

- [ ] **Step 2: Run the shared tests and verify the missing module failure**

Run: `npm test -- tests/components/SharedUi.test.tsx`

Expected: FAIL because `src/components/ui.tsx` does not exist.

- [ ] **Step 3: Implement the palette, typography, and static primitives**

In `src/app/layout.tsx`, replace Archivo/Geist with Sora and keep the layout server-rendered:

```tsx
import type { Metadata } from 'next';
import { Sora } from 'next/font/google';
import './globals.css';

const sora = Sora({
  variable: '--font-sora',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
});

export const metadata: Metadata = {
  title: 'RVMJ Leaderboard',
  description: 'Mahjong scores and lifetime leaderboard. Tap your seat to play.',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={`${sora.variable} h-full antialiased`}>
      <body className="min-h-full bg-canvas text-ink">{children}</body>
    </html>
  );
}
```

Replace `src/app/globals.css` with the approved tokens and global behaviour:

```css
@import "tailwindcss";

:root {
  --canvas: #F7F2E9;
  --surface: #FFFDF8;
  --ink: #142D37;
  --muted: #68797D;
  --divider: #D9D1C5;
  --cobalt: #2F6FE4;
  --cobalt-soft: #E7EEFC;
  --coral: #ED6048;
  --coral-soft: #FCE7E2;
  --gain: #24715D;
  --gain-soft: #DEF1E9;
  --amber: #9A6315;
  --amber-soft: #FBEFD2;
}

@theme inline {
  --color-canvas: var(--canvas);
  --color-surface: var(--surface);
  --color-ink: var(--ink);
  --color-muted: var(--muted);
  --color-divider: var(--divider);
  --color-cobalt: var(--cobalt);
  --color-cobalt-soft: var(--cobalt-soft);
  --color-coral: var(--coral);
  --color-coral-soft: var(--coral-soft);
  --color-gain: var(--gain);
  --color-gain-soft: var(--gain-soft);
  --color-amber: var(--amber);
  --color-amber-soft: var(--amber-soft);
  --font-sans: var(--font-sora);
}

html { background: var(--canvas); color-scheme: light; }
body {
  min-width: 320px;
  background: var(--canvas);
  color: var(--ink);
  font-family: var(--font-sora), system-ui, sans-serif;
  -webkit-font-smoothing: antialiased;
}
.tnum { font-variant-numeric: tabular-nums; font-feature-settings: "tnum"; }
:focus-visible { outline: 3px solid var(--cobalt); outline-offset: 3px; }
button, a, input, select { -webkit-tap-highlight-color: transparent; }
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    scroll-behavior: auto !important;
    transition-duration: 0.01ms !important;
  }
}
```

Implement `src/components/ui.tsx` with these exact structural rules:

```tsx
import Link from 'next/link';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import type { Seat } from '../lib/engine/types';

const seats: Record<Seat, string> = { E: 'East', S: 'South', W: 'West', N: 'North' };
const buttonTone = {
  primary: 'border-cobalt bg-cobalt text-white shadow-[0_3px_0_#142D37]',
  secondary: 'border-ink bg-surface text-ink',
  destructive: 'border-coral bg-coral text-white',
  quiet: 'border-transparent bg-transparent text-muted',
} as const;

export function AppFrame({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <main className={`mx-auto flex min-h-svh w-full max-w-3xl flex-col px-5 py-7 sm:px-8 sm:py-10 ${className}`}>{children}</main>;
}

export function BrandMark() {
  return (
    <div className="inline-flex items-center gap-3" role="img" aria-label="RVMJ">
      <span aria-hidden="true" className="grid size-11 grid-cols-2 gap-1 rounded-[11px] border-2 border-ink bg-coral p-2 shadow-[3px_3px_0_#142D37]">
        <span className="rounded-full bg-surface" /><span className="rounded-full bg-surface" />
        <span className="rounded-full bg-surface" /><span className="rounded-full bg-surface" />
      </span>
      <span aria-hidden="true" className="text-xl font-extrabold tracking-[-0.04em]">RVMJ</span>
    </div>
  );
}

export function PageHeader({ title, description, eyebrow, backHref }: {
  title: string; description?: string; eyebrow?: string; backHref?: string;
}) {
  return (
    <header className="mb-7">
      {backHref ? <Link href={backHref} className="mb-5 inline-flex min-h-11 items-center font-semibold text-cobalt">← Back</Link> : <BrandMark />}
      {eyebrow ? <p className="mt-6 text-xs font-bold uppercase tracking-[0.18em] text-coral">{eyebrow}</p> : null}
      <h1 className="mt-3 max-w-2xl text-3xl font-extrabold leading-tight tracking-[-0.04em] sm:text-4xl">{title}</h1>
      {description ? <p className="mt-3 max-w-2xl text-sm leading-6 text-muted sm:text-base">{description}</p> : null}
    </header>
  );
}

export function Button({ variant = 'primary', busy = false, busyLabel = 'Working…', disabled, type = 'button', className = '', children, ...props }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof buttonTone; busy?: boolean; busyLabel?: string }) {
  return (
    <button {...props} type={type} disabled={disabled || busy} aria-busy={busy || undefined}
      className={`min-h-11 rounded-[10px] border-2 px-4 py-3 font-bold transition-[transform,box-shadow,opacity] active:translate-y-px disabled:cursor-not-allowed disabled:opacity-45 ${buttonTone[variant]} ${className}`}>
      {busy ? busyLabel : children}
    </button>
  );
}

export function ActionLink({ href, children, variant = 'secondary', className = '' }: {
  href: string; children: ReactNode; variant?: keyof typeof buttonTone; className?: string;
}) {
  return <Link href={href} className={`inline-flex min-h-11 items-center justify-center rounded-[10px] border-2 px-4 py-3 text-center font-bold ${buttonTone[variant]} ${className}`}>{children}</Link>;
}

export function SeatBadge({ seat }: { seat: Seat }) {
  return <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-[10px] border-2 border-ink bg-cobalt-soft text-sm font-extrabold" aria-label={seats[seat]}>{seat}</span>;
}

export function PlayerRow({ seat, name, isMe = false, trailing, muted = false }: {
  seat: Seat; name: string; isMe?: boolean; trailing?: ReactNode; muted?: boolean;
}) {
  return (
    <li className="flex min-h-16 items-center gap-3 border-b border-divider py-2 last:border-b-0">
      <SeatBadge seat={seat} />
      <div className="min-w-0 flex-1"><p className={`truncate font-bold ${muted ? 'text-muted' : 'text-ink'}`}>{name}{isMe ? ' (you)' : ''}</p><p className="text-xs text-muted">{seats[seat]}</p></div>
      {trailing ? <div className="shrink-0">{trailing}</div> : null}
    </li>
  );
}

const statusTone = {
  info: 'border-cobalt/30 bg-cobalt-soft text-ink',
  success: 'border-gain/30 bg-gain-soft text-gain',
  warning: 'border-amber/30 bg-amber-soft text-amber',
  error: 'border-coral/30 bg-coral-soft text-ink',
} as const;

export function StatusMessage({ tone, title, children, className = '' }: {
  tone: keyof typeof statusTone; title?: string; children: ReactNode; className?: string;
}) {
  return <div role={tone === 'error' ? 'alert' : 'status'} className={`rounded-[12px] border px-4 py-3 text-sm leading-6 ${statusTone[tone]} ${className}`}>{title ? <p className="font-bold">{title}</p> : null}<div>{children}</div></div>;
}

export function LiveRegion({ tone = 'info', title, message }: {
  tone?: keyof typeof statusTone; title?: string; message?: string;
}) {
  return <div aria-live={tone === 'error' ? 'assertive' : 'polite'} aria-atomic="true">{message ? <StatusMessage tone={tone} title={title}>{message}</StatusMessage> : null}</div>;
}

export function StatePage({ tone, title, description, action }: {
  tone: 'info' | 'warning' | 'error'; title: string; description: string; action?: ReactNode;
}) {
  return <AppFrame className="justify-center"><PageHeader title={title} /><StatusMessage tone={tone}>{description}</StatusMessage>{action ? <div className="mt-5 flex flex-col gap-3">{action}</div> : null}</AppFrame>;
}
```

Append `.superpowers/` to `.gitignore`. Do not stage or delete the current local brainstorming directory.

- [ ] **Step 4: Run the shared-primitive test and verify it passes**

Run: `npm test -- tests/components/SharedUi.test.tsx`

Expected: PASS.

- [ ] **Step 5: Write failing full-screen-panel tests**

Create `tests/components/FullScreenPanel.test.tsx`:

```tsx
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { FullScreenPanel } from '../../src/components/FullScreenPanel';

afterEach(cleanup);

describe('FullScreenPanel', () => {
  it('names the modal, moves focus in, closes on Escape, and restores focus', () => {
    const close = vi.fn();
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const { unmount } = render(<FullScreenPanel title="Count chips" onDismiss={close}><button>First action</button></FullScreenPanel>);
    expect(screen.getByRole('dialog').getAttribute('aria-modal')).toBe('true');
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Count chips' }));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(close).toHaveBeenCalledTimes(1);
    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it('wraps Tab focus inside the dialog', () => {
    render(<FullScreenPanel title="Confirm count"><button>First</button><button>Last</button></FullScreenPanel>);
    const first = screen.getByRole('button', { name: 'First' });
    const last = screen.getByRole('button', { name: 'Last' });
    last.focus();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Tab' });
    expect(document.activeElement).toBe(first);
    first.focus();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });
});
```

- [ ] **Step 6: Run the panel test and verify the missing module failure**

Run: `npm test -- tests/components/FullScreenPanel.test.tsx`

Expected: FAIL because `src/components/FullScreenPanel.tsx` does not exist.

- [ ] **Step 7: Implement focus-safe full-screen panels**

Create `src/components/FullScreenPanel.tsx` as a Client Component. Use one generated title id, store `document.activeElement` on mount, focus the heading, restore focus on unmount, close on Escape only when `onDismiss` exists, and wrap Tab between these selectors:

```ts
const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
```

The rendered contract is:

```tsx
<div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={titleId}
  className="fixed inset-0 z-50 overflow-y-auto bg-canvas">
  <div className="mx-auto flex min-h-svh w-full max-w-3xl flex-col px-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-7 sm:px-8">
    <header className="mb-6 flex items-start justify-between gap-4">
      <div><p className="text-xs font-bold uppercase tracking-[0.18em] text-coral">{eyebrow}</p><h2 ref={titleRef} tabIndex={-1} id={titleId} className="mt-2 text-3xl font-extrabold tracking-[-0.04em]">{title}</h2></div>
      {onDismiss ? <Button variant="quiet" onClick={onDismiss} aria-label={`Close ${title}`}>Close</Button> : null}
    </header>
    <div className="flex-1">{children}</div>
    {footer ? <footer className="mt-6">{footer}</footer> : null}
  </div>
</div>
```

Generate `titleId` with `useId()`. Attach the keyboard handler to the panel and use `querySelectorAll<HTMLElement>(FOCUSABLE)` to wrap Tab from last to first and Shift+Tab from first to last.

- [ ] **Step 8: Run both foundation test files**

Run: `npm test -- tests/components/SharedUi.test.tsx tests/components/FullScreenPanel.test.tsx`

Expected: PASS.

- [ ] **Step 9: Commit the foundation**

```bash
git add -- .gitignore src/app/layout.tsx src/app/globals.css src/components/ui.tsx src/components/FullScreenPanel.tsx tests/components/SharedUi.test.tsx tests/components/FullScreenPanel.test.tsx
git diff --cached --check
git commit -m "feat: add refined tile club interface system"
```

---

### Task 2: Home, sign-in, chip guide, and route states

**Files:**
- Modify: `src/app/page.tsx`
- Modify: `src/app/login/page.tsx`
- Modify: `src/app/chips/page.tsx`
- Modify: `src/components/ChipSetCard.tsx`
- Create: `src/app/loading.tsx`
- Create: `src/app/error.tsx`
- Create: `src/app/not-found.tsx`
- Modify: `tests/components/HomeBoards.test.tsx`
- Modify: `tests/components/ChipSetCard.test.tsx`
- Create: `tests/components/AppStates.test.tsx`
- Create: `tests/components/LoginPage.test.tsx`

**Interfaces:**
- Consumes: Task 1's `AppFrame`, `PageHeader`, `BrandMark`, `Button`, `ActionLink`, `StatusMessage`, `LiveRegion`, and `StatePage`.
- Preserves: `Home({ searchParams: Promise<{ board?: string }> })`, the exact board query/table/order behaviour, and `ChipSetCard()` deriving every value from `src/lib/chips.ts`.
- Produces: branded global loading, retryable error, and not-found boundaries used by all routes.

- [ ] **Step 1: Update board tests before changing the home page**

Keep all current database/query assertions. Replace the rejected-draft presentation assertions with these approved behaviours:

```tsx
it('marks the selected board and keeps signed score semantics', async () => {
  db.result = {
    data: [
      { id: 'p1', display_name: 'Ah Seng', total_points: 32, games_played: 3 },
      { id: 'p2', display_name: 'Bryan', total_points: -32, games_played: 3 },
    ],
    error: null,
  };
  await renderHome('lifetime');
  expect(screen.getByRole('link', { name: 'Lifetime' }).getAttribute('aria-current')).toBe('page');
  expect(screen.getByText('+32')).toBeDefined();
  expect(screen.getByText('-32')).toBeDefined();
  expect(screen.getAllByText('3 games')).toHaveLength(2);
});

it('keeps an unavailable Form board honest and read-only', async () => {
  await renderHome('form');
  expect(db.queries).toEqual([]);
  expect(screen.getByText(/Form uses per-hand games/)).toBeDefined();
  expect(screen.queryByRole('button', { name: /scorekeeper/i })).toBeNull();
});
```

Retain the existing tests for signed-out access, different Lifetime/Skill member sets, true empty copy, and query failure versus empty data.

- [ ] **Step 2: Run the home-board test and verify the new copy/structure fails**

Run: `npm test -- tests/components/HomeBoards.test.tsx`

Expected: FAIL on the new Form copy and approved markup.

- [ ] **Step 3: Recompose the home page without changing its reads**

Delete `ZeroLineBar`, `CountBar`, every felt/brass class, and their scale calculation. Keep the current authentication and board query block unchanged. Render:

- `AppFrame` with a `BrandMark` and the heading `Table standings`.
- A three-link tab rail with `aria-label="Leaderboard"` and `aria-current="page"` on the selected link.
- Signed-out copy: `Sign in to see the boards. To play, tap your seat at the table.` and an `ActionLink` to `/login`.
- Form copy: `Form uses per-hand games. Chip mode is the only live mode right now.` without issuing a query.
- Query failure through `StatusMessage tone="error"` with `Couldn’t load the {title} board just now. Refresh to try again.`
- Empty Lifetime copy `No finished games yet.` and empty Skill copy `No notable hands claimed yet.` through informational status panels.
- Populated rows as an ordered list. Each row has rank, name, context, and a tabular score; positive values use a visible plus sign and `text-gain`, negative values retain the minus and use `text-coral`, zero uses `text-muted`.
- The chip guide link under the board as `ActionLink href="/chips" variant="secondary"` labelled `View the standard chip set`.

The row calculation remains explicit:

```tsx
const value = Number(board === 'lifetime' ? row.total_points : row.notable_wins) || 0;
const shown = board === 'lifetime' && value > 0 ? `+${value}` : String(value);
const scoreTone = board !== 'lifetime' ? 'text-ink' : value > 0 ? 'text-gain' : value < 0 ? 'text-coral' : 'text-muted';
```

- [ ] **Step 4: Run the board tests**

Run: `npm test -- tests/components/HomeBoards.test.tsx`

Expected: PASS.

- [ ] **Step 5: Add route-state tests before creating the boundaries**

Create `tests/components/AppStates.test.tsx`. Mock `next/navigation` only for the not-found link if the renderer requires it. Cover these exact contracts:

```tsx
it('renders a branded loading status', () => {
  render(<Loading />);
  expect(screen.getByRole('status').textContent).toContain('Loading the table…');
});

it('lets a failed route retry in place', () => {
  const retry = vi.fn();
  render(<ErrorPage error={new Error('network down')} retry={retry} />);
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(retry).toHaveBeenCalledTimes(1);
});

it('gives an unknown route a way home', () => {
  render(<NotFound />);
  expect(screen.getByRole('link', { name: 'Back to the leaderboard' }).getAttribute('href')).toBe('/');
});
```

Import `Loading`, `ErrorPage`, and `NotFound` from their route files and include the required Vitest/Testing Library imports and `afterEach(cleanup)`.

- [ ] **Step 6: Run the route-state test and verify the missing module failures**

Run: `npm test -- tests/components/AppStates.test.tsx`

Expected: FAIL because the three route-state modules do not exist.

- [ ] **Step 7: Implement loading, error, and not-found states**

Use these exact player-facing messages:

```tsx
// loading.tsx
export default function Loading() {
  return <StatePage tone="info" title="Getting the table ready" description="Loading the table…" />;
}

// not-found.tsx
export default function NotFound() {
  return <StatePage tone="warning" title="Nothing at this address" description="The page may have moved or the link may be incomplete." action={<ActionLink href="/">Back to the leaderboard</ActionLink>} />;
}
```

`src/app/error.tsx` must begin with `'use client'`, accept Next 16's `retry()` prop, log the original `error` in `useEffect`, and render `StatePage` with title `The table didn’t load`, description `Check your connection, then try this screen again.`, and a `Button` labelled `Try again` that calls `retry`.

- [ ] **Step 8: Write sign-in state tests before changing its action**

Create `tests/components/LoginPage.test.tsx`. Mock `useSearchParams()` to return `/t/east-secret`, mock `createClient().auth.signInWithOAuth`, and cover the exact redirect plus failure recovery:

```tsx
it('preserves the table return address and blocks duplicate sign-in taps', async () => {
  let release!: (value: { error: null }) => void;
  signInWithOAuth.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
  render(<LoginPage />);
  const button = screen.getByRole('button', { name: 'Sign in with Google' });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(signInWithOAuth).toHaveBeenCalledTimes(1);
  expect(signInWithOAuth).toHaveBeenCalledWith({
    provider: 'google',
    options: { redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent('/t/east-secret')}` },
  });
  expect((screen.getByRole('button', { name: 'Opening Google…' }) as HTMLButtonElement).disabled).toBe(true);
  release({ error: null });
});

it('shows an OAuth failure inline and restores the action', async () => {
  signInWithOAuth.mockResolvedValueOnce({ error: { message: 'provider unavailable' } });
  render(<LoginPage />);
  fireEvent.click(screen.getByRole('button', { name: 'Sign in with Google' }));
  expect((await screen.findByRole('alert')).textContent).toContain('provider unavailable');
  expect((screen.getByRole('button', { name: 'Sign in with Google' }) as HTMLButtonElement).disabled).toBe(false);
});
```

- [ ] **Step 9: Run the sign-in test and verify pending/error coverage fails**

Run: `npm test -- tests/components/LoginPage.test.tsx`

Expected: FAIL because the current OAuth action does not await, lock, or render a failure.

- [ ] **Step 10: Rebuild sign-in and chip guide with the shared frame**

Keep the OAuth provider, callback path, and encoded `next` parameter byte-for-byte in `src/app/login/page.tsx`. Add `signingIn` and `error` state, guard duplicate activation, await `signInWithOAuth`, show the provider error inline, and restore the action in `finally`. Replace its returned interface with `AppFrame`, `BrandMark`, approved consequence-first copy, and a full-width primary `Button`:

```tsx
<h1 className="mt-8 text-4xl font-extrabold tracking-[-0.04em]">One sign-in. Then tap straight into your seat.</h1>
<p className="mt-4 leading-7 text-muted">RVMJ remembers your player identity so future NFC taps can take you directly to the table.</p>
<Button className="mt-8 w-full" busy={signingIn} busyLabel="Opening Google…" onClick={signIn}>Sign in with Google</Button>
<div className="mt-4"><LiveRegion tone="error" message={error} /></div>
```

Rebuild `src/app/chips/page.tsx` with `AppFrame`, `PageHeader backHref="/"`, and the existing `ChipSetCard`.

Restyle `ChipSetCard` with a surface panel, quiet divider rows, tabular values, and a coral tile accent beside the heading. Keep `DENOMS`, `PER_PLAYER`, `STACK_TOTAL`, `TABLE_QTY`, and `TABLE_TOTAL` as the only content source. Keep the current test and add:

```tsx
expect(screen.getByRole('table', { name: 'Standard chip set' })).toBeDefined();
expect(screen.getByText('Per player')).toBeDefined();
expect(screen.getByText('Whole table')).toBeDefined();
```

Give the table `aria-label="Standard chip set"`; do not hard-code 400 or 1600 into the component.

- [ ] **Step 11: Run all public-screen tests**

Run: `npm test -- tests/components/HomeBoards.test.tsx tests/components/ChipSetCard.test.tsx tests/components/AppStates.test.tsx tests/components/LoginPage.test.tsx`

Expected: PASS.

- [ ] **Step 12: Commit public screens**

```bash
git add -- src/app/page.tsx src/app/login/page.tsx src/app/chips/page.tsx src/app/loading.tsx src/app/error.tsx src/app/not-found.tsx src/components/ChipSetCard.tsx tests/components/HomeBoards.test.tsx tests/components/ChipSetCard.test.tsx tests/components/AppStates.test.tsx tests/components/LoginPage.test.tsx
git diff --cached --check
git commit -m "feat: redesign public chip mode screens"
```

---

### Task 3: NFC outcomes, match recovery, and top actions

**Files:**
- Create: `src/components/FormActionButton.tsx`
- Modify: `src/app/t/[secret]/page.tsx`
- Modify: `src/app/t/[secret]/StartNewMatch.tsx`
- Modify: `src/app/game/[id]/page.tsx`
- Modify: `src/app/game/[id]/GameTopBar.tsx`
- Modify: `tests/components/GameTopBar.test.tsx`
- Modify: `tests/components/StartNewMatch.test.tsx`

**Interfaces:**
- Consumes: Task 1's shared primitives and Task 2's global error boundary.
- Produces: `FormActionButton({ idleLabel, pendingLabel, variant? })`, which reads `useFormStatus()` inside a form.
- Preserves: `decideJoin`, `toSnapshot`, every admin query/write, unique-violation retry, redirect, East-seat void ownership, original-East continue ownership, and server-side rechecks.

- [ ] **Step 1: Strengthen the recovery-control tests**

Keep every existing `StartNewMatch` safety test. Add an explicit alert/status assertion after arming:

```tsx
fireEvent.click(screen.getByRole('button', { name: 'Start new match' }));
expect(screen.getByRole('alert').textContent).toContain('This will void the unfinished match and its unrecorded chip result.');
```

Update `GameTopBar.test.tsx` to expect accessible contextual navigation:

```tsx
expect(screen.getByRole('navigation', { name: 'Match actions' })).toBeDefined();
expect(screen.getByRole('link', { name: 'Back to table' }).getAttribute('href')).toBe('/t/east-tag');
```

Retain independent Back/Continue visibility assertions.

- [ ] **Step 2: Run both tests and verify the new semantics fail**

Run: `npm test -- tests/components/GameTopBar.test.tsx tests/components/StartNewMatch.test.tsx`

Expected: FAIL because the current components use generic links and an unlabelled warning panel.

- [ ] **Step 3: Add pending server-form buttons and restyle recovery controls**

Create `src/components/FormActionButton.tsx`:

```tsx
'use client';
import { useFormStatus } from 'react-dom';
import { Button } from './ui';

export function FormActionButton({ idleLabel, pendingLabel, variant = 'primary' }: {
  idleLabel: string; pendingLabel: string; variant?: 'primary' | 'secondary' | 'destructive';
}) {
  const { pending } = useFormStatus();
  return <Button type="submit" variant={variant} busy={pending} busyLabel={pendingLabel}>{idleLabel}</Button>;
}
```

In `StartNewMatch`, use Task 1's `Button` and `StatusMessage`. Keep the existing first-press arming and in-flight disappearance logic. Because shared buttons default to `type="button"`, pass `type="submit"` explicitly only to `Yes, void it and start new`; Cancel stays `type="button"`. The armed copy is exactly:

```tsx
<StatusMessage tone="error" title="Start over?">
  This will void the unfinished match and its unrecorded chip result.
</StatusMessage>
```

The final action remains `Yes, void it and start new`; Cancel stays available only before submission.

In `GameTopBar`, wrap existing controls in `<nav aria-label="Match actions">`, label the link `Back to table`, and render `FormActionButton idleLabel="Continue match" pendingLabel="Continuing…"` inside the current server-action form.

- [ ] **Step 4: Replace raw NFC outcome pages with deliberate states**

Do not touch the decision tree. Change `REJECT_COPY` into complete view content:

```ts
const REJECT_COPY = {
  seat_taken: { title: 'That seat is taken', description: 'Tap a free seat, or ask its occupant to move.' },
  game_in_progress: { title: 'This game is already underway', description: 'A game started without you. Wait for it to finish.' },
  table_full: { title: 'This table is full', description: 'Four players are already seated. Wait for the next match.' },
} as const;
```

Render the unknown tag as:

```tsx
return <StatePage tone="error" title="Unknown table tag" description="This sticker is not registered. Check that you tapped the correct seat." action={<ActionLink href="/">Back to the leaderboard</ActionLink>} />;
```

Render reject outcomes with `StatePage tone="warning"` and the corresponding title/description. Leave thrown server failures to `src/app/error.tsx`.

Recompose `confirm_end_stale` with `AppFrame`, `PageHeader eyebrow="Unfinished match"`, `StatusMessage tone="warning"`, `ActionLink` for `View last match`, the existing East-only `StartNewMatch`, and the current waiting-for-East message. Keep `from=${encodeURIComponent(secret)}` exactly.

In `src/app/game/[id]/page.tsx`, replace bare not-found/expired `<main>` elements with `StatePage`. Keep `GameTopBar` outside the state where its Back action exists:

```tsx
const unavailable = (title: string, description: string) => (
  <><GameTopBar backHref={back} /><StatePage tone="warning" title={title} description={description} /></>
);
```

Use `Game not found` / `This match does not exist or is no longer available.` and `This match expired` / `It ended without a recorded chip result.`.

- [ ] **Step 5: Run recovery tests and the join/action regression tests**

Run: `npm test -- tests/components/GameTopBar.test.tsx tests/components/StartNewMatch.test.tsx tests/join.test.ts tests/actions/game.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit NFC and recovery screens**

```bash
git add -- src/components/FormActionButton.tsx 'src/app/t/[secret]/page.tsx' 'src/app/t/[secret]/StartNewMatch.tsx' 'src/app/game/[id]/page.tsx' 'src/app/game/[id]/GameTopBar.tsx' tests/components/GameTopBar.test.tsx tests/components/StartNewMatch.test.tsx
git diff --cached --check
git commit -m "feat: redesign table join and recovery states"
```

---

### Task 4: Chip-only forming screen

**Files:**
- Modify: `src/app/game/[id]/FormingScreen.tsx`
- Create: `tests/components/FormingScreen.test.tsx`

**Interfaces:**
- Consumes: `PlayerRow`, `StatusMessage`, `Button`, and `ActionLink` from Task 1.
- Preserves: `FormingScreen({ gameId, players })`, the game/player realtime subscriptions, and `startGame(gameId, 'chips')`.
- Adds: local `submitting` and inline `error` state around the existing start operation.
- Adds: refresh on both realtime `SUBSCRIBED` and `document.visibilitychange` when the page becomes visible.

- [ ] **Step 1: Write forming-screen tests**

Create a stable router mock, a Supabase channel mock, and a `startGame` mock. Cover:

```tsx
it('keeps all four seats stable and presents chip mode without a mode picker', () => {
  render(<FormingScreen gameId="g1" players={players.slice(0, 2)} />);
  expect(screen.getAllByText(/^(East|South|West|North)$/)).toHaveLength(4);
  expect(screen.getByText('Chip mode')).toBeDefined();
  expect(screen.queryByText(/App scorekeeper/i)).toBeNull();
  expect((screen.getByRole('button', { name: 'Waiting for players (2/4)' }) as HTMLButtonElement).disabled).toBe(true);
});

it('starts only a full table and locks duplicate taps', async () => {
  let release!: () => void;
  vi.mocked(startGame).mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve({}); }));
  render(<FormingScreen gameId="g1" players={players} />);
  const button = screen.getByRole('button', { name: 'Start chip game' });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(startGame).toHaveBeenCalledTimes(1);
  expect((screen.getByRole('button', { name: 'Starting game…' }) as HTMLButtonElement).disabled).toBe(true);
  release();
});

it('shows a failed start inline and restores the action', async () => {
  vi.mocked(startGame).mockResolvedValueOnce({ error: 'table changed' });
  render(<FormingScreen gameId="g1" players={players} />);
  fireEvent.click(screen.getByRole('button', { name: 'Start chip game' }));
  expect((await screen.findByRole('alert')).textContent).toContain('table changed');
  expect((screen.getByRole('button', { name: 'Start chip game' }) as HTMLButtonElement).disabled).toBe(false);
});

it('refreshes seats after reconnect and foreground return', () => {
  render(<FormingScreen gameId="g1" players={players.slice(0, 2)} />);
  act(() => subscribeCallback('SUBSCRIBED'));
  expect(router.refresh).toHaveBeenCalledTimes(1);
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  expect(router.refresh).toHaveBeenCalledTimes(2);
});
```

Use the same Ah Seng/Bryan/Ah Beng/Ah Huat fixtures as the other game-component tests.

- [ ] **Step 2: Run the forming test and verify it fails**

Run: `npm test -- tests/components/FormingScreen.test.tsx`

Expected: FAIL because the current screen exposes App scorekeeper and has no pending guard.

- [ ] **Step 3: Implement the forming screen**

Keep the two current table subscriptions. Change `.subscribe()` to `.subscribe((status) => { if (status === 'SUBSCRIBED') router.refresh(); })`, and add a visibility effect that calls `router.refresh()` only when `document.visibilityState === 'visible'`. Add guarded start state:

```tsx
const [submitting, setSubmitting] = useState(false);
const onStart = async () => {
  if (submitting || !full) return;
  setSubmitting(true);
  setError(undefined);
  try {
    const result = await startGame(gameId, 'chips');
    if (result.error) setError(result.error);
    else router.refresh();
  } catch (cause) {
    setError(cause instanceof Error ? cause.message : 'Could not reach the table. Try again.');
  } finally {
    setSubmitting(false);
  }
};
```

Render a `PageHeader eyebrow="Forming table" title="Take your seats"` inside `AppFrame`. Map `E`, `S`, `W`, `N` to four `PlayerRow` items; empty rows use `name="Tap this seat to join"` and `muted`. Replace the mode buttons and embedded chip card with:

```tsx
<StatusMessage tone="info" title="Chip mode">
  Settle hands with physical chips. RVMJ records the final count when the game ends.
</StatusMessage>
<ActionLink href="/chips" variant="secondary">View the standard chip set</ActionLink>
```

Use one full-width `Button` with `disabled={!full}`, `busy={submitting}`, `busyLabel="Starting game…"`, and label `Start chip game` when full or `Waiting for players (${players.length}/4)` otherwise. Keep `<LiveRegion tone="error" message={error} />` mounted beside the action so a failure is announced without clearing the seats.

- [ ] **Step 4: Run the forming test and related component regression tests**

Run: `npm test -- tests/components/FormingScreen.test.tsx tests/components/ChipSetCard.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit the forming screen**

```bash
git add -- 'src/app/game/[id]/FormingScreen.tsx' tests/components/FormingScreen.test.tsx
git diff --cached --check
git commit -m "feat: redesign chip table formation"
```

---

### Task 5: Active game, notable logging, and locked results

**Files:**
- Modify: `src/app/game/[id]/ChipLive.tsx`
- Modify: `src/app/game/[id]/NotableLogger.tsx`
- Create: `src/app/game/[id]/ReopenGameControl.tsx`
- Modify: `tests/components/ChipLive.test.tsx`
- Create: `tests/components/NotableLogger.test.tsx`
- Create: `tests/components/ReopenGameControl.test.tsx`

**Interfaces:**
- Consumes: Task 1's shared rows, buttons, statuses, and `FullScreenPanel`.
- Produces: `ReopenGameControl({ gameId, onReopened, disabled? })`.
- Preserves: every ChipLive table read, result fail-closed behaviour, realtime subscription, foreground/reconnect refresh, notable-claim read, and `router.refresh()` timing.
- Adds: `syncState: 'checking' | 'ready' | 'failed'`; state-changing controls remain disabled until the latest read succeeds.
- Removes: all native alert calls.

- [ ] **Step 1: Write notable-logger tests**

Mock `logNotable` and render the real component. Cover the disabled initial action, successful close, and failed request preserving both values:

```tsx
it('keeps both choices and restores the action after a rejected request', async () => {
  vi.mocked(logNotable).mockRejectedValueOnce(new Error('network down'));
  render(<NotableLogger players={players} notableHands={notableHands} gameId="g1" onClose={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Bryan' }));
  fireEvent.change(screen.getByLabelText('Notable hand'), { target: { value: 'h1' } });
  fireEvent.click(screen.getByRole('button', { name: 'Log notable hand' }));
  expect((await screen.findByRole('alert')).textContent).toContain('network down');
  expect(screen.getByRole('button', { name: 'Bryan' }).getAttribute('aria-pressed')).toBe('true');
  expect((screen.getByLabelText('Notable hand') as HTMLSelectElement).value).toBe('h1');
  expect((screen.getByRole('button', { name: 'Log notable hand' }) as HTMLButtonElement).disabled).toBe(false);
});
```

Also assert `role="dialog"`, the label `Who won it?`, and that a successful `{}` response calls `onClose` exactly once.

- [ ] **Step 2: Run the notable-logger test and verify it fails**

Run: `npm test -- tests/components/NotableLogger.test.tsx`

Expected: FAIL on the missing labelled select, pressed state, and approved button copy.

- [ ] **Step 3: Rebuild notable logging in the shared full-screen panel**

Keep the current action guard and try/catch/finally. Use `FullScreenPanel title="Log notable hand" onDismiss={onClose}`. Render player choices as 44-pixel `Button` controls with `variant={selected ? 'primary' : 'secondary'}` and `aria-pressed={selected}`. Render:

```tsx
<label htmlFor="notable-hand" className="block text-sm font-bold">Notable hand</label>
<select id="notable-hand" value={handId ?? ''} onChange={changeHand}
  className="mt-2 min-h-11 w-full rounded-[10px] border-2 border-divider bg-surface px-3 text-ink focus:border-cobalt">
```

Keep the native twelve-item list; add no search. The primary action is `Log notable hand`, becomes `Logging…`, and remains disabled until player and hand exist. Keep `<LiveRegion tone="error" message={error} />` mounted before any request so action or transport failures are announced while both selections remain.

- [ ] **Step 4: Write reopen-control tests before replacing alerts**

Create tests that prove the first press does not call `reopenChipGame`, the second does, pending removes Cancel, failure appears in `role="alert"` and restores `Reopen game`, and success calls `onReopened` once. The critical assertion is:

```tsx
fireEvent.click(screen.getByRole('button', { name: 'Reopen game' }));
expect(reopenChipGame).not.toHaveBeenCalled();
expect(screen.getByText('Reopening unlocks the result and removes it from the leaderboard until everyone confirms again.')).toBeDefined();
```

- [ ] **Step 5: Run the reopen test and verify the missing module failure**

Run: `npm test -- tests/components/ReopenGameControl.test.tsx`

Expected: FAIL because `ReopenGameControl.tsx` does not exist.

- [ ] **Step 6: Implement the two-step reopen control**

Create a Client Component with `armed`, `submitting`, and `error` state. Import `reopenChipGame` directly. The optional `disabled` prop disables the first action. The first `Button variant="secondary"` only sets `armed`. The armed state renders:

```tsx
<StatusMessage tone="warning" title="Reopen this game?">
  Reopening unlocks the result and removes it from the leaderboard until everyone confirms again.
</StatusMessage>
```

While idle, show `Yes, reopen game` and Cancel. While submitting, render one disabled busy button labelled `Reopening…`; do not leave Cancel visible. Keep a `LiveRegion tone="error" message={error}` mounted throughout the armed state. On `{ error }` or a rejected promise, keep the component armed and restore both decisions. On success call `onReopened()`.

- [ ] **Step 7: Extend ChipLive tests for the approved active/results states**

Retain the existing result-clearing and reconnect tests. Add:

```tsx
it('shows a quiet chip game with one primary ending action', async () => {
  render(view('active'));
  expect(screen.getByText('Chip game in progress')).toBeDefined();
  expect(screen.getByRole('button', { name: 'End game · count chips' })).toBeDefined();
  expect(screen.getByRole('button', { name: 'Log notable hand' })).toBeDefined();
});

it('states that a settled result is locked and updates the board', async () => {
  db.game = { ...ENDED };
  db.gamePlayers = SETTLED;
  render(view('ended'));
  expect(await screen.findByText('Game locked')).toBeDefined();
  expect(screen.getByText(/leaderboard has been updated/)).toBeDefined();
  expect(screen.getByRole('button', { name: 'Reopen game' })).toBeDefined();
});

it('shows a refresh failure and blocks stale state-changing actions', async () => {
  db.gameError = { message: 'connection lost' };
  render(view('active'));
  expect((await screen.findByRole('alert')).textContent).toContain('Couldn’t refresh this game');
  expect((screen.getByRole('button', { name: 'Log notable hand' }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: 'End game · count chips' }) as HTMLButtonElement).disabled).toBe(true);
});
```

Extend the existing Supabase mock with `gameError` and `claimsError` fields and return them from the corresponding query payloads. Reset both to `null` in `beforeEach`.

- [ ] **Step 8: Recompose ChipLive around the preserved read/subscription logic**

Keep every query, subscription filter, refresh call, foreground listener, and result fail-closed rule. Add `syncState` and make each reload fail visibly without overwriting the last good claims/proposal/result:

```tsx
const [syncState, setSyncState] = useState<'checking' | 'ready' | 'failed'>('checking');
const [syncError, setSyncError] = useState<string>();
const failSync = () => {
  setSyncError('Couldn’t refresh this game. Check the connection and try again.');
  setSyncState('failed');
};
```

At the first line of `reload`, call `setSyncState('checking')`. Destructure both `data` and `error` from the existing `notable_claims` and `games` reads. If either read errors or the game row is absent, call `failSync()` and return before calling `setClaims`, `setEndOpen`, or `setFinals`. After the existing successful active/ended branches finish, clear `syncError` and set `syncState` to `ready`.

Retain the existing `game_players` fail-closed branch. When that ended-result read fails, keep `setFinals(null)`, call `failSync()`, and return. Never replace an earlier settled result with four zeros.

Then replace the returned markup with:

- `AppFrame` and `PageHeader` titled `Chip game in progress` or `Final result`.
- One surface list of `PlayerRow`s. Active rows trail the seat letter in muted text; ended rows trail a signed tabular score, with positive/negative/zero text treatments and a visible sign.
- Active informational copy that the physical chips settle each hand.
- Existing notable claims in a `Notable hands` section with trophy text retained for non-colour identification.
- A `StatusMessage tone="info"` while `syncState === 'checking'` and an always-mounted `LiveRegion tone="error" message={syncError}` for refresh failure.
- Secondary `Log notable hand` and primary `End game · count chips` actions, both disabled unless `syncState === 'ready'`.
- Ended `StatusMessage tone="success" title="Game locked"` with `All four players confirmed. The leaderboard has been updated.`
- `ReopenGameControl gameId={gameId} disabled={syncState !== 'ready'} onReopened={() => router.refresh()}` plus plain text `Available for one hour after the game ends.`

Remove the `reopening` state and every alert call from `ChipLive`; the new child owns that interaction.

- [ ] **Step 9: Run the complete live-game component set**

Run: `npm test -- tests/components/ChipLive.test.tsx tests/components/NotableLogger.test.tsx tests/components/ReopenGameControl.test.tsx`

Expected: PASS, including the existing stale-result clearing and reconnect cases.

- [ ] **Step 10: Commit the active/results slice**

```bash
git add -- 'src/app/game/[id]/ChipLive.tsx' 'src/app/game/[id]/NotableLogger.tsx' 'src/app/game/[id]/ReopenGameControl.tsx' tests/components/ChipLive.test.tsx tests/components/NotableLogger.test.tsx tests/components/ReopenGameControl.test.tsx
git diff --cached --check
git commit -m "feat: redesign live chip game and results"
```

---

### Task 6: Four-player chip-count overview

**Files:**
- Create: `src/app/game/[id]/chip-view.ts`
- Create: `src/app/game/[id]/ChipCountForm.tsx`
- Create: `tests/components/ChipCountForm.test.tsx`

**Interfaces:**
- Consumes: `Seat`, `ChipCounts`, `DENOMS`, `PER_PLAYER`, `STACK_TOTAL`, `TABLE_TOTAL`, `stackTotal`, and `ConservationFailure`.
- Produces: `ChipPlayer`, `ChipCountTable`, `PendingChipProposal`, `SEAT_ORDER`, `emptyChipCountTable()`, and `cloneChipCountTable(table)` from `chip-view.ts`.
- Produces: controlled `ChipCountForm({ players, counts, failure, error, success, submitting, syncBlocked, onCountsChange, onSubmit, onClose })`.

- [ ] **Step 1: Write count-form tests first**

Create fixtures with all four players and `emptyChipCountTable()`. Cover these exact behaviours:

```tsx
it('shows all four players and sixteen uniquely labelled numeric fields', () => {
  renderCountForm();
  expect(screen.getAllByRole('spinbutton')).toHaveLength(16);
  expect(screen.getByRole('spinbutton', { name: 'Ah Seng · East · $1 chips' }).getAttribute('inputmode')).toBe('numeric');
  expect(screen.getByRole('spinbutton', { name: 'Ah Huat · North · $100 chips' }).getAttribute('min')).toBe('0');
});

it('updates one player and the whole-table total without mutating the supplied table', () => {
  const counts = emptyChipCountTable();
  const onCountsChange = vi.fn();
  renderCountForm({ counts, onCountsChange });
  fireEvent.change(screen.getByRole('spinbutton', { name: 'Bryan · South · $100 chips' }), { target: { value: '3' } });
  expect(counts.S[100]).toBe(0);
  expect(onCountsChange).toHaveBeenCalledWith(expect.objectContaining({ S: expect.objectContaining({ 100: 3 }) }));
});

it('names every failed denomination and explains offset stacks', () => {
  renderCountForm({ failure: { failedDenominations: [1, 10], grandTotalOff: false } });
  expect(screen.getByRole('status').textContent).toContain('$1 and $10');
  expect(screen.getByRole('status').textContent).toContain('two stacks offset each other');
});

it('keeps the whole-table total and action in a sticky footer', () => {
  renderCountForm();
  const footer = screen.getByTestId('count-summary');
  expect(footer.className).toContain('sticky');
  expect(within(footer).getByText(/Table total/)).toBeDefined();
  expect(within(footer).getByRole('button', { name: 'Check all counts' })).toBeDefined();
});
```

Include `within` from Testing Library. Use `getAttribute`, `textContent`, and the native `disabled` property as the existing test suite does; do not add `@testing-library/jest-dom`.

- [ ] **Step 2: Run the count-form test and verify the missing module failures**

Run: `npm test -- tests/components/ChipCountForm.test.tsx`

Expected: FAIL because `chip-view.ts` and `ChipCountForm.tsx` do not exist.

- [ ] **Step 3: Implement frontend chip view types and safe cloning**

Create `chip-view.ts`:

```ts
import type { ChipCounts } from '../../../lib/chips';
import type { Seat } from '../../../lib/engine/types';

export type ChipPlayer = { playerId: string; seat: Seat; name: string };
export type ChipCountTable = Record<Seat, ChipCounts>;
export type PendingChipProposal = { counts: ChipCountTable; confirmed: string[]; id: string };
export const SEAT_ORDER: readonly Seat[] = ['E', 'S', 'W', 'N'];

const emptyCounts = (): ChipCounts => ({ 1: 0, 10: 0, 50: 0, 100: 0 });
export const emptyChipCountTable = (): ChipCountTable => ({ E: emptyCounts(), S: emptyCounts(), W: emptyCounts(), N: emptyCounts() });
export const cloneChipCountTable = (table: ChipCountTable): ChipCountTable => ({
  E: { ...table.E }, S: { ...table.S }, W: { ...table.W }, N: { ...table.N },
});
```

- [ ] **Step 4: Implement the controlled count overview**

Use `FullScreenPanel title="Count every stack" eyebrow="End game" onDismiss={onClose}`. Above the players, explain `One phone enters all four stacks. Everyone reviews the combined result next.`

For every `SEAT_ORDER` item, render a section with `SeatBadge`, player name, four fixed denomination columns, and a tabular player total. Each input uses:

```tsx
<input
  type="number"
  min={0}
  step={1}
  inputMode="numeric"
  aria-label={`${player.name} · ${seatNames[seat]} · $${denomination} chips`}
  value={counts[seat][denomination]}
  onChange={(event) => {
    const next = cloneChipCountTable(counts);
    next[seat][denomination] = Number(event.target.value);
    onCountsChange(next);
  }}
  className="tnum min-h-11 w-full min-w-0 rounded-[9px] border-2 border-divider bg-surface px-1.5 text-center font-bold focus:border-cobalt sm:px-3"
/>
```

Use visible column headers `$1`, `$10`, `$50`, `$100`, and show each starting quantity as `Start {PER_PLAYER[denomination]}`. Calculate:

```ts
const tableTotal = SEAT_ORDER.reduce((sum, seat) => sum + stackTotal(counts[seat]), 0);
```

Render three always-mounted `LiveRegion`s for computed `failureMessage`, `error`, and `success`; use warning, error, and success tones respectively. Failure copy is built from the complete denomination list and uses:

```ts
const failed = failure.failedDenominations.map((denomination) => `$${denomination}`);
const names = failed.length === 1 ? failed[0] : `${failed.slice(0, -1).join(', ')} and ${failed.at(-1)}`;
```

If `grandTotalOff` is false, append `The table still totals correctly, so two stacks offset each other.` If true, append `The whole table total is also off.`

The final wrapper has bottom padding large enough for the footer. When `syncBlocked` is true and `error` is absent, render `Checking the latest table count…` through `StatusMessage tone="info"`. The footer is `data-testid="count-summary"` and uses `sticky bottom-0`, a canvas-to-transparent top gradient, safe-area bottom padding, `Table total {tableTotal} / {TABLE_TOTAL}`, and a full-width `Button` labelled `Check all counts`, busy-labelled `Checking counts…`, disabled when `syncBlocked`, and wired to `onSubmit`.

- [ ] **Step 5: Run the count-form test**

Run: `npm test -- tests/components/ChipCountForm.test.tsx`

Expected: PASS.

- [ ] **Step 6: Run chip arithmetic regressions**

Run: `npm test -- tests/chips.test.ts tests/actions/game.test.ts`

Expected: PASS; the new form has not changed validation or authoritative calculation.

- [ ] **Step 7: Commit the controlled count form**

```bash
git add -- 'src/app/game/[id]/chip-view.ts' 'src/app/game/[id]/ChipCountForm.tsx' tests/components/ChipCountForm.test.tsx
git diff --cached --check
git commit -m "feat: add four-player chip count overview"
```

---

### Task 7: Named confirmation and cross-phone recount prefill

**Files:**
- Create: `src/app/game/[id]/ChipConfirmPanel.tsx`
- Modify: `src/app/game/[id]/ChipEndFlow.tsx`
- Create: `tests/components/ChipConfirmPanel.test.tsx`
- Modify: `tests/components/ChipEndFlow.test.tsx`

**Interfaces:**
- Consumes: `PendingChipProposal`, `ChipPlayer`, `ChipCountForm`, `cloneChipCountTable`, `stackTotal`, `STACK_TOTAL`, `confirmChipResult`, and the existing Supabase games subscription.
- Produces: `ChipConfirmPanel({ gameId, proposal, players, me, syncBlocked, syncError, onRecount })`.
- Preserves: server proposal identity from `last_activity_at`, key-based transient-state reset, idempotent confirm behaviour, ended refresh, realtime updates, subscribe resync, and visibility resync.

- [ ] **Step 1: Write named-confirmation tests**

Render `ChipConfirmPanel` directly with a proposal confirmed by `p1` and `p3`. Assert:

```tsx
expect(screen.getByText('Confirmed')).toBeDefined();
expect(screen.getByText('Ah Seng, Ah Beng')).toBeDefined();
expect(screen.getByText('Waiting')).toBeDefined();
expect(screen.getByText('Bryan, Ah Huat')).toBeDefined();
expect(screen.getByText('2 of 4 confirmed')).toBeDefined();
```

Also test:

- Each of the four names has a signed result; zero renders `0`, positive has `+`, and negative keeps `-`.
- A local player already in `confirmed` sees disabled `You confirmed · waiting for the table`.
- A rejected `confirmChipResult` shows a role-alert error and restores `Confirm my count`.
- `Something is wrong · recount` calls `onRecount` with the exact proposal object and does not call the confirm action.
- `syncBlocked={true}` disables confirmation while a refresh is running; a non-empty `syncError` states that the latest count could not be verified.

- [ ] **Step 2: Run the confirmation test and verify the missing module failure**

Run: `npm test -- tests/components/ChipConfirmPanel.test.tsx`

Expected: FAIL because `ChipConfirmPanel.tsx` does not exist.

- [ ] **Step 3: Implement the named confirmation panel**

Use `FullScreenPanel title="Confirm the table count" eyebrow="All four players"`. Derive progress only from `proposal.confirmed` and the supplied players:

```ts
const confirmed = players.filter((player) => proposal.confirmed.includes(player.playerId));
const waiting = players.filter((player) => !proposal.confirmed.includes(player.playerId));
const names = (list: ChipPlayer[]) => list.length === 0 ? 'Nobody' : list.map((player) => player.name).join(', ');
```

Render the four `PlayerRow`s with signed net totals from `stackTotal(proposal.counts[player.seat]) - STACK_TOTAL`. Then render a single progress region:

```tsx
<section aria-label="Confirmation progress" className="rounded-[14px] border border-divider bg-surface p-4">
  <p className="font-extrabold">{confirmed.length} of 4 confirmed</p>
  <dl className="mt-3 grid gap-2 text-sm">
    <div><dt className="font-bold text-gain">Confirmed</dt><dd>{names(confirmed)}</dd></div>
    <div><dt className="font-bold text-amber">Waiting</dt><dd>{names(waiting)}</dd></div>
  </dl>
</section>
```

Keep action state local to the panel so `key={proposal.id}` clears old errors/submitting state for a new proposal. The confirm button is disabled when already confirmed, submitting, or `syncBlocked` is true. While blocked without an error, show `Checking the latest table count…`. Keep one `LiveRegion tone="error"` mounted for `syncError ?? actionError`. Use current try/catch/finally behaviour and call `router.refresh()` only when the action result is `ended`. The recount button calls `onRecount(proposal)`.

- [ ] **Step 4: Add the cross-phone recount regression before changing orchestration**

Extend `tests/components/ChipEndFlow.test.tsx` with a server proposal whose counts are visibly not the defaults:

```tsx
it('prefills recount from the latest proposal even on a phone that did not enter it', async () => {
  const latest = {
    E: { 1: 8, 10: 9, 50: 4, 100: 1 },
    S: { 1: 12, 10: 9, 50: 4, 100: 1 },
    W: { ...PER_PLAYER },
    N: { ...PER_PLAYER },
  };
  db.row = { pending_counts: latest, pending_confirmed: ['p1'], status: 'active', last_activity_at: '2026-08-19T10:00:00.000Z' };
  render(<ChipEndFlow gameId="g1" players={players} me="p2" onClose={vi.fn()} />);
  await screen.findByText('Confirm the table count');
  fireEvent.click(screen.getByRole('button', { name: 'Something is wrong · recount' }));
  expect((screen.getByRole('spinbutton', { name: 'Ah Seng · East · $1 chips' }) as HTMLInputElement).value).toBe('8');
  expect((screen.getByRole('spinbutton', { name: 'Bryan · South · $1 chips' }) as HTMLInputElement).value).toBe('12');
});
```

Add a second regression that changes a field, makes `proposeChipCounts` reject, and asserts the field keeps its edited value while the action is restored.

- [ ] **Step 5: Run the end-flow test and verify recount currently resets to zero**

Run: `npm test -- tests/components/ChipEndFlow.test.tsx`

Expected: FAIL because the current `onRecount` only stores proposal identity and leaves local counts at their initial zeros.

- [ ] **Step 6: Recompose ChipEndFlow without changing its subscription model**

Replace local type aliases with imports from `chip-view.ts`. Initialize counts with `emptyChipCountTable()`. Add `success`, `syncError`, and explicit refresh state:

```ts
const [syncState, setSyncState] = useState<'checking' | 'ready' | 'failed'>('checking');
```

Change `load()` to fail closed without erasing the last good proposal:

```ts
setSyncState('checking');
const { data, error: readError } = await supabase.from('games')
  .select('pending_counts, pending_confirmed, status, last_activity_at').eq('id', gameId).single();
if (readError || !data) {
  setSyncError('Couldn’t verify the latest table count. Reconnect, then try again.');
  setSyncState('failed');
  return;
}
setSyncError(undefined);
setSyncState('ready');
```

Keep the current ended refresh and proposal identity construction. Keep both effects intact.

Render a current proposal through:

```tsx
<ChipConfirmPanel
  key={pending.id}
  gameId={gameId}
  proposal={pending}
  players={players}
  me={me}
  syncBlocked={syncState !== 'ready'}
  syncError={syncError}
  onRecount={(proposal) => {
    setCounts(cloneChipCountTable(proposal.counts));
    setFailure(null);
    setError(undefined);
    setSuccess(undefined);
    setRecountingFrom(proposal.id);
  }}
/>
```

Render the entry state through `ChipCountForm`. Move the existing `proposeChipCounts` guard into an `onSubmit` callback and return immediately unless `syncState === 'ready'`. On conservation failure set `failure` and leave all counts unchanged. On action/transport error set `error` and leave all counts unchanged. On `{}` success set `success` to `All 1,600 points and every denomination balance. Sharing this count with the table…`; realtime still owns the transition to confirmation. Pass `syncBlocked={syncState !== 'ready'}` and pass `syncError ?? error` as the displayed error. When blocked without an error, `ChipCountForm` renders `Checking the latest table count…` in an informational status.

Keep Escape dismissal by passing `onClose` into `ChipCountForm`; `ChipConfirmPanel` deliberately has no close button because a live shared proposal must be confirmed or recounted.

- [ ] **Step 7: Update existing confirmation assertions**

In `ChipEndFlow.test.tsx`, replace numeric-only ticker assertions with named progress assertions, but retain the identical re-proposal, server-only `iConfirmed`, foreground refresh, and resubscribe tests. The identical proposal test must still update `last_activity_at` and prove the button becomes usable again.

- [ ] **Step 8: Run the count and confirmation test set**

Run: `npm test -- tests/components/ChipCountForm.test.tsx tests/components/ChipConfirmPanel.test.tsx tests/components/ChipEndFlow.test.tsx`

Expected: PASS.

- [ ] **Step 9: Run live-game integration tests**

Run: `npm test -- tests/components/ChipLive.test.tsx tests/actions/game.test.ts tests/chips.test.ts`

Expected: PASS; a proposal still opens on every phone and finalization remains server-owned.

- [ ] **Step 10: Commit confirmation and recount**

```bash
git add -- 'src/app/game/[id]/ChipConfirmPanel.tsx' 'src/app/game/[id]/ChipEndFlow.tsx' tests/components/ChipConfirmPanel.test.tsx tests/components/ChipEndFlow.test.tsx
git diff --cached --check
git commit -m "feat: add named chip confirmation and recount prefill"
```

---

### Task 8: Full-flow visual, responsive, and accessibility verification

**Files:**
- Verify: every file listed in the File map
- Modify only if the checks expose a defect: the smallest owning component and its focused test

**Interfaces:**
- Consumes: the complete frontend from Tasks 1–7.
- Produces: a visually inspected, keyboard-checked, responsive chip journey with no rejected styling or raw fallback screen.

- [ ] **Step 1: Run focused source audits**

Run each command and require no output:

```bash
rg -n "felt|brass|bone|dark:" src/app src/components
rg -n "(^|[^.]\\b)alert\\(" src/app src/components
rg -n "App scorekeeper" 'src/app/game/[id]/FormingScreen.tsx'
rg -n 'className="p-8|className=".*bg-black|className=".*text-gray-' src/app src/components
```

Also run `rg -n "#F7F2E9|#FFFDF8|#142D37|#68797D|#D9D1C5|#2F6FE4|#E7EEFC|#ED6048|#FCE7E2|#24715D|#DEF1E9|#9A6315|#FBEFD2" src/app/globals.css` and confirm all thirteen approved values appear exactly once.

- [ ] **Step 2: Start the verified development server**

Run: `npm run dev`

Expected: Next.js starts without a compile error. Keep the process available for the remaining visual checks.

- [ ] **Step 3: Inspect public screens at four widths**

Open `/`, `/?board=skill`, `/login`, `/chips`, and a deliberately invalid path. Inspect at exactly:

- 360 × 800
- 390 × 844
- 768 × 1024
- 1440 × 1000

At every width confirm: no horizontal scroll, no clipped score, at least 44-pixel controls, one coral signature tile, cream-only canvas, visible selected board, readable error/empty state, and restrained surfaces without repeated hard shadows.

- [ ] **Step 4: Inspect table screens with real seeded data**

Use four authenticated browser sessions or four isolated browser contexts connected only to local or disposable test data. Rehearse:

1. Tap E, S, W, and N tags and confirm the four forming rows do not shift.
2. Confirm no App scorekeeper choice exists.
3. Start the chip game and log one notable hand.
4. Open chip count and confirm all sixteen fields fit at 360 pixels without horizontal scroll.
5. Enter a count that fails $1 and $10 conservation; confirm both denominations are named and every value remains.
6. Correct it and submit a balanced 1,600-point count.
7. Confirm that every session shows the same signed results and names confirmed/waiting players.
8. Request recount from a session that did not enter the proposal; confirm all sixteen proposal values are prefilled.
9. Re-propose and confirm from all four sessions; confirm results and board update everywhere.
10. Arm reopen, cancel once, then reopen; confirm stale results disappear from every session.

- [ ] **Step 5: Perform keyboard and non-colour checks**

Using only Tab, Shift+Tab, Enter, Space, and Escape:

- Traverse home tabs and actions in visual order.
- Open and close notable logging; confirm focus enters the title, stays in the panel, and returns to its opener.
- Open chip counting; confirm every input has a spoken name containing player, seat, and denomination.
- Confirm focus never lands behind a full-screen panel.
- Confirm gain/loss remains understandable from `+`/`-`, confirmation from headings/names, and failures from text when colour is ignored.
- Enable reduced motion and confirm no required state depends on animation.

- [ ] **Step 6: Fix only observed defects with a regression test first**

For each observed defect, add one failing assertion to the owning test file, run that single file to see the failure, edit only the owning component, and rerun the single file. Do not widen product scope or alter server logic during visual QA.

- [ ] **Step 7: Commit verified visual fixes if any were required**

Stage only the exact test/component pairs changed in Step 6, run `git diff --cached --check`, and commit with:

```bash
git commit -m "fix: close chip frontend visual gaps"
```

If Step 6 found no defects, make no empty commit.

---

### Task 9: Repository-wide verification and generated-file cleanup

**Files:**
- Verify: entire repository
- Restore without staging: `next-env.d.ts`

**Interfaces:**
- Consumes: the complete verified implementation.
- Produces: a clean, reviewable commit series with all automated checks passing and no generated or brainstorming files staged.

- [ ] **Step 1: Run the full test suite**

Run: `npm test`

Expected: all component, action, chip, join, engine, and smoke tests PASS.

- [ ] **Step 2: Run type checking**

Run: `npm run typecheck`

Expected: PASS with no TypeScript error.

- [ ] **Step 3: Run lint**

Run: `npm run lint`

Expected: PASS apart from the already-known `GameLive.tsx` warning if it remains unchanged. Record any new warning as a failure and fix it before continuing.

- [ ] **Step 4: Run the supported production build**

Run: `npm run build -- --webpack`

Expected: PASS and emit the complete route table.

- [ ] **Step 5: Restore generated `next-env.d.ts` exactly**

If typecheck/dev changed the file to `.next/dev/types/`, use `apply_patch` so its complete content is:

```ts
/// <reference types="next" />
/// <reference types="next/image-types/global" />
import "./.next/types/routes.d.ts";
import "./.next/types/root-params.d.ts";

// NOTE: This file should not be edited
// see https://nextjs.org/docs/app/api-reference/config/typescript for more information.
```

Run: `git diff --exit-code -- next-env.d.ts`

Expected: exit 0 and no output.

- [ ] **Step 6: Inspect the final diff and staging boundary**

Run:

```bash
git status --short --branch
git diff --check
git diff --stat origin/main...HEAD
git log --oneline --decorate origin/main..HEAD
git ls-files .superpowers
```

Expected: no uncommitted implementation changes, no whitespace error, a focused commit series including the design spec and plan, and no tracked `.superpowers` path.

- [ ] **Step 7: Review the final code against every acceptance criterion**

Read `docs/superpowers/specs/2026-08-19-chip-mode-frontend-design.md` from top to bottom. For each Acceptance criteria line, identify the implementing file and the automated or manual verification from Tasks 1–9. Stop and repair any uncovered gap before asking to push.

---

### Task 10: Bryan branch gate, GitHub push, and production verification

**Files:**
- No source changes expected
- Verify: local Git branch, `origin`, GitHub branch, Vercel production deployment, and public assets

**Interfaces:**
- Consumes: the clean, passing commit series from Task 9.
- Produces: the verified frontend on the branch Bryan explicitly approves and a working production deployment.

- [ ] **Step 1: Present the final local evidence and ask the branch gate**

Tell Bryan the current branch, proposed remote target, commit list, test count, typecheck result, lint result, build result, and manual four-session result. Ask exactly:

> The frontend is complete and verified. The current branch is `main`; should I push these commits to `origin/main`?

Do not run `git push` until Bryan answers yes to that exact target. If Bryan names another branch, stop and update the target without force-pushing.

- [ ] **Step 2: Recheck the remote immediately before push**

After approval, run:

```bash
git fetch origin
git status --short --branch
git log --oneline --left-right origin/main...HEAD
```

Expected: clean worktree, local `HEAD` contains only the intended commits, and `origin/main` has no unintegrated commit. If the remote is ahead or diverged, stop and report the exact commits to Bryan; do not merge, rebase, or force-push without a new decision.

- [ ] **Step 3: Push the approved branch normally**

Run: `git push origin HEAD:main`

Expected: a fast-forward update of `origin/main`; never use `--force` or `--force-with-lease`.

- [ ] **Step 4: Verify GitHub received the exact commit**

Run:

```bash
git rev-parse HEAD
git ls-remote origin refs/heads/main
```

Expected: both commands show the same commit hash.

- [ ] **Step 5: Verify the automatic Vercel deployment**

Wait for the connected deployment to complete, then open `https://rvmj.vercel.app` in a fresh browser context. Confirm HTTP 200, the cream Refined Tile Club home renders, no browser console error appears, the Sora font asset loads from the app's own `/_next/static/` path, and every CSS/JS asset requested by the page returns 200.

Open `https://rvmj.vercel.app/login` and `https://rvmj.vercel.app/chips`; confirm both return 200 and carry the same visual system. Do not sign in with or expose any credential during this public deployment check.

- [ ] **Step 6: Report the shipped result**

Give Bryan the GitHub branch, final commit hash, live URL, automated check results, and production verification outcome. If deployment failed, report the failure and keep working within the already-approved frontend scope until the live checks pass.
