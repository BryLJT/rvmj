'use server';
import { createServerSupabase } from '../supabase/server';
import { createAdminClient } from '../supabase/admin';
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
    if (error) return { error: error.message };
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'failed to reopen' };
  }
}
