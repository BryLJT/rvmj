'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '../../../lib/supabase/client';
import { proposeChipCounts, type ConservationFailure } from '../../../lib/actions/game';
import { ChipConfirmPanel, ChipConfirmSyncBlockedContext } from './ChipConfirmPanel';
import { ChipCountForm } from './ChipCountForm';
import {
  cloneChipCountTable, emptyChipCountTable,
  type ChipCountTable, type ChipPlayer, type PendingChipProposal,
} from './chip-view';

const SYNC_FAILED = 'Couldn’t verify the latest table count. Reconnect, then try again.';
const PROPOSED = 'All 1,600 points and every denomination balance. Sharing this count with the table…';
const UNREACHABLE = 'Could not reach the table. Try again.';

/**
 * Phase 1 (count) and phase 2 (confirm) of ending a chip game, over one server-persisted
 * proposal that all four phones read through realtime (spec §8.6).
 *
 * This component owns the READ and the two actions; the panels own presentation only.
 */
export function ChipEndFlow({ gameId, players, me, onClose }: {
  gameId: string; players: ChipPlayer[]; me: string; onClose: () => void;
}) {
  const router = useRouter();
  const [counts, setCounts] = useState<ChipCountTable>(emptyChipCountTable);
  const [pending, setPending] = useState<PendingChipProposal | null>(null);
  const [failure, setFailure] = useState<ConservationFailure>();
  const [error, setError] = useState<string>();
  const [success, setSuccess] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  // Every action here acts on numbers this phone last READ. Until a read lands — and again
  // for as long as a re-read is in flight — those numbers may already be superseded, so the
  // actions close rather than proposing or confirming against a stale view of the table.
  const [syncState, setSyncState] = useState<'checking' | 'ready' | 'failed'>('checking');
  const [syncError, setSyncError] = useState<string>();
  // Identity of the proposal this phone said "recount" to. Held rather than clearing `pending`,
  // because any games UPDATE (someone else confirming) re-runs load() and would otherwise yank
  // this phone back to the confirm view mid-recount. A genuinely NEW proposal has a new identity
  // and does pull it back — including a re-proposal of identical counts, which is why the
  // identity is the server's proposal stamp and not a signature of the numbers.
  const [recountingFrom, setRecountingFrom] = useState<string | null>(null);
  const supabase = createClient();

  // Mount, (re)SUBSCRIBE, realtime and foreground can all have a read in flight at once. Without
  // an epoch, whichever resolves LAST wins: a stale success landing after a fresh failure would
  // re-enable Confirm on a view this component already knows is stale (same defect ChipLive's
  // `passRef` closes, kept deliberately identical here).
  const passRef = useRef(0);
  // `syncState` cannot gate the actions ALONE: a tap in the same batch as a resync runs before
  // React has re-rendered with syncBlocked=true, so the DOM button is still enabled and its
  // handler still sees the old props. The ref closes that window synchronously — for this
  // component's own submit, and (through context) for the confirm panel's handler too.
  const syncBlockedRef = useRef(true);
  const submittingRef = useRef(false);

  // The proposal is SERVER-persisted (games.pending_counts) and mirrored to all four phones
  // via realtime; each player confirms on their own phone (spec §8.6).
  const load = useCallback(async () => {
    const pass = ++passRef.current;
    const current = () => pass === passRef.current;
    // Block BEFORE the await, not after the next render: see the note on syncBlockedRef.
    syncBlockedRef.current = true;
    setSyncState('checking');

    const { data, error: readError } = await supabase.from('games')
      .select('pending_counts, pending_confirmed, status, last_activity_at').eq('id', gameId).single();
    // A superseded pass may not speak for the table any more — not to report failure, and above
    // all not to report success, which would re-enable the actions a newer failure just closed.
    if (!current()) return;
    // This pass has an answer, so a tap that was dropped for landing mid-verification (see
    // `submit`) gives its pending label back. A genuine in-flight proposal owns `submitting`
    // through its own finally and must never be released from here.
    if (!submittingRef.current) setSubmitting(false);
    // Fail CLOSED, and keep the last good proposal and every entered count: a phone that cannot
    // re-read is a phone that must not act, but wiping the screen also loses work nobody can
    // recover. The proposal on display is simply no longer confirmable until a read succeeds.
    if (readError || !data) { setSyncError(SYNC_FAILED); setSyncState('failed'); return; }
    // This flow owns only live and settled chip games. An expired (or future unknown) status
    // belongs to the route-level recovery screen; treating one as active would let this phone
    // confirm a terminal game. Stay failed closed while the route catches up.
    if (data.status !== 'active' && data.status !== 'ended') {
      setSyncError(SYNC_FAILED);
      setSyncState('failed');
      router.refresh();
      return;
    }
    if (data.status === 'ended') { router.refresh(); return; }

    setPending(data.pending_counts
      ? {
          counts: data.pending_counts as ChipCountTable,
          confirmed: data.pending_confirmed ?? [],
          // Proposal IDENTITY, not proposal CONTENT. propose_chip_counts stamps
          // last_activity_at on every call, so a recount that lands on byte-identical
          // numbers is still a NEW proposal — which a JSON signature of the counts cannot
          // see. (Other RPCs bump the stamp too; that errs towards showing this phone the
          // live proposal, which is the safe direction.)
          id: String(data.last_activity_at ?? JSON.stringify(data.pending_counts)),
        }
      : null);
    // Only now — with the whole fresh row processed — may this phone act again.
    setSyncError(undefined);
    syncBlockedRef.current = false;
    setSyncState('ready');
    // Deps are the game alone, as they were when `load` lived inside the effect below. Adding
    // `router` here would make `load`'s identity a render-identity concern and re-tear-down the
    // subscription on every render.
  }, [gameId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    // initial fetch on mount; the subscription below keeps it fresh thereafter
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    const ch = supabase
      .channel(`chip-end-${gameId}`)
      // The handler is wrapped rather than passed straight through: supabase-js ignores what a
      // realtime callback returns, so handing it `load` hands it a floating promise nobody owns.
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'games', filter: `id=eq.${gameId}` },
        () => { void load(); })
      // Realtime does NOT replay events missed while the socket was down. Without this re-read,
      // a phone that was backgrounded across a re-proposal comes back showing the SUPERSEDED
      // proposal with an ENABLED Confirm — and that tap confirms the CURRENT one.
      .subscribe((s) => { if (s === 'SUBSCRIBED') load(); });
    return () => { supabase.removeChannel(ch); };
  }, [gameId, load]); // eslint-disable-line react-hooks/exhaustive-deps

  // Same hole, the other way in: the phone was locked, not disconnected.
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [load]);

  const submit = async () => {
    // Two taps in one batch both reach this before React has re-rendered either of them away.
    if (submittingRef.current) return;
    // A tap in the same batch as a resync is a proposal built on numbers this phone has not
    // re-read: `syncState` has not reached the DOM yet, so the button was still live when it was
    // pressed. Drop the tap, but hold the pending label until the verification settles — a tap
    // that vanishes with no feedback reads as a broken button. (Re-running the dropped tap once
    // the read lands is Task 8's dead-tap work, deliberately not done here.)
    if (syncBlockedRef.current) { setSubmitting(true); return; }
    submittingRef.current = true;
    setSubmitting(true);
    setFailure(undefined); setError(undefined); setSuccess(undefined);
    try {
      const res = await proposeChipCounts(gameId, counts);
      // A conservation failure is a MISCOUNT, not an error: every entered value stays exactly
      // where it is so the table can fix the one stack that is wrong.
      if (res.conservation) setFailure(res.conservation);
      else if (res.error) setError(res.error);
      // Realtime owns the move to confirmation — on this phone as much as the other three.
      else setSuccess(PROPOSED);
    } catch (cause) {
      // Transport failure at the table: never leave the button stuck disabled.
      setError(cause instanceof Error ? cause.message : UNREACHABLE);
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  if (pending && pending.id !== recountingFrom) {
    return (
      <ChipConfirmSyncBlockedContext.Provider value={syncBlockedRef}>
        <ChipConfirmPanel
          key={pending.id}
          gameId={gameId}
          proposal={pending}
          players={players}
          me={me}
          syncBlocked={syncState !== 'ready'}
          syncError={syncError}
          onRecount={(proposal) => {
            // CLONE. The recounting phone is usually not the one that entered these numbers, so
            // this is the only path that puts the table's latest count into the form — and it
            // must not hand the editor the object the proposal is still being rendered from.
            setCounts(cloneChipCountTable(proposal.counts));
            setFailure(undefined);
            setError(undefined);
            setSuccess(undefined);
            setRecountingFrom(proposal.id);
          }}
        />
      </ChipConfirmSyncBlockedContext.Provider>
    );
  }

  return (
    <ChipCountForm
      players={players}
      counts={counts}
      failure={failure}
      // A failed sync is the more urgent message: it says the action is closed, which the
      // stale action error no longer explains.
      error={syncError ?? error}
      success={success}
      submitting={submitting}
      syncBlocked={syncState !== 'ready'}
      onCountsChange={setCounts}
      onSubmit={submit}
      onClose={onClose}
    />
  );
}
