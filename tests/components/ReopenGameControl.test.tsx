import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReopenGameControl } from '../../src/app/game/[id]/ReopenGameControl';
import { reopenChipGame } from '../../src/lib/actions/game';

const reconciliation = vi.hoisted(() => ({
  reads: [] as Array<{
    data: { status: string } | null;
    error: { message: string } | null;
  }>,
  calls: 0,
  tables: [] as string[],
  selects: [] as string[],
  filters: [] as Array<[string, string]>,
}));

vi.mock('../../src/lib/actions/game', () => ({
  reopenChipGame: vi.fn(async () => ({})),
}));

vi.mock('../../src/lib/supabase/client', () => ({
  createClient: () => ({
    from: (table: string) => {
      reconciliation.tables.push(table);
      return {
        select: (columns: string) => {
          reconciliation.selects.push(columns);
          const query = {
            eq: (column: string, value: string) => {
              reconciliation.filters.push([column, value]);
              return query;
            },
            single: async () => {
              reconciliation.calls += 1;
              return reconciliation.reads.shift() ?? { data: { status: 'ended' }, error: null };
            },
          };
          return query;
        },
      };
    },
  }),
}));

function renderControl(onReopened = vi.fn(), disabled = false) {
  render(<ReopenGameControl gameId="g1" onReopened={onReopened} disabled={disabled} />);
  return onReopened;
}

function armControl() {
  fireEvent.click(screen.getByRole('button', { name: 'Reopen game' }));
}

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(reopenChipGame).mockResolvedValue({});
  reconciliation.reads = [];
  reconciliation.calls = 0;
  reconciliation.tables = [];
  reconciliation.selects = [];
  reconciliation.filters = [];
});

describe('ReopenGameControl', () => {
  it('only arms on the first press and explains the exact consequence', () => {
    renderControl();

    armControl();

    expect(reopenChipGame).not.toHaveBeenCalled();
    expect(screen.getByText('Reopening unlocks the result and removes it from the leaderboard until everyone confirms again.')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Yes, reopen game' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDefined();
  });

  it('honours the disabled state before the warning is armed', () => {
    renderControl(vi.fn(), true);

    const action = screen.getByRole('button', { name: 'Reopen game' }) as HTMLButtonElement;
    expect(action.disabled).toBe(true);
    fireEvent.click(action);
    expect(screen.queryByText(/Reopening unlocks the result/)).toBeNull();
  });

  it('blocks an armed confirmation if the parent disables stale actions', () => {
    const onReopened = vi.fn();
    const { rerender } = render(<ReopenGameControl gameId="g1" onReopened={onReopened} />);
    armControl();

    rerender(<ReopenGameControl gameId="g1" onReopened={onReopened} disabled />);
    const confirm = screen.getByRole('button', { name: 'Yes, reopen game' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.click(confirm);
    expect(reopenChipGame).not.toHaveBeenCalled();
  });

  it('blocks duplicate confirmation before rerender, hides Cancel while pending, and succeeds once', async () => {
    let release!: () => void;
    vi.mocked(reopenChipGame).mockImplementationOnce(() => new Promise((resolve) => {
      release = () => resolve({});
    }));
    const onReopened = renderControl();
    armControl();
    const confirm = screen.getByRole('button', { name: 'Yes, reopen game' });

    act(() => {
      confirm.click();
      confirm.click();
    });

    expect(reopenChipGame).toHaveBeenCalledTimes(1);
    expect(reopenChipGame).toHaveBeenCalledWith('g1');
    expect((screen.getByRole('button', { name: 'Reopening…' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();

    await act(async () => release());
    expect(onReopened).toHaveBeenCalledTimes(1);
  });

  it('stays armed, alerts inline, and restores both decisions after an action failure', async () => {
    vi.mocked(reopenChipGame).mockResolvedValueOnce({ error: 'reopen window expired' });
    renderControl();
    armControl();

    fireEvent.click(screen.getByRole('button', { name: 'Yes, reopen game' }));

    expect((await screen.findByRole('alert')).textContent).toContain('reopen window expired');
    expect((screen.getByRole('button', { name: 'Yes, reopen game' }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDefined();
  });

  it('stays armed and restores both decisions after a rejected request', async () => {
    vi.mocked(reopenChipGame).mockRejectedValueOnce(new Error('network down'));
    renderControl();
    armControl();

    fireEvent.click(screen.getByRole('button', { name: 'Yes, reopen game' }));

    expect((await screen.findByRole('alert')).textContent).toContain('network down');
    expect((screen.getByRole('button', { name: 'Yes, reopen game' }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDefined();
  });

  it('reconciles two lost-response attempts and latches only after a fresh active row', async () => {
    vi.mocked(reopenChipGame)
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce({ error: 'game cannot be reopened' });
    reconciliation.reads = [
      { data: null, error: { message: 'reconciliation unavailable' } },
      { data: { status: 'active' }, error: null },
    ];
    const onReopened = renderControl();
    armControl();

    fireEvent.click(screen.getByRole('button', { name: 'Yes, reopen game' }));
    expect((await screen.findByRole('alert')).textContent).toContain('network down');
    expect(onReopened).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Yes, reopen game' }));
    await waitFor(() => expect(onReopened).toHaveBeenCalledTimes(1));
    expect(reopenChipGame).toHaveBeenCalledTimes(2);
    expect(reconciliation.calls).toBe(2);
    expect(reconciliation.tables).toEqual(['games', 'games']);
    expect(reconciliation.selects).toEqual(['status', 'status']);
    expect(reconciliation.filters).toEqual([['id', 'g1'], ['id', 'g1']]);
    expect((screen.getByRole('button', { name: 'Reopening…' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
  });

  it.each([
    ['ended', 'reopen window expired'],
    ['expired', 'A new game has already been started at this table'],
  ])('preserves the original error when reconciliation reads %s', async (status, originalError) => {
    vi.mocked(reopenChipGame).mockResolvedValueOnce({ error: originalError });
    reconciliation.reads = [{ data: { status }, error: null }];
    const onReopened = renderControl();
    armControl();

    fireEvent.click(screen.getByRole('button', { name: 'Yes, reopen game' }));

    expect((await screen.findByRole('alert')).textContent).toContain(originalError);
    expect(reconciliation.calls).toBe(1);
    expect(onReopened).not.toHaveBeenCalled();
    expect((screen.getByRole('button', { name: 'Yes, reopen game' }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDefined();
  });

  it('preserves a readable action error when reconciliation cannot read the row', async () => {
    const originalError = 'A new game has already been started at this table';
    vi.mocked(reopenChipGame).mockResolvedValueOnce({ error: originalError });
    reconciliation.reads = [{ data: null, error: { message: 'connection lost' } }];
    const onReopened = renderControl();
    armControl();

    fireEvent.click(screen.getByRole('button', { name: 'Yes, reopen game' }));

    expect((await screen.findByRole('alert')).textContent).toContain(originalError);
    expect(reconciliation.calls).toBe(1);
    expect(onReopened).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDefined();
  });

  it('reconciles a rejected call as successful only when the fresh row is active', async () => {
    vi.mocked(reopenChipGame).mockRejectedValueOnce(new Error('network down'));
    reconciliation.reads = [{ data: { status: 'active' }, error: null }];
    const onReopened = renderControl();
    armControl();

    fireEvent.click(screen.getByRole('button', { name: 'Yes, reopen game' }));

    await waitFor(() => expect(onReopened).toHaveBeenCalledTimes(1));
    expect(reconciliation.calls).toBe(1);
    expect((screen.getByRole('button', { name: 'Reopening…' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

// router.refresh() is not awaited and can take a second on a phone. Restoring the confirm button
// invites a second press, and reopen_game then raises "not ended, or ended more than an hour ago"
// for an operation that actually succeeded.
it('does not restore the confirmation after a successful reopen', async () => {
  const onReopened = vi.fn();
  render(<ReopenGameControl gameId="g1" onReopened={onReopened} />);
  fireEvent.click(screen.getByRole('button', { name: 'Reopen game' }));
  fireEvent.click(screen.getByRole('button', { name: 'Yes, reopen game' }));
  await waitFor(() => expect(onReopened).toHaveBeenCalledTimes(1));

  const confirm = screen.queryByRole('button', { name: 'Yes, reopen game' }) as HTMLButtonElement | null;
  expect(confirm === null || confirm.disabled).toBe(true);
  expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
  expect(onReopened).toHaveBeenCalledTimes(1);
});
