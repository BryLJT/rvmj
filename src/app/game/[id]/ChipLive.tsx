'use client';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '../../../lib/supabase/client';
import type { Seat } from '../../../lib/engine/types';
import { reopenChipGame } from '../../../lib/actions/game';
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
  const [reopening, setReopening] = useState(false);
  const supabase = createClient();

  const reload = useCallback(async () => {
    const { data } = await supabase.from('notable_claims')
      .select('id, player_id, notable_hand_id').eq('game_id', gameId).order('created_at');
    setClaims(data ?? []);
    // A proposal made on ANY phone has to surface the confirm view on THIS one — all four
    // players confirm on their own phone (spec §8.6), and only one of them tapped "End game".
    const { data: g } = await supabase.from('games').select('pending_counts, status').eq('id', gameId).single();
    if (g?.pending_counts) setEndOpen(true);
    else if (g?.status === 'ended') setEndOpen(false); // finalized — drop the overlay, show the result
    // Key off the FRESHLY-READ row, not the `status` prop. reopen_game nulls final_total on all
    // four rows and flips status back to 'active', but router.refresh() merges the RSC payload
    // WITHOUT unmounting this component — so `finals` has to be cleared here or it survives the
    // reopen and this phone keeps asserting settled numbers for a game that has none.
    if (g?.status === 'ended') {
      const { data: gps, error } = await supabase.from('game_players')
        .select('player_id, final_total').eq('game_id', gameId);
      // Fail CLOSED: a failed read must show seat letters, not four zeros that read as
      // "everyone broke even".
      if (error || !gps) { setFinals(null); return; }
      setFinals(Object.fromEntries(gps.map((r) => [r.player_id, r.final_total ?? 0])));
    } else setFinals(null);
  }, [gameId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    // initial fetch on mount; the subscription below keeps it fresh thereafter
    // eslint-disable-next-line react-hooks/set-state-in-effect
    reload();
    const ch = supabase
      .channel(`chip-${gameId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notable_claims', filter: `game_id=eq.${gameId}` }, reload)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'games', filter: `id=eq.${gameId}` },
        () => { reload(); router.refresh(); })
      // Realtime does NOT replay events missed while the socket was down. Every (re)subscribe
      // has to re-read the row or this phone silently keeps a pre-outage view of the table.
      .subscribe((s) => { if (s === 'SUBSCRIBED') reload(); });
    return () => { supabase.removeChannel(ch); };
  }, [gameId, reload, router]); // eslint-disable-line react-hooks/exhaustive-deps

  // Phones on a mahjong table lock and background constantly; coming back to the foreground is
  // the other moment the socket may have missed everything that happened meanwhile.
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === 'visible') reload(); };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [reload]);

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
            {status === 'ended' && finals ? (
              <span className={`font-mono ${(finals[p.playerId] ?? 0) < 0 ? 'text-red-600' : (finals[p.playerId] ?? 0) > 0 ? 'text-green-600' : 'opacity-50'}`}>
                {(finals[p.playerId] ?? 0) > 0 ? '+' : ''}{finals[p.playerId] ?? 0}
              </span>
            ) : (
              <span className="font-mono opacity-40">{p.seat}</span>
            )}
          </li>
        ))}
      </ul>
      {status === 'ended' && (
        <button className="rounded border px-4 py-2 text-sm disabled:opacity-40" disabled={reopening}
          onClick={async () => {
            if (reopening) return;
            setReopening(true);
            try {
              const res = await reopenChipGame(gameId);
              if (res.error) alert(res.error); else router.refresh();
            } catch (e) {
              alert(e instanceof Error ? e.message : 'could not reach the table — try again');
            } finally {
              setReopening(false);
            }
          }}>
          {reopening ? 'Reopening…' : 'Reopen (within 1 hour of ending)'}
        </button>
      )}
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
