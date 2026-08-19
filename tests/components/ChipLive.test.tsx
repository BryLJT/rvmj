import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, waitFor, cleanup, act } from '@testing-library/react';
import { ChipLive } from '../../src/app/game/[id]/ChipLive';

/**
 * Same shape as ChipEndFlow.test.tsx: a vi.hoisted mutable server row, the realtime handlers the
 * component registered captured on the way past, and a `serverUpdate` helper that moves the row
 * and then fires them. ChipLive reads three tables, so the mock query object has to satisfy
 * `.eq().order()` (notable_claims), `.eq().single()` (games) and a bare awaited `.eq()`
 * (game_players) — hence the thenable.
 *
 * `removeChannel` genuinely unregisters that channel's handlers. That fidelity is load-bearing:
 * the reopen tests below rerender with a new `status` prop, which re-creates the subscription,
 * and a mock that leaked the old handler would fire a stale closure that the real app never has.
 */
const db = vi.hoisted(() => ({
  game: null as Record<string, unknown> | null,
  claims: [] as Record<string, unknown>[],
  gamePlayers: { data: null, error: null } as { data: unknown; error: unknown },
  gameError: null as { message: string } | null,
  claimsError: null as { message: string } | null,
  handlers: [] as (() => void)[],
  subscribeCbs: [] as ((s: string) => void)[],
}));

vi.mock('../../src/lib/actions/game', () => ({
  reopenChipGame: vi.fn(async () => ({})),
  logNotable: vi.fn(async () => ({})),
  proposeChipCounts: vi.fn(async () => ({})),
  confirmChipResult: vi.fn(async () => ({ result: 'pending_1' })),
}));

vi.mock('../../src/lib/supabase/client', () => {
  const payload = (table: string) => {
    if (table === 'notable_claims') {
      return db.claimsError ? { data: null, error: db.claimsError } : { data: db.claims.map((c) => ({ ...c })), error: null };
    }
    if (table === 'games') {
      return db.gameError ? { data: null, error: db.gameError } : { data: db.game ? { ...db.game } : null, error: null };
    }
    return { ...db.gamePlayers };
  };
  const query = (table: string) => {
    const q: Record<string, unknown> = {
      eq: () => q,
      order: async () => payload(table),
      single: async () => payload(table),
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve(payload(table)).then(res, rej),
    };
    return q;
  };
  type Ch = { _h: (() => void)[]; on: (...a: unknown[]) => Ch; subscribe: (cb?: (s: string) => void) => Ch };
  return {
    createClient: () => ({
      from: (table: string) => ({ select: () => query(table) }),
      channel: () => {
        const mine: (() => void)[] = [];
        const ch: Ch = {
          _h: mine,
          on: (..._a: unknown[]) => {
            const cb = _a[2] as () => void;
            mine.push(cb); db.handlers.push(cb);
            return ch;
          },
          subscribe: (cb?: (s: string) => void) => { if (cb) db.subscribeCbs.push(cb); return ch; },
        };
        return ch;
      },
      removeChannel: (ch: Ch) => {
        for (const cb of ch._h) {
          const i = db.handlers.indexOf(cb);
          if (i >= 0) db.handlers.splice(i, 1);
        }
      },
    }),
  };
});
// The router object must be STABLE across renders, as Next's real one is: ChipLive's
// subscription effect lists `router` in its deps, so a fresh object per render would tear the
// channel down and re-subscribe forever.
vi.mock('next/navigation', () => {
  const router = { refresh: () => {} };
  return { useRouter: () => router };
});

const players = [
  { playerId: 'p1', seat: 'E' as const, name: 'Ah Seng' },
  { playerId: 'p2', seat: 'S' as const, name: 'Bryan' },
  { playerId: 'p3', seat: 'W' as const, name: 'Ah Beng' },
  { playerId: 'p4', seat: 'N' as const, name: 'Ah Huat' },
];
const notableHands = [{ id: 'h1', name: 'Thirteen Wonders', local_name: null }];

const ENDED = { pending_counts: null, status: 'ended' };
const ACTIVE = { pending_counts: null, status: 'active' };
const SETTLED = {
  data: [
    { player_id: 'p1', final_total: 120 }, { player_id: 'p2', final_total: -80 },
    { player_id: 'p3', final_total: -30 }, { player_id: 'p4', final_total: -10 },
  ],
  error: null,
};
// what reopen_game leaves behind: final_total nulled on all four rows
const REOPENED = {
  data: players.map((p) => ({ player_id: p.playerId, final_total: null })),
  error: null,
};

const view = (status: 'active' | 'ended') => (
  <ChipLive gameId="g1" status={status} players={players} me="p2" notableHands={notableHands} />
);

afterEach(cleanup);
beforeEach(() => {
  db.game = { ...ACTIVE };
  db.claims = [];
  db.gamePlayers = { data: [], error: null };
  db.gameError = null;
  db.claimsError = null;
  db.handlers = [];
  db.subscribeCbs = [];
});

/** Move the server row(s) and fire the realtime handlers the component subscribed to. */
const serverUpdate = async () => { await act(async () => { db.handlers.forEach((cb) => cb()); }); };
const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };

/** Every seat shows its seat letter — i.e. NO settled number is being asserted for anyone. */
const expectNoTotals = () => {
  expect(screen.queryByText('+120')).toBeNull();
  expect(screen.queryByText('-80')).toBeNull();
  // and not four grey zeros either: "everyone broke even" is a claim about a game that has none
  expect(screen.queryAllByText('0')).toHaveLength(0);
  expect(screen.getAllByText(/^[ESWN]$/)).toHaveLength(4);
};

describe('ChipLive after reopen (spec §10 — the recount safety valve)', () => {
  // reopen_game nulls final_total on all four rows and flips status back to 'active'.
  // router.refresh() merges the RSC payload WITHOUT unmounting this client component, so a
  // `finals` that is only ever SET and never CLEARED survives the reopen. Two orderings, both
  // of which must end with no settled numbers on screen.

  it('clears the totals when the realtime UPDATE lands BEFORE the status prop flips', async () => {
    db.game = { ...ENDED };
    db.gamePlayers = SETTLED;
    const { rerender } = render(view('ended'));
    await waitFor(() => expect(screen.getByText('+120')).toBeDefined());

    // reopen fires; realtime beats the RSC payload, so the prop is still 'ended'
    db.game = { ...ACTIVE };
    db.gamePlayers = REOPENED;
    await serverUpdate();
    // unfixed: reload() closes over status='ended', re-reads the nulled rows and
    // `final_total ?? 0` yields a truthy {p1:0,...} → 0/0/0/0 for a LIVE game
    expectNoTotals();

    rerender(view('active'));
    await flush();
    expectNoTotals();
  });

  it('clears the totals when the realtime UPDATE lands AFTER the status prop flips', async () => {
    db.game = { ...ENDED };
    db.gamePlayers = SETTLED;
    const { rerender } = render(view('ended'));
    await waitFor(() => expect(screen.getByText('+120')).toBeDefined());

    rerender(view('active')); // RSC payload merges first
    await flush();

    db.game = { ...ACTIVE };
    db.gamePlayers = REOPENED;
    await serverUpdate();
    // unfixed: the ended branch never re-runs, so the phone keeps the OLD, now-erased totals
    // beside each player for the whole reopened game — the dangerous one
    expectNoTotals();
  });

  it('shows seat letters, not four zeros, when the game_players read FAILS', async () => {
    db.game = { ...ENDED };
    db.gamePlayers = { data: null, error: { message: 'permission denied for table game_players' } };
    db.claims = [{ id: 'c1', player_id: 'p1', notable_hand_id: 'h1' }];
    render(view('ended'));
    // the claim proves reload() actually completed before we assert on the totals
    await waitFor(() => expect(screen.getByText(/Ah Seng — Thirteen Wonders/)).toBeDefined());
    // unfixed: finals = {} is truthy → four grey zeros, indistinguishable from "everyone broke even"
    expectNoTotals();
  });
});

describe('ChipLive resync (realtime replays nothing that was missed)', () => {
  it('reloads when the phone comes back to the foreground', async () => {
    render(view('active'));
    await flush();
    expect(screen.queryByText(/Notable hands/)).toBeNull();

    // logged on another phone while this one was locked — no realtime event will replay it
    db.claims = [{ id: 'c1', player_id: 'p1', notable_hand_id: 'h1' }];
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    await waitFor(() => expect(screen.getByText(/Ah Seng — Thirteen Wonders/)).toBeDefined());
  });

  it('reloads when the socket (re)reaches SUBSCRIBED', async () => {
    render(view('active'));
    await flush();
    expect(screen.queryByText(/Notable hands/)).toBeNull();

    db.claims = [{ id: 'c1', player_id: 'p1', notable_hand_id: 'h1' }];
    expect(db.subscribeCbs.length).toBeGreaterThan(0);
    await act(async () => { db.subscribeCbs.forEach((cb) => cb('SUBSCRIBED')); });
    await waitFor(() => expect(screen.getByText(/Ah Seng — Thirteen Wonders/)).toBeDefined());
  });
});

describe('ChipLive approved active and locked states', () => {
  it('shows a quiet chip game with one primary ending action', async () => {
    render(view('active'));
    await flush();
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
    expect(screen.getByText('+120')).toBeDefined();
  });

  it('shows a refresh failure and blocks stale state-changing actions', async () => {
    db.gameError = { message: 'connection lost' };
    render(view('active'));
    expect((await screen.findByRole('alert')).textContent).toContain('Couldn\u2019t refresh this game');
    expect((screen.getByRole('button', { name: 'Log notable hand' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'End game · count chips' }) as HTMLButtonElement).disabled).toBe(true);
  });

  // The claims read is the FIRST read in reload. If it fails the component must not fall through
  // and repaint the table from a half-finished pass.
  it('treats a failed claims read as a refresh failure too', async () => {
    db.claimsError = { message: 'permission denied for table notable_claims' };
    render(view('active'));
    expect((await screen.findByRole('alert')).textContent).toContain('Couldn\u2019t refresh this game');
    expect((screen.getByRole('button', { name: 'End game · count chips' }) as HTMLButtonElement).disabled).toBe(true);
  });

  // A refresh that fails AFTER a good pass must not erase what the phone already showed.
  it('keeps the last good claims on screen when a later refresh fails', async () => {
    db.claims = [{ id: 'c1', player_id: 'p1', notable_hand_id: 'h1' }];
    render(view('active'));
    await waitFor(() => expect(screen.getByText(/Ah Seng — Thirteen Wonders/)).toBeDefined());

    db.gameError = { message: 'connection lost' };
    await serverUpdate();
    expect(screen.getByText(/Ah Seng — Thirteen Wonders/)).toBeDefined();
    expect((screen.getByRole('button', { name: 'End game · count chips' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
