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

/**
 * `.select().not()[.in()][.gte().lt()].order().limit()` — the archive query, awaited at its last
 * link — plus the separate `notable_claim_types` read that resolves which claims carry a selected
 * hand type. They are different objects, so `in` can chain on one and be the awaited last link on
 * the other.
 */
function archive(rows: unknown[] = [], signed?: SignedUrl[], options: {
  matches?: { claim_id: string }[];
  matchError?: { message: string } | null;
} = {}) {
  const query: Record<string, unknown> = {};
  const select = vi.fn(() => query);
  const not = vi.fn(() => query);
  const order = vi.fn(() => query);
  const limit = vi.fn(async () => ({ data: rows, error: null }));
  const inIds = vi.fn(() => query);
  const gte = vi.fn(() => query);
  const lt = vi.fn(() => query);
  query.select = select;
  query.not = not;
  query.order = order;
  query.limit = limit;
  query.in = inIds;
  query.gte = gte;
  query.lt = lt;

  const match: Record<string, unknown> = {};
  const matchSelect = vi.fn(() => match);
  const matchIn = vi.fn(async () => ({
    data: options.matches ?? [],
    error: options.matchError ?? null,
  }));
  match.select = matchSelect;
  match.in = matchIn;
  const signedData = signed ?? rows.map((row) => {
    const path = (row as { photo_path: string }).photo_path;
    return { path, signedUrl: `https://signed.example/${path}` };
  });
  const createSignedUrls = vi.fn(async (paths: string[], ttl: number) => ({ data: signedData, paths, ttl }));
  return {
    client: {
      from: vi.fn((table: string) => (table === 'notable_claim_types' ? match : query)),
      storage: { from: vi.fn(() => ({ createSignedUrls })) },
    },
    select,
    not,
    order,
    limit,
    in: inIds,
    gte,
    lt,
    matchSelect,
    matchIn,
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
   * An unusable year is dropped rather than guessed at, so the board applies its own default
   * period. Same fail-soft posture the homepage takes for the same parameter.
   *
   * AMENDED 2026-08-29. The hand filter now survives it. The year and the hand types are read
   * independently, and since the archive itself is filtered by hand, dropping the hands from the
   * back link would return the player to a board that disagreed with the archive they were just
   * looking at. Only the part that could not be read is discarded.
   */
  it('drops an unusable year from the back link but keeps the hand filter', async () => {
    signedInAs({ id: USER_ID });

    const html = renderToStaticMarkup(await HandsPage({
      searchParams: Promise.resolve({ year: 'not-a-year', hand: 'h7' }),
    }));

    expect(html).toContain('href="/?board=skill&amp;hand=h7"');
    expect(html).not.toContain('year=');
  });

  /**
   * INVERTED 2026-08-29. This assertion used to stop `hand` from becoming a gallery filter; Bryan
   * has since decided it should be one, so it now guards the escape instead: with filtering
   * switched off, the archive is byte-for-byte the one this page always showed — same columns,
   * same photo filter, same order, same depth, same signed paths, and no filter links at all.
   *
   * That is what makes "Show every photographed hand" a way BACK to the original archive rather
   * than a third, subtly different view of it.
   */
  it('shows the original photo archive when filtering is switched off', async () => {
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
      // Filters that WOULD exclude both photographed wins, switched off by the escape parameter.
      searchParams: Promise.resolve({ year: '2025', hand: ['h7', 'h8'], all: '1' }),
    }));

    // The query IS the gallery's definition of what it shows: same columns, same photo filter,
    // same order, same depth, and the same paths signed.
    expect(carriedAdmin.select.mock.calls).toEqual(plainAdmin.select.mock.calls);
    expect(carriedAdmin.not.mock.calls).toEqual(plainAdmin.not.mock.calls);
    expect(carriedAdmin.order.mock.calls).toEqual(plainAdmin.order.mock.calls);
    expect(carriedAdmin.limit.mock.calls).toEqual(plainAdmin.limit.mock.calls);
    expect(carriedAdmin.createSignedUrls.mock.calls).toEqual(plainAdmin.createSignedUrls.mock.calls);

    // And the photo grid itself is byte-identical. The slice starts at the grid rather than after
    // the header, because the escaped view legitimately adds a notice between the two saying what
    // it is showing and offering the way back to the filter.
    const gallery = (html: string) => html.slice(html.indexOf('<section'));
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

describe('/hands honours the board filter', () => {
  beforeEach(() => signedInAs({ id: USER_ID }));

  const photoRow = (over: Record<string, unknown> = {}) => ({
    id: 'c1',
    created_at: '2026-08-27T17:30:00Z',
    photo_path: 'g1/a.webp',
    logged_by: USER_ID,
    players: { display_name: 'Ah Seng' },
    notable_claim_types: [{ notable_hands: { name: 'Pure Suit' } }],
    ...over,
  });

  const view = (params: Record<string, string | string[]>) =>
    HandsPage({ searchParams: Promise.resolve(params) }).then(renderToStaticMarkup);

  it('lists only photographed wins carrying a selected hand type', async () => {
    const admin = archive([photoRow()], undefined, {
      matches: [{ claim_id: 'c1' }, { claim_id: 'c1' }],
    });
    mocks.createAdminClient.mockReturnValue(admin.client);

    await view({ year: 'all', hand: ['h8'] });

    expect(admin.matchSelect).toHaveBeenCalledWith('claim_id');
    expect(admin.matchIn).toHaveBeenCalledWith('notable_hand_id', ['h8']);
    // Deduplicated: one claim carrying two selected labels is one claim, not two.
    expect(admin.in).toHaveBeenCalledWith('id', ['c1']);
  });

  /**
   * The board and the gallery describe different populations — the board ranks every win, the
   * gallery holds only photographed ones. A filter matching wins nobody photographed is an honest
   * empty answer, and must not read as a fault.
   */
  it('renders the filtered-empty message without running the archive query', async () => {
    const admin = archive([], undefined, { matches: [] });
    mocks.createAdminClient.mockReturnValue(admin.client);

    const html = await view({ year: 'all', hand: ['h8'] });

    expect(admin.limit).not.toHaveBeenCalled();
    expect(html).toContain('No photos of these hand types yet');
    expect(html).not.toContain('No photographed hands yet');
  });

  /** A failed filter read is a FAILURE, never an empty result. */
  it('reports a failed filter read rather than an empty archive', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.createAdminClient.mockReturnValue(
      archive([], undefined, { matches: [], matchError: { message: 'boom' } }).client,
    );

    const html = await view({ year: 'all', hand: ['h8'] });

    expect(html).toContain('Couldn’t load the archive');
    expect(html).not.toContain('No photos of these hand types yet');
    consoleError.mockRestore();
  });

  /**
   * The window opens at SINGAPORE midnight of the first Monday of August, which is 16:00 UTC the
   * day before. Anchored to UTC midnight it would swallow eight hours of the previous year — and
   * mahjong is played in exactly those hours.
   */
  it('restricts to the selected academic year using the Singapore boundary', async () => {
    const admin = archive([photoRow()]);
    mocks.createAdminClient.mockReturnValue(admin.client);

    await view({ year: '2026' });

    expect(admin.gte).toHaveBeenCalledWith('games.ended_at', '2026-08-02T16:00:00.000Z');
    expect(admin.lt).toHaveBeenCalledWith('games.ended_at', '2027-08-01T16:00:00.000Z');
  });

  it('applies no window for all time', async () => {
    const admin = archive([photoRow()]);
    mocks.createAdminClient.mockReturnValue(admin.client);

    await view({ year: 'all' });

    expect(admin.gte).not.toHaveBeenCalled();
    expect(admin.lt).not.toHaveBeenCalled();
  });

  /**
   * Clearing the gallery's own view must never clear the board being returned to — the player
   * asked to see more photos, not to lose their filter.
   */
  it('shows everything on the escape parameter while the back link keeps the filter', async () => {
    const admin = archive([photoRow()]);
    mocks.createAdminClient.mockReturnValue(admin.client);

    const html = await view({ year: '2026', hand: ['h8'], all: '1' });

    expect(admin.in).not.toHaveBeenCalled();
    expect(admin.gte).not.toHaveBeenCalled();
    expect(admin.matchIn).not.toHaveBeenCalled();
    expect(html).toContain('href="/?board=skill&amp;year=2026&amp;hand=h8"');
  });

  it('offers the escape from a filtered view and the way back from an unfiltered one', async () => {
    mocks.createAdminClient.mockReturnValue(
      archive([photoRow()], undefined, { matches: [{ claim_id: 'c1' }] }).client,
    );
    const filtered = await view({ year: '2026', hand: ['h8'] });
    expect(filtered).toContain('href="/hands?year=2026&amp;hand=h8&amp;all=1"');

    mocks.createAdminClient.mockReturnValue(archive([photoRow()]).client);
    const everything = await view({ year: '2026', hand: ['h8'], all: '1' });
    expect(everything).toContain('href="/hands?year=2026&amp;hand=h8"');
  });
});
