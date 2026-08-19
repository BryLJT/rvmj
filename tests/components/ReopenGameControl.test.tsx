import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReopenGameControl } from '../../src/app/game/[id]/ReopenGameControl';
import { reopenChipGame } from '../../src/lib/actions/game';

vi.mock('../../src/lib/actions/game', () => ({
  reopenChipGame: vi.fn(async () => ({})),
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
});
