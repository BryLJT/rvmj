import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createServerSupabase: vi.fn(),
  createAdminClient: vi.fn(),
  redirect: vi.fn(),
  sendAlert: vi.fn(),
}));

vi.mock('../../src/lib/supabase/server', () => ({
  createServerSupabase: mocks.createServerSupabase,
}));
vi.mock('../../src/lib/supabase/admin', () => ({
  createAdminClient: mocks.createAdminClient,
}));
vi.mock('../../src/lib/telegram', () => ({ sendAlert: mocks.sendAlert }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));

import { endAbandonedGame } from '../../src/lib/actions/game';

const GAME_ID = '11111111-1111-1111-1111-111111111111';
const TABLE_ID = '22222222-2222-2222-2222-222222222222';
const USER_ID = '33333333-3333-3333-3333-333333333333';
const STALE_TIMESTAMP = '2020-01-02T03:04:05.678Z';

type RpcResult = { data: boolean | string | null; error: { message: string } | null };

function queryReturning(result: { data: unknown; error: unknown }) {
  const query: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of ['select', 'eq', 'in', 'order', 'limit']) {
    query[method] = vi.fn(() => query);
  }
  query.single = vi.fn(async () => result);
  query.maybeSingle = vi.fn(async () => result);
  return query;
}

function arrange(mode: 'chips' | 'app', rpcResult: RpcResult) {
  const tagSeat = { table_id: TABLE_ID, seat: 'E' };
  const game = {
    id: GAME_ID,
    status: 'active',
    mode,
    created_at: '2020-01-01T00:00:00.000Z',
    last_activity_at: STALE_TIMESTAMP,
    game_players: [{ player_id: USER_ID, seat: 'E' }],
  };
  const rpc = vi.fn(async () => rpcResult);
  const admin = {
    from: vi.fn((table: string) => queryReturning(
      table === 'table_seats'
        ? { data: tagSeat, error: null }
        : { data: game, error: null },
    )),
    rpc,
  };

  mocks.createServerSupabase.mockResolvedValue({
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: USER_ID } } })) },
  });
  mocks.createAdminClient.mockReturnValue(admin);
  mocks.redirect.mockImplementation(() => { throw new Error('NEXT_REDIRECT'); });

  return { rpc };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.sendAlert.mockResolvedValue(undefined);
});

describe('endAbandonedGame', () => {
  it('sends the exact observed timestamp when expiring an abandoned chip game', async () => {
    const { rpc } = arrange('chips', { data: true, error: null });

    await expect(endAbandonedGame('east-secret')).rejects.toThrow('NEXT_REDIRECT');

    expect(rpc).toHaveBeenCalledWith('expire_abandoned_game', {
      p_game_id: GAME_ID,
      p_expected_last_activity_at: STALE_TIMESTAMP,
    });
    expect(mocks.redirect).toHaveBeenCalledWith('/t/east-secret');
  });

  it('sends the exact observed timestamp when ending an abandoned app game', async () => {
    const { rpc } = arrange('app', { data: 'ended', error: null });

    await expect(endAbandonedGame('east-secret')).rejects.toThrow('NEXT_REDIRECT');

    expect(rpc).toHaveBeenCalledWith('end_abandoned_game', {
      p_game_id: GAME_ID,
      p_expected_last_activity_at: STALE_TIMESTAMP,
    });
  });

  it.each([
    ['chips' as const, false],
    ['app' as const, 'changed'],
  ])('treats a resumed %s game as a harmless lost race', async (mode, data) => {
    const { rpc } = arrange(mode, { data, error: null });

    await expect(endAbandonedGame('east-secret')).rejects.toThrow('NEXT_REDIRECT');

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(mocks.sendAlert).not.toHaveBeenCalled();
    expect(mocks.redirect).toHaveBeenCalledWith('/t/east-secret');
  });

  it('alerts once when an unchanged app game is quarantined', async () => {
    arrange('app', { data: 'quarantined', error: null });

    await expect(endAbandonedGame('east-secret')).rejects.toThrow('NEXT_REDIRECT');

    expect(mocks.sendAlert).toHaveBeenCalledTimes(1);
    expect(mocks.sendAlert.mock.calls[0]?.[0]).toContain(GAME_ID);
    expect(mocks.redirect).toHaveBeenCalledWith('/t/east-secret');
  });

  it('surfaces a genuine database failure and does not continue to replacement creation', async () => {
    const { rpc } = arrange('chips', { data: null, error: { message: 'database unavailable' } });

    await expect(endAbandonedGame('east-secret')).rejects.toThrow(
      'could not clear the abandoned game: database unavailable',
    );

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});

import { logNotable } from '../../src/lib/actions/game';

const HAND_ID = '44444444-4444-4444-4444-444444444444';
const OTHER_ID = '55555555-5555-5555-5555-555555555555';

/** A minimal valid WebP header: "RIFF" then four size bytes then "WEBP". */
function webpBytes(payload = 32): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(12 + payload);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0);        // RIFF
  bytes.set([0x57, 0x45, 0x42, 0x50], 8);        // WEBP
  return bytes;
}

/** Declared so `upload.mock.calls` is a typed tuple — the assertions read its arguments back. */
type UploadCall = (
  path: string,
  bytes: Uint8Array,
  options: { contentType: string },
) => Promise<{ data: { path: string }; error: null }>;

function arrangeNotable({ participant = true, rpcError = null as { message: string } | null } = {}) {
  const upload = vi.fn<UploadCall>(async () => ({ data: { path: 'p' }, error: null }));
  const remove = vi.fn(async () => ({ data: null, error: null }));
  const rpc = vi.fn(async () => ({ data: 'claim-id', error: rpcError }));
  const admin = {
    from: vi.fn(() => queryReturning({ data: participant ? { seat: 'E' } : null, error: null })),
    rpc,
    storage: { from: vi.fn(() => ({ upload, remove })) },
  };
  mocks.createServerSupabase.mockResolvedValue({
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: USER_ID } } })) },
  });
  mocks.createAdminClient.mockReturnValue(admin);
  return { upload, remove, rpc };
}

describe('logNotable photo leg', () => {
  it('records a claim with a null path when no photo is supplied', async () => {
    const { upload, rpc } = arrangeNotable();

    expect(await logNotable(GAME_ID, OTHER_ID, HAND_ID)).toEqual({});

    expect(upload).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith('log_notable_claim', expect.objectContaining({ p_photo_path: null }));
  });

  it('uploads the photo and passes its path to the claim', async () => {
    const { upload, rpc } = arrangeNotable();

    expect(await logNotable(GAME_ID, OTHER_ID, HAND_ID, new Blob([webpBytes()]))).toEqual({});

    expect(upload).toHaveBeenCalledTimes(1);
    const [path, , options] = upload.mock.calls[0];
    expect(path).toMatch(new RegExp(`^${GAME_ID}/[0-9a-f-]{36}\\.webp$`));
    expect(options).toMatchObject({ contentType: 'image/webp' });
    expect(rpc).toHaveBeenCalledWith('log_notable_claim', expect.objectContaining({ p_photo_path: path }));
  });

  it('rejects a non-participant BEFORE any storage write', async () => {
    const { upload } = arrangeNotable({ participant: false });

    const result = await logNotable(GAME_ID, OTHER_ID, HAND_ID, new Blob([webpBytes()]));

    expect(result.error).toBe('you are not in this game');
    expect(upload).not.toHaveBeenCalled();
  });

  it('rejects an oversized photo BEFORE any storage write', async () => {
    const { upload } = arrangeNotable();

    const result = await logNotable(GAME_ID, OTHER_ID, HAND_ID, new Blob([new Uint8Array(2 * 1024 * 1024 + 1)]));

    expect(result.photoFailed).toBe(true);
    expect(upload).not.toHaveBeenCalled();
  });

  // The declared type is what the network SAYS. The bytes are what it IS.
  it('rejects bytes that are not WebP even when the blob claims to be', async () => {
    const { upload } = arrangeNotable();
    const notWebp = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0])], { type: 'image/webp' });

    const result = await logNotable(GAME_ID, OTHER_ID, HAND_ID, notWebp);

    expect(result.photoFailed).toBe(true);
    expect(upload).not.toHaveBeenCalled();
  });

  it('deletes the uploaded object when recording the claim fails', async () => {
    const { upload, remove } = arrangeNotable({ rpcError: { message: 'game is not an active chip game' } });

    const result = await logNotable(GAME_ID, OTHER_ID, HAND_ID, new Blob([webpBytes()]));

    expect(result.error).toBe('game is not an active chip game');
    expect(remove).toHaveBeenCalledWith([upload.mock.calls[0][0]]);
  });

  // A failed CLAIM is not a failed PHOTO. Offering "log it without the photo" here would just
  // fail again the same way, so the escape must stay hidden.
  it('does not flag photoFailed when the claim itself was rejected', async () => {
    const { remove } = arrangeNotable({ rpcError: { message: 'logger is not in this game' } });

    const result = await logNotable(GAME_ID, OTHER_ID, HAND_ID, new Blob([webpBytes()]));

    expect(result.photoFailed).toBeUndefined();
    expect(remove).toHaveBeenCalled();
  });
});

import { removeNotablePhoto } from '../../src/lib/actions/game';

const CLAIM_ID = '66666666-6666-6666-6666-666666666666';

function arrangeRemove(rpcResult: { data: string | null; error: { message: string } | null }) {
  const remove = vi.fn(async () => ({ data: null, error: null }));
  const rpc = vi.fn(async () => rpcResult);
  mocks.createServerSupabase.mockResolvedValue({
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: USER_ID } } })) },
  });
  mocks.createAdminClient.mockReturnValue({ rpc, storage: { from: vi.fn(() => ({ remove })) } });
  return { remove, rpc };
}

describe('removeNotablePhoto', () => {
  it('clears the claim then deletes the freed object', async () => {
    const { remove, rpc } = arrangeRemove({ data: 'game-1/abc.webp', error: null });

    expect(await removeNotablePhoto(CLAIM_ID)).toEqual({});

    expect(rpc).toHaveBeenCalledWith('clear_notable_photo', { p_claim_id: CLAIM_ID, p_actor: USER_ID });
    expect(remove).toHaveBeenCalledWith(['game-1/abc.webp']);
  });

  // The database owns this refusal, so the action only has to surface it.
  it('refuses a caller who did not log the claim, and touches no storage', async () => {
    const { remove } = arrangeRemove({ data: null, error: { message: 'not your claim' } });

    expect(await removeNotablePhoto(CLAIM_ID)).toEqual({ error: 'not your claim' });
    expect(remove).not.toHaveBeenCalled();
  });

  it('succeeds without touching storage when the claim had no photo', async () => {
    const { remove } = arrangeRemove({ data: null, error: null });

    expect(await removeNotablePhoto(CLAIM_ID)).toEqual({});
    expect(remove).not.toHaveBeenCalled();
  });
});

import { signNotablePhotos } from '../../src/lib/actions/game';

function arrangeSigning({ participant = true, rows = [] as { id: string; photo_path: string }[] } = {}) {
  const createSignedUrls = vi.fn(async (paths: string[]) => ({
    data: paths.map((p) => ({ path: p, signedUrl: `https://signed.example/${p}?token=t`, error: null })),
    error: null,
  }));
  const claimQuery = {
    select: vi.fn(() => claimQuery),
    eq: vi.fn(() => claimQuery),
    not: vi.fn(async () => ({ data: rows, error: null })),
  };
  mocks.createServerSupabase.mockResolvedValue({
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: USER_ID } } })) },
  });
  mocks.createAdminClient.mockReturnValue({
    from: vi.fn((table: string) => (table === 'notable_claims'
      ? claimQuery
      : queryReturning({ data: participant ? { seat: 'E' } : null, error: null }))),
    storage: { from: vi.fn(() => ({ createSignedUrls })) },
  });
  return { createSignedUrls };
}

describe('signNotablePhotos', () => {
  it('maps each claim id to a signed URL', async () => {
    arrangeSigning({ rows: [{ id: 'c1', photo_path: 'g1/a.webp' }, { id: 'c2', photo_path: 'g1/b.webp' }] });

    const { urls } = await signNotablePhotos(GAME_ID);

    expect(urls).toEqual({
      c1: 'https://signed.example/g1/a.webp?token=t',
      c2: 'https://signed.example/g1/b.webp?token=t',
    });
  });

  it('signs nothing when no claim has a photo', async () => {
    const { createSignedUrls } = arrangeSigning({ rows: [] });

    expect(await signNotablePhotos(GAME_ID)).toEqual({ urls: {} });
    expect(createSignedUrls).not.toHaveBeenCalled();
  });

  it('refuses a caller who is not in the game', async () => {
    const { createSignedUrls } = arrangeSigning({ participant: false });

    const result = await signNotablePhotos(GAME_ID);

    expect(result.error).toBe('you are not in this game');
    expect(createSignedUrls).not.toHaveBeenCalled();
  });
});
