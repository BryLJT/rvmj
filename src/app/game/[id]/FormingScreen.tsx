'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChipSetCard } from '../../../components/ChipSetCard';
import { startGame } from '../../../lib/actions/game';
import { createClient } from '../../../lib/supabase/client';

type P = { playerId: string; seat: 'E' | 'S' | 'W' | 'N'; name: string };

export function FormingScreen({ gameId, players }: { gameId: string; players: P[] }) {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const full = players.length === 4;

  // refresh when other players tap in, or the game starts
  useEffect(() => {
    const supabase = createClient();
    const ch = supabase
      .channel(`forming-${gameId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'game_players', filter: `game_id=eq.${gameId}` },
        () => router.refresh())
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'games', filter: `id=eq.${gameId}` },
        () => router.refresh())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [gameId, router]);

  const onStart = async () => {
    const res = await startGame(gameId, 'chips');
    if (res.error) setError(res.error);
    else router.refresh();
  };

  return (
    <main className="mx-auto flex max-w-md flex-col gap-4 p-6">
      <h1 className="text-xl font-bold">Forming game</h1>
      <ul className="rounded-lg border p-4">
        {(['E', 'S', 'W', 'N'] as const).map((s) => {
          const p = players.find((x) => x.seat === s);
          return (
            <li key={s} className="flex justify-between py-1">
              <span className="font-mono">{s}</span><span>{p ? p.name : '— tap to join —'}</span>
            </li>
          );
        })}
      </ul>

      <h2 className="font-semibold">Mode</h2>
      <div className="flex gap-2">
        {/* Chips is the PRESELECTED DEFAULT (spec §8.1, Bryan 2026-08-08). Task 19 makes App a live option. */}
        <button className="flex-1 rounded-lg border-2 border-black px-4 py-3 font-medium dark:border-white">
          Chips ✓
        </button>
        <button disabled title="coming soon" className="flex-1 rounded-lg border px-4 py-3 opacity-40">
          App scorekeeper
        </button>
      </div>
      <ChipSetCard />

      <button onClick={onStart} disabled={!full}
        className="rounded-lg border px-6 py-3 font-medium disabled:opacity-40">
        {full ? 'Start game' : `Waiting for players (${players.length}/4)`}
      </button>
      {error && <p className="text-red-600">{error}</p>}
    </main>
  );
}
