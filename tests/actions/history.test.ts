import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ server: vi.fn(), admin: vi.fn() }));
vi.mock('../../src/lib/supabase/server', () => ({ createServerSupabase: mocks.server }));
vi.mock('../../src/lib/supabase/admin', () => ({ createAdminClient: mocks.admin }));
import { getGameHistory, getHistoricalGame, saveHistoricalNotable } from '../../src/lib/actions/history';
const USER = '10000000-0000-0000-0000-000000000001';
const GAME = '20000000-0000-0000-0000-000000000001';
const CLAIM = '30000000-0000-0000-0000-000000000001';
const HAND = '40000000-0000-0000-0000-000000000001';
const row = (i = 1) => ({ id: `20000000-0000-0000-0000-${String(i).padStart(12, '0')}`, mode: 'chips', variant: 'regular', ended_at: '2026-11-17T15:42:00+00:00', players: [{ player_id: USER, seat: 'E', display_name: 'Bryan', final_total: null }] });
let rpc: ReturnType<typeof vi.fn>;
beforeEach(() => { vi.clearAllMocks(); mocks.server.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: USER } } }) } }); rpc = vi.fn(); mocks.admin.mockReturnValue({ rpc }); });
describe('personal history boundary', () => {
  it('authenticates before any service-role read', async () => { mocks.server.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: null } }) } }); expect(await getGameHistory()).toEqual({ status: 'expired' }); expect(mocks.admin).not.toHaveBeenCalled(); });
  it('reads only a fixed bounded page for the session viewer and preserves null scores', async () => { rpc.mockResolvedValue({ data: Array.from({ length: 21 }, (_, i) => row(i + 1)), error: null }); const result = await getGameHistory(); expect(result.status).toBe('ready'); if (result.status !== 'ready')
    return; expect(result.games).toHaveLength(20); expect(result.games[0].players[0].finalTotal).toBeNull(); expect(result.nextCursor).toBeTruthy(); expect(rpc).toHaveBeenCalledWith('personal_game_history', { p_viewer: USER, p_before_time: null, p_before_id: null }); });
  it('validates pagination before querying and never interprets a cursor as SQL', async () => { expect(await getGameHistory('x),status.eq.active')).toEqual({ status: 'error' }); expect(rpc).not.toHaveBeenCalled(); });
  it('carries exact end time and id through a page cursor', async () => { rpc.mockResolvedValueOnce({ data: Array.from({ length: 21 }, (_, i) => row(i + 1)), error: null }).mockResolvedValueOnce({ data: [], error: null }); const first = await getGameHistory(); if (first.status !== 'ready')
    throw Error('page failed'); await getGameHistory(first.nextCursor!); expect(rpc).toHaveBeenLastCalledWith('personal_game_history', { p_viewer: USER, p_before_time: '2026-11-17T15:42:00+00:00', p_before_id: '20000000-0000-0000-0000-000000000020' }); });
  it('reports read failure separately from empty history', async () => { rpc.mockResolvedValue({ data: null, error: { message: 'network' } }); expect(await getGameHistory()).toEqual({ status: 'error' }); rpc.mockResolvedValue({ data: [], error: null }); expect(await getGameHistory()).toEqual({ status: 'ready', games: [], nextCursor: null }); });
  it('fails the page if a game cannot be parsed instead of dropping it', async () => { rpc.mockResolvedValue({ data: [{ ...row(), variant: 'unknown' }], error: null }); expect(await getGameHistory()).toEqual({ status: 'error' }); });
  it('does not read game details for an invalid id', async () => { expect(await getHistoricalGame('../other')).toEqual({ status: 'absent' }); expect(mocks.admin).not.toHaveBeenCalled(); });
});
describe('stable historical save', () => {
  const input = { requestId: CLAIM, gameId: GAME, winnerId: USER, handIds: [HAND] };
  it('derives the logger from the session and confirms the returned claim', async () => { rpc.mockResolvedValue({ data: [{ claim_id: CLAIM, photo_complete: true, upload_path: null }], error: null }); expect(await saveHistoricalNotable(input)).toEqual({ status: 'saved', claimId: CLAIM }); expect(rpc).toHaveBeenCalledWith('save_historical_notable', { p_claim_id: CLAIM, p_game_id: GAME, p_player_id: USER, p_actor: USER, p_hand_ids: [HAND], p_photo_digest: null, p_photo_extension: null }); });
  it('does not report success for an empty or wrong save response', async () => { rpc.mockResolvedValue({ data: [], error: null }); expect((await saveHistoricalNotable(input)).status).toBe('error'); });
  it('refuses malformed labels as a whole before writes', async () => { expect((await saveHistoricalNotable({ ...input, handIds: [HAND, 'bad'] })).status).toBe('error'); expect(rpc).not.toHaveBeenCalled(); });
  it('does not upload any bytes if the database refuses the claim', async () => { rpc.mockResolvedValue({ data: null, error: { message: 'game is not ended' } }); const upload = vi.fn(); mocks.admin.mockReturnValue({ rpc, storage: { from: () => ({ upload }) } }); const photo = new Blob([new Uint8Array([255, 216, 255, 0])], { type: 'image/jpeg' }); expect((await saveHistoricalNotable({ ...input, photo })).status).toBe('error'); expect(upload).not.toHaveBeenCalled(); });
  it('accepts an already completed same-save retry without another upload', async () => { rpc.mockResolvedValue({ data: [{ claim_id: CLAIM, photo_complete: true, upload_path: 'saved.jpg' }], error: null }); const upload = vi.fn(); mocks.admin.mockReturnValue({ rpc, storage: { from: () => ({ upload }) } }); const photo = new Blob([new Uint8Array([255, 216, 255, 0])], { type: 'image/jpeg' }); expect((await saveHistoricalNotable({ ...input, photo })).status).toBe('saved'); expect(upload).not.toHaveBeenCalled(); });
});
describe('historical photo delivery', () => {
  const photo = new Blob([new Uint8Array([255, 216, 255, 0])], { type: 'image/jpeg' });
  const input = { requestId: CLAIM, gameId: GAME, winnerId: USER, handIds: [HAND], photo };
  const path = `${GAME}/${CLAIM}-history.jpg`;
  function storage(uploadResult: unknown = { error: null }) { const upload = vi.fn<(path: string, bytes: Uint8Array, options: unknown) => Promise<unknown>>(async () => uploadResult), remove = vi.fn(async () => ({ error: null })); mocks.admin.mockReturnValue({ rpc, storage: { from: () => ({ upload, remove }) } }); return { upload, remove }; }
  it('uploads only to its stable reserved object and confirms the photo before success', async () => {
    rpc.mockResolvedValueOnce({ data: [{ claim_id: CLAIM, photo_complete: false, upload_path: path }], error: null }).mockResolvedValueOnce({ data: path, error: null });
    const bucket = storage();
    expect(await saveHistoricalNotable(input)).toEqual({ status: 'saved', claimId: CLAIM });
    expect(bucket.upload.mock.calls[0][0]).toBe(path);
    expect(bucket.upload.mock.calls[0][2]).toEqual({ contentType: 'image/jpeg', upsert: false });
    expect(bucket.remove).not.toHaveBeenCalled();
  });
  it('continues an upload replay when the same immutable object already exists', async () => {
    rpc.mockResolvedValueOnce({ data: [{ claim_id: CLAIM, photo_complete: false, upload_path: path }], error: null }).mockResolvedValueOnce({ data: path, error: null });
    storage({ error: { statusCode: '409' } });
    expect((await saveHistoricalNotable(input)).status).toBe('saved');
  });
  it('keeps possibly referenced bytes after a lost attachment response', async () => {
    rpc.mockResolvedValueOnce({ data: [{ claim_id: CLAIM, photo_complete: false, upload_path: path }], error: null }).mockRejectedValueOnce(Error('lost response'));
    const bucket = storage();
    expect((await saveHistoricalNotable(input)).status).toBe('error');
    expect(bucket.remove).not.toHaveBeenCalled();
  });
  it('removes only the rejected upload when another photo won the claim lock', async () => {
    rpc.mockResolvedValueOnce({ data: [{ claim_id: CLAIM, photo_complete: false, upload_path: path }], error: null }).mockResolvedValueOnce({ data: 'other-photo.webp', error: null });
    const bucket = storage();
    expect((await saveHistoricalNotable(input)).status).toBe('error');
    expect(bucket.remove).toHaveBeenCalledWith([path]);
  });
});
describe('detail access', () => {
  it('authenticates before membership lookup', async () => { mocks.server.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: null } }) } }); expect(await getHistoricalGame(GAME)).toEqual({ status: 'expired' }); expect(mocks.admin).not.toHaveBeenCalled(); });
  it('does not read another game when membership is absent', async () => { const query = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn(async () => ({ data: null, error: null })) }; query.select.mockReturnValue(query); query.eq.mockReturnValue(query); const from = vi.fn(() => query); mocks.admin.mockReturnValue({ from }); expect(await getHistoricalGame(GAME)).toEqual({ status: 'absent' }); expect(from.mock.calls).toEqual([['game_players']]); expect(query.eq).toHaveBeenCalledWith('player_id', USER); });
  it('keeps membership query errors distinct from inaccessible games', async () => { const query = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn(async () => ({ data: null, error: { message: 'network' } })) }; query.select.mockReturnValue(query); query.eq.mockReturnValue(query); mocks.admin.mockReturnValue({ from: () => query }); expect(await getHistoricalGame(GAME)).toEqual({ status: 'error' }); });
});
