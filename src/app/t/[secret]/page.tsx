import { redirect } from 'next/navigation';
import { createServerSupabase } from '../../../lib/supabase/server';
import { createAdminClient } from '../../../lib/supabase/admin';
import {
  decideJoin, toSnapshot, OPEN_GAME_SELECT,
  type JoinDecision, type OpenGameRow,
} from '../../../lib/join';
import { endAbandonedGame } from '../../../lib/actions/game';
import type { Seat } from '../../../lib/engine/types';

export const dynamic = 'force-dynamic';

// Ledger carry: three DISTINCT rejection copies — a fifth player at a full forming table
// must not read the same message as an outsider tapping a running game.
const REJECT_COPY: Record<string, string> = {
  seat_taken: 'That seat is already taken. Tap a free seat, or ask its occupant to move.',
  game_in_progress: 'A game started without you. Wait for it to finish.',
  table_full: 'Table full — four players are already in this game. Wait for the next one.',
};

// Postgres unique_violation. The one-open-game-per-table index raises this when another
// phone won the race to create the game; it is a signal to re-join, not a failure.
const UNIQUE_VIOLATION = '23505';

function hoursSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000);
}

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
  const readOpenGame = async () => {
    const { data, error } = await admin
      .from('games')
      .select(OPEN_GAME_SELECT)
      .eq('table_id', tagSeat.table_id)
      .in('status', ['forming', 'active'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    // Fail loudly, never degrade into a write: a transient select failure is NOT "no open
    // game". Treating it as one would hand decideJoin a null snapshot and create a DUPLICATE
    // forming game at a table that already has a live one.
    if (error) throw new Error(`could not read open game: ${error.message}`);
    return (data ?? null) as OpenGameRow | null;
  };

  const tap = { playerId: user.id, seat: tagSeat.seat as Seat, now: new Date() };

  // Seat this player into a game that already exists. Used both by the ordinary forming-game
  // path and by the create-race loser, which is the same situation arriving a moment later.
  const seatInto = async (decision: JoinDecision) => {
    switch (decision.action) {
      case 'rejoin':
        redirect(`/game/${decision.gameId}`);
        break;
      case 'claim_seat': {
        // Race safety: PK (game_id, seat) + unique (game_id, player_id) make the second
        // phone's insert FAIL — it gets the seat_taken copy, never a silent overwrite.
        const { error } = await admin.from('game_players')
          .insert({ game_id: decision.gameId, player_id: user.id, seat: tagSeat.seat });
        if (error) return <main className="p-8">{REJECT_COPY.seat_taken}</main>;
        redirect(`/game/${decision.gameId}`);
        break;
      }
      case 'move_seat': {
        // Same race safety as claim_seat: PK (game_id, seat) rejects a move onto an occupied
        // seat. Surface that as seat_taken — never redirect as if the move had succeeded.
        const { error } = await admin.from('game_players')
          .update({ seat: tagSeat.seat })
          .eq('game_id', decision.gameId).eq('player_id', user.id);
        if (error) return <main className="p-8">{REJECT_COPY.seat_taken}</main>;
        redirect(`/game/${decision.gameId}`);
        break;
      }
      case 'reject':
        return <main className="p-8">{REJECT_COPY[decision.reason]}</main>;
      default:
        throw new Error(`cannot seat into an existing game: ${decision.action}`);
    }
  };

  const row = await readOpenGame();
  const decision = decideJoin(toSnapshot(row), tap);

  switch (decision.action) {
    case 'reject':
    case 'rejoin':
    case 'claim_seat':
    case 'move_seat':
      return seatInto(decision);

    case 'confirm_end_stale': {
      // A played game is NEVER cleared silently. The tapper is told exactly what is lost,
      // and clearing only happens on their explicit confirmation (a POST, so it cannot be
      // triggered by a prefetch, a shared link, or the back button).
      const isChips = row?.mode === 'chips';
      const idle = hoursSince(String(row?.last_activity_at ?? new Date().toISOString()));
      // A player who was IN that game must be able to reach it and settle it properly —
      // otherwise the only route forward is destroying their own unrecorded night. The
      // escape hatch is offered to participants only; an outsider has nothing to record.
      const wasPlaying = Object.values(toSnapshot(row)?.seats ?? {}).includes(user.id);
      return (
        <main className="p-8 space-y-4">
          <h1 className="text-xl font-semibold">There is an unfinished game at this table</h1>
          <p>Nobody ended it, and there has been no activity for about {idle} hours.</p>
          <p className="font-medium">
            {isChips
              ? 'The final chip counts were never recorded, so this game has no scores and nothing can be saved from it. Ending it will start a fresh game.'
              : 'It will be ended using the hands that were already recorded, and those scores will count towards the leaderboard.'}
          </p>
          {wasPlaying && (
            <p>
              You were playing in it.{' '}
              <a className="underline font-medium" href={`/game/${decision.staleGameId}`}>
                Open that game and finish it properly
              </a>{' '}
              instead of ending it here.
            </p>
          )}
          <form action={endAbandonedGame.bind(null, secret)}>
            <button type="submit" className="rounded bg-black px-4 py-2 text-white">
              End it and start a new game
            </button>
          </form>
          <p className="text-sm text-gray-500">
            Ending it cannot be undone.
          </p>
        </main>
      );
    }

    case 'expire_and_create': {
      // A forming game holds nothing — nobody ever recorded a hand or a chip count — so
      // clearing it costs nothing and stays silent. Only PLAYED games get a confirmation.
      // An unnoticed failure here would leave the old game open and the create below would
      // then die on games_one_open_per_table, naming the wrong cause.
      const { error } = await admin.rpc('expire_game', { p_game_id: decision.expireGameId });
      if (error) throw new Error(`could not expire abandoned game: ${error.message}`);
      break; // fall through to create below
    }

    case 'create_forming':
      break;
  }

  // Atomic create: game row + first seat in one RPC (ledger carry).
  const { data: newGameId, error } = await admin.rpc('create_game_with_seat', {
    p_table_id: tagSeat.table_id, p_player_id: user.id, p_seat: tagSeat.seat,
  });

  if (error) {
    // Two friends tapping different tags at the same instant BOTH resolve to this table and
    // both try to start the game. That is the normal way a night starts, not an exotic race.
    // The loser re-reads and takes a seat in the winner's game; nothing is shown to either.
    if (error.code !== UNIQUE_VIOLATION) throw new Error(`could not create game: ${error.message}`);
    const retryDecision = decideJoin(toSnapshot(await readOpenGame()), tap);
    return seatInto(retryDecision);
  }
  if (!newGameId) throw new Error('could not create game: no id returned');

  redirect(`/game/${newGameId}`);
}
