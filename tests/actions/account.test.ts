import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createServerSupabase: vi.fn(),
  createAdminClient: vi.fn(),
}));
vi.mock('../../src/lib/supabase/server', () => ({ createServerSupabase: mocks.createServerSupabase }));
vi.mock('../../src/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }));

import { renameMe } from '../../src/lib/actions/account';

const USER = '33333333-3333-3333-3333-333333333333';
const signedInAs = (user: { id: string } | null) =>
  mocks.createServerSupabase.mockResolvedValue({ auth: { getUser: vi.fn(async () => ({ data: { user } })) } });
const rpcReturning = (result: unknown) => {
  const rpc = vi.fn(async () => result);
  mocks.createAdminClient.mockReturnValue({ rpc });
  return rpc;
};

beforeEach(() => { vi.clearAllMocks(); signedInAs({ id: USER }); });

describe('renameMe', () => {
  it('saves a new name', async () => {
    rpcReturning({ data: [{ stored_name: 'Orca', applied: true }], error: null });
    expect(await renameMe('Orca')).toEqual({ status: 'saved', name: 'Orca' });
  });

  // Not a failure. The database is honestly reporting that the submitted name is already stored.
  it('reports an unchanged name without claiming to have written', async () => {
    rpcReturning({ data: [{ stored_name: 'Orca', applied: false }], error: null });
    expect(await renameMe('Orca')).toEqual({ status: 'unchanged', name: 'Orca' });
  });

  it('refuses a blank name without calling the database', async () => {
    const rpc = rpcReturning({ data: null, error: null });
    expect(await renameMe('   ')).toEqual({ status: 'invalid', reason: 'blank' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('refuses an over-long name without calling the database', async () => {
    const rpc = rpcReturning({ data: null, error: null });
    expect(await renameMe('x'.repeat(41))).toEqual({ status: 'invalid', reason: 'too_long' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('trims before measuring, so padding does not fail a legal name', async () => {
    const rpc = rpcReturning({ data: [{ stored_name: 'x'.repeat(40), applied: true }], error: null });
    expect(await renameMe('  ' + 'x'.repeat(40) + '  ')).toEqual({ status: 'saved', name: 'x'.repeat(40) });
    expect(rpc).toHaveBeenCalled();
  });

  it('reports an expired session rather than failing opaquely', async () => {
    signedInAs(null);
    expect(await renameMe('Orca')).toEqual({ status: 'expired' });
  });

  it('reports a database error as a failure', async () => {
    rpcReturning({ data: null, error: { message: 'boom' } });
    expect(await renameMe('Orca')).toEqual({ status: 'failed' });
  });

  /**
   * The trust boundary. The browser can send anything and still cannot nominate an account:
   * the id handed to the database comes from the session and nowhere else.
   */
  it('names the account from the session, never from the caller', async () => {
    const rpc = rpcReturning({ data: [{ stored_name: 'Orca', applied: true }], error: null });
    await renameMe('Orca');
    expect(rpc).toHaveBeenCalledWith('set_display_name', { p_player_id: USER, p_name: 'Orca' });
  });

  it('accepts a composite row as well as an array', async () => {
    rpcReturning({ data: { stored_name: 'Orca', applied: true }, error: null });
    expect(await renameMe('Orca')).toEqual({ status: 'saved', name: 'Orca' });
  });

  it('treats an empty result as a failure rather than a silent success', async () => {
    rpcReturning({ data: [], error: null });
    expect(await renameMe('Orca')).toEqual({ status: 'failed' });
  });
});
