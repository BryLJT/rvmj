import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A Server Component is an async function, so it can simply be called. The only fidelity that
 * matters is that `redirect()` and `notFound()` THROW the way the real ones do — a mock that
 * merely returned would let the page run on past its guard and read the claim anyway.
 */
const mocks = vi.hoisted(() => ({
  createServerSupabase: vi.fn(),
  createAdminClient: vi.fn(),
  redirect: vi.fn(),
  notFound: vi.fn(),
}));

vi.mock('../../src/lib/supabase/server', () => ({ createServerSupabase: mocks.createServerSupabase }));
vi.mock('../../src/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock('../../src/lib/telegram', () => ({ sendAlert: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect, notFound: mocks.notFound }));

import WinPage from '../../src/app/hands/[claimId]/page';

const USER_ID = '33333333-3333-3333-3333-333333333333';
const CLAIM_ID = '3f1a5e0c-0d7b-4a2e-9f1b-7c2d8e4a6b90';

const claimRow = (over: Record<string, unknown> = {}) => ({
  id: CLAIM_ID,
  created_at: '2026-08-27T17:30:00Z',
  photo_path: null,
  players: { display_name: 'Ah Seng', house: 'orcaella' },
  notable_claim_types: [
    { notable_hands: { id: 'h8', name: 'Pure Suit', local_name: '清一色', rarity: 'rare' } },
  ],
  ...over,
});

/** `.select().eq().maybeSingle()` — the claim read, awaited at its last link. */
function claim(row: unknown, signedUrl?: string | null) {
  const query: Record<string, unknown> = {};
  query.select = vi.fn(() => query);
  query.eq = vi.fn(() => query);
  query.maybeSingle = vi.fn(async () => ({ data: row, error: null }));
  const createSignedUrl = vi.fn(async () => ({
    data: signedUrl ? { signedUrl } : null,
    error: signedUrl ? null : { message: 'nope' },
  }));
  return {
    client: {
      from: vi.fn(() => query),
      storage: { from: vi.fn(() => ({ createSignedUrl })) },
    },
    query,
    createSignedUrl,
  };
}

const signedInAs = (user: { id: string } | null) => {
  mocks.createServerSupabase.mockResolvedValue({
    auth: { getUser: vi.fn(async () => ({ data: { user } })) },
  });
};

const render = (props: {
  params: Promise<{ claimId: string }>;
  searchParams?: Promise<Record<string, string | string[]>>;
}) => WinPage(props).then(renderToStaticMarkup);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.redirect.mockImplementation(() => { throw new Error('NEXT_REDIRECT'); });
  mocks.notFound.mockImplementation(() => { throw new Error('NEXT_NOT_FOUND'); });
  signedInAs({ id: USER_ID });
  mocks.createAdminClient.mockReturnValue(claim(claimRow()).client);
});

describe('/hands/[claimId] access', () => {
  it('redirects a signed-out visitor to login and reads no claim on the way', async () => {
    signedInAs(null);
    const read = claim(claimRow());
    mocks.createAdminClient.mockReturnValue(read.client);

    await expect(render({ params: Promise.resolve({ claimId: CLAIM_ID }) })).rejects.toThrow('NEXT_REDIRECT');

    expect(mocks.redirect).toHaveBeenCalledWith(`/login?next=%2Fhands%2F${CLAIM_ID}`);
    expect(read.query.maybeSingle).not.toHaveBeenCalled();
  });

  /** Without this the login wall eats the board state and returns the player to a reset board. */
  it('carries the year and hand filters through the login wall', async () => {
    signedInAs(null);

    await expect(render({
      params: Promise.resolve({ claimId: CLAIM_ID }),
      searchParams: Promise.resolve({ year: '2026', hand: ['b', 'a'] }),
    })).rejects.toThrow('NEXT_REDIRECT');

    expect(mocks.redirect).toHaveBeenCalledWith(
      `/login?next=${encodeURIComponent(`/hands/${CLAIM_ID}?year=2026&hand=a&hand=b`)}`,
    );
  });

  /** Postgres answers a malformed uuid with an error, so the shape is checked before the read. */
  it('renders not-found for a malformed id without querying', async () => {
    const read = claim(claimRow());
    mocks.createAdminClient.mockReturnValue(read.client);

    await expect(render({ params: Promise.resolve({ claimId: 'nope' }) })).rejects.toThrow('NEXT_NOT_FOUND');
    expect(read.query.maybeSingle).not.toHaveBeenCalled();
  });

  it('renders not-found for a well-formed id that matches no win', async () => {
    mocks.createAdminClient.mockReturnValue(claim(null).client);

    await expect(render({ params: Promise.resolve({ claimId: CLAIM_ID }) })).rejects.toThrow('NEXT_NOT_FOUND');
  });
});

describe('/hands/[claimId] content', () => {
  it('shows the winner, the Singapore date and every label with its local name', async () => {
    const html = await render({ params: Promise.resolve({ claimId: CLAIM_ID }) });

    expect(html).toContain('Ah Seng');
    expect(html).toContain('28 Aug 2026');
    expect(html).toContain('Pure Suit');
    expect(html).toContain('清一色');
  });

  it('returns the player to the exact board they left', async () => {
    const html = await render({
      params: Promise.resolve({ claimId: CLAIM_ID }),
      searchParams: Promise.resolve({ year: '2026', hand: ['b', 'a'] }),
    });

    expect(html).toContain('href="/?board=skill&amp;year=2026&amp;hand=a&amp;hand=b"');
  });

  /** A bare address — typed, bookmarked, or reached from anywhere that is not the board. */
  it('still renders with no return state, with a plain back link', async () => {
    const html = await render({ params: Promise.resolve({ claimId: CLAIM_ID }) });

    expect(html).toContain('href="/?board=skill"');
  });

  it('shows the photo when the link signs', async () => {
    mocks.createAdminClient.mockReturnValue(
      claim(claimRow({ photo_path: 'g1/a.webp' }), 'https://signed.example/a.webp').client,
    );

    const html = await render({ params: Promise.resolve({ claimId: CLAIM_ID }) });

    expect(html).toContain('https://signed.example/a.webp');
  });

  /**
   * The rule that matters most here. A photo that failed to sign must never be reported as a win
   * nobody photographed.
   */
  it('reports a failed photo rather than saying none was taken', async () => {
    mocks.createAdminClient.mockReturnValue(claim(claimRow({ photo_path: 'g1/a.webp' }), null).client);

    const html = await render({ params: Promise.resolve({ claimId: CLAIM_ID }) });

    expect(html).toContain('couldn’t be loaded');
    expect(html).not.toContain('No photo was taken');
  });

  it('says no photo was taken when the win has none', async () => {
    const html = await render({ params: Promise.resolve({ claimId: CLAIM_ID }) });

    expect(html).toContain('No photo was taken');
  });

  /** A win is never rendered a label short. */
  it('reports a failure when the labels cannot be read', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.createAdminClient.mockReturnValue(
      claim(claimRow({ notable_claim_types: [{ notable_hands: { id: 'h1', name: 'Broken' } }] })).client,
    );

    const html = await render({ params: Promise.resolve({ claimId: CLAIM_ID }) });

    expect(html).toContain('Couldn’t load this win');
    expect(html).not.toContain('Broken');
    consoleError.mockRestore();
  });
});
