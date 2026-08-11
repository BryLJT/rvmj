import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import { ChipEndFlow } from '../../src/app/game/[id]/ChipEndFlow';
import { proposeChipCounts } from '../../src/lib/actions/game';
import { PER_PLAYER } from '../../src/lib/chips';

// The brief's supabase mock is static (pending_counts always null), which leaves ConfirmPanel
// unrendered by the whole suite. This mutable version lets a test move the server row and then
// fire the realtime `games` UPDATE handler the component registered — the only way to exercise
// the proposal-identity behaviour carried directive 2 is about.
const db = vi.hoisted(() => ({
  row: {} as Record<string, unknown>,
  handlers: [] as (() => void)[],
  subscribeCbs: [] as ((s: string) => void)[],
}));

vi.mock('../../src/lib/actions/game', () => ({
  proposeChipCounts: vi.fn(async () => ({ conservation: { failedDenominations: [1, 10], grandTotalOff: false } })),
  confirmChipResult: vi.fn(async () => ({ result: 'pending_1' })),
}));
vi.mock('../../src/lib/supabase/client', () => ({
  createClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { ...db.row } }) }) }) }),
    channel: () => {
      const ch = {
        on: (_e: string, _f: unknown, cb: () => void) => { db.handlers.push(cb); return ch; },
        subscribe: (cb?: (s: string) => void) => { if (cb) db.subscribeCbs.push(cb); return ch; },
      };
      return ch;
    },
    removeChannel: () => {},
  }),
}));
// STABLE across renders, as Next's real router object is — effects that list it in their deps
// must not tear down and re-subscribe on every render.
vi.mock('next/navigation', () => {
  const router = { refresh: vi.fn() };
  return { useRouter: () => router };
});

const players = [
  { playerId: 'p1', seat: 'E' as const, name: 'Ah Seng' },
  { playerId: 'p2', seat: 'S' as const, name: 'Bryan' },
  { playerId: 'p3', seat: 'W' as const, name: 'Ah Beng' },
  { playerId: 'p4', seat: 'N' as const, name: 'Ah Huat' },
];

// vitest runs without `globals: true`, so @testing-library's auto-cleanup never registers —
// without this, each test renders into a DOM still holding the previous test's overlay.
afterEach(cleanup);
beforeEach(() => {
  db.row = { pending_counts: null, pending_confirmed: [], status: 'active', last_activity_at: '2026-08-11T10:00:00.000Z' };
  db.handlers = [];
  db.subscribeCbs = [];
});

/** Push a new server row and fire the realtime `games` UPDATE the component subscribed to. */
const serverUpdate = async (row: Record<string, unknown>) => {
  db.row = row;
  await act(async () => { db.handlers.forEach((cb) => cb()); });
};

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

  // Carried directive 5: a REJECTED server-action promise (transport failure at the table)
  // must not leave the button stuck disabled — try/catch/finally, not try/finally alone.
  it('re-enables Check & propose and surfaces an error when the action rejects', async () => {
    vi.mocked(proposeChipCounts).mockRejectedValueOnce(new Error('network down'));
    render(<ChipEndFlow gameId="g1" players={players} me="p2" onClose={() => {}} />);
    const btn = screen.getByRole('button', { name: /Check & propose/ });
    fireEvent.click(btn);
    await waitFor(() => {
      expect(screen.getByText(/network down/)).toBeDefined();
    });
    expect((btn as HTMLButtonElement).disabled).toBe(false);
  });

  // Carried directive 4: this overlay (the second in the app) carries dialog semantics
  // and closes on Escape — a phone keyboard/bluetooth keyboard user can back out.
  it('is a labelled modal dialog that closes on Escape', () => {
    const onClose = vi.fn();
    render(<ChipEndFlow gameId="g1" players={players} me="p2" onClose={onClose} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-label') ?? dialog.getAttribute('aria-labelledby')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});

describe('ChipEndFlow confirm phase (spec §8.6 — all four confirm)', () => {
  const stacks = { E: { ...PER_PLAYER }, S: { ...PER_PLAYER }, W: { ...PER_PLAYER }, N: { ...PER_PLAYER } };
  const row = (confirmed: string[], at: string) => ({
    pending_counts: stacks, pending_confirmed: confirmed, status: 'active', last_activity_at: at,
  });
  const confirmButton = () => screen.getByRole('button', { name: /Confirm my count|You confirmed/ }) as HTMLButtonElement;

  it('shows the four net results and the confirmation ticker from the server proposal', async () => {
    db.row = row([], '2026-08-11T10:00:00.000Z');
    render(<ChipEndFlow gameId="g1" players={players} me="p2" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText('Confirm the count')).toBeDefined());
    expect(screen.getByText(/0\/4 confirmed/)).toBeDefined();
    expect(screen.getAllByText('0')).toHaveLength(4); // four untouched stacks → four zero nets
    expect(confirmButton().disabled).toBe(false);
  });

  // Carried directive 2, the case a content signature cannot see: the table recounts, gets the
  // SAME numbers, and re-proposes. propose_chip_counts resets pending_confirmed to '{}' but
  // pending_counts is byte-identical — a phone that already confirmed must be able to confirm
  // again, or the game can never reach four and the recount loop livelocks.
  it('re-enables confirm after an IDENTICAL re-proposal resets the confirmations', async () => {
    db.row = row([], '2026-08-11T10:00:00.000Z');
    render(<ChipEndFlow gameId="g1" players={players} me="p2" onClose={() => {}} />);
    await waitFor(() => expect(confirmButton().disabled).toBe(false));

    fireEvent.click(confirmButton());
    await serverUpdate(row(['p2'], '2026-08-11T10:00:00.000Z'));
    expect(screen.getByText(/1\/4 confirmed/)).toBeDefined();
    expect(confirmButton().disabled).toBe(true);

    // identical counts re-proposed → confirmations wiped
    await serverUpdate(row([], '2026-08-11T10:05:00.000Z'));
    await waitFor(() => expect(screen.getByText(/0\/4 confirmed/)).toBeDefined());
    expect(confirmButton().disabled).toBe(false);
  });
});

// Supabase realtime does NOT replay events missed while the socket was down, and phones on a
// mahjong table lock and background constantly. Without a resync on reconnect/foreground, this
// phone comes back showing a SUPERSEDED proposal with an ENABLED Confirm and no staleness
// signal — and that tap confirms the CURRENT proposal, numbers the player never saw.
describe('ChipEndFlow resync after the socket missed something', () => {
  const stacks = { E: { ...PER_PLAYER }, S: { ...PER_PLAYER }, W: { ...PER_PLAYER }, N: { ...PER_PLAYER } };
  const proposed = { pending_counts: stacks, pending_confirmed: [], status: 'active', last_activity_at: '2026-08-11T10:05:00.000Z' };

  it('reloads when the phone comes back to the foreground', async () => {
    render(<ChipEndFlow gameId="g1" players={players} me="p2" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText('Count chips')).toBeDefined());

    db.row = proposed; // proposed on another phone while this one was locked — no event replays
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    await waitFor(() => expect(screen.getByText('Confirm the count')).toBeDefined());
  });

  it('reloads when the socket (re)reaches SUBSCRIBED', async () => {
    render(<ChipEndFlow gameId="g1" players={players} me="p2" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText('Count chips')).toBeDefined());

    db.row = proposed;
    expect(db.subscribeCbs.length).toBeGreaterThan(0);
    await act(async () => { db.subscribeCbs.forEach((cb) => cb('SUBSCRIBED')); });
    await waitFor(() => expect(screen.getByText('Confirm the count')).toBeDefined());
  });
});
