import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotableLogger } from '../../src/app/game/[id]/NotableLogger';
import { logNotable } from '../../src/lib/actions/game';

vi.mock('../../src/lib/actions/game', () => ({
  logNotable: vi.fn(async () => ({})),
}));

const players = [
  { playerId: 'p1', seat: 'E' as const, name: 'Ah Seng' },
  { playerId: 'p2', seat: 'S' as const, name: 'Bryan' },
  { playerId: 'p3', seat: 'W' as const, name: 'Ah Beng' },
  { playerId: 'p4', seat: 'N' as const, name: 'Ah Huat' },
];

const notableHands = Array.from({ length: 12 }, (_, index) => ({
  id: `h${index + 1}`,
  name: index === 0 ? 'Thirteen Wonders' : `Notable hand ${index + 1}`,
  local_name: index === 0 ? '十三幺' : null,
}));

function renderLogger(onClose = vi.fn()) {
  render(
    <NotableLogger
      players={players}
      notableHands={notableHands}
      gameId="g1"
      onClose={onClose}
    />,
  );
  return onClose;
}

function chooseNotable() {
  fireEvent.click(screen.getByRole('button', { name: 'Bryan' }));
  fireEvent.change(screen.getByLabelText('Notable hand'), { target: { value: 'h1' } });
}

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(logNotable).mockResolvedValue({});
});

describe('NotableLogger', () => {
  it('starts with a disabled action in a named dialog with labelled choices', () => {
    renderLogger();

    expect(screen.getByRole('dialog', { name: 'Log notable hand' })).toBeDefined();
    expect(screen.getByText('Who won it?')).toBeDefined();
    expect(screen.getByLabelText('Notable hand')).toBeDefined();
    expect(screen.getAllByRole('option')).toHaveLength(13);
    expect((screen.getByRole('button', { name: 'Log notable hand' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('marks the chosen player as pressed and enables the action only after both choices exist', () => {
    renderLogger();

    fireEvent.click(screen.getByRole('button', { name: 'Bryan' }));
    expect(screen.getByRole('button', { name: 'Bryan' }).getAttribute('aria-pressed')).toBe('true');
    expect((screen.getByRole('button', { name: 'Log notable hand' }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('Notable hand'), { target: { value: 'h1' } });
    expect((screen.getByRole('button', { name: 'Log notable hand' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('blocks duplicate activation before rerender and closes exactly once after success', async () => {
    let release!: () => void;
    vi.mocked(logNotable).mockImplementationOnce(() => new Promise((resolve) => {
      release = () => resolve({});
    }));
    const onClose = renderLogger();
    chooseNotable();
    const action = screen.getByRole('button', { name: 'Log notable hand' });

    act(() => {
      action.click();
      action.click();
    });

    expect(logNotable).toHaveBeenCalledTimes(1);
    expect(logNotable).toHaveBeenCalledWith('g1', 'p2', 'h1');
    expect((screen.getByRole('button', { name: 'Logging…' }) as HTMLButtonElement).disabled).toBe(true);

    await act(async () => release());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps both choices and restores the action after an action failure', async () => {
    vi.mocked(logNotable).mockResolvedValueOnce({ error: 'hand no longer available' });
    renderLogger();
    chooseNotable();

    fireEvent.click(screen.getByRole('button', { name: 'Log notable hand' }));

    expect((await screen.findByRole('alert')).textContent).toContain('hand no longer available');
    expect(screen.getByRole('button', { name: 'Bryan' }).getAttribute('aria-pressed')).toBe('true');
    expect((screen.getByLabelText('Notable hand') as HTMLSelectElement).value).toBe('h1');
    expect((screen.getByRole('button', { name: 'Log notable hand' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('keeps both choices and restores the action after a rejected request', async () => {
    vi.mocked(logNotable).mockRejectedValueOnce(new Error('network down'));
    renderLogger();
    chooseNotable();

    fireEvent.click(screen.getByRole('button', { name: 'Log notable hand' }));

    expect((await screen.findByRole('alert')).textContent).toContain('network down');
    expect(screen.getByRole('button', { name: 'Bryan' }).getAttribute('aria-pressed')).toBe('true');
    expect((screen.getByLabelText('Notable hand') as HTMLSelectElement).value).toBe('h1');
    expect((screen.getByRole('button', { name: 'Log notable hand' }) as HTMLButtonElement).disabled).toBe(false);
  });
});
