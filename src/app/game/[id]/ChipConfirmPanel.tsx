'use client';

import { createContext, useContext, useRef, useState, type RefObject } from 'react';
import { useRouter } from 'next/navigation';
import { FullScreenPanel } from '../../../components/FullScreenPanel';
import { Button, LiveRegion, PlayerRow, StatusMessage } from '../../../components/ui';
import { confirmChipResult } from '../../../lib/actions/game';
import { STACK_TOTAL, stackTotal } from '../../../lib/chips';
import { SEAT_ORDER, type ChipPlayer, type PendingChipProposal } from './chip-view';

const names = (list: ChipPlayer[]) => (
  list.length === 0 ? 'Nobody' : list.map((player) => player.name).join(', ')
);

/** Lets the parent close the stale-action window before React commits its checking state. */
export const ChipConfirmSyncBlockedContext = createContext<RefObject<boolean> | null>(null);

function SignedResult({ value }: { value: number }) {
  const tone = value > 0 ? 'text-gain' : value < 0 ? 'text-coral' : 'text-muted';
  return (
    <span className={`tnum text-lg font-extrabold ${tone}`}>
      {value > 0 ? `+${value}` : String(value)}
    </span>
  );
}

export function ChipConfirmPanel({
  gameId, proposal, players, me, syncBlocked, syncError, onRecount,
}: {
  gameId: string;
  proposal: PendingChipProposal;
  players: ChipPlayer[];
  me: string;
  syncBlocked: boolean;
  syncError?: string;
  onRecount: (proposal: PendingChipProposal) => void;
}) {
  const router = useRouter();
  const [actionError, setActionError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const parentSyncBlockedRef = useContext(ChipConfirmSyncBlockedContext);
  // Only the SAME-BATCH cases need a ref. `syncBlocked` and `iConfirmed` belong to the render
  // this handler was created in, so the closure already sees exactly what a ref written during
  // that render would hold — copying them only broke the no-ref-writes-during-render rule. What
  // a closure cannot see is a block the PARENT raised after this render (the context ref) or a
  // first activation from this very batch (`submittingRef`).
  const submittingRef = useRef(false);
  const iConfirmed = proposal.confirmed.includes(me);

  // Masking is not forgetting. `syncError ?? actionError` hides the action error under the newer
  // sync failure, but it survives underneath — so when the read recovers and the sync error
  // clears, an alert describing an attempt two reads ago pops back into an assertive region, is
  // re-announced, and sits beside a freshly re-enabled Confirm. Newer bad news retires the old.
  const [maskingSyncError, setMaskingSyncError] = useState(syncError);
  if (syncError !== maskingSyncError) {
    setMaskingSyncError(syncError);
    if (syncError) setActionError(undefined);
  }

  const confirmed = players.filter((player) => proposal.confirmed.includes(player.playerId));
  const waiting = players.filter((player) => !proposal.confirmed.includes(player.playerId));

  const confirm = async () => {
    if (submittingRef.current || syncBlocked || parentSyncBlockedRef?.current || iConfirmed) return;
    submittingRef.current = true;
    setSubmitting(true);
    setActionError(undefined);
    try {
      const result = await confirmChipResult(gameId);
      if (result.error) setActionError(result.error);
      else if (result.result === 'ended') router.refresh();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Could not reach the table. Try again.');
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  return (
    <FullScreenPanel title="Confirm the table count" eyebrow="All four players">
      {/*
        Ordered by SEAT, never by the `players` array. That array comes from an embedded
        game_players select with no ORDER BY, so its order is not stable — it can differ between
        the four phones and can reorder in place after a router.refresh(). This is the one screen
        whose entire purpose is four people comparing the SAME list before approving it.
      */}
      <ul className="rounded-[14px] border border-divider bg-surface px-4 sm:px-5">
        {SEAT_ORDER.map((seat) => {
          const player = players.find((candidate) => candidate.seat === seat);
          return (
            <PlayerRow
              key={seat}
              seat={seat}
              name={player?.name ?? seat}
              isMe={player?.playerId === me}
              trailing={<SignedResult value={stackTotal(proposal.counts[seat]) - STACK_TOTAL} />}
            />
          );
        })}
      </ul>

      <section aria-label="Confirmation progress" className="mt-5 rounded-[14px] border border-divider bg-surface p-4">
        <p className="font-extrabold">{confirmed.length} of 4 confirmed</p>
        <dl className="mt-3 grid gap-2 text-sm">
          <div><dt className="font-bold text-gain">Confirmed</dt><dd>{names(confirmed)}</dd></div>
          <div><dt className="font-bold text-amber">Waiting</dt><dd>{names(waiting)}</dd></div>
        </dl>
      </section>

      <div className="mt-5 flex flex-col gap-3">
        {syncBlocked && !syncError && (
          <StatusMessage tone="info">Checking the latest table count…</StatusMessage>
        )}
        <LiveRegion tone="error" message={syncError ?? actionError} />
        <Button
          className="w-full"
          disabled={iConfirmed || syncBlocked}
          busy={submitting}
          busyLabel="Confirming…"
          onClick={confirm}
        >
          {iConfirmed ? 'You confirmed · waiting for the table' : 'Confirm my count'}
        </Button>
        {/*
          Closed while confirming: that confirmation is still in flight against the very proposal
          being rejected, and as the fourth one it finalizes the game — leaving this phone in a
          recount form that can never propose, because propose_chip_counts needs status 'active'.
          Closed while the read is unverified for the same reason every other action here is: it
          would seed the form from a proposal that may already be superseded and latch that stale
          id as the recount origin, so the recovering read pulls the phone straight back out.
        */}
        <Button
          variant="secondary"
          className="w-full"
          disabled={submitting || syncBlocked}
          onClick={() => onRecount(proposal)}
        >
          Something is wrong · recount
        </Button>
      </div>
    </FullScreenPanel>
  );
}
