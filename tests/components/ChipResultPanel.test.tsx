import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChipResultPanel, ChipResultSyncBlockedContext, END_ARMING_SECONDS } from '../../src/app/game/[id]/ChipResultPanel';
import { endChipGame } from '../../src/lib/actions/game';
import { PER_PLAYER } from '../../src/lib/chips';
import type { PendingChipProposal } from '../../src/app/game/[id]/chip-view';

const navigation = vi.hoisted(() => ({ router: { refresh: vi.fn() } }));

vi.mock('next/navigation', () => ({ useRouter: () => navigation.router }));
vi.mock('../../src/lib/actions/game', () => ({
  endChipGame: vi.fn(async () => ({ result: 'ended' })),
}));

const players = [
  { playerId: 'p1', seat: 'E' as const, name: 'Ah Seng' },
  { playerId: 'p2', seat: 'S' as const, name: 'Bryan' },
  { playerId: 'p3', seat: 'W' as const, name: 'Ah Beng' },
  { playerId: 'p4', seat: 'N' as const, name: 'Ah Huat' },
];

// East is up one $10 chip, South down one. Conserves, sums to zero, and is not all zeros.
const proposal = (proposedBy = 'p2'): PendingChipProposal => ({
  id: '2026-08-27T10:00:00.000Z',
  proposedBy,
  counts: {
    E: { ...PER_PLAYER, 10: PER_PLAYER[10] + 1 },
    S: { ...PER_PLAYER, 10: PER_PLAYER[10] - 1 },
    W: { ...PER_PLAYER },
    N: { ...PER_PLAYER },
  },
});

function renderPanel(overrides: Partial<Parameters<typeof ChipResultPanel>[0]> = {}) {
  const onRecount = vi.fn();
  const pending = overrides.proposal ?? proposal();
  render(
    <ChipResultPanel
      gameId="g1"
      proposal={pending}
      players={players}
      me="p2"
      syncBlocked={false}
      onRecount={onRecount}
      {...overrides}
    />,
  );
  return { onRecount, pending };
}

/** Walks past the reading window so the End control is armed. */
const armEnd = async () => {
  await act(async () => {});
  await act(async () => { vi.advanceTimersByTime(END_ARMING_SECONDS * 1000); });
};

const endButton = () => screen.queryByRole('button', { name: /end match/i });

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.clearAllMocks();
  vi.mocked(endChipGame).mockResolvedValue({ result: 'ended' });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('ChipResultPanel', () => {
  it('shows signed results for all four seats in seat order whatever order they arrive in', () => {
    renderPanel({ players: [players[2], players[0], players[3], players[1]] });

    const rows = screen.getAllByRole('listitem');
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('Ah Seng'),
      expect.stringContaining('Bryan'),
      expect.stringContaining('Ah Beng'),
      expect.stringContaining('Ah Huat'),
    ]);
    expect(rows[0].textContent).toContain('+10');
    expect(rows[1].textContent).toContain('-10');
  });

  it('gives the End control to the counter alone', () => {
    renderPanel({ me: 'p2', proposal: proposal('p2') });
    expect(endButton()).not.toBeNull();
  });

  it('withholds the End control from every player who did not count, including East', () => {
    for (const me of ['p1', 'p3', 'p4']) {
      renderPanel({ me, proposal: proposal('p2') });
      expect(endButton()).toBeNull();
      cleanup();
    }
  });

  // A chip match already showing a proposal when 0007 lands has counts but no recorded counter.
  // Nobody may end it; the recount path is how somebody takes it over.
  it('gives nobody the End control when the proposal has no recorded counter', () => {
    renderPanel({ me: 'p2', proposal: { ...proposal(), proposedBy: null } });

    expect(endButton()).toBeNull();
    expect(screen.getByRole('button', { name: /recount/i })).toBeDefined();
  });

  it('tells the other three who they are waiting for', () => {
    renderPanel({ me: 'p3', proposal: proposal('p2') });
    expect(screen.getByText(/waiting for bryan/i)).toBeDefined();
  });

  it('holds the End control closed for the reading window, then arms it', () => {
    renderPanel();

    expect(endButton()?.hasAttribute('disabled')).toBe(true);
    act(() => { vi.advanceTimersByTime(END_ARMING_SECONDS * 1000 - 100); });
    expect(endButton()?.hasAttribute('disabled')).toBe(true);
    act(() => { vi.advanceTimersByTime(100); });
    expect(endButton()?.hasAttribute('disabled')).toBe(false);
  });

  it('ignores a tap that lands before the window has elapsed', () => {
    renderPanel();

    fireEvent.click(endButton()!);

    expect(endChipGame).not.toHaveBeenCalled();
  });

  it('ends the match with the game id alone and guards two same-batch activations', async () => {
    renderPanel();
    await armEnd();

    const button = endButton()!;
    fireEvent.click(button);
    fireEvent.click(button);

    await waitFor(() => expect(endChipGame).toHaveBeenCalledOnce());
    expect(endChipGame).toHaveBeenCalledWith('g1');
  });

  it('refreshes the route once the server reports the match ended', async () => {
    renderPanel();
    await armEnd();

    fireEvent.click(endButton()!);

    await waitFor(() => expect(navigation.router.refresh).toHaveBeenCalledOnce());
  });

  it('shows a refusal inline and restores the End control', async () => {
    vi.mocked(endChipGame).mockResolvedValue({ error: 'only the player who entered the counts can end the match' });
    renderPanel();
    await armEnd();

    fireEvent.click(endButton()!);

    await waitFor(() => expect(screen.getByText(/only the player who entered the counts/i)).toBeDefined());
    expect(endButton()?.hasAttribute('disabled')).toBe(false);
    expect(navigation.router.refresh).not.toHaveBeenCalled();
  });

  it('closes the End control while the latest read is unverified', async () => {
    renderPanel({ syncBlocked: true });
    await armEnd();

    fireEvent.click(endButton()!);

    expect(endChipGame).not.toHaveBeenCalled();
    expect(endButton()?.hasAttribute('disabled')).toBe(true);
  });

  it('closes the End control in the same batch as a parent resync, before React re-renders it', async () => {
    const blocked = { current: false };
    render(
      <ChipResultSyncBlockedContext.Provider value={blocked}>
        <ChipResultPanel
          gameId="g1" proposal={proposal()} players={players} me="p2"
          syncBlocked={false} onRecount={vi.fn()}
        />
      </ChipResultSyncBlockedContext.Provider>,
    );
    await armEnd();
    blocked.current = true;

    fireEvent.click(endButton()!);

    expect(endChipGame).not.toHaveBeenCalled();
  });

  it('offers recount to everyone, counter included, and never ends the match', () => {
    const { onRecount, pending } = renderPanel({ me: 'p3', proposal: proposal('p2') });

    fireEvent.click(screen.getByRole('button', { name: /recount/i }));

    expect(onRecount).toHaveBeenCalledWith(pending);
    expect(endChipGame).not.toHaveBeenCalled();
  });

  // Ported from the four-confirm panel: this masking behaviour is unchanged by the rewrite,
  // and it is exactly the kind of hard-won detail a rename quietly loses.
  it('does not resurrect a stale action error once the sync error clears', async () => {
    vi.mocked(endChipGame).mockResolvedValue({ error: 'Could not reach the table. Try again.' });
    const { rerender } = render(
      <ChipResultPanel gameId="g1" proposal={proposal()} players={players} me="p2"
        syncBlocked={false} onRecount={vi.fn()} />,
    );
    await armEnd();
    fireEvent.click(endButton()!);
    await waitFor(() => expect(screen.getByText(/could not reach the table/i)).toBeDefined());

    rerender(
      <ChipResultPanel gameId="g1" proposal={proposal()} players={players} me="p2"
        syncBlocked syncError="Couldn't verify the latest table count." onRecount={vi.fn()} />,
    );
    rerender(
      <ChipResultPanel gameId="g1" proposal={proposal()} players={players} me="p2"
        syncBlocked={false} onRecount={vi.fn()} />,
    );

    expect(screen.queryByText(/could not reach the table/i)).toBeNull();
  });

  it('has no dismiss action while a shared proposal is live', () => {
    renderPanel();
    expect(screen.queryByRole('button', { name: /close|cancel|dismiss/i })).toBeNull();
  });
});
