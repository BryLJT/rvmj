import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FormingScreen } from '../../src/app/game/[id]/FormingScreen';
import { startGame } from '../../src/lib/actions/game';

const navigation = vi.hoisted(() => ({
  router: { refresh: vi.fn() },
}));

const realtime = vi.hoisted(() => ({
  subscribeCallback: undefined as ((status: string) => void) | undefined,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => navigation.router,
}));

vi.mock('../../src/lib/actions/game', () => ({
  startGame: vi.fn(async () => ({})),
}));

vi.mock('../../src/lib/supabase/client', () => ({
  createClient: () => ({
    channel: () => {
      const channel = {
        on: () => channel,
        subscribe: (callback?: (status: string) => void) => {
          realtime.subscribeCallback = callback;
          return channel;
        },
      };
      return channel;
    },
    removeChannel: vi.fn(),
  }),
}));

const players = [
  { playerId: 'p1', seat: 'E' as const, name: 'Ah Seng' },
  { playerId: 'p2', seat: 'S' as const, name: 'Bryan' },
  { playerId: 'p3', seat: 'W' as const, name: 'Ah Beng' },
  { playerId: 'p4', seat: 'N' as const, name: 'Ah Huat' },
];

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.clearAllMocks();
  realtime.subscribeCallback = undefined;
  vi.mocked(startGame).mockResolvedValue({});
});

describe('FormingScreen', () => {
  it('keeps all four seats stable and presents chip mode without a mode picker', () => {
    render(<FormingScreen gameId="g1" players={players.slice(0, 2)} />);

    expect(screen.getAllByText(/^(East|South|West|North)$/)).toHaveLength(4);
    expect(screen.getByText('Chip mode')).toBeDefined();
    expect(screen.queryByText(/App scorekeeper/i)).toBeNull();
    expect((screen.getByRole('button', { name: 'Waiting for players (2/4)' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('starts only a full table and locks duplicate taps', async () => {
    let release!: () => void;
    vi.mocked(startGame).mockImplementationOnce(() => new Promise((resolve) => {
      release = () => resolve({});
    }));
    render(<FormingScreen gameId="g1" players={players} />);

    const button = screen.getByRole('button', { name: 'Start chip game' });
    fireEvent.click(button);
    fireEvent.click(button);

    expect(startGame).toHaveBeenCalledTimes(1);
    expect((screen.getByRole('button', { name: 'Starting game…' }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => release());
  });

  it('shows a failed start inline and restores the action', async () => {
    vi.mocked(startGame).mockResolvedValueOnce({ error: 'table changed' });
    render(<FormingScreen gameId="g1" players={players} />);

    fireEvent.click(screen.getByRole('button', { name: 'Start chip game' }));

    expect((await screen.findByRole('alert')).textContent).toContain('table changed');
    expect((screen.getByRole('button', { name: 'Start chip game' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows a rejected start inline and restores the action', async () => {
    vi.mocked(startGame).mockRejectedValueOnce(new Error('network down'));
    render(<FormingScreen gameId="g1" players={players} />);

    fireEvent.click(screen.getByRole('button', { name: 'Start chip game' }));

    expect((await screen.findByRole('alert')).textContent).toContain('network down');
    expect((screen.getByRole('button', { name: 'Start chip game' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('refreshes seats after reconnect and only after a visible foreground return', () => {
    let visibility: DocumentVisibilityState = 'hidden';
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
    render(<FormingScreen gameId="g1" players={players.slice(0, 2)} />);

    act(() => realtime.subscribeCallback?.('SUBSCRIBED'));
    expect(navigation.router.refresh).toHaveBeenCalledTimes(1);

    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(navigation.router.refresh).toHaveBeenCalledTimes(1);

    visibility = 'visible';
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(navigation.router.refresh).toHaveBeenCalledTimes(2);
  });
});
