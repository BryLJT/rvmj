import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Spec §12's twelfth automated guard: the archive redirects a signed-out visitor to login.
 *
 * `/hands` is the only new route in the branch and its guard is the whole of what stands
 * between private table photos and the open web, so it is worth testing directly rather than
 * by inspection. A Server Component is an async function, so it can simply be called — the
 * only fidelity that matters is that `redirect()` THROWS the way the real one does, because a
 * mock that merely returns would let the page run on past the guard and read the archive.
 */
const mocks = vi.hoisted(() => ({
  createServerSupabase: vi.fn(),
  createAdminClient: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock('../../src/lib/supabase/server', () => ({ createServerSupabase: mocks.createServerSupabase }));
vi.mock('../../src/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock('../../src/lib/telegram', () => ({ sendAlert: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: mocks.redirect,
  useRouter: () => ({ refresh: vi.fn() }),
}));

import HandsPage from '../../src/app/hands/page';

const USER_ID = '33333333-3333-3333-3333-333333333333';

/** `.select().not().order().limit()` — the archive query, awaited at its last link. */
function emptyArchive() {
  const query: Record<string, unknown> = {};
  for (const method of ['select', 'not', 'order']) query[method] = () => query;
  query.limit = async () => ({ data: [], error: null });
  return { from: vi.fn(() => query) };
}

const signedInAs = (user: { id: string } | null) => {
  mocks.createServerSupabase.mockResolvedValue({
    auth: { getUser: vi.fn(async () => ({ data: { user } })) },
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.redirect.mockImplementation(() => { throw new Error('NEXT_REDIRECT'); });
  mocks.createAdminClient.mockReturnValue(emptyArchive());
});

describe('/hands access', () => {
  it('redirects a signed-out visitor to login and reads no photos on the way', async () => {
    signedInAs(null);

    await expect(HandsPage()).rejects.toThrow('NEXT_REDIRECT');

    expect(mocks.redirect).toHaveBeenCalledWith('/login?next=%2Fhands');
    // The redirect has to happen BEFORE the archive is read, not merely instead of rendering it.
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it('lets a signed-in visitor through to the archive', async () => {
    signedInAs({ id: USER_ID });

    await HandsPage();

    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(mocks.createAdminClient).toHaveBeenCalled();
  });
});
