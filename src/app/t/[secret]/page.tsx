import { redirect } from 'next/navigation';
import { createServerSupabase } from '../../../lib/supabase/server';
import { createAdminClient } from '../../../lib/supabase/admin';
import { decideJoin, type GameSnapshot } from '../../../lib/join';
import type { Seat } from '../../../lib/engine/types';

export const dynamic = 'force-dynamic';

// Ledger carry: three DISTINCT rejection copies — a fifth player at a full forming table
// must not read the same message as an outsider tapping a running game.
const REJECT_COPY: Record<string, string> = {
  seat_taken: 'That seat is already taken. Tap a free seat, or ask its occupant to move.',
  game_in_progress: 'A game started without you. Wait for it to finish.',
  table_full: 'Table full — four players are already in this game. Wait for the next one.',
};

export default async function TapPage({ params }: { params: Promise<{ secret: string }> }) {
  const { secret } = await params;
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/t/${secret}`)}`);

  const admin = createAdminClient();
  const { data: tagSeat } = await admin
    .from('table_seats').select('table_id, seat').eq('secret', secret).single();
  if (!tagSeat) {
    return <main className="p-8">Unknown tag. This sticker is not registered.</main>;
  }

  // Deterministic select (ledger carry): at most one non-terminal game per table, newest first.
  const { data: g, error: openGameError } = await admin
    .from('games')
    .select('id, status, mode, created_at, last_activity_at, game_players(player_id, seat)')
    .eq('table_id', tagSeat.table_id)
    .in('status', ['forming', 'active'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  // Fail loudly, never degrade into a write: a transient select failure is NOT "no open game".
  // Treating it as one would hand decideJoin a null snapshot and create a DUPLICATE forming
  // game at a table that already has a live one.
  if (openGameError) throw new Error(`could not read open game: ${openGameError.message}`);

  const snapshot: GameSnapshot | null = g
    ? {
        id: g.id,
        status: g.status as 'forming' | 'active',
        createdAt: new Date(g.created_at),
        lastActivityAt: new Date(g.last_activity_at),
        seats: Object.fromEntries(
          (g.game_players ?? []).map((p: { player_id: string; seat: string }) => [p.seat, p.player_id]),
        ),
      }
    : null;

  const decision = decideJoin(snapshot, { playerId: user.id, seat: tagSeat.seat as Seat, now: new Date() });

  switch (decision.action) {
    case 'reject':
      return <main className="p-8">{REJECT_COPY[decision.reason]}</main>;
    case 'rejoin':
      redirect(`/game/${decision.gameId}`);
      break;
    case 'claim_seat': {
      // Race safety: PK (game_id, seat) + unique (game_id, player_id) make the second
      // phone's insert FAIL — it gets the seat_taken copy, never a silent overwrite.
      const { error: claimError } = await admin.from('game_players')
        .insert({ game_id: decision.gameId, player_id: user.id, seat: tagSeat.seat });
      if (claimError) return <main className="p-8">{REJECT_COPY.seat_taken}</main>;
      redirect(`/game/${decision.gameId}`);
      break;
    }
    case 'move_seat': {
      // Same race safety as claim_seat: PK (game_id, seat) rejects a move onto an occupied
      // seat. Surface that as seat_taken — never redirect as if the move had succeeded.
      const { error: moveError } = await admin.from('game_players')
        .update({ seat: tagSeat.seat })
        .eq('game_id', decision.gameId).eq('player_id', user.id);
      if (moveError) return <main className="p-8">{REJECT_COPY.seat_taken}</main>;
      redirect(`/game/${decision.gameId}`);
      break;
    }
    case 'expire_and_create':
      await admin.rpc('expire_game', { p_game_id: decision.expireGameId });
      break; // fall through to create below
    case 'end_stale_and_create': {
      // Mode-aware stale handling (spec §10): a silent CHIP game expires WITHOUT results —
      // there are no counts to settle it with. An APP game auto-ends with its recorded totals.
      const { data: stale } = await admin.from('games').select('mode').eq('id', decision.endGameId).single();
      if (stale?.mode === 'chips') {
        await admin.rpc('expire_game', { p_game_id: decision.endGameId });
      } else {
        // `end_game` arrives with migration 0002; Task 18 replaces this throw with the RPC call.
        // Until app mode exists this branch is unreachable — fail loudly, never mis-end silently.
        throw new Error('stale app-mode game found before app mode shipped — investigate');
      }
      break; // fall through to create below
    }
    case 'create_forming':
      break;
  }

  // Atomic create: game row + first seat in one RPC (ledger carry).
  const { data: newGameId, error } = await admin.rpc('create_game_with_seat', {
    p_table_id: tagSeat.table_id, p_player_id: user.id, p_seat: tagSeat.seat,
  });
  if (error || !newGameId) throw new Error(`could not create game: ${error?.message}`);
  redirect(`/game/${newGameId}`);
}
