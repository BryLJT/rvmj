import { createAdminClient } from './supabase/admin';

/**
 * Did somebody else already resolve this game?
 *
 * Used to tell a genuine failure apart from a lost race. Several phones act on one table at
 * once, so two people can both read an abandoned match and both try to clear it; the loser's
 * RPC raises because the match is already gone. That is the outcome they asked for, not an
 * error. Only a match still sitting open means something actually broke.
 *
 * Re-reads the row rather than matching on the RPC's exception text: `expire_game` and
 * `end_game` raise plain messages, and message wording is not an API — it can be reworded
 * without warning, and the tap route would quietly start crashing again.
 *
 * Deliberately NOT in `actions/game.ts`: every export of a `'use server'` module becomes a
 * publicly callable endpoint, and this is an internal read with no business being one.
 */
export async function gameAlreadyResolved(gameId: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data } = await admin.from('games').select('status').eq('id', gameId).maybeSingle();
  const status = (data as { status?: string } | null)?.status;
  return !!status && status !== 'forming' && status !== 'active';
}
