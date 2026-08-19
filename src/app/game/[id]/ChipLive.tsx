'use client';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '../../../lib/supabase/client';
import type { Seat } from '../../../lib/engine/types';
import { AppFrame, Button, LiveRegion, PageHeader, PlayerRow, StatusMessage } from '../../../components/ui';
import { NotableLogger } from './NotableLogger';
import { ReopenGameControl } from './ReopenGameControl';
import { ChipEndFlow } from './ChipEndFlow';

type P = { playerId: string; seat: Seat; name: string };
type NH = { id: string; name: string; local_name: string | null };
type Claim = { id: string; player_id: string; notable_hand_id: string };

const SYNC_FAILED = 'Couldn’t refresh this game. Check the connection and try again.';

export function ChipLive({ gameId, status, players, me, notableHands }: {
  gameId: string; status: 'active' | 'ended'; players: P[]; me: string; notableHands: NH[];
}) {
  const router = useRouter();
  const [claims, setClaims] = useState<Claim[]>([]);
  const [finals, setFinals] = useState<Record<string, number> | null>(null);
  const [loggerOpen, setLoggerOpen] = useState(false);
  const [endOpen, setEndOpen] = useState(false);
  // Every state-changing control on this screen acts on numbers this phone last READ. If the
  // latest read failed, those numbers may already be wrong, so the controls close rather than
  // letting somebody end or annotate a game from a stale view of it.
  const [syncState, setSyncState] = useState<'checking' | 'ready' | 'failed'>('checking');
  const [syncError, setSyncError] = useState<string>();
  const supabase = createClient();

  const reload = useCallback(async () => {
    setSyncState('checking');
    const failSync = () => { setSyncError(SYNC_FAILED); setSyncState('failed'); };

    const { data: claimRows, error: claimsError } = await supabase.from('notable_claims')
      .select('id, player_id, notable_hand_id').eq('game_id', gameId).order('created_at');
    // Bail BEFORE any setState. A half-finished pass that writes claims and then fails on the
    // game row leaves the screen describing two different moments in time.
    if (claimsError || !claimRows) { failSync(); return; }

    // A proposal made on ANY phone has to surface the confirm view on THIS one — all four
    // players confirm on their own phone (spec §8.6), and only one of them tapped "End game".
    const { data: g, error: gameError } = await supabase.from('games')
      .select('pending_counts, status').eq('id', gameId).single();
    if (gameError || !g) { failSync(); return; }

    setClaims(claimRows);
    if (g.pending_counts) setEndOpen(true);
    else if (g.status === 'ended') setEndOpen(false); // finalized — drop the overlay, show the result
    // Key off the FRESHLY-READ row, not the `status` prop. reopen_game nulls final_total on all
    // four rows and flips status back to 'active', but router.refresh() merges the RSC payload
    // WITHOUT unmounting this component — so `finals` has to be cleared here or it survives the
    // reopen and this phone keeps asserting settled numbers for a game that has none.
    if (g.status === 'ended') {
      const { data: gps, error } = await supabase.from('game_players')
        .select('player_id, final_total').eq('game_id', gameId);
      // Fail CLOSED: a failed read must show seat letters, not four zeros that read as
      // "everyone broke even".
      if (error || !gps) { setFinals(null); failSync(); return; }
      setFinals(Object.fromEntries(gps.map((r) => [r.player_id, r.final_total ?? 0])));
    } else setFinals(null);

    setSyncError(undefined);
    setSyncState('ready');
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

  const ended = status === 'ended';
  const ready = syncState === 'ready';
  const showFinals = ended && finals;

  return (
    <AppFrame>
      <PageHeader
        title={ended ? 'Final result' : 'Chip game in progress'}
        description={ended ? undefined : 'The chips settle every hand at the table. The app stays out of the way until you count up.'}
      />

      {!ended && (
        <p className="mb-5 text-sm text-muted">
          <Link href="/chips" className="font-semibold text-cobalt underline underline-offset-4">
            See the standard chip set
          </Link>
        </p>
      )}

      <ul className="rounded-[12px] border border-divider bg-surface px-4">
        {players.map((p) => (
          <PlayerRow
            key={p.seat}
            seat={p.seat}
            name={p.name}
            isMe={p.playerId === me}
            trailing={showFinals ? <FinalScore value={finals[p.playerId] ?? 0} /> : undefined}
          />
        ))}
      </ul>

      {syncState === 'checking' && (
        <StatusMessage tone="info" className="mt-5">Checking the latest table state…</StatusMessage>
      )}
      {/* Mounted at all times so a later failure is announced rather than silently appearing. */}
      <div className="mt-5 empty:mt-0"><LiveRegion tone="error" message={syncError} /></div>

      {claims.length > 0 && (
        <section className="mt-7">
          <h2 className="text-xs font-bold uppercase tracking-[0.18em] text-coral">Notable hands</h2>
          <ul className="mt-3 flex flex-col gap-2">
            {claims.map((c) => (
              <li key={c.id} className="rounded-[10px] border border-divider bg-surface px-4 py-3 text-sm">
                🏆 {name(c.player_id)} — {handName(c.notable_hand_id)}
              </li>
            ))}
          </ul>
        </section>
      )}

      {ended ? (
        <div className="mt-7 flex flex-col gap-4">
          <StatusMessage tone="success" title="Game locked">
            All four players confirmed. The leaderboard has been updated.
          </StatusMessage>
          <ReopenGameControl gameId={gameId} disabled={!ready} onReopened={() => router.refresh()} />
          <p className="text-sm text-muted">Available for one hour after the game ends.</p>
        </div>
      ) : (
        <div className="mt-7 flex flex-col gap-3">
          <Button variant="secondary" disabled={!ready} onClick={() => setLoggerOpen(true)}>
            Log notable hand
          </Button>
          <Button variant="primary" disabled={!ready} onClick={() => setEndOpen(true)}>
            End game · count chips
          </Button>
        </div>
      )}

      {loggerOpen && (
        <NotableLogger players={players} notableHands={notableHands} gameId={gameId}
          onClose={() => setLoggerOpen(false)} />
      )}
      {endOpen && status === 'active' && (
        <ChipEndFlow gameId={gameId} players={players} me={me} onClose={() => setEndOpen(false)} />
      )}
    </AppFrame>
  );
}

/** The sign is always written out, so the result never depends on colour alone. */
function FinalScore({ value }: { value: number }) {
  const tone = value > 0 ? 'text-gain' : value < 0 ? 'text-coral' : 'text-muted';
  return (
    <span className={`tabular-nums text-lg font-extrabold ${tone}`}>
      {value > 0 ? `+${value}` : String(value)}
    </span>
  );
}
