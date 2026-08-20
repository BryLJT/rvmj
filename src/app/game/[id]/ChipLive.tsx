'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '../../../lib/supabase/client';
import { subscribeAuthenticatedChannel } from '../../../lib/supabase/realtime';
import type { Seat } from '../../../lib/engine/types';
import { ActionLink, AppFrame, Button, LiveRegion, PageHeader, PlayerRow, StatusMessage } from '../../../components/ui';
import { NotableLogger } from './NotableLogger';
import { ReopenGameControl } from './ReopenGameControl';
import { ChipEndFlow } from './ChipEndFlow';

type P = { playerId: string; seat: Seat; name: string };
type NH = { id: string; name: string; local_name: string | null };
type Claim = { id: string; player_id: string; notable_hand_id: string };

const SYNC_FAILED = 'Couldn’t refresh this game. Check the connection and try again.';
const LIVE_CONNECTION_FAILED = 'Live table connection lost. Check the connection and try again.';

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
  // Only the games-realtime path calls router.refresh(); foreground and resubscribe do not. So the
  // `status` prop can be a whole reopen out of date, and every branch keyed off it — including the
  // one that mounts the counting flow — would leave this phone unable to confirm.
  const [freshStatus, setFreshStatus] = useState<'active' | 'ended' | null>(null);
  // Closing the logger on EVERY pending reload discards a half-filled hand whenever anyone else
  // touches the table. It should close on the transition into pending, not while pending.
  const wasPendingRef = useRef(false);
  const supabase = createClient();

  // Mount, (re)SUBSCRIBE, realtime and foreground can all have a read in flight at once. Without
  // an epoch, whichever resolves LAST wins: a stale success landing after a fresh failure would
  // re-enable "End game" on a view this component already knows is stale.
  const passRef = useRef(0);
  const realtimeBlockedRef = useRef(false);
  const syncBlockedRef = useRef(true);
  // Sorted: the server's embedded select has no ORDER BY, so row order is not stable, and
  // keying the subscription on it would rebuild the channel on an unrelated refresh.
  const seatKey = players.map((p) => p.playerId).sort().join(',');

  const reload = useCallback(async () => {
    const pass = ++passRef.current;
    const current = () => pass === passRef.current;
    syncBlockedRef.current = true;
    setSyncState('checking');
    const failSync = () => { if (current()) { setSyncError(SYNC_FAILED); setSyncState('failed'); } };

    const { data: claimRows, error: claimsError } = await supabase.from('notable_claims')
      .select('id, player_id, notable_hand_id').eq('game_id', gameId).order('created_at');
    if (!current()) return;
    // Bail BEFORE any setState. A half-finished pass that writes claims and then fails on the
    // game row leaves the screen describing two different moments in time.
    if (claimsError || !claimRows) { failSync(); return; }

    // A proposal made on ANY phone has to surface the confirm view on THIS one — all four
    // players confirm on their own phone (spec §8.6), and only one of them tapped "End game".
    const { data: g, error: gameError } = await supabase.from('games')
      .select('pending_counts, status').eq('id', gameId).single();
    if (!current()) return;
    if (gameError || !g) { failSync(); return; }
    // This component owns only the live and settled CHIP states. Expired (or future unknown)
    // rows belong to the route-level recovery screen; treating one as active would re-enable
    // actions against a terminal game. Keep this pass failed closed while the route catches up.
    if (g.status !== 'active' && g.status !== 'ended') {
      failSync();
      router.refresh();
      return;
    }

    setClaims(claimRows);
    setFreshStatus(g.status);
    const isPending = Boolean(g.pending_counts);
    // The logger panel sits above the counting flow in the stacking order, so leaving it open
    // would hide the confirm step and stall the table at three of four confirmations.
    if (isPending) { setEndOpen(true); if (!wasPendingRef.current) setLoggerOpen(false); }
    else if (g.status === 'ended') setEndOpen(false); // finalized — drop the overlay, show the result
    wasPendingRef.current = isPending;
    // Key off the FRESHLY-READ row, not the `status` prop. reopen_game nulls final_total on all
    // four rows and flips status back to 'active', but router.refresh() merges the RSC payload
    // WITHOUT unmounting this component — so `finals` has to be cleared here or it survives the
    // reopen and this phone keeps asserting settled numbers for a game that has none.
    if (g.status === 'ended') {
      const { data: gps, error } = await supabase.from('game_players')
        .select('player_id, final_total').eq('game_id', gameId);
      if (!current()) return;
      // Fail CLOSED, and "closed" includes INCOMPLETE. An empty or partial read is not an error
      // in supabase-js — RLS filtering every row returns { data: [], error: null } — and
      // Object.fromEntries([]) is a truthy {}, which rendered four zeros that read as
      // "everyone broke even". A settled game has one non-null total for every seat or none.
      const byId = new Map((gps ?? []).map((r) => [r.player_id as string, r.final_total as number | null]));
      const settled = !error && gps !== null
        && seatKey.split(',').every((id) => byId.get(id) !== undefined && byId.get(id) !== null);
      if (!settled) { setFinals(null); failSync(); return; }
      setFinals(Object.fromEntries(seatKey.split(',').map((id) => [id, Number(byId.get(id))])));
    } else setFinals(null);

    // A successful HTTP read makes the displayed data fresh, but it does not restore the live
    // channel. Only a new SUBSCRIBED may reopen actions after a Realtime lifecycle failure.
    if (realtimeBlockedRef.current) { setSyncState('failed'); return; }
    setSyncError(undefined);
    syncBlockedRef.current = false;
    setSyncState('ready');
  }, [gameId, seatKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    // initial fetch on mount; the subscription below keeps it fresh thereafter
    // eslint-disable-next-line react-hooks/set-state-in-effect
    reload();
    return subscribeAuthenticatedChannel(
      supabase,
      `chip-${gameId}`,
      () => supabase
        .channel(`chip-${gameId}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notable_claims', filter: `game_id=eq.${gameId}` }, reload)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'games', filter: `id=eq.${gameId}` },
          () => { reload(); router.refresh(); }),
      (realtimeStatus) => {
        // Realtime does NOT replay events missed while the socket was down. Every (re)subscribe
        // has to re-read the row or this phone silently keeps a pre-outage view of the table.
        if (realtimeStatus === 'SUBSCRIBED') {
          realtimeBlockedRef.current = false;
          void reload();
        }
        else if (realtimeStatus === 'CHANNEL_ERROR' || realtimeStatus === 'TIMED_OUT' || realtimeStatus === 'CLOSED') {
          // Invalidate any older success still in flight before closing the stale controls.
          passRef.current += 1;
          realtimeBlockedRef.current = true;
          syncBlockedRef.current = true;
          setSyncError(LIVE_CONNECTION_FAILED);
          setSyncState('failed');
        }
      },
    );
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

  // Prefer what this phone last READ over what the server render handed it.
  const ended = (freshStatus ?? status) === 'ended';
  const ready = syncState === 'ready';
  const showFinals = ended && finals;

  return (
    <AppFrame>
      {/* The exit is keyed off `ended`, i.e. the freshly-read row, not the `status` prop. A
          phone that woke after the table settled carries a stale prop but a correct read, and
          that is precisely the moment somebody wants out of this screen. */}
      <PageHeader
        title={ended ? 'Final result' : 'Chip game in progress'}
        description={ended ? undefined : 'The chips settle every hand at the table. The app stays out of the way until you count up.'}
        trailing={ended ? <ActionLink href="/" variant="secondary">Leaderboard</ActionLink> : undefined}
      />

      {!ended && (
        <ActionLink href="/chips" variant="secondary" className="mb-5 self-start">See the standard chip set</ActionLink>
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
      <div className={syncError ? 'mt-5' : ''}><LiveRegion tone="error" message={syncError} /></div>

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
          {/* Only claim the board moved when this phone has actually READ the settled result. */}
          {showFinals && (
            <StatusMessage tone="success" title="Game locked">
              All four players confirmed. The leaderboard has been updated.
            </StatusMessage>
          )}
          <ReopenGameControl gameId={gameId} disabled={!ready} onReopened={() => router.refresh()} />
          <p className="text-sm text-muted">Available for one hour after the game ends.</p>
        </div>
      ) : (
        <div className="mt-7 flex flex-col gap-3">
          <Button variant="secondary" disabled={!ready}
            onClick={() => { if (!syncBlockedRef.current) setLoggerOpen(true); }}>
            Log notable hand
          </Button>
          <Button variant="primary" disabled={!ready}
            onClick={() => { if (!syncBlockedRef.current) setEndOpen(true); }}>
            End game · count chips
          </Button>
        </div>
      )}

      {loggerOpen && (
        <NotableLogger players={players} notableHands={notableHands} gameId={gameId}
          syncBlocked={!ready} isSyncBlocked={() => syncBlockedRef.current} syncError={syncError}
          onClose={() => setLoggerOpen(false)} />
      )}
      {endOpen && !ended && (
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
