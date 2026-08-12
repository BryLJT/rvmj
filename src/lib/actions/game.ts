'use server';
import { redirect } from 'next/navigation';
import { createServerSupabase } from '../supabase/server';
import { createAdminClient } from '../supabase/admin';
import { decideJoin, toSnapshot, OPEN_GAME_SELECT } from '../join';
import type { RulesConfig, Seat } from '../engine/types';
import { validateCountsTable, checkConservation, type ChipCounts } from '../chips';
import { sendAlert } from '../telegram';

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

export async function logNotable(gameId: string, playerId: string, notableHandId: string): Promise<{ error?: string }> {
  try {
    const user = await requireUser();
    const { admin } = await requireParticipant(gameId, user.id);
    const { error } = await admin.rpc('log_notable_claim', {
      p_game_id: gameId, p_player_id: playerId, p_notable_hand_id: notableHandId, p_logged_by: user.id,
    });
    if (error) return { error: error.message };
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'failed to log' };
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
 * Restricted to players who were in the match, and enforced here rather than in the UI. A
 * non-participant reviving it would lock THEMSELVES out: the match stops looking abandoned,
 * they still cannot join a game in progress, and the void option is gone for another 12h.
 */
export async function continueMatch(secret: string): Promise<void> {
  const user = await requireUser();
  const admin = createAdminClient();

  const { data: tagSeat } = await admin
    .from('table_seats').select('table_id, seat').eq('secret', secret).single();
  if (!tagSeat) throw new Error('unknown tag');

  const { data: row, error: readError } = await admin
    .from('games')
    .select(OPEN_GAME_SELECT)
    .eq('table_id', tagSeat.table_id)
    .in('status', ['forming', 'active'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (readError) throw new Error(`could not read open game: ${readError.message}`);

  const snapshot = toSnapshot(row);
  const decision = decideJoin(snapshot, {
    playerId: user.id, seat: tagSeat.seat as Seat, now: new Date(),
  });

  // Someone else resolved it first (voided it, or already resumed it). Re-enter through the
  // normal tap route and let it decide afresh rather than acting on a stale view.
  if (!row || decision.action !== 'confirm_end_stale') redirect(`/t/${secret}`);

  if (!Object.values(snapshot?.seats ?? {}).includes(user.id)) {
    throw new Error('you were not in that match');
  }

  const { error } = await admin
    .from('games')
    .update({ last_activity_at: new Date().toISOString() })
    .eq('id', decision.staleGameId);
  if (error) throw new Error(`could not continue the match: ${error.message}`);

  redirect(`/game/${decision.staleGameId}`);
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
    // A silent CHIP game expires WITHOUT results — there are no counts to settle it with.
    // A silent APP game auto-ends with whatever was recorded.
    const { error } = (row as { mode?: string }).mode === 'chips'
      ? await admin.rpc('expire_game', { p_game_id: decision.staleGameId })
      : await admin.rpc('end_game', { p_game_id: decision.staleGameId });
    if (error) throw new Error(`could not clear the abandoned game: ${error.message}`);
  }

  redirect(`/t/${secret}`);
}
