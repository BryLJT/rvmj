'use server';
import { createHash } from 'node:crypto';
import { createServerSupabase } from '../supabase/server';
import { createAdminClient } from '../supabase/admin';
import { isClaimId, one, parseClaimHandTypes } from '../notable-claim';
import { MAX_UPLOAD_BYTES, PHOTO_BUCKET } from '../image';
import {
  historyCursor, parseHistoryCursor, parseHistoryGame,
  type HistoryResult, type GameDetailResult, type HistoricalSave, type HistoricalSaveResult,
  type HistoricalWin,
} from '../game-history';

type StoredPlayer = {
  player_id: string;
  seat: string;
  final_total: unknown;
  players: { display_name?: unknown } | { display_name?: unknown }[] | null;
};
type SavedClaim = { claim_id?: unknown; photo_complete?: unknown; upload_path?: unknown };

async function viewer() {
  const client = await createServerSupabase();
  const { data: { user } } = await client.auth.getUser();
  return user;
}

export async function getGameHistory(cursor?: string): Promise<HistoryResult> {
  try {
    const user = await viewer();
    if (!user) return { status: 'expired' };
    const before = cursor === undefined ? null : parseHistoryCursor(cursor);
    if (cursor !== undefined && !before) return { status: 'error' };

    const { data, error } = await createAdminClient().rpc('personal_game_history', {
      p_viewer: user.id,
      p_before_time: before?.endedAt ?? null,
      p_before_id: before?.id ?? null,
    });
    if (error) console.error('[history]', error.message);
    if (error || !Array.isArray(data) || data.length > 21) return { status: 'error' };
    const games = data.map(parseHistoryGame);
    if (games.some(game => !game)) {
      console.error('[history] unreadable game row');
      return { status: 'error' };
    }
    const parsed = games.filter(game => game !== null);
    return {
      status: 'ready',
      games: parsed.slice(0, 20),
      nextCursor: parsed.length > 20 ? historyCursor(parsed[19]) : null,
    };
  } catch (cause) {
    console.error('[history]', cause);
    return { status: 'error' };
  }
}

export async function getHistoricalGame(gameId: string): Promise<GameDetailResult> {
  if (!isClaimId(gameId)) return { status: 'absent' };
  try {
    const user = await viewer();
    if (!user) return { status: 'expired' };
    const admin = createAdminClient();
    const { data: seat, error: seatError } = await admin.from('game_players')
      .select('seat').eq('game_id', gameId).eq('player_id', user.id).maybeSingle();
    if (seatError) {
      console.error('[history detail membership]', seatError.message);
      return { status: 'error' };
    }
    if (!seat) return { status: 'absent' };

    const { data, error } = await admin.from('games')
      .select('id, status, mode, variant, ended_at, game_players(player_id, seat, final_total, players(display_name))')
      .eq('id', gameId).maybeSingle();
    if (error) console.error('[history detail]', error.message);
    if (error) return { status: 'error' };
    if (!data) return { status: 'absent' };
    if (data.status === 'active' || data.status === 'forming') return { status: 'reopened', gameId };
    if (data.status !== 'ended') return { status: 'absent' };

    const players = Array.isArray(data.game_players)
      ? data.game_players.map((player: StoredPlayer) => ({
        ...player,
        display_name: one(player.players)?.display_name,
      })) : null;
    const game = parseHistoryGame({ ...data, players });
    if (!game) return { status: 'error' };

    const [claims, hands] = await Promise.all([
      admin.from('notable_claims')
        .select('id, photo_path, players!notable_claims_player_id_fkey(display_name), notable_claim_types(notable_hands(id, name, local_name, rarity))')
        .eq('game_id', gameId).order('created_at').order('id'),
      admin.from('notable_hands').select('id, name, local_name, rarity').order('name'),
    ]);
    if (claims.error) console.error('[history detail wins]', claims.error.message);
    if (hands.error) console.error('[history detail catalogue]', hands.error.message);
    let wins: HistoricalWin[] | null = null;
    if (!claims.error && Array.isArray(claims.data)) {
      const parsed = claims.data.map((row: Record<string, unknown>) => {
        const handTypes = parseClaimHandTypes(row.notable_claim_types);
        const name = one(row.players as { display_name?: unknown })?.display_name;
        if (!isClaimId(row.id) || !handTypes || typeof name !== 'string') return null;
        return {
          id: row.id,
          winnerName: name,
          handTypes,
          hasPhoto: typeof row.photo_path === 'string' && row.photo_path.length > 0,
        };
      });
      if (parsed.every(win => win !== null)) wins = parsed.filter(win => win !== null);
    }
    const catalogue = !hands.error && Array.isArray(hands.data) && hands.data.length
      ? parseClaimHandTypes(hands.data.map(hand => ({ notable_hands: hand }))) : null;
    return { status: 'ready', game, wins, catalogue };
  } catch (cause) {
    console.error('[history detail]', cause);
    return { status: 'error' };
  }
}

export async function saveHistoricalNotable(input: HistoricalSave): Promise<HistoricalSaveResult> {
  const failure = (message = 'Could not save this win. Try again.'): HistoricalSaveResult =>
    ({ status: 'error', message });
  try {
    const user = await viewer();
    if (!user) return { status: 'expired' };
    if (!input || !isClaimId(input.requestId) || !isClaimId(input.gameId) || !isClaimId(input.winnerId)
      || !Array.isArray(input.handIds) || !input.handIds.length || !input.handIds.every(isClaimId)) {
      return failure('Choose a winner and valid hand types.');
    }
    const handIds = [...new Set(input.handIds)].sort();
    let bytes: Uint8Array | undefined;
    let extension: 'webp' | 'jpg' | null = null;
    let digest: string | null = null;
    if (input.photo) {
      if (!(input.photo instanceof Blob) || !input.photo.size || input.photo.size > MAX_UPLOAD_BYTES) {
        return failure('That photo is too large or empty.');
      }
      bytes = new Uint8Array(await input.photo.arrayBuffer());
      if (bytes.length >= 12 && String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF'
        && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP') {
        extension = 'webp';
      } else if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) {
        extension = 'jpg';
      }
      if (!extension) return failure('That file is not a supported image.');
      digest = createHash('sha256').update(bytes).digest('hex');
    }

    const admin = createAdminClient();
    const { data, error } = await admin.rpc('save_historical_notable', {
      p_claim_id: input.requestId,
      p_game_id: input.gameId,
      p_player_id: input.winnerId,
      p_actor: user.id,
      p_hand_ids: handIds,
      p_photo_digest: digest,
      p_photo_extension: extension,
    });
    if (error) {
      console.error('[historical save]', error.message);
      return failure('Could not save this win. The game may be in progress again, or the save details changed. Retry the same save.');
    }
    const saved = one(data as SavedClaim | SavedClaim[] | null);
    if (!saved || saved.claim_id !== input.requestId || typeof saved.photo_complete !== 'boolean') {
      return failure();
    }
    if (saved.photo_complete) return { status: 'saved', claimId: input.requestId };
    if (!bytes || !extension || typeof saved.upload_path !== 'string') return failure();

    // Confirm the claim and immutable photo digest first. Never overwrite this object: all
    // concurrent/lost-response retries share this path and the same prepared bytes.
    const bucket = admin.storage.from(PHOTO_BUCKET);
    const upload = await bucket.upload(saved.upload_path, bytes, {
      contentType: extension === 'webp' ? 'image/webp' : 'image/jpeg',
      upsert: false,
    });
    if (upload.error && String(upload.error.statusCode) !== '409') {
      console.error('[historical photo upload]', upload.error.message);
      return failure('The win is recorded. Could not upload its photo. Retry this save.');
    }
    const attached = await admin.rpc('finish_historical_photo', {
      p_claim_id: input.requestId,
      p_actor: user.id,
    });
    // An ambiguous response may already have attached the object. Leave it for the stable
    // retry, which checks photo_complete before uploading anything again.
    if (attached.error) {
      console.error('[historical photo attachment]', attached.error.message);
      return failure('The win is recorded. Could not confirm its photo. Retry this save.');
    }
    if (attached.data !== saved.upload_path) {
      const cleanup = await bucket.remove([saved.upload_path]);
      if (cleanup.error) console.error('[historical photo cleanup]', cleanup.error.message);
      return failure('This win already has another photo. Open the recorded win to review it.');
    }
    return { status: 'saved', claimId: input.requestId };
  } catch (cause) {
    console.error('[historical save]', cause);
    return failure();
  }
}
