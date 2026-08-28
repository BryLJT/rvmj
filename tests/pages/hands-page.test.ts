import { renderToStaticMarkup } from 'react-dom/server';
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
function archive(rows: unknown[] = []) {
  const query: Record<string, unknown> = {};
  const select = vi.fn(() => query);
  query.select = select;
  for (const method of ['not', 'order']) query[method] = () => query;
  query.limit = async () => ({ data: rows, error: null });
  const createSignedUrls = vi.fn(async (paths: string[]) => ({
    data: paths.map((path) => ({ path, signedUrl: `https://signed.example/${path}` })),
  }));
  return {
    client: {
      from: vi.fn(() => query),
      storage: { from: vi.fn(() => ({ createSignedUrls })) },
    },
    select,
  };
}

const signedInAs = (user: { id: string } | null) => {
  mocks.createServerSupabase.mockResolvedValue({
    auth: { getUser: vi.fn(async () => ({ data: { user } })) },
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.redirect.mockImplementation(() => { throw new Error('NEXT_REDIRECT'); });
  mocks.createAdminClient.mockReturnValue(archive().client);
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

  it('returns archive visitors to the Skill board', async () => {
    signedInAs({ id: USER_ID });

    const html = renderToStaticMarkup(await HandsPage());

    expect(html).toContain('href="/?board=skill"');
  });

  it('reads every label through the claim-type join, rather than the legacy parent relationship', async () => {
    signedInAs({ id: USER_ID });
    const admin = archive();
    mocks.createAdminClient.mockReturnValue(admin.client);

    await HandsPage();

    expect(admin.select).toHaveBeenCalledWith(`
  id,
  created_at,
  photo_path,
  logged_by,
  players!notable_claims_player_id_fkey(display_name),
  notable_claim_types(notable_hands(name))
`);
  });

  it('passes every attached label to the one photographed win in alphabetical order', async () => {
    signedInAs({ id: USER_ID });
    const admin = archive([{
      id: 'claim-1',
      created_at: '2026-08-20T14:00:00.000Z',
      photo_path: 'claims/claim-1.webp',
      logged_by: USER_ID,
      players: { display_name: 'Bryan' },
      notable_claim_types: [
        { notable_hands: { name: 'Pure Suit' } },
        { notable_hands: { name: 'All Pungs' } },
      ],
    }]);
    mocks.createAdminClient.mockReturnValue(admin.client);

    const html = renderToStaticMarkup(await HandsPage());

    expect(html).toContain('All Pungs');
    expect(html).toContain('Pure Suit');
    expect(html.indexOf('All Pungs')).toBeLessThan(html.indexOf('Pure Suit'));
    expect((html.match(/<button/g) ?? [])).toHaveLength(1);
  });
});
