import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { StartNewMatch } from '../../src/app/t/[secret]/StartNewMatch';

afterEach(cleanup);

const startButton = () => screen.getByText('Start new match');
const confirmButton = () => screen.getByText('Yes, void it and start new');
const ARE_YOU_SURE = /Are you sure\? This will void the previous match in progress\./;

describe('StartNewMatch (two-step void)', () => {
  it('shows only the first step until it is armed', () => {
    render(<StartNewMatch action={vi.fn()} />);
    expect(startButton()).toBeDefined();
    expect(screen.queryByText(ARE_YOU_SURE)).toBeNull();
  });

  /**
   * The load-bearing test. The failure this guards against is silent: if the first press
   * were ever wired straight to the action, a real match would be voided with no warning
   * and nothing on screen would look wrong.
   *
   * Guard-must-fail drill run 2026-08-13: wiring the first button to `action` fails this
   * test plus the cancel and second-confirmation tests (3 of 4), and reverting restores all
   * four. Verified, not assumed.
   */
  it('does NOT void anything on the first press — only arms the confirmation', () => {
    const action = vi.fn();
    render(<StartNewMatch action={action} />);

    fireEvent.click(startButton());

    expect(screen.getByText(ARE_YOU_SURE)).toBeDefined();
    expect(action).not.toHaveBeenCalled();
  });

  it('cancelling disarms it and still voids nothing', () => {
    const action = vi.fn();
    render(<StartNewMatch action={action} />);

    fireEvent.click(startButton());
    fireEvent.click(screen.getByText('Cancel'));

    expect(screen.queryByText(ARE_YOU_SURE)).toBeNull();
    expect(startButton()).toBeDefined();
    expect(action).not.toHaveBeenCalled();
  });

  it('voids only after the second, explicit confirmation', async () => {
    const action = vi.fn();
    render(<StartNewMatch action={action} />);

    fireEvent.click(startButton());
    fireEvent.click(confirmButton());

    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
  });

  /**
   * Both controls must vanish together while the void is in flight. The bug this pins down is
   * a lie rather than a crash: Cancel used to stay live during the request, and pressing it
   * put the screen back to "Start new match" as though nothing had happened — while the match
   * was voided anyway. A control that can no longer stop the action must not remain on screen
   * implying that it can.
   */
  it('shows only a progress message while the void is in flight — nothing left to press', async () => {
    let release!: () => void;
    const action = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    render(<StartNewMatch action={action} />);

    fireEvent.click(startButton());
    fireEvent.click(confirmButton());

    await waitFor(() => expect(screen.getByText('Starting a new match…')).toBeDefined());
    expect(screen.queryByText('Cancel')).toBeNull();
    expect(screen.queryByText('Yes, void it and start new')).toBeNull();
    expect(screen.queryByText(ARE_YOU_SURE)).toBeNull();

    release();
    await waitFor(() => expect(screen.queryByText('Starting a new match…')).toBeNull());
  });
});
