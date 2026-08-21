import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createServerSupabase: vi.fn(),
  createAdminClient: vi.fn(),
}));

vi.mock('../src/lib/supabase/server', () => ({ createServerSupabase: mocks.createServerSupabase }));
vi.mock('../src/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }));

import { GET } from '../src/app/auth/callback/route';

const USER_ID = '33333333-3333-3333-3333-333333333333';
const ORIGIN = 'https://rvmj.example';

function arrangeSignIn(user: { id: string } | null) {
  const exchange = vi.fn(async () => ({ data: { user }, error: null }));
  mocks.createServerSupabase.mockResolvedValue({ auth: { exchangeCodeForSession: exchange } });
  return exchange;
}

/** `.from('players').select('house').eq('id', ...).maybeSingle()` */
function arrangeHouse(result: { data: unknown; error: unknown }) {
  const query: Record<string, unknown> = {};
  for (const method of ['select', 'eq']) query[method] = () => query;
  query.maybeSingle = async () => result;
  const from = vi.fn(() => query);
  mocks.createAdminClient.mockReturnValue({ from });
  return from;
}

const callback = (search: string) => GET(new Request(`${ORIGIN}/auth/callback${search}`));
const locationOf = async (search: string) => (await callback(search)).headers.get('location');

beforeEach(() => {
  vi.clearAllMocks();
  arrangeSignIn({ id: USER_ID });
  arrangeHouse({ data: { house: null }, error: null });
});

describe('OAuth callback', () => {
  it('marks a house-less sign-in on the destination it already sanitised', async () => {
    expect(await locationOf('?code=abc')).toBe(`${ORIGIN}/?houseSetup=1`);
  });

  it('leaves a player who already has a house alone', async () => {
    arrangeHouse({ data: { house: 'rusa' }, error: null });

    expect(await locationOf('?code=abc')).toBe(`${ORIGIN}/`);
  });

  /**
   * The existing same-origin protection is the reason this handler exists at all. The URL
   * parser rewrites backslashes and strips tab/newline, so a prefix check on the raw string is
   * not enough; these are the cases that survive `startsWith('//')`.
   */
  it('keeps refusing an off-origin destination', async () => {
    for (const hostile of ['https://evil.com/x', '//evil.com', '/\\evil.com', '/\t//evil.com']) {
      const location = await locationOf(`?code=abc&next=${encodeURIComponent(hostile)}`);
      expect(location).toBe(`${ORIGIN}/?houseSetup=1`);
    }
  });

  it('preserves a same-origin destination, its query, and its fragment', async () => {
    expect(await locationOf(`?code=abc&next=${encodeURIComponent('/?board=skill')}`))
      .toBe(`${ORIGIN}/?board=skill&houseSetup=1`);
    expect(await locationOf(`?code=abc&next=${encodeURIComponent('/game/7#seat-E')}`))
      .toBe(`${ORIGIN}/game/7?houseSetup=1#seat-E`);
  });

  it('adds nothing at all without a code', async () => {
    const from = arrangeHouse({ data: { house: null }, error: null });

    expect(await locationOf(`?next=${encodeURIComponent('/chips')}`)).toBe(`${ORIGIN}/chips`);
    expect(from).not.toHaveBeenCalled();
  });

  it('does not mark a sign-in that failed', async () => {
    arrangeSignIn(null);

    expect(await locationOf('?code=abc')).toBe(`${ORIGIN}/`);
  });

  /**
   * A profile read is a convenience, not a gate. If it fails the player still lands where they
   * were going; the homepage action is the later route to selection.
   */
  it('never lets a failed house read block the destination', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    arrangeHouse({ data: null, error: { message: 'permission denied for table players' } });

    expect(await locationOf(`?code=abc&next=${encodeURIComponent('/chips')}`)).toBe(`${ORIGIN}/chips`);
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('never lets a thrown house read block the destination', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.createAdminClient.mockImplementation(() => { throw new Error('no service role key'); });

    expect(await locationOf('?code=abc')).toBe(`${ORIGIN}/`);
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
