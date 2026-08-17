import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createServerSupabase: vi.fn(),
  createAdminClient: vi.fn(),
  redirect: vi.fn(),
  sendAlert: vi.fn(),
}));

vi.mock('../../src/lib/supabase/server', () => ({
  createServerSupabase: mocks.createServerSupabase,
}));
vi.mock('../../src/lib/supabase/admin', () => ({
  createAdminClient: mocks.createAdminClient,
}));
vi.mock('../../src/lib/telegram', () => ({ sendAlert: mocks.sendAlert }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));

import { endAbandonedGame } from '../../src/lib/actions/game';

const GAME_ID = '11111111-1111-1111-1111-111111111111';
const TABLE_ID = '22222222-2222-2222-2222-222222222222';
const USER_ID = '33333333-3333-3333-3333-333333333333';
const STALE_TIMESTAMP = '2020-01-02T03:04:05.678Z';

type RpcResult = { data: boolean | string | null; error: { message: string } | null };

function queryReturning(result: { data: unknown; error: unknown }) {
  const query: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of ['select', 'eq', 'in', 'order', 'limit']) {
    query[method] = vi.fn(() => query);
  }
  query.single = vi.fn(async () => result);
  query.maybeSingle = vi.fn(async () => result);
  return query;
}

function arrange(mode: 'chips' | 'app', rpcResult: RpcResult) {
  const tagSeat = { table_id: TABLE_ID, seat: 'E' };
  const game = {
    id: GAME_ID,
    status: 'active',
    mode,
    created_at: '2020-01-01T00:00:00.000Z',
    last_activity_at: STALE_TIMESTAMP,
    game_players: [{ player_id: USER_ID, seat: 'E' }],
  };
  const rpc = vi.fn(async () => rpcResult);
  const admin = {
    from: vi.fn((table: string) => queryReturning(
      table === 'table_seats'
        ? { data: tagSeat, error: null }
        : { data: game, error: null },
    )),
    rpc,
  };

  mocks.createServerSupabase.mockResolvedValue({
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: USER_ID } } })) },
  });
  mocks.createAdminClient.mockReturnValue(admin);
  mocks.redirect.mockImplementation(() => { throw new Error('NEXT_REDIRECT'); });

  return { rpc };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.sendAlert.mockResolvedValue(undefined);
});

describe('endAbandonedGame', () => {
  it('sends the exact observed timestamp when expiring an abandoned chip game', async () => {
    const { rpc } = arrange('chips', { data: true, error: null });

    await expect(endAbandonedGame('east-secret')).rejects.toThrow('NEXT_REDIRECT');

    expect(rpc).toHaveBeenCalledWith('expire_abandoned_game', {
      p_game_id: GAME_ID,
      p_expected_last_activity_at: STALE_TIMESTAMP,
    });
    expect(mocks.redirect).toHaveBeenCalledWith('/t/east-secret');
  });

  it('sends the exact observed timestamp when ending an abandoned app game', async () => {
    const { rpc } = arrange('app', { data: 'ended', error: null });

    await expect(endAbandonedGame('east-secret')).rejects.toThrow('NEXT_REDIRECT');

    expect(rpc).toHaveBeenCalledWith('end_abandoned_game', {
      p_game_id: GAME_ID,
      p_expected_last_activity_at: STALE_TIMESTAMP,
    });
  });

  it.each([
    ['chips' as const, false],
    ['app' as const, 'changed'],
  ])('treats a resumed %s game as a harmless lost race', async (mode, data) => {
    const { rpc } = arrange(mode, { data, error: null });

    await expect(endAbandonedGame('east-secret')).rejects.toThrow('NEXT_REDIRECT');

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(mocks.sendAlert).not.toHaveBeenCalled();
    expect(mocks.redirect).toHaveBeenCalledWith('/t/east-secret');
  });

  it('alerts once when an unchanged app game is quarantined', async () => {
    arrange('app', { data: 'quarantined', error: null });

    await expect(endAbandonedGame('east-secret')).rejects.toThrow('NEXT_REDIRECT');

    expect(mocks.sendAlert).toHaveBeenCalledTimes(1);
    expect(mocks.sendAlert.mock.calls[0]?.[0]).toContain(GAME_ID);
    expect(mocks.redirect).toHaveBeenCalledWith('/t/east-secret');
  });

  it('surfaces a genuine database failure and does not continue to replacement creation', async () => {
    const { rpc } = arrange('chips', { data: null, error: { message: 'database unavailable' } });

    await expect(endAbandonedGame('east-secret')).rejects.toThrow(
      'could not clear the abandoned game: database unavailable',
    );

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});
