import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CHOICE_GUARD_MS, ChipResultPanel, ChipResultSyncBlockedContext, END_ARMING_SECONDS,
} from '../../src/app/game/[id]/ChipResultPanel';
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

/** The question End match opens. The result panel is a dialog too, so this one is named. */
const question = () => screen.queryByRole('dialog', { name: 'Which game was this?' });

/** Presses End match and waits out the double-tap guard, leaving the question ready to answer. */
const openQuestion = async () => {
  fireEvent.click(endButton()!);
  await act(async () => { vi.advanceTimersByTime(CHOICE_GUARD_MS); });
};

const answer = (name: 'Regular' | '8 Fei') => fireEvent.click(screen.getByRole('button', { name }));

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

  /**
   * End match no longer ends anything by itself (Bryan, 2026-10-08). It asks which game this
   * was, because the answer decides which leaderboard the match counts on.
   */
  it('asks which game it was instead of ending the match straight away', async () => {
    renderPanel();
    await armEnd();

    fireEvent.click(endButton()!);

    expect(question()).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Regular' })).toBeDefined();
    expect(screen.getByRole('button', { name: '8 Fei' })).toBeDefined();
    expect(endChipGame).not.toHaveBeenCalled();
  });

  it.each([['Regular', 'regular'], ['8 Fei', 'fei']] as const)(
    'ends the match as a %s game when that answer is given', async (label, variant) => {
      renderPanel();
      await armEnd();
      await openQuestion();

      answer(label);

      await waitFor(() => expect(endChipGame).toHaveBeenCalledOnce());
      expect(endChipGame).toHaveBeenCalledWith('g1', variant);
    },
  );

  /**
   * No default. Focus opens on the heading, not on an answer, so Enter or Space straight after
   * the question appears cannot choose a game for the table.
   */
  it('opens the question with neither answer chosen or focused', async () => {
    renderPanel();
    await armEnd();
    await openQuestion();

    expect(document.activeElement?.textContent).toBe('Which game was this?');
    expect(endChipGame).not.toHaveBeenCalled();
  });

  /**
   * The question appears mid-screen at the instant End match is pressed, so the second half of a
   * double tap lands on whichever answer is under the thumb. That would file the match on a
   * ladder nobody chose, and only this phone would have seen it happen.
   */
  it('ignores an answer that lands in the instant the question opens', async () => {
    renderPanel();
    await armEnd();

    fireEvent.click(endButton()!);
    answer('8 Fei');
    expect(endChipGame).not.toHaveBeenCalled();
    expect(question()).not.toBeNull();

    await act(async () => { vi.advanceTimersByTime(CHOICE_GUARD_MS); });
    answer('8 Fei');
    await waitFor(() => expect(endChipGame).toHaveBeenCalledWith('g1', 'fei'));
  });

  it('guards two same-batch answers, including one for each game', async () => {
    renderPanel();
    await armEnd();
    await openQuestion();

    answer('Regular');
    answer('8 Fei');

    await waitFor(() => expect(endChipGame).toHaveBeenCalledOnce());
    expect(endChipGame).toHaveBeenCalledWith('g1', 'regular');
  });

  it('backs out of the question on Cancel without ending anything, and can ask again', async () => {
    renderPanel();
    await armEnd();
    await openQuestion();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(question()).toBeNull();
    expect(endChipGame).not.toHaveBeenCalled();
    expect(endButton()?.hasAttribute('disabled')).toBe(false);

    await openQuestion();
    expect(question()).not.toBeNull();
  });

  it('backs out of the question on Escape', async () => {
    renderPanel();
    await armEnd();
    await openQuestion();

    fireEvent.keyDown(question()!, { key: 'Escape' });

    expect(question()).toBeNull();
    expect(endChipGame).not.toHaveBeenCalled();
  });

  /**
   * The result panel behind the question has its own Tab trap. If Tab were allowed to reach it,
   * focus would walk out of the question onto the End and Recount buttons under the backdrop.
   */
  it('keeps Tab inside the question', async () => {
    renderPanel();
    await armEnd();
    await openQuestion();

    const cancel = screen.getByRole('button', { name: 'Cancel' });
    cancel.focus();
    fireEvent.keyDown(cancel, { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Regular' }));

    fireEvent.keyDown(document.activeElement!, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(cancel);
  });

  it('refreshes the route once the server reports the match ended', async () => {
    renderPanel();
    await armEnd();
    await openQuestion();

    answer('Regular');

    await waitFor(() => expect(navigation.router.refresh).toHaveBeenCalledOnce());
  });

  it('shows a refusal inline, closes the question, and restores the End control', async () => {
    vi.mocked(endChipGame).mockResolvedValue({ error: 'only the player who entered the counts can end the match' });
    renderPanel();
    await armEnd();
    await openQuestion();

    answer('8 Fei');

    await waitFor(() => expect(screen.getByText(/only the player who entered the counts/i)).toBeDefined());
    expect(question()).toBeNull();
    expect(endButton()?.hasAttribute('disabled')).toBe(false);
    expect(navigation.router.refresh).not.toHaveBeenCalled();
  });

  it('closes the End control while the latest read is unverified', async () => {
    renderPanel({ syncBlocked: true });
    await armEnd();

    fireEvent.click(endButton()!);

    expect(question()).toBeNull();
    expect(endChipGame).not.toHaveBeenCalled();
    expect(endButton()?.hasAttribute('disabled')).toBe(true);
  });

  /**
   * The table can be recounted, or this phone's read can go stale, in the time somebody spends
   * deciding. An answer given then would end the match on numbers this phone has not verified.
   */
  it('closes the answers if the read goes unverified while the question is open', async () => {
    const view = (syncBlocked: boolean, syncError?: string) => (
      <ChipResultPanel gameId="g1" proposal={proposal()} players={players} me="p2"
        syncBlocked={syncBlocked} syncError={syncError} onRecount={vi.fn()} />
    );
    const { rerender } = render(view(false));
    await armEnd();
    await openQuestion();

    rerender(view(true, 'Live table connection lost. Reconnect, then try again.'));

    expect(screen.getByRole('button', { name: 'Regular' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: '8 Fei' }).hasAttribute('disabled')).toBe(true);
    // Said inside the question as well, since that is what the player is looking at.
    expect(question()!.textContent).toContain('Live table connection lost');
    fireEvent.click(screen.getByRole('button', { name: '8 Fei' }));
    expect(endChipGame).not.toHaveBeenCalled();
  });

  it('refuses an answer in the same batch as a parent resync, before React re-renders it', async () => {
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
    await openQuestion();
    blocked.current = true;

    answer('Regular');

    expect(endChipGame).not.toHaveBeenCalled();
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

    expect(question()).toBeNull();
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
    await openQuestion();
    answer('Regular');
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
