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

  /**
   * The Notable wins board renders publicly, so a signed-out visitor can genuinely arrive here
   * from a filtered board. Without this the login wall eats their period and filters: they sign
   * in, land on a bare `/hands`, and the back arrow returns them to a reset board — the same hole
   * the back arrow itself was added to close, just one redirect further along.
   *
   * The `next` value is REBUILT from the validated pieces, never replayed from an incoming
   * address. It is a redirect target, so it must not be able to express somewhere this page did
   * not construct. (`/auth/callback` resolves `next` to a same-origin path as well — this is the
   * first of the two guards, not the only one.)
   */
  it('carries the return state through the login wall', async () => {
    signedInAs(null);

    await expect(HandsPage({
      searchParams: Promise.resolve({ year: '2025', hand: ['h8', 'h7'] }),
    })).rejects.toThrow('NEXT_REDIRECT');

    expect(mocks.redirect).toHaveBeenCalledWith('/login?next=%2Fhands%3Fyear%3D2025%26hand%3Dh7%26hand%3Dh8');
    // Still before the archive is read, not merely instead of rendering it.
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  /**
   * The year and the filters stand on their own. An unusable year drops the YEAR — the page will
   * not guess a period nobody chose — but keeping the hand filters costs nothing and is most of
   * what the player would otherwise lose, in the one case where the address was already partly
   * unreadable.
   */
  it('drops only the unusable year, keeping the hand filters', async () => {
    signedInAs(null);

    await expect(HandsPage({
      searchParams: Promise.resolve({ year: 'not-a-year', hand: ['h8', 'h7'] }),
    })).rejects.toThrow('NEXT_REDIRECT');

    expect(mocks.redirect).toHaveBeenCalledWith('/login?next=%2Fhands%3Fhand%3Dh7%26hand%3Dh8');
  });

  it('sends a bare /hands when there is genuinely nothing to carry', async () => {
    signedInAs(null);

    await expect(HandsPage()).rejects.toThrow('NEXT_REDIRECT');

    expect(mocks.redirect).toHaveBeenCalledWith('/login?next=%2Fhands');
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

  /**
   * The gallery is reached FROM the standings board, so its back arrow has to return the player
   * to the view they left — the period and the hand types included. Without this, a player who
   * filtered Notable wins, opened a photo and came back would find the board reset, which reads
   * as the app having thrown their selection away.
   *
   * The address is REBUILT from validated parts rather than carried whole: the year goes through
   * `parseYearParam` and the rest through `standingsHref`, so the only thing a hand-typed
   * `/hands?...` can influence is which same-origin standings address the arrow points at. A
   * verbatim return URL would be an open redirect.
   */
  it('rebuilds the standings address it was sent back to', async () => {
    signedInAs({ id: USER_ID });

    const html = renderToStaticMarkup(await HandsPage({
      searchParams: Promise.resolve({ year: '2025', hand: ['h8', 'h7'] }),
    }));

    expect(html).toContain('href="/?board=skill&amp;year=2025&amp;hand=h7&amp;hand=h8"');
  });

  it('carries All time back as the period rather than dropping it', async () => {
    signedInAs({ id: USER_ID });

    const html = renderToStaticMarkup(await HandsPage({
      searchParams: Promise.resolve({ year: 'all', hand: 'h7' }),
    }));

    expect(html).toContain('href="/?board=skill&amp;year=all&amp;hand=h7"');
  });

  /**
   * An unusable year means the return address cannot be trusted to be one the player came from,
   * so the arrow falls back to today's plain Skill board rather than guessing. Same fail-soft
   * posture the homepage takes for the same parameter.
   */
  it('falls back to the plain Skill board when the return year is unusable', async () => {
    signedInAs({ id: USER_ID });

    const html = renderToStaticMarkup(await HandsPage({
      searchParams: Promise.resolve({ year: 'not-a-year', hand: 'h7' }),
    }));

    expect(html).toContain('href="/?board=skill"');
    expect(html).not.toContain('hand=h7');
    expect(html).not.toContain('year=');
  });

  /**
   * Spec line 265, now that those parameters actually appear on the URL. The board's filters are
   * RETURN STATE and nothing else: they must not reach the archive query, its ordering, its
   * depth, the paths it signs, or a single byte of what it renders. This is the assertion that
   * stops `hand` from quietly becoming a gallery filter later.
   */
  it('shows the same photo archive whether or not board filters ride along', async () => {
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
    ];

    const plainAdmin = archive(rows);
    mocks.createAdminClient.mockReturnValue(plainAdmin.client);
    const plain = renderToStaticMarkup(await HandsPage());

    const carriedAdmin = archive(rows);
    mocks.createAdminClient.mockReturnValue(carriedAdmin.client);
    const carried = renderToStaticMarkup(await HandsPage({
      // Filters that would exclude both photographed wins if the gallery ever honoured them.
      searchParams: Promise.resolve({ year: '2025', hand: ['h7', 'h8'] }),
    }));

    // The query IS the gallery's definition of what it shows: same columns, same photo filter,
    // same order, same depth, and the same paths signed.
    expect(carriedAdmin.select.mock.calls).toEqual(plainAdmin.select.mock.calls);
    expect(carriedAdmin.not.mock.calls).toEqual(plainAdmin.not.mock.calls);
    expect(carriedAdmin.order.mock.calls).toEqual(plainAdmin.order.mock.calls);
    expect(carriedAdmin.limit.mock.calls).toEqual(plainAdmin.limit.mock.calls);
    expect(carriedAdmin.createSignedUrls.mock.calls).toEqual(plainAdmin.createSignedUrls.mock.calls);

    // And the archive itself is byte-identical. Everything after the header is the gallery; the
    // back link inside the header is the one thing this return state is allowed to change.
    const gallery = (html: string) => html.slice(html.indexOf('</header>'));
    expect(gallery(carried)).toBe(gallery(plain));
    // Proves the comparison is not vacuous: the two renders DO differ, and only in the header.
    expect(carried).not.toBe(plain);
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
