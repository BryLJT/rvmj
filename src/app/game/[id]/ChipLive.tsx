'use client';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '../../../lib/supabase/client';
import type { Seat } from '../../../lib/engine/types';
import { NotableLogger } from './NotableLogger';
import { ChipEndFlow } from './ChipEndFlow';

type P = { playerId: string; seat: Seat; name: string };
type NH = { id: string; name: string; local_name: string | null };
type Claim = { id: string; player_id: string; notable_hand_id: string };

export function ChipLive({ gameId, status, players, me, notableHands }: {
  gameId: string; status: 'active' | 'ended'; players: P[]; me: string; notableHands: NH[];
}) {
  const router = useRouter();
  const [claims, setClaims] = useState<Claim[]>([]);
  const [finals, setFinals] = useState<Record<string, number> | null>(null);
  const [loggerOpen, setLoggerOpen] = useState(false);
  const [endOpen, setEndOpen] = useState(false);
  const supabase = createClient();

  const reload = useCallback(async () => {
    const { data } = await supabase.from('notable_claims')
      .select('id, player_id, notable_hand_id').eq('game_id', gameId).order('created_at');
    setClaims(data ?? []);
    if (status === 'ended') {
      const { data: gps } = await supabase.from('game_players')
        .select('player_id, final_total').eq('game_id', gameId);
      setFinals(Object.fromEntries((gps ?? []).map((g) => [g.player_id, g.final_total ?? 0])));
    }
  }, [gameId, status]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    // initial fetch on mount; the subscription below keeps it fresh thereafter
    // eslint-disable-next-line react-hooks/set-state-in-effect
    reload();
    const ch = supabase
      .channel(`chip-${gameId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notable_claims', filter: `game_id=eq.${gameId}` }, reload)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'games', filter: `id=eq.${gameId}` },
        () => router.refresh())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [gameId, reload, router]); // eslint-disable-line react-hooks/exhaustive-deps

  const name = (playerId: string) => players.find((p) => p.playerId === playerId)?.name ?? '?';
  const handName = (id: string) => notableHands.find((h) => h.id === id)?.name ?? '?';

  return (
    <main className="mx-auto flex max-w-md flex-col gap-4 p-6">
      <h1 className="text-xl font-bold">{status === 'active' ? 'Chip game on' : 'Game over'}</h1>
      {status === 'active' && (
        <p className="text-sm opacity-70">
          Settle every hand with chips as usual — the app stays out of the way.{' '}
          <Link className="underline" href="/chips">The standard set</Link>
        </p>
      )}
      <ul className="rounded-lg border p-4">
        {players.map((p) => (
          <li key={p.seat} className="flex justify-between py-1">
            <span>{p.name}{p.playerId === me ? ' (you)' : ''}</span>
            {finals ? (
              <span className={`font-mono ${(finals[p.playerId] ?? 0) < 0 ? 'text-red-600' : (finals[p.playerId] ?? 0) > 0 ? 'text-green-600' : 'opacity-50'}`}>
                {(finals[p.playerId] ?? 0) > 0 ? '+' : ''}{finals[p.playerId] ?? 0}
              </span>
            ) : (
              <span className="font-mono opacity-40">{p.seat}</span>
            )}
          </li>
        ))}
      </ul>
      {claims.length > 0 && (
        <section>
          <h2 className="mb-1 font-semibold">Notable hands</h2>
          <ul className="flex flex-col gap-1">
            {claims.map((c) => (
              <li key={c.id} className="rounded border px-3 py-2 text-sm">
                🏆 {name(c.player_id)} — {handName(c.notable_hand_id)}
              </li>
            ))}
          </ul>
        </section>
      )}
      {status === 'active' && (
        <>
          <button onClick={() => setLoggerOpen(true)} className="rounded-lg border px-6 py-3">Log notable hand</button>
          <button onClick={() => setEndOpen(true)} className="rounded-lg border px-6 py-3 font-medium">
            End game — count chips
          </button>
        </>
      )}
      {loggerOpen && (
        <NotableLogger players={players} notableHands={notableHands} gameId={gameId}
          onClose={() => setLoggerOpen(false)} />
      )}
      {endOpen && status === 'active' && (
        <ChipEndFlow gameId={gameId} players={players} me={me} onClose={() => setEndOpen(false)} />
      )}
    </main>
  );
}
