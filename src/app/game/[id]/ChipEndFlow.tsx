'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '../../../lib/supabase/client';
import { subscribeAuthenticatedChannel } from '../../../lib/supabase/realtime';
import { proposeChipCounts, type ConservationFailure } from '../../../lib/actions/game';
import { ChipResultPanel, ChipResultSyncBlockedContext } from './ChipResultPanel';
import { ChipCountForm } from './ChipCountForm';
import { RecountChoicePanel } from './RecountChoicePanel';
import {
  chipCountTablesEqual, cloneChipCountTable, emptyChipCountTable,
  type ChipCountTable, type ChipPlayer, type PendingChipProposal,
} from './chip-view';

const SYNC_FAILED = 'Couldn’t verify the latest table count. Reconnect, then try again.';
const LIVE_CONNECTION_FAILED = 'Live table connection lost. Reconnect, then try again.';
const PROPOSED = 'All 1,600 points and every denomination balance. Sharing this count with the table…';
const UNREACHABLE = 'Could not reach the table. Try again.';

/**
 * Phase 1 (count) and phase 2 (read and end) of ending a chip game, over one server-persisted
 * proposal that all four phones read through realtime (spec §8.6). Nobody confirms: the player
 * who entered the counts ends it, and the other three watch and may recount.
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
  const [hasUnsentLocalCounts, setHasUnsentLocalCounts] = useState(false);
  const [recountChoice, setRecountChoice] = useState<PendingChipProposal | null>(null);
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
  const realtimeBlockedRef = useRef(false);
  // `syncState` cannot gate the actions ALONE: a tap in the same batch as a resync runs before
  // React has re-rendered with syncBlocked=true, so the DOM button is still enabled and its
  // handler still sees the old props. The ref closes that window synchronously — for this
  // component's own submit, and (through context) for the confirm panel's handler too.
  const syncBlockedRef = useRef(true);
  const submittingRef = useRef(false);
  const recountChoiceTakenRef = useRef(false);

  // The proposal is SERVER-persisted (games.pending_counts) and mirrored to all four phones
  // via realtime; each player confirms on their own phone (spec §8.6).
  const load = useCallback(async () => {
    const pass = ++passRef.current;
    const current = () => pass === passRef.current;
    // Block BEFORE the await, not after the next render: see the note on syncBlockedRef.
    syncBlockedRef.current = true;
    setSyncState('checking');

    const { data, error: readError } = await supabase.from('games')
      .select('pending_counts, pending_proposed_by, status, last_activity_at').eq('id', gameId).single();
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
          proposedBy: (data.pending_proposed_by as string | null) ?? null,
          // Proposal IDENTITY, not proposal CONTENT. propose_chip_counts stamps
          // last_activity_at on every call, so a recount that lands on byte-identical
          // numbers is still a NEW proposal — which a JSON signature of the counts cannot
          // see. (Other RPCs bump the stamp too; that errs towards showing this phone the
          // live proposal, which is the safe direction.)
          id: String(data.last_activity_at ?? JSON.stringify(data.pending_counts)),
        }
      : null);
    // A successful HTTP read makes the proposal fresh, but it does not restore the live channel.
    // Only a new SUBSCRIBED may reopen actions after a Realtime lifecycle failure.
    if (realtimeBlockedRef.current) { setSyncState('failed'); return; }
    // Only now — with the whole fresh row processed and the channel live — may this phone act.
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
    return subscribeAuthenticatedChannel(
      supabase,
      `chip-end-${gameId}`,
      () => supabase
        .channel(`chip-end-${gameId}`)
        // The handler is wrapped rather than passed straight through: supabase-js ignores what a
        // realtime callback returns, so handing it `load` hands it a floating promise nobody owns.
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'games', filter: `id=eq.${gameId}` },
          () => { void load(); }),
      (realtimeStatus) => {
        // Realtime does NOT replay events missed while the socket was down. Without this re-read,
        // a phone that was backgrounded across a re-proposal comes back showing the SUPERSEDED
        // proposal with an ENABLED Confirm — and that tap confirms the CURRENT one.
        if (realtimeStatus === 'SUBSCRIBED') {
          realtimeBlockedRef.current = false;
          void load();
        }
        else if (realtimeStatus === 'CHANNEL_ERROR' || realtimeStatus === 'TIMED_OUT' || realtimeStatus === 'CLOSED') {
          // Block immediately and invalidate any older successful read that is still in flight.
          passRef.current += 1;
          realtimeBlockedRef.current = true;
          syncBlockedRef.current = true;
          setSyncError(LIVE_CONNECTION_FAILED);
          setSyncState('failed');
        }
      },
    );
  }, [gameId, load]); // eslint-disable-line react-hooks/exhaustive-deps

  // Same hole, the other way in: the phone was locked, not disconnected.
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [load]);

  // Which phase is on screen. Hoisted above the render branch because the Escape floor below has
  // to stay off while the shared result is up.
  const showingProposal = Boolean(pending && pending.id !== recountingFrom);
  const activeRecountChoice = recountChoice?.id === pending?.id ? recountChoice : null;

  // FullScreenPanel's onKeyDown only fires for a key pressed on something INSIDE the panel. Its
  // background is not focusable, so a tap there parks focus on <body>, and every Escape after that
  // is dispatched where no React handler in this tree can see it. This listener is the floor for
  // that case alone: when the panel did handle the key it marks the event handled, and this defers
  // instead of closing twice. The result screen is deliberately exempt — a live shared proposal is
  // ended or recounted, never dismissed.
  useEffect(() => {
    if (showingProposal) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, showingProposal]);

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
      // Realtime owns the move to the shared result — on this phone as much as the other three.
      else {
        setHasUnsentLocalCounts(false);
        setSuccess(PROPOSED);
      }
    } catch (cause) {
      // Transport failure at the table: never leave the button stuck disabled.
      setError(cause instanceof Error ? cause.message : UNREACHABLE);
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const clearCountMessages = () => {
    setFailure(undefined);
    setError(undefined);
    setSuccess(undefined);
  };

  const startRecount = (proposal: PendingChipProposal, useTableNumbers: boolean) => {
    if (syncBlockedRef.current) return;
    if (useTableNumbers) {
      // CLONE. The editor must never share nested count objects with the proposal still owned by
      // realtime, or a local edit could mutate the supposedly current server snapshot in memory.
      setCounts(cloneChipCountTable(proposal.counts));
      setHasUnsentLocalCounts(false);
    }
    clearCountMessages();
    setRecountChoice(null);
    setRecountingFrom(proposal.id);
  };

  const takeRecountChoice = (proposal: PendingChipProposal, useTableNumbers: boolean) => {
    // The ref closes both same-batch holes: two taps before React removes this panel, and a tap
    // arriving in the same batch as load() blocks actions for a fresh server read.
    if (recountChoiceTakenRef.current || syncBlockedRef.current) return;
    recountChoiceTakenRef.current = true;
    startRecount(proposal, useTableNumbers);
  };

  if (activeRecountChoice && showingProposal) {
    return (
      <RecountChoicePanel
        syncBlocked={syncState !== 'ready'}
        syncError={syncError}
        onUseTableNumbers={() => takeRecountChoice(activeRecountChoice, true)}
        onUseMyNumbers={() => takeRecountChoice(activeRecountChoice, false)}
      />
    );
  }

  if (pending && showingProposal) {
    return (
      <ChipResultSyncBlockedContext.Provider value={syncBlockedRef}>
        <ChipResultPanel
          key={pending.id}
          gameId={gameId}
          proposal={pending}
          players={players}
          me={me}
          syncBlocked={syncState !== 'ready'}
          syncError={syncError}
          onRecount={(proposal) => {
            if (syncBlockedRef.current) return;
            if (hasUnsentLocalCounts && !chipCountTablesEqual(counts, proposal.counts)) {
              recountChoiceTakenRef.current = false;
              setRecountChoice(proposal);
              return;
            }
            startRecount(proposal, true);
          }}
        />
      </ChipResultSyncBlockedContext.Provider>
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
      onCountsChange={(next) => {
        setCounts(next);
        setHasUnsentLocalCounts(true);
      }}
      onSubmit={submit}
      onClose={onClose}
    />
  );
}
