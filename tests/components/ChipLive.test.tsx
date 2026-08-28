import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, waitFor, cleanup, act, fireEvent, within } from '@testing-library/react';
import { ChipLive } from '../../src/app/game/[id]/ChipLive';
import { logNotable, signNotablePhotos } from '../../src/lib/actions/game';
import { PER_PLAYER } from '../../src/lib/chips';

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
  selects: [] as { table: string; columns: string }[],
  gamesHook: null as null | (() => Promise<void>),
  handlers: [] as (() => void)[],
  subscribeCbs: [] as ((s: string) => void)[],
}));

vi.mock('../../src/lib/actions/game', () => ({
  reopenChipGame: vi.fn(async () => ({})),
  logNotable: vi.fn(async () => ({})),
  proposeChipCounts: vi.fn(async () => ({})),
  endChipGame: vi.fn(async () => ({ result: 'ended' })),
  signNotablePhotos: vi.fn(async () => ({ urls: {} })),
}));

vi.mock('../../src/lib/supabase/client', () => {
  const payload = async (table: string) => {
    if (table === 'games' && db.gamesHook) await db.gamesHook();
    if (table === 'notable_claims') {
      return db.claimsError ? { data: null, error: db.claimsError } : {
        data: db.claims.map((claim) => {
          const { notable_hand_id, ...row } = claim;
          return {
            ...row,
            photo_path: row.photo_path ?? null,
            notable_claim_types: 'notable_claim_types' in claim
              ? claim.notable_claim_types
              : [{ notable_hand_id }],
          };
        }),
        error: null,
      };
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
        payload(table).then(res, rej),
    };
    return q;
  };
  type Ch = { _h: (() => void)[]; on: (...a: unknown[]) => Ch; subscribe: (cb?: (s: string) => void) => Ch };
  return {
    createClient: () => ({
      auth: {
        getSession: async () => ({ data: { session: { access_token: 'authenticated-token' } }, error: null }),
      },
      realtime: { setAuth: async () => undefined },
      from: (table: string) => ({
        select: (columns: string) => {
          db.selects.push({ table, columns });
          return query(table);
        },
      }),
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
      removeChannel: async (ch: Ch) => {
        for (const cb of ch._h) {
          const i = db.handlers.indexOf(cb);
          if (i >= 0) db.handlers.splice(i, 1);
        }
        return 'ok';
      },
    }),
  };
});
// The router object must be STABLE across renders, as Next's real one is: ChipLive's
// subscription effect lists `router` in its deps, so a fresh object per render would tear the
// channel down and re-subscribe forever.
const navigation = vi.hoisted(() => ({ router: { refresh: vi.fn() } }));
vi.mock('next/navigation', () => ({ useRouter: () => navigation.router }));

const players = [
  { playerId: 'p1', seat: 'E' as const, name: 'Ah Seng' },
  { playerId: 'p2', seat: 'S' as const, name: 'Bryan' },
  { playerId: 'p3', seat: 'W' as const, name: 'Ah Beng' },
  { playerId: 'p4', seat: 'N' as const, name: 'Ah Huat' },
];
const notableHands = [
  { id: 'h1', name: 'Thirteen Wonders', local_name: null, rarity: 'legendary' as const },
  { id: 'h8', name: 'All Pungs', local_name: null, rarity: 'rare' as const },
];

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

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
beforeEach(() => {
  vi.clearAllMocks();
  db.game = { ...ACTIVE };
  db.claims = [];
  db.gamePlayers = { data: [], error: null };
  db.gameError = null;
  db.claimsError = null;
  db.selects = [];
  db.gamesHook = null;
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

const expectUnreadableClaimsBlocked = async () => {
  expect((await screen.findByRole('alert')).textContent).toContain('Couldn\u2019t refresh this game');
  expect(screen.queryByRole('heading', { name: 'Notable hands' })).toBeNull();
  expect(screen.queryByText('🏆 Bryan — ?')).toBeNull();
  expect((screen.getByRole('button', { name: 'End game · count chips' }) as HTMLButtonElement).disabled).toBe(true);
};

describe('ChipLive multi-label notable wins', () => {
  it('renders one live entry with every alphabetized label for one physical win', async () => {
    db.claims = [{
      id: 'c1',
      player_id: 'p2',
      photo_path: null,
      notable_claim_types: [
        { notable_hand_id: 'h1' },
        { notable_hand_id: 'h8' },
      ],
    }];

    render(view('active'));

    const notableWins = (await screen.findByRole('heading', { name: 'Notable hands' })).closest('section');
    expect(notableWins).not.toBeNull();
    await waitFor(() => expect(within(notableWins!).getAllByRole('listitem')).toHaveLength(1));

    const [win] = within(notableWins!).getAllByRole('listitem');
    expect(within(notableWins!).getAllByText(/Bryan/)).toHaveLength(1);
    expect(win.textContent).toContain('All Pungs');
    expect(win.textContent).toContain('Thirteen Wonders');
    expect(win.textContent?.indexOf('All Pungs')).toBeLessThan(win.textContent?.indexOf('Thirteen Wonders') ?? -1);
  });

  it('requests nested claim-type rows with the parent win', async () => {
    render(view('active'));

    await waitFor(() => expect(db.selects.find(({ table }) => table === 'notable_claims')?.columns)
      .toBe('id, player_id, photo_path, notable_claim_types(notable_hand_id)'));
  });

  it('fails closed when a parent win arrives without readable joined labels', async () => {
    db.claims = [{
      id: 'c1',
      player_id: 'p2',
      photo_path: null,
      notable_claim_types: null,
    }];

    render(view('active'));

    await expectUnreadableClaimsBlocked();
  });

  it('fails closed when a joined label row is malformed', async () => {
    db.claims = [{
      id: 'c1',
      player_id: 'p2',
      photo_path: null,
      notable_claim_types: [null],
    }];

    render(view('active'));

    await expectUnreadableClaimsBlocked();
  });

  it('fails closed when a joined label is absent from the supplied catalogue', async () => {
    db.claims = [{
      id: 'c1',
      player_id: 'p2',
      photo_path: null,
      notable_claim_types: [{ notable_hand_id: 'unknown-hand' }],
    }];

    render(view('active'));

    await expectUnreadableClaimsBlocked();
  });
});

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

  it('fails closed when the live table connection times out', async () => {
    render(view('active'));
    await waitFor(() => expect((screen.getByRole('button', { name: 'End game · count chips' }) as HTMLButtonElement).disabled).toBe(false));
    await waitFor(() => expect(db.subscribeCbs.length).toBeGreaterThan(0));

    act(() => { db.subscribeCbs.forEach((callback) => callback('TIMED_OUT')); });

    expect(screen.getByRole('alert').textContent).toContain('Live table connection lost');
    expect((screen.getByRole('button', { name: 'Log notable win' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'End game · count chips' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('does not let a successful foreground read reopen actions before Realtime reconnects', async () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    render(view('active'));
    await waitFor(() => expect((screen.getByRole('button', { name: 'End game · count chips' }) as HTMLButtonElement).disabled).toBe(false));
    await waitFor(() => expect(db.subscribeCbs.length).toBeGreaterThan(0));
    act(() => { db.subscribeCbs.forEach((callback) => callback('TIMED_OUT')); });

    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });

    expect(screen.getByRole('alert').textContent).toContain('Live table connection lost');
    expect((screen.getByRole('button', { name: 'Log notable win' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'End game · count chips' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('keeps an open notable-hand draft visible but blocks its action after Realtime fails', async () => {
    render(view('active'));
    await waitFor(() => expect((screen.getByRole('button', { name: 'Log notable win' }) as HTMLButtonElement).disabled).toBe(false));
    await waitFor(() => expect(db.subscribeCbs.length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole('button', { name: 'Log notable win' }));
    const dialog = screen.getByRole('dialog', { name: 'Log notable win' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Bryan' }));
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Thirteen Wonders' }));

    act(() => { db.subscribeCbs.forEach((callback) => callback('CHANNEL_ERROR')); });

    expect(screen.getByRole('dialog', { name: 'Log notable win' })).toBeDefined();
    expect(within(dialog).getByRole('alert').textContent).toContain('Live table connection lost');
    const action = within(dialog).getByRole('button', { name: 'Log notable win' }) as HTMLButtonElement;
    expect(action.disabled).toBe(true);
    fireEvent.click(action);
    expect(logNotable).not.toHaveBeenCalled();
    expect(within(dialog).getByRole('button', { name: 'Bryan' }).getAttribute('aria-pressed')).toBe('true');
    expect((within(dialog).getByRole('checkbox', { name: 'Thirteen Wonders' }) as HTMLInputElement).checked).toBe(true);
  });
});

describe('ChipLive approved active and locked states', () => {
  it('shows a quiet chip game with one primary ending action', async () => {
    render(view('active'));
    await flush();
    expect(screen.getByText('Chip game in progress')).toBeDefined();
    expect(screen.getByRole('button', { name: 'End game · count chips' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Log notable win' })).toBeDefined();
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
    expect((screen.getByRole('button', { name: 'Log notable win' }) as HTMLButtonElement).disabled).toBe(true);
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

describe('ChipLive review round 1 — fail-closed and ordering', () => {
  // The guard read `if (error || !gps)`. supabase-js returns { data: [], error: null } when RLS
  // filters every row, and Object.fromEntries([]) is {} — truthy — so the screen rendered four
  // grey zeros for a settled game: exactly the "everyone broke even" claim the guard exists to
  // prevent, with no error shown.
  it('shows seat letters, not four zeros, when the settled rows come back EMPTY', async () => {
    db.game = { ...ENDED };
    db.gamePlayers = { data: [], error: null };
    db.claims = [{ id: 'c1', player_id: 'p1', notable_hand_id: 'h1' }];
    render(view('ended'));
    await waitFor(() => expect(screen.getByText(/Ah Seng — Thirteen Wonders/)).toBeDefined());
    expectNoTotals();
  });

  it('shows seat letters when only SOME seats came back', async () => {
    db.game = { ...ENDED };
    db.gamePlayers = { data: [{ player_id: 'p1', final_total: 120 }], error: null };
    render(view('ended'));
    await flush();
    expectNoTotals();
  });

  // status='ended' with null totals is a half-written settlement, not a draw.
  it('shows seat letters when a settled row has no total yet', async () => {
    db.game = { ...ENDED };
    db.gamePlayers = { data: players.map((p) => ({ player_id: p.playerId, final_total: null })), error: null };
    render(view('ended'));
    await flush();
    expectNoTotals();
  });

  // The success banner is the one claim on this screen that was still asserted from the `status`
  // prop, which reload() deliberately does not trust.
  it('does not claim the leaderboard was updated when the result could not be read', async () => {
    db.game = { ...ENDED };
    db.gamePlayers = { data: null, error: { message: 'permission denied for table game_players' } };
    render(view('ended'));
    await waitFor(() => expect(screen.getByRole('alert')).toBeDefined());
    expect(screen.queryByText('Game locked')).toBeNull();
    expect(screen.queryByText(/leaderboard has been updated/)).toBeNull();
  });

  // Two reloads overlap constantly here (mount + SUBSCRIBED + realtime + foreground). If an older
  // pass may still write, a stale success lands after a fresh failure and re-enables "End game"
  // on a view the component already knows is stale.
  it('does not let an older in-flight read re-enable actions after a newer read failed', async () => {
    let release!: () => void;
    const held = new Promise<void>((r) => { release = r; });
    let firstRead = true;
    db.gamesHook = async () => { if (firstRead) { firstRead = false; await held; } };

    render(view('active'));
    await flush();

    db.gameError = { message: 'connection lost' };
    await serverUpdate();
    expect((screen.getByRole('button', { name: 'End game · count chips' }) as HTMLButtonElement).disabled).toBe(true);

    db.gameError = null;
    await act(async () => { release(); await Promise.resolve(); await Promise.resolve(); });
    expect((screen.getByRole('button', { name: 'End game · count chips' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('alert').textContent).toContain('Couldn\u2019t refresh this game');
  });

  // The logger panel sits at z-50; the end-of-game flow at z-10. Left open, it hides the confirm
  // step entirely and the table stalls at three of four confirmations.
  it('closes the notable logger when a proposal opens the counting flow', async () => {
    render(view('active'));
    await flush();
    act(() => { screen.getByRole('button', { name: 'Log notable win' }).click(); });
    expect(screen.queryByRole('dialog', { name: 'Log notable win' })).not.toBeNull();

    const stacks = { E: { ...PER_PLAYER }, S: { ...PER_PLAYER }, W: { ...PER_PLAYER }, N: { ...PER_PLAYER } };
    db.game = { pending_counts: stacks, pending_proposed_by: null, status: 'active', last_activity_at: '2026-08-19T10:00:00.000Z' };
    await serverUpdate();
    expect(screen.queryByRole('dialog', { name: 'Log notable win' })).toBeNull();
  });
});

describe('ChipLive review round 2 — trusting the freshly-read row everywhere', () => {
  const stacks = () => ({ E: { ...PER_PLAYER }, S: { ...PER_PLAYER }, W: { ...PER_PLAYER }, N: { ...PER_PLAYER } });

  // Only the games-realtime path calls router.refresh(); foreground and resubscribe call reload()
  // alone. A phone backgrounded across a reopen-and-repropose comes back with a stale 'ended'
  // prop, so the whole screen stayed on Final result and could never confirm — the table stalls
  // at 3/4, which is the same failure the logger fix in this file already guards against.
  it('leaves the locked view when the fresh row says the game is live again', async () => {
    db.game = { ...ENDED };
    db.gamePlayers = SETTLED;
    render(view('ended'));
    await waitFor(() => expect(screen.getByText('+120')).toBeDefined());

    db.game = { pending_counts: stacks(), pending_proposed_by: null, status: 'active', last_activity_at: '2026-08-19T10:00:00.000Z' };
    db.gamePlayers = REOPENED;
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });

    expect(screen.queryByText('Final result')).toBeNull();
    expect(screen.getByText('Chip game in progress')).toBeDefined();
    expect(await screen.findByRole('dialog', { name: 'The table count' })).toBeDefined();
  });

  // Closing on every pending reload, rather than on the transition into pending, discards a
  // half-filled notable hand whenever anyone else touches the table.
  it('keeps an open notable logger across a reload that was already pending', async () => {
    db.game = { pending_counts: stacks(), pending_proposed_by: null, status: 'active', last_activity_at: '2026-08-19T10:00:00.000Z' };
    render(view('active'));
    await flush();

    act(() => { screen.getByRole('button', { name: 'Log notable win' }).click(); });
    expect(screen.queryByRole('dialog', { name: 'Log notable win' })).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Bryan' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Thirteen Wonders' }));

    await serverUpdate();
    expect(screen.queryByRole('dialog', { name: 'Log notable win' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Bryan' }).getAttribute('aria-pressed')).toBe('true');
    expect((screen.getByRole('checkbox', { name: 'Thirteen Wonders' }) as HTMLInputElement).checked).toBe(true);
  });

  // players comes from an embedded select with no ORDER BY, so its row order is not stable.
  // Keying the subscription on that order tears the channel down and re-checks on every refresh.
  it('does not rebuild the realtime channel when the player rows arrive in a different order', async () => {
    const { rerender } = render(view('active'));
    await flush();
    const before = db.subscribeCbs.length;

    const reversed = [...players].reverse();
    rerender(<ChipLive gameId="g1" status="active" players={reversed} me="p2" notableHands={notableHands} />);
    await flush();
    expect(db.subscribeCbs.length).toBe(before);
  });
});

describe('ChipLive review round 3 — terminal rows fail closed', () => {
  const expectActionsBlocked = () => {
    expect((screen.getByRole('button', { name: 'Log notable win' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'End game · count chips' }) as HTMLButtonElement).disabled).toBe(true);
  };

  it('does not invent an active game when SUBSCRIBED finds an expired row', async () => {
    render(view('active'));
    await waitFor(() => expect((screen.getByRole('button', { name: 'End game · count chips' }) as HTMLButtonElement).disabled).toBe(false));
    navigation.router.refresh.mockClear();

    db.game = { pending_counts: null, status: 'expired' };
    await act(async () => { db.subscribeCbs.forEach((callback) => callback('SUBSCRIBED')); });

    expect((await screen.findByRole('alert')).textContent).toContain('Couldn\u2019t refresh this game');
    expectActionsBlocked();
    expect(navigation.router.refresh).toHaveBeenCalledTimes(1);
  });

  it('does not invent an active game when foreground recovery finds an expired row', async () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    render(view('active'));
    await waitFor(() => expect((screen.getByRole('button', { name: 'End game · count chips' }) as HTMLButtonElement).disabled).toBe(false));
    navigation.router.refresh.mockClear();

    db.game = { pending_counts: null, status: 'expired' };
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });

    expect((await screen.findByRole('alert')).textContent).toContain('Couldn\u2019t refresh this game');
    expectActionsBlocked();
    expect(navigation.router.refresh).toHaveBeenCalledTimes(1);
  });
});

describe('ChipLive review round 4 — the in-game chip set link is a real touch target', () => {
  // Measured in a real browser at 360x800: 182 x 18, display:inline, padding:0 — 26px short of
  // the mandated 44px. It is the SOLE content of its <p>, so it is a standalone navigation
  // control, not a link inside a sentence. The same link to the same destination already renders
  // through ActionLink on the home screen (page.tsx) and the forming screen (FormingScreen.tsx);
  // only the in-game copy was left as a bare typographic <Link>.
  it('renders the chip set link through the shared action-link sizing contract', async () => {
    render(view('active'));
    await flush();

    const link = screen.getByRole('link', { name: 'House rules' });
    // Carries the match, so the rules page can send this player back into it rather than
    // dumping them on the leaderboard mid-game.
    expect(link.getAttribute('href')).toBe('/chips?game=g1');

    const classes = link.className.split(' ');
    // 44x44 minimum, and the display mode that lets the padding actually create a hit area.
    expect(classes).toContain('min-h-11');
    expect(classes).toContain('min-w-11');
    expect(classes).toContain('inline-flex');
  });

  // The link is a live-game affordance only; the locked screen has no chip set to reach for.
  it('does not offer the chip set link once the game has ended', async () => {
    db.game = { ...ENDED };
    db.gamePlayers = SETTLED;
    render(view('ended'));
    await flush();
    expect(screen.queryByRole('link', { name: 'House rules' })).toBeNull();
  });
});

describe('ChipLive way back to the leaderboard', () => {
  it('offers a leaderboard link once the game has ended', async () => {
    db.game = { ...ENDED };
    db.gamePlayers = SETTLED;
    render(view('ended'));
    await flush();

    expect(screen.getByRole('link', { name: 'Leaderboard' }).getAttribute('href')).toBe('/');
  });

  // Leaving mid-game is not the affordance being added; the exit belongs to the settled screen.
  it('does not offer the leaderboard link while the game is still live', async () => {
    render(view('active'));
    await flush();

    expect(screen.queryByRole('link', { name: 'Leaderboard' })).toBeNull();
  });

  // The reason this link lives in the client component and not the server-rendered top bar.
  // Phones lock constantly at a table, and waking one calls reload() WITHOUT router.refresh()
  // (see ChipLive's own note), so the `status` prop can still read 'active' on a screen that is
  // already showing Final result. Keyed off the prop, the exit would be missing exactly then.
  it('offers the leaderboard link when only the freshly-read row knows the game ended', async () => {
    render(view('active'));
    await flush();
    expect(screen.queryByRole('link', { name: 'Leaderboard' })).toBeNull();

    db.game = { ...ENDED };
    db.gamePlayers = SETTLED;
    await serverUpdate();

    expect(screen.getByText('Final result')).toBeDefined();
    expect(screen.getByRole('link', { name: 'Leaderboard' }).getAttribute('href')).toBe('/');
  });
});

describe('ChipLive notable-hand photos', () => {
  it('uses every alphabetized label in a multi-label thumbnail description', async () => {
    db.claims = [{
      id: 'c1',
      player_id: 'p2',
      photo_path: 'g1/a.webp',
      notable_claim_types: [
        { notable_hand_id: 'h1' },
        { notable_hand_id: 'h8' },
      ],
    }];
    vi.mocked(signNotablePhotos).mockResolvedValue({ urls: { c1: 'https://signed.example/a.webp' } });

    render(view('active'));

    expect(await screen.findByAltText('All Pungs, Thirteen Wonders won by Bryan')).toBeDefined();
  });

  it('shows a thumbnail for a claim that has one', async () => {
    db.claims = [{ id: 'c1', player_id: 'p2', notable_hand_id: 'h1', photo_path: 'g1/a.webp' }];
    vi.mocked(signNotablePhotos).mockResolvedValue({ urls: { c1: 'https://signed.example/a.webp' } });

    render(view('active'));
    await flush();
    await flush();

    const img = screen.getByAltText('Thirteen Wonders won by Bryan') as HTMLImageElement;
    expect(img.src).toBe('https://signed.example/a.webp');
  });

  it('renders no placeholder for a claim without a photo', async () => {
    db.claims = [{ id: 'c1', player_id: 'p2', notable_hand_id: 'h1', photo_path: null }];

    const { container } = render(view('active'));
    await flush();

    // Not queryByRole('img'): AppFrame's wordmark is a role="img" composite present on every
    // screen, so the real assertion is that no <img> element was rendered at all.
    expect(container.querySelector('img')).toBeNull();
    expect(vi.mocked(signNotablePhotos)).not.toHaveBeenCalled();
  });

  // Photos are decoration. A signing outage must not reach the fail-closed chip guards.
  it('keeps chip actions available when signing fails', async () => {
    db.claims = [{ id: 'c1', player_id: 'p2', notable_hand_id: 'h1', photo_path: 'g1/a.webp' }];
    vi.mocked(signNotablePhotos).mockResolvedValue({ error: 'could not sign photos' });

    render(view('active'));
    await flush();
    await flush();

    expect((screen.getByRole('button', { name: 'End game · count chips' }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByRole('alert')?.textContent ?? '').not.toContain('sign');
  });

  // The test above covers a RETURNED error. A server action over table wifi rejects instead,
  // and `void` discards the value, not the rejection — so the effect's "swallowed rather than
  // surfaced" comment is only true if the chain actually carries a .catch().
  it('swallows a signing request that rejects rather than leaking an unhandled rejection', async () => {
    db.claims = [{ id: 'c1', player_id: 'p2', notable_hand_id: 'h1', photo_path: 'g1/a.webp' }];
    vi.mocked(signNotablePhotos).mockRejectedValue(new Error('offline'));
    const leaked: unknown[] = [];
    const record = (reason: unknown) => leaked.push(reason);
    process.on('unhandledRejection', record);

    try {
      render(view('active'));
      await flush();
      await flush();
      // Node decides a rejection is unhandled one macrotask after the microtask queue drains.
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

      expect(leaked).toEqual([]);
      expect((screen.getByRole('button', { name: 'End game · count chips' }) as HTMLButtonElement).disabled).toBe(false);
    } finally {
      process.off('unhandledRejection', record);
    }
  });
});
