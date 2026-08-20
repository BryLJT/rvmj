'use server';
import { redirect } from 'next/navigation';
import { createServerSupabase } from '../supabase/server';
import { createAdminClient } from '../supabase/admin';
import { decideJoin, toSnapshot, OPEN_GAME_SELECT, ACTIVE_TTL_MS } from '../join';
import type { RulesConfig, Seat } from '../engine/types';
import { validateCountsTable, checkConservation, type ChipCounts } from '../chips';
import { sendAlert } from '../telegram';
import { MAX_UPLOAD_BYTES, PHOTO_BUCKET } from '../image';

/**
 * A server action receives whatever the network sends, so `blob.type` is a claim, not a fact.
 * WebP is a RIFF container: bytes 0-3 are "RIFF" and bytes 8-11 are "WEBP".
 */
function isWebp(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  return ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP';
}

async function requireUser() {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('not signed in');
  return user;
}

async function requireParticipant(gameId: string, userId: string) {
  const admin = createAdminClient();
  const { data } = await admin.from('game_players')
    .select('seat').eq('game_id', gameId).eq('player_id', userId).single();
  if (!data) throw new Error('you are not in this game');
  return { admin, seat: data.seat as 'E' | 'S' | 'W' | 'N' };
}

export async function startGame(gameId: string, mode: 'chips' | 'app', rules?: RulesConfig): Promise<{ error?: string }> {
  try {
    const user = await requireUser();
    const { admin } = await requireParticipant(gameId, user.id);
    if (mode === 'app') return { error: 'App scorekeeper mode arrives in a later release' }; // Task 19 replaces this line with rules validation
    void rules;
    const { error } = await admin.rpc('start_game', { p_game_id: gameId, p_mode: 'chips', p_rules: null });
    if (error) return { error: error.message };
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'failed to start' };
  }
}

export async function logNotable(
  gameId: string,
  playerId: string,
  notableHandId: string,
  photo?: Blob,
): Promise<{ error?: string; photoFailed?: boolean }> {
  try {
    const user = await requireUser();
    const { admin } = await requireParticipant(gameId, user.id);

    // Everything that can reject does so before the first storage write, so a caller who fails
    // validation can never leave bytes behind.
    let path: string | null = null;
    if (photo) {
      if (photo.size > MAX_UPLOAD_BYTES) {
        return { error: 'That photo is too large.', photoFailed: true };
      }
      const bytes = new Uint8Array(await photo.arrayBuffer());
      if (!isWebp(bytes)) {
        return { error: 'That file is not a supported image.', photoFailed: true };
      }
      const candidate = `${gameId}/${crypto.randomUUID()}.webp`;
      const { error: uploadError } = await admin.storage.from(PHOTO_BUCKET)
        .upload(candidate, bytes, { contentType: 'image/webp' });
      if (uploadError) {
        return { error: 'Could not upload the photo.', photoFailed: true };
      }
      path = candidate;
    }

    const { error } = await admin.rpc('log_notable_claim', {
      p_game_id: gameId,
      p_player_id: playerId,
      p_notable_hand_id: notableHandId,
      p_logged_by: user.id,
      p_photo_path: path,
    });
    if (error) {
      // No orphans from a failed claim. Note this is NOT photoFailed: the photo was fine, the
      // claim was refused, and retrying without the photo would be refused identically.
      if (path) await admin.storage.from(PHOTO_BUCKET).remove([path]);
      return { error: error.message };
    }
    return {};
  } catch (cause) {
    return { error: cause instanceof Error ? cause.message : 'failed to log' };
  }
}

export type ConservationFailure = { failedDenominations: number[]; grandTotalOff: boolean };

export async function proposeChipCounts(
  gameId: string,
  rawCounts: Record<string, Record<string, number>>,
): Promise<{ error?: string; conservation?: ConservationFailure }> {
  try {
    const user = await requireUser();
    const { admin } = await requireParticipant(gameId, user.id);
    // Trust boundary: a server action receives whatever the network sends, so the declared
    // parameter type guarantees nothing. validateCountsTable checks the SEAT MAP shape
    // (exactly E/S/W/N — a three- or five-seat map would otherwise degrade into a
    // misleading "recount the $1 chips" prompt) and every count inside it, before any arithmetic.
    let table: Record<Seat, ChipCounts>;
    try {
      table = validateCountsTable(rawCounts);
    } catch (e) {
      return { error: e instanceof Error ? e.message : 'bad counts' };
    }
    // USER-FACING recount path (spec §10): a failed check is a miscount, never an error page.
    const check = checkConservation(table);
    if (!check.ok) {
      return { conservation: { failedDenominations: [...check.failedDenominations], grandTotalOff: check.grandTotalOff } };
    }
    const { error } = await admin.rpc('propose_chip_counts', { p_game_id: gameId, p_counts: table });
    if (error) return { error: error.message };
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'failed to propose counts' };
  }
}

export async function confirmChipResult(gameId: string): Promise<{ error?: string; result?: string }> {
  try {
    const user = await requireUser();
    const { admin } = await requireParticipant(gameId, user.id);
    const { data, error } = await admin.rpc('confirm_chip_result', { p_game_id: gameId, p_player_id: user.id });
    if (error) {
      if (error.message.includes('should-never-happen')) {
        // The finalize backstop fired: conservation passed at propose time but the totals
        // did not sum to zero — a bug or tampering, exactly what the alert channel is for.
        await sendAlert(`⚠️ RVMJ chip finalize failed the zero-sum backstop\nGame: ${process.env.NEXT_PUBLIC_SITE_URL}/game/${gameId}\n${error.message}`);
      }
      return { error: error.message };
    }
    return { result: data as string };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'failed to confirm' };
  }
}

export async function reopenChipGame(gameId: string): Promise<{ error?: string }> {
  try {
    const user = await requireUser();
    const { admin } = await requireParticipant(gameId, user.id);
    const { error } = await admin.rpc('reopen_game', { p_game_id: gameId });
    if (error) {
      // One-open-game-per-table rejects a reopen when a NEW game has already been started
      // at this table. The rejection is correct; the raw constraint text is not readable by
      // a player mid-game, and this is reachable by a stray tag tap after a game ends.
      if (error.code === '23505') {
        return { error: 'A new game has already been started at this table, so this one cannot be reopened.' };
      }
      return { error: error.message };
    }
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'failed to reopen' };
  }
}

/**
 * Resume an abandoned match instead of voiding it.
 *
 * The database side that is easy to miss: the match is only "abandoned" because
 * `last_activity_at` is old, and nothing else about the row says so. Opening the match
 * screen does not touch that column, so without this update the match would STAY abandoned
 * — every teammate tapping in afterwards would be met with the void prompt for a game that
 * is being actively played. Refreshing the timestamp is what actually resumes it.
 *
 * Takes the MATCH id, not a tag secret. Both questions that decide permission — is this match
 * abandoned, and did this person sit East in it — are answered from the match's own record,
 * so nothing from the address bar is on the authorisation path at all. `backSecret` is a
 * return address and nothing else; a malformed one costs you the trip home, never more.
 */
export async function continueMatch(gameId: string, backSecret?: string): Promise<void> {
  const user = await requireUser();
  const admin = createAdminClient();

  const back = typeof backSecret === 'string' && backSecret.length > 0
    ? `/t/${encodeURIComponent(backSecret)}`
    : '/';

  const { data: game, error: readError } = await admin
    .from('games')
    .select('id, status, last_activity_at, game_players(player_id, seat)')
    .eq('id', gameId)
    .maybeSingle();
  if (readError) throw new Error(`could not read the match: ${readError.message}`);
  if (!game) throw new Error('match not found');

  const g = game as unknown as {
    status: string;
    last_activity_at: string;
    game_players?: { player_id: string; seat: string }[] | null;
  };

  // Not abandoned, or already voided by somebody else. Nothing to resume — send them home
  // rather than failing, since "someone got there first" is a normal outcome at a live table.
  const abandoned =
    g.status === 'active' && Date.now() - new Date(g.last_activity_at).getTime() > ACTIVE_TTL_MS;
  if (!abandoned) redirect(back);

  // The host of THAT match owns resuming it, remembered from the match itself rather than
  // from wherever they happen to sit tonight. Tying it to tonight's seat would make a match
  // unresumable the moment its host moved chairs — the participants would be present and
  // willing, and the only available action would be destroying their own night.
  const host = (g.game_players ?? []).find((p) => p.seat === 'E');
  if (!host || host.player_id !== user.id) {
    throw new Error('only the player who sat East in that match can continue it');
  }

  // Guarded on status. If a void commits between the read above and this write, the update
  // matches nothing instead of succeeding against a dead match and landing the player on an
  // expired game with no way back — the exact stranding the return address exists to prevent.
  const { data: updated, error } = await admin
    .from('games')
    .update({ last_activity_at: new Date().toISOString() })
    .eq('id', gameId)
    .eq('status', 'active')
    .select('id');
  if (error) throw new Error(`could not continue the match: ${error.message}`);
  if (!updated || updated.length === 0) redirect(back);

  redirect(`/game/${gameId}`);
}

/**
 * Confirm-and-clear for an abandoned game that was actually PLAYED (spec: a played game is
 * never cleared silently). Takes only the tag secret — never a game id from the form — and
 * re-decides server-side, so a POST cannot be aimed at a game that is live right now.
 *
 * It clears and nothing else, then sends the tapper back through the normal tap route, which
 * seats them by the ordinary rules. That keeps join logic in exactly one place, and makes a
 * second confirmer harmless: they arrive, find nothing stale, and simply get a seat.
 */
export async function endAbandonedGame(secret: string): Promise<void> {
  const user = await requireUser();
  const admin = createAdminClient();

  const { data: tagSeat } = await admin
    .from('table_seats').select('table_id, seat').eq('secret', secret).single();
  if (!tagSeat) throw new Error('unknown tag');

  // Voiding has ONE owner at the table: whoever taps the East sticker tonight. Enforced here
  // rather than merely hidden, because this action is callable directly.
  //
  // Tonight's East seat, NOT the old match's host, and deliberately so: if last week's host
  // has gone home the table must still be reclaimable, or an abandoned match blocks it for
  // twelve hours. Resuming is the mirror image — that belongs to the old match's host, since
  // only the people who played can judge whether it is worth carrying on.
  if (tagSeat.seat !== 'E') {
    throw new Error('only the East seat can start a new match at this table');
  }

  const { data: row, error: readError } = await admin
    .from('games')
    .select(OPEN_GAME_SELECT)
    .eq('table_id', tagSeat.table_id)
    .in('status', ['forming', 'active'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  // Never degrade a failed read into a destructive write.
  if (readError) throw new Error(`could not read open game: ${readError.message}`);

  const decision = decideJoin(toSnapshot(row), {
    playerId: user.id, seat: tagSeat.seat as Seat, now: new Date(),
  });

  if (row && decision.action === 'confirm_end_stale') {
    const observed = row as { mode?: string; last_activity_at: string };
    const params = {
      p_game_id: decision.staleGameId,
      p_expected_last_activity_at: observed.last_activity_at,
    };

    if (observed.mode === 'chips') {
      const { data, error } = await admin.rpc('expire_abandoned_game', params);
      if (error) {
        throw new Error(`could not clear the abandoned game: ${error.message}`);
      }
      if (data !== true && data !== false) {
        throw new Error(`could not clear the abandoned game: unexpected result ${String(data)}`);
      }
    } else {
      const { data, error } = await admin.rpc('end_abandoned_game', params);
      if (error) {
        throw new Error(`could not clear the abandoned game: ${error.message}`);
      }
      if (data === 'quarantined') {
        await sendAlert(
          `⚠️ RVMJ abandoned app game quarantined\nGame: ${process.env.NEXT_PUBLIC_SITE_URL}/game/${decision.staleGameId}`,
        );
      } else if (data !== 'ended' && data !== 'changed') {
        throw new Error(`could not clear the abandoned game: unexpected result ${String(data)}`);
      }
    }

    // `false` / `changed` means the match was resumed after the confirmation screen loaded.
    // That is an ordinary lost race: return through the tag route, which now sees the live
    // match and never creates a replacement. Successful end/expiry takes the same route and
    // lets the one canonical join flow create or join the next match.
  }

  redirect(`/t/${secret}`);
}

export async function removeNotablePhoto(claimId: string): Promise<{ error?: string }> {
  try {
    const user = await requireUser();
    const admin = createAdminClient();

    // No requireParticipant here on purpose: the question is not "are you at this table" but
    // "did you log this claim", and the RPC answers it inside the transaction that clears it.
    const { data: path, error } = await admin.rpc('clear_notable_photo', {
      p_claim_id: claimId,
      p_actor: user.id,
    });
    if (error) return { error: error.message };

    // Order is deliberate. Column first, object second. If the object delete then fails we are
    // left with an invisible orphan costing a little storage; the reverse order would leave a
    // claim pointing at a deleted image, which is a broken picture on somebody's screen.
    if (path) await admin.storage.from(PHOTO_BUCKET).remove([path as string]);
    return {};
  } catch (cause) {
    return { error: cause instanceof Error ? cause.message : 'failed to remove' };
  }
}
