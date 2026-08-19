import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChipConfirmPanel } from '../../src/app/game/[id]/ChipConfirmPanel';
import { confirmChipResult } from '../../src/lib/actions/game';
import { PER_PLAYER } from '../../src/lib/chips';
import type { PendingChipProposal } from '../../src/app/game/[id]/chip-view';

const navigation = vi.hoisted(() => ({ router: { refresh: vi.fn() } }));

vi.mock('next/navigation', () => ({ useRouter: () => navigation.router }));
vi.mock('../../src/lib/actions/game', () => ({
  confirmChipResult: vi.fn(async () => ({ result: 'pending_2' })),
}));

const players = [
  { playerId: 'p1', seat: 'E' as const, name: 'Ah Seng' },
  { playerId: 'p2', seat: 'S' as const, name: 'Bryan' },
  { playerId: 'p3', seat: 'W' as const, name: 'Ah Beng' },
  { playerId: 'p4', seat: 'N' as const, name: 'Ah Huat' },
];

const proposal = (confirmed: string[] = ['p1', 'p3']): PendingChipProposal => ({
  id: '2026-08-19T10:00:00.000Z',
  confirmed,
  counts: {
    E: { ...PER_PLAYER, 1: PER_PLAYER[1] + 1 },
    S: { ...PER_PLAYER, 1: PER_PLAYER[1] - 1 },
    W: { ...PER_PLAYER },
    N: { ...PER_PLAYER },
  },
});

function renderPanel(overrides: Partial<Parameters<typeof ChipConfirmPanel>[0]> = {}) {
  const onRecount = vi.fn();
  const pending = proposal();
  render(
    <ChipConfirmPanel
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

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(confirmChipResult).mockResolvedValue({ result: 'pending_2' });
});

describe('ChipConfirmPanel', () => {
  it('names confirmed and waiting players and shows signed results for all four seats', () => {
    renderPanel();

    const progress = screen.getByRole('region', { name: 'Confirmation progress' });
    expect(within(progress).getByText('Confirmed')).toBeDefined();
    expect(within(progress).getByText('Ah Seng, Ah Beng')).toBeDefined();
    expect(within(progress).getByText('Waiting')).toBeDefined();
    expect(within(progress).getByText('Bryan, Ah Huat')).toBeDefined();
    expect(within(progress).getByText('2 of 4 confirmed')).toBeDefined();

    expect(screen.getByText('Ah Seng').closest('li')?.textContent).toContain('+1');
    const bryan = screen.getByText((_text, element) => element?.tagName === 'P' && element.textContent === 'Bryan (you)');
    expect(bryan.closest('li')?.textContent).toContain('-1');
    expect(screen.getByText('Ah Beng').closest('li')?.textContent).toContain('0');
    expect(screen.getByText('Ah Huat').closest('li')?.textContent).toContain('0');
  });

  it('shows an already-confirmed local player a disabled waiting action', () => {
    renderPanel({ proposal: proposal(['p2']) });

    const button = screen.getByRole('button', { name: 'You confirmed · waiting for the table' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it('guards two same-batch confirmation activations and sends only the game id', async () => {
    let release!: () => void;
    vi.mocked(confirmChipResult).mockImplementationOnce(() => new Promise((resolve) => {
      release = () => resolve({ result: 'pending_2' });
    }));
    renderPanel({ proposal: proposal([]) });
    const button = screen.getByRole('button', { name: 'Confirm my count' });

    act(() => {
      button.click();
      button.click();
    });

    expect(confirmChipResult).toHaveBeenCalledTimes(1);
    expect(confirmChipResult).toHaveBeenCalledWith('g1');
    expect((screen.getByRole('button', { name: 'Confirming…' }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => release());
  });

  it('shows a resolved action failure inline and restores confirmation', async () => {
    vi.mocked(confirmChipResult).mockResolvedValueOnce({ error: 'table changed' });
    renderPanel({ proposal: proposal([]) });

    fireEvent.click(screen.getByRole('button', { name: 'Confirm my count' }));

    expect((await screen.findByRole('alert')).textContent).toContain('table changed');
    expect((screen.getByRole('button', { name: 'Confirm my count' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows a rejected transport failure inline and restores confirmation', async () => {
    vi.mocked(confirmChipResult).mockRejectedValueOnce(new Error('network down'));
    renderPanel({ proposal: proposal([]) });

    fireEvent.click(screen.getByRole('button', { name: 'Confirm my count' }));

    expect((await screen.findByRole('alert')).textContent).toContain('network down');
    expect((screen.getByRole('button', { name: 'Confirm my count' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('blocks stale confirmation during sync and exposes checking or failure state', () => {
    const { rerender } = render(
      <ChipConfirmPanel gameId="g1" proposal={proposal([])} players={players} me="p2"
        syncBlocked onRecount={vi.fn()} />,
    );
    expect(screen.getByText('Checking the latest table count…')).toBeDefined();
    const blocked = screen.getByRole('button', { name: 'Confirm my count' }) as HTMLButtonElement;
    expect(blocked.disabled).toBe(true);
    fireEvent.click(blocked);
    expect(confirmChipResult).not.toHaveBeenCalled();

    rerender(
      <ChipConfirmPanel gameId="g1" proposal={proposal([])} players={players} me="p2"
        syncBlocked syncError="Couldn’t verify the latest table count. Reconnect, then try again."
        onRecount={vi.fn()} />,
    );
    expect(screen.queryByText('Checking the latest table count…')).toBeNull();
    expect(screen.getByRole('alert').textContent).toContain('Couldn’t verify the latest table count');
  });

  it('returns the exact proposal for recount and never confirms', () => {
    const pending = proposal([]);
    const onRecount = vi.fn();
    renderPanel({ proposal: pending, onRecount });

    fireEvent.click(screen.getByRole('button', { name: 'Something is wrong · recount' }));

    expect(onRecount).toHaveBeenCalledTimes(1);
    expect(onRecount).toHaveBeenCalledWith(pending);
    expect(confirmChipResult).not.toHaveBeenCalled();
  });

  it('keeps server confirmation authoritative after a successful non-final action', async () => {
    renderPanel({ proposal: proposal([]) });

    fireEvent.click(screen.getByRole('button', { name: 'Confirm my count' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm my count' })).toBeDefined());

    expect(screen.queryByRole('button', { name: 'You confirmed · waiting for the table' })).toBeNull();
    expect(navigation.router.refresh).not.toHaveBeenCalled();
  });

  it('refreshes the route only when the server reports the game ended', async () => {
    vi.mocked(confirmChipResult).mockResolvedValueOnce({ result: 'ended' });
    renderPanel({ proposal: proposal([]) });

    fireEvent.click(screen.getByRole('button', { name: 'Confirm my count' }));
    await waitFor(() => expect(navigation.router.refresh).toHaveBeenCalledTimes(1));
  });

  it('has no dismiss action while a shared proposal is live', () => {
    renderPanel();

    expect(screen.getByRole('dialog', { name: 'Confirm the table count' })).toBeDefined();
    expect(screen.queryByRole('button', { name: /Close Confirm the table count/ })).toBeNull();
    expect(document.querySelector('[aria-live="assertive"]')).not.toBeNull();
  });
});
