'use client';

import { createContext, useContext, useEffect, useRef, useState, type RefObject } from 'react';
import { useRouter } from 'next/navigation';
import { FullScreenPanel } from '../../../components/FullScreenPanel';
import { Button, LiveRegion, PlayerRow, StatusMessage } from '../../../components/ui';
import { endChipGame } from '../../../lib/actions/game';
import { STACK_TOTAL, stackTotal } from '../../../lib/chips';
import type { GameVariant } from '../../../lib/game-variant';
import { GameChoiceDialog } from './GameChoiceDialog';
import { SEAT_ORDER, type ChipPlayer, type PendingChipProposal } from './chip-view';

/**
 * The reading window (spec §8.6). Deliberately CLIENT-side: the only person who can reach the
 * End control is the one who just entered the counts and decided the match was over, so this is
 * an ergonomic speed bump for a cooperating user, not a security boundary. The database enforces
 * who may end the match; it does not enforce when.
 */
export const END_ARMING_SECONDS = 4;

/**
 * How long the "which game was this?" question ignores an answer after it opens.
 *
 * The question appears in the middle of the screen at the instant End match is pressed, so the
 * second half of a double tap lands on whichever answer happens to be under the thumb. That would
 * file the match on a ladder nobody chose, and only this phone would have seen it happen. Long
 * enough to swallow a double tap, short enough that nobody deliberately answering notices it.
 */
export const CHOICE_GUARD_MS = 400;

/** Lets the parent close the stale-action window before React commits its checking state. */
export const ChipResultSyncBlockedContext = createContext<RefObject<boolean> | null>(null);

function SignedResult({ value }: { value: number }) {
  const tone = value > 0 ? 'text-gain' : value < 0 ? 'text-coral' : 'text-muted';
  return (
    <span className={`tnum text-lg font-extrabold ${tone}`}>
      {value > 0 ? `+${value}` : String(value)}
    </span>
  );
}

export function ChipResultPanel({
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
  // The question End match opens (Bryan, 2026-10-08). The parent remounts this panel on every
  // new proposal, so a recount that lands while the question is up also takes it down.
  const [choosing, setChoosing] = useState(false);
  const [endingAs, setEndingAs] = useState<GameVariant | null>(null);
  const choiceOpenedAtRef = useRef(0);
  const parentSyncBlockedRef = useContext(ChipResultSyncBlockedContext);
  const submittingRef = useRef(false);

  // Whoever entered the counts owns the End control, and nobody else does — not East, not the
  // player whose score it is. The parent remounts this panel on every new proposal (key is the
  // proposal id), so a recount that transfers the counter also restarts the window below.
  const isCounter = proposal.proposedBy !== null && proposal.proposedBy === me;

  const [remaining, setRemaining] = useState(END_ARMING_SECONDS);
  const armed = remaining <= 0;
  // Depends on `armed`, NOT on `remaining`. Keyed on the count itself, the interval is torn down
  // and rebuilt on every tick, and each rebuild restarts the full second from whenever the effect
  // happens to run — so the window silently takes longer than it claims. This starts once and
  // stops once.
  useEffect(() => {
    if (armed) return;
    const tick = setInterval(() => setRemaining((left) => Math.max(0, left - 1)), 1000);
    return () => clearInterval(tick);
  }, [armed]);
  // Masking is not forgetting. `syncError ?? actionError` hides the action error under the newer
  // sync failure, but it survives underneath — so when the read recovers and the sync error
  // clears, an alert describing an attempt two reads ago pops back into an assertive region, is
  // re-announced, and sits beside a freshly re-enabled End.
  //
  // The clear runs on EITHER edge, deliberately. Watching only the rising edge misses the action
  // that fails while the sync error is ALREADY showing — no transition happens at the moment it is
  // set, so nothing ever retires it.
  const [maskingSyncError, setMaskingSyncError] = useState(syncError);
  if (syncError !== maskingSyncError) {
    setMaskingSyncError(syncError);
    setActionError(undefined);
  }

  // One seat-ordered pass drives the rows. `players` arrives in whatever order the embedded
  // select returned, and this is the one screen whose entire purpose is four people comparing
  // the SAME list before it becomes permanent.
  const seatedRows = SEAT_ORDER.map((seat) => ({ seat, player: players.find((p) => p.seat === seat) }));
  const counter = players.find((player) => player.playerId === proposal.proposedBy);

  // End match no longer ends anything by itself: it asks which game this was. Every guard the
  // end used to pass is passed HERE as well, so the question cannot even be opened against a
  // table count this phone has not verified.
  const askWhichGame = () => {
    if (submittingRef.current || syncBlocked || parentSyncBlockedRef?.current) return;
    // `armed` is read from the closure, not a ref, and deliberately so. It belongs to the render
    // this handler was created in, and the only transition it can be stale across is closed to
    // OPEN — so a stale read refuses a tap that would otherwise have been allowed, never the
    // reverse. Refs are for blocks arriving from OUTSIDE this render (the parent's resync) or
    // from this very batch (a second tap), where staleness fails the dangerous way.
    if (!armed) return;
    setActionError(undefined);
    choiceOpenedAtRef.current = Date.now();
    setChoosing(true);
  };

  const end = async (variant: GameVariant) => {
    // Checked again, not inherited from the tap that opened the question: the table can be
    // recounted, or the read can go stale, in the time somebody spends deciding.
    if (submittingRef.current || syncBlocked || parentSyncBlockedRef?.current) return;
    if (Date.now() - choiceOpenedAtRef.current < CHOICE_GUARD_MS) return;
    submittingRef.current = true;
    setSubmitting(true);
    setEndingAs(variant);
    setActionError(undefined);
    try {
      const result = await endChipGame(gameId, variant);
      if (result.error) setActionError(result.error);
      else if (result.result === 'ended') router.refresh();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Could not reach the table. Try again.');
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
      setEndingAs(null);
      // Closed on a refusal as well as on success. The refusal is shown on the panel underneath,
      // beside the End control it restores, which is where this screen has always reported one.
      setChoosing(false);
    }
  };

  // The eyebrow is NOT "Final result": that is the ended-game view's own label, and these numbers
  // are not final until the counter ends the match. Two screens claiming the same words is exactly
  // the confusion this panel exists to prevent.
  return (
    <FullScreenPanel title="The table count" eyebrow="Check the numbers">
      {/*
        Ordered by SEAT, never by the `players` array — that array comes from an embedded
        game_players select with no ORDER BY, so its order is not stable between the four phones.
      */}
      <ul className="rounded-[14px] border border-divider bg-surface px-4 sm:px-5">
        {seatedRows.map(({ seat, player }) => (
          <PlayerRow
            key={seat}
            seat={seat}
            name={player?.name ?? seat}
            isMe={player?.playerId === me}
            trailing={<SignedResult value={stackTotal(proposal.counts[seat]) - STACK_TOTAL} />}
          />
        ))}
      </ul>

      <div className="mt-5 flex flex-col gap-3">
        {syncBlocked && !syncError && (
          <StatusMessage tone="info">Checking the latest table count…</StatusMessage>
        )}
        <LiveRegion tone="error" message={syncError ?? actionError} />

        {isCounter ? (
          <Button
            className="w-full"
            disabled={!armed || syncBlocked}
            busy={submitting}
            busyLabel="Ending…"
            onClick={askWhichGame}
          >
            {armed ? 'End match' : `End match in ${remaining}…`}
          </Button>
        ) : (
          <StatusMessage tone="info">
            {/*
              A proposal with no recorded counter can only come from a match that was already
              showing counts when 0007 landed. Nobody inherits the End control; somebody has to
              recount to take it, which is the same path a dead phone takes.
            */}
            {counter
              ? `Waiting for ${counter.name} to end the match.`
              : 'Nobody has claimed this count. Recount to take it over.'}
          </StatusMessage>
        )}

        {/*
          Recount stays open to EVERYONE, the counter included, and it is the only control the
          other three have. Closed while an end is in flight (that call may already have settled
          the match, leaving this phone in a form that can never propose) and while the read is
          unverified (it would seed the form from a proposal that may already be superseded).
        */}
        <Button
          variant="secondary"
          className="w-full"
          disabled={submitting || syncBlocked}
          onClick={() => {
            if (submittingRef.current || parentSyncBlockedRef?.current) return;
            onRecount(proposal);
          }}
        >
          Something is wrong · recount
        </Button>
      </div>

      {choosing && (
        <GameChoiceDialog
          endingAs={endingAs}
          disabled={syncBlocked}
          // Only the sync failure is repeated in here. It is the one message that explains why
          // the answers have just closed; an action refusal closes the question instead.
          error={syncError}
          onChoose={end}
          onCancel={() => { if (!submittingRef.current) setChoosing(false); }}
        />
      )}
    </FullScreenPanel>
  );
}
