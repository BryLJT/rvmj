import { redirect } from 'next/navigation';
import { createServerSupabase } from '../../../lib/supabase/server';
import { FormingScreen } from './FormingScreen';
import { ChipLive } from './ChipLive';
import { GameLive } from './GameLive';

export const dynamic = 'force-dynamic';

export default async function GamePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/game/${id}`)}`);

  const { data: game } = await supabase
    .from('games')
    .select('id, status, mode, rules, table_id, game_players(player_id, seat, players(display_name))')
    .eq('id', id).single();
  if (!game) return <main className="p-8">Game not found.</main>;
  if (game.status === 'expired') return <main className="p-8">This game expired without results.</main>;

  const players = (game.game_players ?? []).map(
    (gp: { player_id: string; seat: string; players: { display_name: string } | { display_name: string }[] | null }) => ({
      playerId: gp.player_id,
      seat: gp.seat as 'E' | 'S' | 'W' | 'N',
      name: Array.isArray(gp.players) ? gp.players[0]?.display_name ?? '?' : gp.players?.display_name ?? '?',
    }),
  );

  if (game.status === 'forming') return <FormingScreen gameId={game.id} players={players} />;

  const { data: notableHands } = await supabase.from('notable_hands').select('id, name, local_name').order('name');

  if (game.mode === 'chips')
    // chip games are never quarantined (end_game asserts app mode), so the cast is safe
    return <ChipLive gameId={game.id} status={game.status as 'active' | 'ended'} players={players}
      me={user.id} notableHands={notableHands ?? []} />;
  return <GameLive gameId={game.id} status={game.status as 'active' | 'ended' | 'quarantined'} rules={game.rules}
    players={players} me={user.id} notableHands={notableHands ?? []} />;
}
