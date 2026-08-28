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

type SignedUrl = { path: string; signedUrl: string };

/** `.select().not().order().limit()` — the archive query, awaited at its last link. */
function archive(rows: unknown[] = [], signed?: SignedUrl[]) {
  const query: Record<string, unknown> = {};
  const select = vi.fn(() => query);
  const not = vi.fn(() => query);
  const order = vi.fn(() => query);
  const limit = vi.fn(async () => ({ data: rows, error: null }));
  query.select = select;
  query.not = not;
  query.order = order;
  query.limit = limit;
  const signedData = signed ?? rows.map((row) => {
    const path = (row as { photo_path: string }).photo_path;
    return { path, signedUrl: `https://signed.example/${path}` };
  });
  const createSignedUrls = vi.fn(async (paths: string[], ttl: number) => ({ data: signedData, paths, ttl }));
  return {
    client: {
      from: vi.fn(() => query),
      storage: { from: vi.fn(() => ({ createSignedUrls })) },
    },
    select,
    not,
    order,
    limit,
    createSignedUrls,
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
    expect(admin.not).toHaveBeenCalledWith('photo_path', 'is', null);
    expect(admin.order).toHaveBeenCalledWith('created_at', { ascending: false });
    expect(admin.limit).toHaveBeenCalledWith(60);
  });

  it('extracts present nested object and array labels in alphabetical order from one photographed parent', async () => {
    signedInAs({ id: USER_ID });
    const admin = archive([{
      id: 'claim-1',
      created_at: '2026-08-20T14:00:00.000Z',
      photo_path: 'claims/claim-1.webp',
      logged_by: USER_ID,
      players: { display_name: 'Bryan' },
      notable_claim_types: [
        { notable_hands: { name: 'Pure Suit' } },
        { notable_hands: [{ name: 'All Pungs' }] },
        { notable_hands: null },
        { notable_hands: {} },
        {},
      ],
    }]);
    mocks.createAdminClient.mockReturnValue(admin.client);

    const html = renderToStaticMarkup(await HandsPage());

    expect(html).toContain('aria-label="All Pungs, Pure Suit won by Bryan"');
    expect(html).not.toContain('? won by Bryan');
    expect((html.match(/<button/g) ?? [])).toHaveLength(1);
  });

  it('signs every parent path once and drops only paths without a signed URL', async () => {
    signedInAs({ id: USER_ID });
    const rows = [
      {
        id: 'claim-1', created_at: '2026-08-20T14:00:00.000Z', photo_path: 'claims/one.webp', logged_by: USER_ID,
        players: { display_name: 'Bryan' }, notable_claim_types: [{ notable_hands: { name: 'All Pungs' } }],
      },
      {
        id: 'claim-2', created_at: '2026-08-19T14:00:00.000Z', photo_path: 'claims/two.webp', logged_by: USER_ID,
        players: { display_name: 'Chen' }, notable_claim_types: [{ notable_hands: { name: 'Pure Suit' } }],
      },
      {
        id: 'claim-3', created_at: '2026-08-18T14:00:00.000Z', photo_path: 'claims/three.webp', logged_by: USER_ID,
        players: { display_name: 'Devi' }, notable_claim_types: [{ notable_hands: { name: 'Half Flush' } }],
      },
    ];
    const admin = archive(rows, [
      { path: 'claims/one.webp', signedUrl: 'https://signed.example/claims/one.webp' },
      { path: 'claims/two.webp', signedUrl: '' },
      { path: 'claims/three.webp', signedUrl: 'https://signed.example/claims/three.webp' },
    ]);
    mocks.createAdminClient.mockReturnValue(admin.client);

    const html = renderToStaticMarkup(await HandsPage());

    expect(admin.createSignedUrls).toHaveBeenCalledTimes(1);
    expect(admin.createSignedUrls).toHaveBeenCalledWith(
      ['claims/one.webp', 'claims/two.webp', 'claims/three.webp'],
      3600,
    );
    expect((html.match(/<button/g) ?? [])).toHaveLength(2);
    expect(html).toContain('https://signed.example/claims/one.webp');
    expect(html).toContain('https://signed.example/claims/three.webp');
    expect(html).not.toContain('claims/two.webp');
  });
});
