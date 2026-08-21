import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createServerSupabase: vi.fn(),
  createAdminClient: vi.fn(),
}));

vi.mock('../../src/lib/supabase/server', () => ({ createServerSupabase: mocks.createServerSupabase }));
vi.mock('../../src/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }));

import { chooseHouse } from '../../src/lib/actions/house';

const USER_ID = '33333333-3333-3333-3333-333333333333';
const OTHER_ID = '44444444-4444-4444-4444-444444444444';

/** PostgREST returns a `returns table` function as an array of rows. */
function arrange(user: { id: string } | null, rpcResult: { data: unknown; error: { message: string } | null }) {
  const rpc = vi.fn(async () => rpcResult);
  mocks.createServerSupabase.mockResolvedValue({
    auth: { getUser: vi.fn(async () => ({ data: { user } })) },
  });
  mocks.createAdminClient.mockReturnValue({ rpc });
  return { rpc };
}

beforeEach(() => vi.clearAllMocks());

describe('chooseHouse', () => {
  it('saves a valid choice for the signed-in player', async () => {
    const { rpc } = arrange({ id: USER_ID }, { data: [{ stored_house: 'rusa', applied: true }], error: null });

    await expect(chooseHouse('rusa')).resolves.toEqual({ status: 'saved', house: 'rusa' });
    expect(rpc).toHaveBeenCalledWith('choose_house', { p_player_id: USER_ID, p_house: 'rusa' });
  });

  /**
   * The security property of this whole feature in one test. `chooseHouse` takes a house and
   * nothing else, so there is no parameter through which a caller could nominate an account;
   * the id handed to the database is the session's, every time.
   */
  it('sends the session player id, never anything the caller could influence', async () => {
    const { rpc } = arrange({ id: USER_ID }, { data: [{ stored_house: 'manis', applied: true }], error: null });

    await chooseHouse('manis');

    const [, args] = rpc.mock.calls[0] as unknown as [string, { p_player_id: string }];
    expect(args.p_player_id).toBe(USER_ID);
    expect(args.p_player_id).not.toBe(OTHER_ID);
  });

  it('reports the stored house when the database says it was already set', async () => {
    arrange({ id: USER_ID }, { data: [{ stored_house: 'chelonia', applied: false }], error: null });

    await expect(chooseHouse('panthera')).resolves.toEqual({ status: 'already', house: 'chelonia' });
  });

  it('accepts a single-object payload as well as a one-row array', async () => {
    arrange({ id: USER_ID }, { data: { stored_house: 'strix', applied: true }, error: null });

    await expect(chooseHouse('strix')).resolves.toEqual({ status: 'saved', house: 'strix' });
  });

  it('rejects an identifier outside the seven without reaching the database', async () => {
    const { rpc } = arrange({ id: USER_ID }, { data: [{ stored_house: 'rusa', applied: true }], error: null });

    await expect(chooseHouse('gryffindor')).resolves.toEqual({ status: 'failed' });
    await expect(chooseHouse('RUSA')).resolves.toEqual({ status: 'failed' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('never converts an unauthenticated request into a write', async () => {
    const { rpc } = arrange(null, { data: [{ stored_house: 'rusa', applied: true }], error: null });

    await expect(chooseHouse('rusa')).resolves.toEqual({ status: 'expired' });
    expect(rpc).not.toHaveBeenCalled();
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it('reports a database error as a plain failure', async () => {
    arrange({ id: USER_ID }, { data: null, error: { message: 'permission denied for function choose_house' } });

    await expect(chooseHouse('rusa')).resolves.toEqual({ status: 'failed' });
  });

  it('treats an unrecognisable payload as a failure rather than guessing', async () => {
    arrange({ id: USER_ID }, { data: [], error: null });
    await expect(chooseHouse('rusa')).resolves.toEqual({ status: 'failed' });

    arrange({ id: USER_ID }, { data: [{ stored_house: 'gryffindor', applied: true }], error: null });
    await expect(chooseHouse('rusa')).resolves.toEqual({ status: 'failed' });
  });

  it('survives a thrown transport error', async () => {
    mocks.createServerSupabase.mockRejectedValue(new Error('fetch failed'));

    await expect(chooseHouse('rusa')).resolves.toEqual({ status: 'failed' });
  });
});
