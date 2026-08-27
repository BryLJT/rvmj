import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Mirrors tests/pages/hands-page.test.ts. The guard matters for the same reason: a Server
 * Component is an async function, so it can simply be called, and the only fidelity that counts
 * is that `redirect()` THROWS the way the real one does. A mock that merely returned would let
 * the page run on past the guard and read the profile anyway.
 */
const mocks = vi.hoisted(() => ({
  createServerSupabase: vi.fn(),
  createAdminClient: vi.fn(),
  redirect: vi.fn(),
}));
vi.mock('../../src/lib/supabase/server', () => ({ createServerSupabase: mocks.createServerSupabase }));
vi.mock('../../src/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock('../../src/lib/actions/account', () => ({ renameMe: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect, useRouter: () => ({ refresh: vi.fn() }) }));

import AccountPage from '../../src/app/account/page';

const USER = '33333333-3333-3333-3333-333333333333';
const profile = (row: unknown, error: unknown = null) => {
  const query: Record<string, unknown> = {};
  query.select = () => query;
  query.eq = () => query;
  query.maybeSingle = async () => ({ data: row, error });
  return { from: vi.fn(() => query) };
};
const signedInAs = (user: { id: string } | null) =>
  mocks.createServerSupabase.mockResolvedValue({ auth: { getUser: vi.fn(async () => ({ data: { user } })) } });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.redirect.mockImplementation(() => { throw new Error('NEXT_REDIRECT'); });
  mocks.createAdminClient.mockReturnValue(profile({ display_name: 'Bryan Lim', house: 'orcaella' }));
});

describe('/account access', () => {
  it('redirects a signed-out visitor to login and reads no profile on the way', async () => {
    signedInAs(null);
    await expect(AccountPage()).rejects.toThrow('NEXT_REDIRECT');
    expect(mocks.redirect).toHaveBeenCalledWith('/login?next=%2Faccount');
    // The redirect must happen BEFORE the profile is read, not merely instead of rendering it.
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it('shows a signed-in player their name and house', async () => {
    signedInAs({ id: USER });
    const html = renderToStaticMarkup(await AccountPage());
    expect(html).toContain('Bryan Lim');
    expect(html).toContain('Orcaella');
  });

  it('says so plainly when a player has no house', async () => {
    signedInAs({ id: USER });
    mocks.createAdminClient.mockReturnValue(profile({ display_name: 'rachel', house: null }));
    const html = renderToStaticMarkup(await AccountPage());
    expect(html).toContain('No house yet');
  });

  // An empty page would read as "you have no account". Say the read failed instead.
  it('says the account could not be loaded rather than rendering a blank form', async () => {
    signedInAs({ id: USER });
    mocks.createAdminClient.mockReturnValue(profile(null, { message: 'boom' }));
    expect(renderToStaticMarkup(await AccountPage())).toContain('Couldn’t load your account');
  });

  it('returns to the leaderboard', async () => {
    signedInAs({ id: USER });
    expect(renderToStaticMarkup(await AccountPage())).toContain('href="/"');
  });

  // The house is permanent by design (0006's trigger). A control that cannot do anything is
  // worse than a plain line of text, so there must not be one.
  it('shows the house without offering to change it', async () => {
    signedInAs({ id: USER });
    const html = renderToStaticMarkup(await AccountPage());
    expect(html).toContain('Orcaella');
    expect(html).not.toContain('Choose your house');
  });
});
