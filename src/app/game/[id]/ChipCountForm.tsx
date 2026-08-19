'use client';
import { FullScreenPanel } from '../../../components/FullScreenPanel';
import { Button, LiveRegion, SeatBadge, StatusMessage } from '../../../components/ui';
import { DENOMS, PER_PLAYER, TABLE_TOTAL, stackTotal, type Denom } from '../../../lib/chips';
import type { ConservationFailure } from '../../../lib/actions/game';
import type { Seat } from '../../../lib/engine/types';
import { SEAT_ORDER, cloneChipCountTable, type ChipCountTable, type ChipPlayer } from './chip-view';

const seatNames: Record<Seat, string> = { E: 'East', S: 'South', W: 'West', N: 'North' };

/**
 * Names every denomination that failed, not just the first. "Recount your $1 chips" sends four
 * people to the wrong pile when $1 and $50 are both out.
 */
function failureMessage(failure: ConservationFailure): string {
  const failed = failure.failedDenominations.map((d) => `$${d}`);
  // The type permits an empty list even though checkConservation never returns one; without this
  // the copy reads "Recount the  and undefined chips".
  const tail = failure.grandTotalOff
    ? 'The whole table total is also off.'
    : 'The table still totals correctly, so two stacks offset each other.';
  if (failed.length === 0) return `The counts do not add up. Recount every stack. ${tail}`;
  const names = failed.length === 1 ? failed[0] : `${failed.slice(0, -1).join(', ')} and ${failed.at(-1)}`;
  return `Recount the ${names} chips. ${tail}`;
}

export function ChipCountForm({
  players, counts, failure, error, success, submitting = false, syncBlocked = false,
  onCountsChange, onSubmit, onClose,
}: {
  players: ChipPlayer[];
  counts: ChipCountTable;
  failure?: ConservationFailure;
  error?: string;
  success?: string;
  submitting?: boolean;
  syncBlocked?: boolean;
  onCountsChange: (next: ChipCountTable) => void;
  onSubmit: () => void;
  onClose: () => void;
}) {
  const bySeat = (seat: Seat) => players.find((p) => p.seat === seat);
  const tableTotal = SEAT_ORDER.reduce((sum, seat) => sum + stackTotal(counts[seat]), 0);

  const setCount = (seat: Seat, denom: Denom, raw: string) => {
    // Clone first. Mutating the caller's table would leave the parent holding a value it never
    // agreed to, and React would not re-render for it either.
    // min and step are spinner hints, not validation: a typed "-2" or "1.5" otherwise reaches the
    // server and returns a raw validation string instead of the recount guidance this screen owns.
    const parsed = Number(raw);
    const next = cloneChipCountTable(counts);
    next[seat][denom] = Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
    onCountsChange(next);
  };

  return (
    <FullScreenPanel title="Count every stack" eyebrow="End game" onDismiss={onClose}>
      <p className="mt-4 text-sm leading-6 text-muted">
        One phone enters all four stacks. Everyone reviews the combined result next.
      </p>

      <div className="mt-5 flex flex-col gap-3">
        {/* Mounted before any message exists, so a change is announced rather than appearing silently. */}
        <LiveRegion tone="warning" message={failure ? failureMessage(failure) : undefined} />
        <LiveRegion tone="error" message={error} />
        <LiveRegion tone="success" message={success} />
        {syncBlocked && !error && (
          <StatusMessage tone="info">Checking the latest table count…</StatusMessage>
        )}
      </div>

      <div className="mt-6 flex flex-col gap-5 pb-32">
        {SEAT_ORDER.map((seat) => {
          const player = bySeat(seat);
          const name = player?.name ?? seatNames[seat];
          return (
            <section key={seat} className="rounded-[12px] border border-divider bg-surface p-4">
              <div className="flex items-center gap-3">
                <SeatBadge seat={seat} />
                <p className="min-w-0 flex-1 truncate font-bold">{name}</p>
                <p className="tnum shrink-0 font-extrabold">{stackTotal(counts[seat])}</p>
              </div>

              <div className="mt-4 grid grid-cols-4 gap-2">
                {DENOMS.map((d) => (
                  <div key={d} className="flex min-w-0 flex-col gap-1">
                    <span className="text-center text-xs font-bold">${d}</span>
                    <input
                      type="number"
                      min={0}
                      step={1}
                      inputMode="numeric"
                      aria-label={`${name} · ${seatNames[seat]} · $${d} chips`}
                      value={counts[seat][d]}
                      onChange={(event) => setCount(seat, d, event.target.value)}
                      // A field showing 0 with the caret before it turns an intended 5 into 50.
                      onFocus={(event) => event.target.select()}
                      className="tnum min-h-11 w-full min-w-0 rounded-[9px] border-2 border-divider bg-surface px-1.5 text-center font-bold focus:border-cobalt sm:px-3"
                    />
                    <span className="text-center text-[11px] text-muted">Start {PER_PLAYER[d]}</span>
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>

      <div
        data-testid="count-summary"
        className="sticky bottom-0 -mx-5 bg-gradient-to-t from-canvas from-60% to-transparent px-5 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-6"
      >
        <p className="tnum mb-3 text-center text-sm font-bold">
          Table total {tableTotal} / {TABLE_TOTAL}
        </p>
        <Button
          className="w-full"
          disabled={syncBlocked}
          busy={submitting}
          busyLabel="Checking counts…"
          onClick={onSubmit}
        >
          Check all counts
        </Button>
      </div>
    </FullScreenPanel>
  );
}
