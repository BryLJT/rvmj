import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Suspense, useEffect, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FormingScreen } from '../../src/app/game/[id]/FormingScreen';
import { startGame } from '../../src/lib/actions/game';

const navigation = vi.hoisted(() => ({
  router: { refresh: vi.fn() },
  onRefresh: undefined as (() => void) | undefined,
}));

const realtime = vi.hoisted(() => ({
  subscribeCallback: undefined as ((status: string) => void) | undefined,
  channelName: undefined as string | undefined,
  channel: undefined as unknown,
  registrations: [] as Array<{
    event: string;
    config: Record<string, string>;
    callback: () => void;
  }>,
  removeChannel: vi.fn(async () => 'ok'),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => navigation.router,
}));

vi.mock('../../src/lib/actions/game', () => ({
  startGame: vi.fn(async () => ({})),
}));

vi.mock('../../src/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      getSession: async () => ({ data: { session: { access_token: 'authenticated-token' } }, error: null }),
    },
    realtime: { setAuth: async () => undefined },
    channel: (name: string) => {
      const channel = {
        on: (event: string, config: Record<string, string>, callback: () => void) => {
          realtime.registrations.push({ event, config, callback });
          return channel;
        },
        subscribe: (callback?: (status: string) => void) => {
          realtime.subscribeCallback = callback;
          return channel;
        },
      };
      realtime.channelName = name;
      realtime.channel = channel;
      return channel;
    },
    removeChannel: realtime.removeChannel,
  }),
}));

const players = [
  { playerId: 'p1', seat: 'E' as const, name: 'Ah Seng' },
  { playerId: 'p2', seat: 'S' as const, name: 'Bryan' },
  { playerId: 'p3', seat: 'W' as const, name: 'Ah Beng' },
  { playerId: 'p4', seat: 'N' as const, name: 'Ah Huat' },
];

const refreshGate: { promise?: Promise<void> } = {};

function RefreshGate() {
  if (refreshGate.promise) throw refreshGate.promise;
  return null;
}

function ResyncHarness({ screenPlayers = players }: { screenPlayers?: typeof players }) {
  const [refreshVersion, setRefreshVersion] = useState(0);
  // Wired on mount, before any test dispatches the reconnect/foreground events that call
  // router.refresh(), so the in-flight refresh still suspends on the very first resync.
  useEffect(() => {
    navigation.onRefresh = () => setRefreshVersion((version) => version + 1);
  }, []);
  return (
    <>
      <FormingScreen gameId="g1" players={screenPlayers} />
      <Suspense fallback={null}>{refreshVersion > 0 ? <RefreshGate /> : null}</Suspense>
    </>
  );
}

function blockRefresh() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  refreshGate.promise = promise;
  return async () => {
    refreshGate.promise = undefined;
    resolve();
    await promise;
  };
}

afterEach(() => {
  cleanup();
  refreshGate.promise = undefined;
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.clearAllMocks();
  navigation.onRefresh = undefined;
  navigation.router.refresh.mockImplementation(() => navigation.onRefresh?.());
  realtime.subscribeCallback = undefined;
  realtime.channelName = undefined;
  realtime.channel = undefined;
  realtime.registrations = [];
  vi.mocked(startGame).mockResolvedValue({});
});

describe('FormingScreen', () => {
  // Three of the four ways into the rules page are mid-match, so each carries its match.
  it('sends the house rules link back to the table it was opened from', () => {
    render(<FormingScreen gameId="g1" players={players} />);
    expect(screen.getByRole('link', { name: 'House rules' }).getAttribute('href')).toBe('/chips?game=g1');
  });

  it('keeps all four seats stable and presents chip mode without a mode picker', () => {
    render(<FormingScreen gameId="g1" players={players.slice(0, 2)} />);

    expect(screen.getAllByText(/^(East|South|West|North)$/)).toHaveLength(4);
    expect(screen.getByText('Chip mode')).toBeDefined();
    expect(screen.queryByText(/App scorekeeper/i)).toBeNull();
    expect(screen.getByRole('list').className.split(' ')).toContain('bg-surface');
    expect(screen.getByRole('list').className.split(' ')).not.toContain('bg-surface-raised');
    expect((screen.getByRole('button', { name: 'Waiting for players (2/4)' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('starts only a full table and locks duplicate taps', async () => {
    let release!: () => void;
    vi.mocked(startGame).mockImplementationOnce(() => new Promise((resolve) => {
      release = () => resolve({});
    }));
    render(<FormingScreen gameId="g1" players={players} />);

    const button = screen.getByRole('button', { name: 'Start chip game' });
    act(() => {
      button.click();
      button.click();
    });

    expect(startGame).toHaveBeenCalledTimes(1);
    expect(startGame).toHaveBeenCalledWith('g1', 'chips');
    expect((screen.getByRole('button', { name: 'Starting game…' }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => release());
  });

  it('locks stale Start immediately while reconnect refresh waits for fresh seats', async () => {
    const releaseRefresh = blockRefresh();
    render(<ResyncHarness />);
    await waitFor(() => expect(realtime.subscribeCallback).toBeDefined());
    const staleButton = screen.getByRole('button', { name: 'Start chip game' });

    act(() => {
      realtime.subscribeCallback?.('SUBSCRIBED');
      staleButton.click();
    });

    expect(startGame).not.toHaveBeenCalled();
    expect((screen.getByRole('button', { name: 'Checking table…' }) as HTMLButtonElement).disabled).toBe(true);

    await act(releaseRefresh);
    const freshButton = screen.getByRole('button', { name: 'Start chip game' });
    expect((freshButton as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(freshButton);
    expect(startGame).toHaveBeenCalledTimes(1);
  });

  it('locks stale Start immediately while foreground refresh waits for fresh seats', async () => {
    const releaseRefresh = blockRefresh();
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    render(<ResyncHarness />);
    const staleButton = screen.getByRole('button', { name: 'Start chip game' });

    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
      staleButton.click();
    });

    expect(startGame).not.toHaveBeenCalled();
    expect((screen.getByRole('button', { name: 'Checking table…' }) as HTMLButtonElement).disabled).toBe(true);

    await act(releaseRefresh);
    expect((screen.getByRole('button', { name: 'Start chip game' }) as HTMLButtonElement).disabled).toBe(false);
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

  it('refreshes seats after reconnect and only after a visible foreground return', async () => {
    let visibility: DocumentVisibilityState = 'hidden';
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
    render(<FormingScreen gameId="g1" players={players.slice(0, 2)} />);
    await waitFor(() => expect(realtime.subscribeCallback).toBeDefined());

    act(() => realtime.subscribeCallback?.('SUBSCRIBED'));
    expect(navigation.router.refresh).toHaveBeenCalledTimes(1);

    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(navigation.router.refresh).toHaveBeenCalledTimes(1);

    visibility = 'visible';
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(navigation.router.refresh).toHaveBeenCalledTimes(2);
  });

  it('shows a recovery action and guards the refresh when live updates fail', async () => {
    const releaseRefresh = blockRefresh();
    render(<ResyncHarness screenPlayers={players.slice(0, 2)} />);
    await waitFor(() => expect(realtime.subscribeCallback).toBeDefined());

    act(() => realtime.subscribeCallback?.('CHANNEL_ERROR'));

    expect(screen.getByRole('alert').textContent).toContain('Live updates paused');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh seats' }));
    expect(navigation.router.refresh).toHaveBeenCalledTimes(1);
    expect((screen.getByRole('button', { name: 'Checking table…' }) as HTMLButtonElement).disabled).toBe(true);

    await act(releaseRefresh);
    expect(screen.getByRole('alert').textContent).toContain('Live updates paused');
    expect(screen.getByRole('button', { name: 'Refresh seats' })).toBeDefined();
  });

  it('preserves both filtered realtime subscriptions, their refreshes, and cleanup', async () => {
    const { unmount } = render(<FormingScreen gameId="g1" players={players.slice(0, 2)} />);
    await waitFor(() => expect(realtime.channelName).toBe('forming-g1'));

    expect(realtime.channelName).toBe('forming-g1');
    expect(realtime.registrations.map(({ event, config }) => ({ event, config }))).toEqual([
      {
        event: 'postgres_changes',
        config: { event: '*', schema: 'public', table: 'game_players', filter: 'game_id=eq.g1' },
      },
      {
        event: 'postgres_changes',
        config: { event: 'UPDATE', schema: 'public', table: 'games', filter: 'id=eq.g1' },
      },
    ]);

    act(() => realtime.registrations[0].callback());
    expect(navigation.router.refresh).toHaveBeenCalledTimes(1);
    act(() => realtime.registrations[1].callback());
    expect(navigation.router.refresh).toHaveBeenCalledTimes(2);

    unmount();
    expect(realtime.removeChannel).toHaveBeenCalledTimes(1);
    expect(realtime.removeChannel).toHaveBeenCalledWith(realtime.channel);
  });
});
