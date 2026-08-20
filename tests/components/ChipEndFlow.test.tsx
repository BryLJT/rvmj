import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChipEndFlow } from '../../src/app/game/[id]/ChipEndFlow';
import { confirmChipResult, proposeChipCounts } from '../../src/lib/actions/game';
import { PER_PLAYER } from '../../src/lib/chips';

type GameRead = { data: Record<string, unknown> | null; error?: unknown };

const db = vi.hoisted(() => ({
  row: {} as Record<string, unknown>,
  error: undefined as unknown,
  reads: [] as Array<GameRead | Promise<GameRead>>,
  handlers: [] as (() => void)[],
  subscribeCbs: [] as ((status: string) => void)[],
  channelName: undefined as string | undefined,
  channel: undefined as unknown,
  registrations: [] as Array<{ event: string; config: Record<string, string>; callback: () => void }>,
  selects: [] as string[],
  removeChannel: vi.fn(async () => 'ok'),
}));

const navigation = vi.hoisted(() => ({ router: { refresh: vi.fn() } }));

vi.mock('../../src/lib/actions/game', () => ({
  proposeChipCounts: vi.fn(async () => ({})),
  confirmChipResult: vi.fn(async () => ({ result: 'pending_1' })),
}));
vi.mock('../../src/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      getSession: async () => ({ data: { session: { access_token: 'authenticated-token' } }, error: null }),
    },
    realtime: { setAuth: async () => undefined },
    from: (table: string) => ({
      select: (columns: string) => {
        db.selects.push(`${table}:${columns}`);
        return {
          eq: () => ({
            single: async () => {
              const queued = db.reads.shift();
              if (queued) return await queued;
              return { data: db.error ? null : { ...db.row }, error: db.error };
            },
          }),
        };
      },
    }),
    channel: (name: string) => {
      const channel = {
        on: (event: string, config: Record<string, string>, callback: () => void) => {
          db.registrations.push({ event, config, callback });
          db.handlers.push(callback);
          return channel;
        },
        subscribe: (callback?: (status: string) => void) => {
          if (callback) db.subscribeCbs.push(callback);
          return channel;
        },
      };
      db.channelName = name;
      db.channel = channel;
      return channel;
    },
    removeChannel: db.removeChannel,
  }),
}));
vi.mock('next/navigation', () => ({ useRouter: () => navigation.router }));

const players = [
  { playerId: 'p1', seat: 'E' as const, name: 'Ah Seng' },
  { playerId: 'p2', seat: 'S' as const, name: 'Bryan' },
  { playerId: 'p3', seat: 'W' as const, name: 'Ah Beng' },
  { playerId: 'p4', seat: 'N' as const, name: 'Ah Huat' },
];

const balanced = () => ({
  E: { ...PER_PLAYER }, S: { ...PER_PLAYER }, W: { ...PER_PLAYER }, N: { ...PER_PLAYER },
});

const proposalRow = (confirmed: string[] = [], at = '2026-08-19T10:00:00.000Z', counts = balanced()) => ({
  pending_counts: counts,
  pending_confirmed: confirmed,
  status: 'active',
  last_activity_at: at,
});

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
};

const renderFlow = (onClose = vi.fn()) => {
  render(<ChipEndFlow gameId="g1" players={players} me="p2" onClose={onClose} />);
  return onClose;
};

const waitForCountReady = async () => {
  const button = screen.getByRole('button', { name: 'Check all counts' }) as HTMLButtonElement;
  await waitFor(() => expect(button.disabled).toBe(false));
  return button;
};

const serverUpdate = async (row: Record<string, unknown>) => {
  db.row = row;
  await act(async () => { db.handlers[0]?.(); });
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.clearAllMocks();
  db.row = { pending_counts: null, pending_confirmed: [], status: 'active', last_activity_at: '2026-08-19T09:00:00.000Z' };
  db.error = undefined;
  db.reads = [];
  db.handlers = [];
  db.subscribeCbs = [];
  db.channelName = undefined;
  db.channel = undefined;
  db.registrations = [];
  db.selects = [];
  vi.mocked(proposeChipCounts).mockResolvedValue({});
  vi.mocked(confirmChipResult).mockResolvedValue({ result: 'pending_1' });
});

describe('ChipEndFlow count entry', () => {
  it('uses the controlled count form and keeps Escape dismissal', async () => {
    const onClose = renderFlow();

    expect(screen.getByRole('dialog', { name: 'Count every stack' })).toBeDefined();
    await waitForCountReady();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // The panel's React onKeyDown only sees keys pressed on something INSIDE it. Tapping the panel
  // background — which is not focusable — parks focus on <body>, and every Escape after that is
  // dispatched there, where no React handler in this tree can reach it. Dispatching on the dialog
  // element itself (the test above) cannot catch this: that is the one case that always worked.
  it('keeps Escape working after a tap on the panel background moves focus to the body', async () => {
    const onClose = renderFlow();
    await waitForCountReady();

    (document.activeElement as HTMLElement | null)?.blur();
    expect(document.activeElement).toBe(document.body);
    fireEvent.keyDown(document.body, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // Confirmation deliberately has no dismissal: a live shared proposal is confirmed or recounted.
  it('does not let Escape dismiss the confirmation panel', async () => {
    db.row = proposalRow();
    const onClose = renderFlow();
    await screen.findByRole('dialog', { name: 'Confirm the table count' });

    (document.activeElement as HTMLElement | null)?.blur();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });

    expect(onClose).not.toHaveBeenCalled();
  });

  it('names every failed denomination and preserves edited input after conservation failure', async () => {
    vi.mocked(proposeChipCounts).mockResolvedValueOnce({
      conservation: { failedDenominations: [1, 10], grandTotalOff: false },
    });
    renderFlow();
    const button = await waitForCountReady();
    const input = screen.getByRole('spinbutton', { name: 'Ah Seng · East · $1 chips' }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '17' } });

    fireEvent.click(button);

    expect(await screen.findByText('Recount the $1 and $10 chips. The table still totals correctly, so two stacks offset each other.')).toBeDefined();
    expect(input.value).toBe('17');
    expect((screen.getByRole('button', { name: 'Check all counts' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('preserves edited input and restores the action after a resolved action error', async () => {
    vi.mocked(proposeChipCounts).mockResolvedValueOnce({ error: 'table changed' });
    renderFlow();
    const button = await waitForCountReady();
    const input = screen.getByRole('spinbutton', { name: 'Bryan · South · $10 chips' }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '23' } });

    fireEvent.click(button);

    expect((await screen.findByRole('alert')).textContent).toContain('table changed');
    expect(input.value).toBe('23');
    expect((screen.getByRole('button', { name: 'Check all counts' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('preserves edited input and restores the action after a rejected transport', async () => {
    vi.mocked(proposeChipCounts).mockRejectedValueOnce(new Error('network down'));
    renderFlow();
    const button = await waitForCountReady();
    const input = screen.getByRole('spinbutton', { name: 'Ah Beng · West · $50 chips' }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '6' } });

    fireEvent.click(button);

    expect((await screen.findByRole('alert')).textContent).toContain('network down');
    expect(input.value).toBe('6');
    expect((screen.getByRole('button', { name: 'Check all counts' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows balanced proposal success while realtime owns the phase change', async () => {
    renderFlow();
    const button = await waitForCountReady();

    fireEvent.click(button);

    expect(await screen.findByText('All 1,600 points and every denomination balance. Sharing this count with the table…')).toBeDefined();
    expect(screen.getByRole('dialog', { name: 'Count every stack' })).toBeDefined();
  });

  it('guards two same-batch proposal activations and sends all sixteen current fields', async () => {
    const action = deferred<{ error?: string }>();
    vi.mocked(proposeChipCounts).mockImplementationOnce(() => action.promise);
    renderFlow();
    const button = await waitForCountReady();
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Ah Huat · North · $100 chips' }), { target: { value: '3' } });

    act(() => {
      button.click();
      button.click();
    });

    expect(proposeChipCounts).toHaveBeenCalledTimes(1);
    expect(proposeChipCounts).toHaveBeenCalledWith('g1', {
      E: { 1: 0, 10: 0, 50: 0, 100: 0 },
      S: { 1: 0, 10: 0, 50: 0, 100: 0 },
      W: { 1: 0, 10: 0, 50: 0, 100: 0 },
      N: { 1: 0, 10: 0, 50: 0, 100: 3 },
    });
    await act(async () => action.resolve({}));
  });

  it('blocks a same-batch proposal activation as soon as resync begins', async () => {
    renderFlow();
    const staleButton = await waitForCountReady();
    const read = deferred<GameRead>();
    db.reads.push(read.promise);

    act(() => {
      db.subscribeCbs[0]?.('SUBSCRIBED');
      staleButton.click();
    });

    expect(proposeChipCounts).not.toHaveBeenCalled();
    expect((screen.getByRole('button', { name: 'Checking counts…' }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => read.resolve({ data: { ...db.row } }));
  });
});

describe('ChipEndFlow recount and proposal identity', () => {
  const latest = {
    E: { 1: 8, 10: 9, 50: 4, 100: 1 },
    S: { 1: 12, 10: 8, 50: 3, 100: 2 },
    W: { 1: 13, 10: 7, 50: 2, 100: 3 },
    N: { 1: 14, 10: 6, 50: 1, 100: 4 },
  };

  it('asks which numbers to use when this phone has different unsent work', async () => {
    renderFlow();
    await waitForCountReady();
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Ah Seng · East · $1 chips' }), { target: { value: '77' } });
    await serverUpdate(proposalRow([], '2026-08-19T10:00:00.000Z', latest));

    fireEvent.click(await screen.findByRole('button', { name: 'Something is wrong · recount' }));

    expect(screen.getByRole('dialog', { name: 'Choose your starting numbers' })).toBeDefined();
    expect(screen.getByText('This phone has unsent numbers that differ from the table’s current count. Choose which set to edit.')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Start recount from the table’s current numbers' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Start recount from my unsent numbers' })).toBeDefined();
  });

  it('replaces unsent work only after choosing the table’s current numbers', async () => {
    renderFlow();
    await waitForCountReady();
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Ah Seng · East · $1 chips' }), { target: { value: '77' } });
    await serverUpdate(proposalRow([], '2026-08-19T10:00:00.000Z', latest));
    fireEvent.click(await screen.findByRole('button', { name: 'Something is wrong · recount' }));

    fireEvent.click(screen.getByRole('button', { name: 'Start recount from the table’s current numbers' }));

    expect((screen.getByRole('spinbutton', { name: 'Ah Seng · East · $1 chips' }) as HTMLInputElement).value).toBe('8');
    expect((screen.getByRole('spinbutton', { name: 'Bryan · South · $100 chips' }) as HTMLInputElement).value).toBe('2');
  });

  it('preserves unsent work after choosing this phone’s numbers', async () => {
    renderFlow();
    await waitForCountReady();
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Ah Seng · East · $1 chips' }), { target: { value: '77' } });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Bryan · South · $10 chips' }), { target: { value: '23' } });
    await serverUpdate(proposalRow([], '2026-08-19T10:00:00.000Z', latest));
    fireEvent.click(await screen.findByRole('button', { name: 'Something is wrong · recount' }));

    fireEvent.click(screen.getByRole('button', { name: 'Start recount from my unsent numbers' }));

    expect((screen.getByRole('spinbutton', { name: 'Ah Seng · East · $1 chips' }) as HTMLInputElement).value).toBe('77');
    expect((screen.getByRole('spinbutton', { name: 'Bryan · South · $10 chips' }) as HTMLInputElement).value).toBe('23');
  });

  it('invalidates an open recount choice when a newer proposal arrives', async () => {
    renderFlow();
    await waitForCountReady();
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Ah Seng · East · $1 chips' }), { target: { value: '77' } });
    await serverUpdate(proposalRow([], '2026-08-19T10:00:00.000Z', latest));
    fireEvent.click(await screen.findByRole('button', { name: 'Something is wrong · recount' }));
    expect(screen.getByRole('dialog', { name: 'Choose your starting numbers' })).toBeDefined();

    await serverUpdate(proposalRow([], '2026-08-19T10:05:00.000Z', latest));

    expect(await screen.findByRole('dialog', { name: 'Confirm the table count' })).toBeDefined();
    expect(screen.queryByRole('dialog', { name: 'Choose your starting numbers' })).toBeNull();
  });

  it('skips the choice when edited local values equal the table’s current numbers', async () => {
    const zeroes = {
      E: { 1: 0, 10: 0, 50: 0, 100: 0 }, S: { 1: 0, 10: 0, 50: 0, 100: 0 },
      W: { 1: 0, 10: 0, 50: 0, 100: 0 }, N: { 1: 0, 10: 0, 50: 0, 100: 0 },
    };
    renderFlow();
    await waitForCountReady();
    const input = screen.getByRole('spinbutton', { name: 'Ah Seng · East · $1 chips' });
    fireEvent.change(input, { target: { value: '1' } });
    fireEvent.change(input, { target: { value: '0' } });
    await serverUpdate(proposalRow([], '2026-08-19T10:00:00.000Z', zeroes));

    fireEvent.click(await screen.findByRole('button', { name: 'Something is wrong · recount' }));

    expect(screen.getByRole('dialog', { name: 'Count every stack' })).toBeDefined();
    expect(screen.queryByRole('dialog', { name: 'Choose your starting numbers' })).toBeNull();
  });

  it('stops treating a successfully shared count as unsent local work', async () => {
    renderFlow();
    const button = await waitForCountReady();
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Ah Seng · East · $1 chips' }), { target: { value: '77' } });
    fireEvent.click(button);
    await waitFor(() => expect(proposeChipCounts).toHaveBeenCalledTimes(1));
    await serverUpdate(proposalRow([], '2026-08-19T10:00:00.000Z', latest));

    fireEvent.click(await screen.findByRole('button', { name: 'Something is wrong · recount' }));

    expect(screen.getByRole('dialog', { name: 'Count every stack' })).toBeDefined();
    expect(screen.queryByRole('dialog', { name: 'Choose your starting numbers' })).toBeNull();
    expect((screen.getByRole('spinbutton', { name: 'Ah Seng · East · $1 chips' }) as HTMLInputElement).value).toBe('8');
  });

  it('keeps failed count work unsent so a later proposal still triggers the choice', async () => {
    vi.mocked(proposeChipCounts).mockResolvedValueOnce({ error: 'table changed' });
    renderFlow();
    const button = await waitForCountReady();
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Ah Seng · East · $1 chips' }), { target: { value: '77' } });
    fireEvent.click(button);
    expect((await screen.findByRole('alert')).textContent).toContain('table changed');
    await serverUpdate(proposalRow([], '2026-08-19T10:00:00.000Z', latest));

    fireEvent.click(await screen.findByRole('button', { name: 'Something is wrong · recount' }));

    expect(screen.getByRole('dialog', { name: 'Choose your starting numbers' })).toBeDefined();
  });

  it('blocks recount choices immediately while a latest-row check is in flight', async () => {
    renderFlow();
    await waitForCountReady();
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Ah Seng · East · $1 chips' }), { target: { value: '77' } });
    await serverUpdate(proposalRow([], '2026-08-19T10:00:00.000Z', latest));
    fireEvent.click(await screen.findByRole('button', { name: 'Something is wrong · recount' }));
    const staleChoice = screen.getByRole('button', { name: 'Start recount from the table’s current numbers' });
    const read = deferred<GameRead>();
    db.reads.push(read.promise);

    act(() => {
      db.subscribeCbs[0]?.('SUBSCRIBED');
      staleChoice.click();
    });

    expect(screen.getByRole('dialog', { name: 'Choose your starting numbers' })).toBeDefined();
    expect((screen.getByRole('button', { name: 'Start recount from the table’s current numbers' }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => read.resolve({ data: proposalRow([], '2026-08-19T10:00:00.000Z', latest) }));
  });

  it('accepts only the first of two recount choices activated in one batch', async () => {
    renderFlow();
    await waitForCountReady();
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Ah Seng · East · $1 chips' }), { target: { value: '77' } });
    await serverUpdate(proposalRow([], '2026-08-19T10:00:00.000Z', latest));
    fireEvent.click(await screen.findByRole('button', { name: 'Something is wrong · recount' }));
    const tableChoice = screen.getByRole('button', { name: 'Start recount from the table’s current numbers' });
    const localChoice = screen.getByRole('button', { name: 'Start recount from my unsent numbers' });

    act(() => {
      tableChoice.click();
      localChoice.click();
    });

    expect((screen.getByRole('spinbutton', { name: 'Ah Seng · East · $1 chips' }) as HTMLInputElement).value).toBe('8');
  });

  it('prefills every field from the latest proposal on a phone that did not enter it', async () => {
    db.row = proposalRow(['p1'], '2026-08-19T10:00:00.000Z', latest);
    renderFlow();
    await screen.findByRole('dialog', { name: 'Confirm the table count' });

    fireEvent.click(screen.getByRole('button', { name: 'Something is wrong · recount' }));

    const expected = [
      ['Ah Seng · East · $1 chips', '8'], ['Ah Seng · East · $10 chips', '9'],
      ['Ah Seng · East · $50 chips', '4'], ['Ah Seng · East · $100 chips', '1'],
      ['Bryan · South · $1 chips', '12'], ['Bryan · South · $10 chips', '8'],
      ['Bryan · South · $50 chips', '3'], ['Bryan · South · $100 chips', '2'],
      ['Ah Beng · West · $1 chips', '13'], ['Ah Beng · West · $10 chips', '7'],
      ['Ah Beng · West · $50 chips', '2'], ['Ah Beng · West · $100 chips', '3'],
      ['Ah Huat · North · $1 chips', '14'], ['Ah Huat · North · $10 chips', '6'],
      ['Ah Huat · North · $50 chips', '1'], ['Ah Huat · North · $100 chips', '4'],
    ] as const;
    for (const [label, value] of expected) {
      expect((screen.getByRole('spinbutton', { name: label }) as HTMLInputElement).value).toBe(value);
    }
  });

  it('deep-clones recount input so later edits cannot mutate the server proposal', async () => {
    const source = structuredClone(latest);
    db.row = proposalRow([], '2026-08-19T10:00:00.000Z', source);
    renderFlow();
    await screen.findByRole('dialog', { name: 'Confirm the table count' });
    fireEvent.click(screen.getByRole('button', { name: 'Something is wrong · recount' }));

    // Submit BEFORE editing anything. ChipCountForm copies the table on every write, so an edit
    // can never catch a missing clone — an UNTOUCHED recount is the only moment the entry state
    // is still exactly what recount seeded it with. It has to be a copy: this flow renders the
    // live proposal from that same object, and seeding the editor with it aliases the two.
    fireEvent.click(screen.getByRole('button', { name: 'Check all counts' }));
    await waitFor(() => expect(proposeChipCounts).toHaveBeenCalledTimes(1));
    const seeded = vi.mocked(proposeChipCounts).mock.calls[0][1];
    expect(seeded).toEqual(source);
    expect(seeded).not.toBe(source);
    expect(seeded.E).not.toBe(source.E);
    expect(seeded.N).not.toBe(source.N);

    fireEvent.change(screen.getByRole('spinbutton', { name: 'Ah Seng · East · $1 chips' }), { target: { value: '99' } });

    expect(source).toEqual(latest);
    expect(source.E[1]).toBe(8);
    expect(source.S[1]).toBe(12);
  });

  it('keeps recount open for the same proposal and returns to confirmation for a new identity', async () => {
    db.row = proposalRow([], '2026-08-19T10:00:00.000Z', latest);
    renderFlow();
    await screen.findByRole('dialog', { name: 'Confirm the table count' });
    fireEvent.click(screen.getByRole('button', { name: 'Something is wrong · recount' }));
    expect(screen.getByRole('dialog', { name: 'Count every stack' })).toBeDefined();

    await serverUpdate(proposalRow(['p1'], '2026-08-19T10:00:00.000Z', latest));
    expect(screen.getByRole('dialog', { name: 'Count every stack' })).toBeDefined();

    await serverUpdate(proposalRow([], '2026-08-19T10:05:00.000Z', latest));
    expect(await screen.findByRole('dialog', { name: 'Confirm the table count' })).toBeDefined();
  });

  it('resets transient confirmation failure for identical counts with a new server identity', async () => {
    vi.mocked(confirmChipResult).mockResolvedValueOnce({ error: 'old proposal failed' });
    db.row = proposalRow([], '2026-08-19T10:00:00.000Z');
    renderFlow();
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm my count' }));
    expect((await screen.findByRole('alert')).textContent).toContain('old proposal failed');

    await serverUpdate(proposalRow([], '2026-08-19T10:05:00.000Z'));

    expect(screen.queryByText('old proposal failed')).toBeNull();
    expect((screen.getByRole('button', { name: 'Confirm my count' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('derives local confirmation only from fresh server data', async () => {
    db.row = proposalRow([], '2026-08-19T10:00:00.000Z');
    renderFlow();
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm my count' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm my count' })).toBeDefined());

    await serverUpdate(proposalRow(['p2'], '2026-08-19T10:00:00.000Z'));

    expect((screen.getByRole('button', { name: 'You confirmed · waiting for the table' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('ChipEndFlow latest-read safety and realtime contract', () => {
  it('preserves the exact games subscription, row refresh, cleanup, and select contract', async () => {
    const { unmount } = render(<ChipEndFlow gameId="g1" players={players} me="p2" onClose={vi.fn()} />);
    await waitForCountReady();

    expect(db.channelName).toBe('chip-end-g1');
    expect(db.registrations.map(({ event, config }) => ({ event, config }))).toEqual([{
      event: 'postgres_changes',
      config: { event: 'UPDATE', schema: 'public', table: 'games', filter: 'id=eq.g1' },
    }]);
    expect(db.selects).toContain('games:pending_counts, pending_confirmed, status, last_activity_at');

    await serverUpdate(proposalRow());
    expect(await screen.findByRole('dialog', { name: 'Confirm the table count' })).toBeDefined();

    unmount();
    expect(db.removeChannel).toHaveBeenCalledTimes(1);
    expect(db.removeChannel).toHaveBeenCalledWith(db.channel);
  });

  it('reloads on SUBSCRIBED and blocks stale confirmation in the same batch', async () => {
    db.row = proposalRow();
    renderFlow();
    const staleButton = await screen.findByRole('button', { name: 'Confirm my count' });
    const read = deferred<GameRead>();
    db.reads.push(read.promise);

    act(() => {
      db.subscribeCbs[0]?.('SUBSCRIBED');
      staleButton.click();
    });

    expect(confirmChipResult).not.toHaveBeenCalled();
    expect((screen.getByRole('button', { name: 'Confirm my count' }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => read.resolve({ data: proposalRow() }));
  });

  it('fails closed when the live table connection closes unexpectedly', async () => {
    renderFlow();
    await waitForCountReady();
    await waitFor(() => expect(db.subscribeCbs.length).toBeGreaterThan(0));

    act(() => { db.subscribeCbs.forEach((callback) => callback('CLOSED')); });

    expect(screen.getByRole('alert').textContent).toContain('Live table connection lost');
    expect((screen.getByRole('button', { name: 'Check all counts' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('does not let a successful foreground read reopen actions before Realtime reconnects', async () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    renderFlow();
    await waitForCountReady();
    await waitFor(() => expect(db.subscribeCbs.length).toBeGreaterThan(0));
    act(() => { db.subscribeCbs.forEach((callback) => callback('CLOSED')); });

    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });

    expect(screen.getByRole('alert').textContent).toContain('Live table connection lost');
    expect((screen.getByRole('button', { name: 'Check all counts' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('reloads when the phone returns to the visible foreground', async () => {
    let visibility: DocumentVisibilityState = 'hidden';
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
    renderFlow();
    await waitForCountReady();
    db.row = proposalRow();

    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(screen.queryByRole('dialog', { name: 'Confirm the table count' })).toBeNull();

    visibility = 'visible';
    await act(async () => document.dispatchEvent(new Event('visibilitychange')));
    expect(await screen.findByRole('dialog', { name: 'Confirm the table count' })).toBeDefined();
  });

  it('fails closed without erasing the last good proposal when the row is absent', async () => {
    db.row = proposalRow();
    renderFlow();
    await screen.findByRole('dialog', { name: 'Confirm the table count' });
    db.reads.push({ data: null });

    await act(async () => db.handlers[0]?.());

    expect(screen.getByRole('dialog', { name: 'Confirm the table count' })).toBeDefined();
    expect((screen.getByRole('button', { name: 'Confirm my count' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('alert').textContent).toContain('Couldn’t verify the latest table count');
  });

  it('keeps a newer failed read authoritative when an older success resolves last', async () => {
    db.row = proposalRow();
    renderFlow();
    await screen.findByRole('dialog', { name: 'Confirm the table count' });
    const stale = deferred<GameRead>();
    db.reads.push(stale.promise, { data: null, error: new Error('offline') });

    act(() => db.handlers[0]?.());
    await act(async () => document.dispatchEvent(new Event('visibilitychange')));
    expect(screen.getByRole('alert').textContent).toContain('Couldn’t verify the latest table count');

    await act(async () => stale.resolve({
      data: proposalRow([], '2026-08-19T10:05:00.000Z'),
    }));

    expect(screen.getByRole('alert').textContent).toContain('Couldn’t verify the latest table count');
    expect((screen.getByRole('button', { name: 'Confirm my count' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('refreshes the route when the latest row says the game ended', async () => {
    db.row = { pending_counts: null, pending_confirmed: [], status: 'ended', last_activity_at: '2026-08-19T10:00:00.000Z' };
    renderFlow();

    await waitFor(() => expect(navigation.router.refresh).toHaveBeenCalledTimes(1));
  });
});
