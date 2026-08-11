'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '../../../lib/supabase/client';
import { DENOMS, PER_PLAYER, STACK_TOTAL, stackTotal, type ChipCounts } from '../../../lib/chips';
import type { Seat } from '../../../lib/engine/types';
import { proposeChipCounts, confirmChipResult, type ConservationFailure } from '../../../lib/actions/game';

type P = { playerId: string; seat: Seat; name: string };
type Pending = { counts: Record<Seat, ChipCounts>; confirmed: string[] } | null;

const emptyCounts = (): ChipCounts => ({ 1: 0, 10: 0, 50: 0, 100: 0 });
const TITLE_ID = 'chip-end-title';

/** Full-screen overlay with dialog semantics. Escape backs out (the handler lives in the parent). */
function Overlay({ children }: { children: ReactNode }) {
  return (
    <div role="dialog" aria-modal="true" aria-labelledby={TITLE_ID}
      className="fixed inset-0 z-10 overflow-y-auto bg-white p-6 dark:bg-neutral-900">
      <div className="mx-auto flex max-w-md flex-col gap-4">{children}</div>
    </div>
  );
}

/**
 * Phase 2 — everyone confirms the same server-side proposal.
 *
 * Rendered with key={signature of pending.counts} by the parent: confirm_chip_result carries
 * no proposal version, so a phone still showing proposal v1 could confirm against v2. Remounting
 * on a counts change throws away every scrap of local confirm state, forcing a fresh look at the
 * numbers before this phone can confirm again. (A change to pending_confirmed alone keeps the
 * same key, so the live 2/4 → 3/4 ticker does not reset anything.)
 */
function ConfirmPanel({ gameId, pending, me, nameOf, onRecount }: {
  gameId: string; pending: NonNullable<Pending>; me: string;
  nameOf: (s: Seat) => string; onRecount: () => void;
}) {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const [justConfirmed, setJustConfirmed] = useState(false);

  const nets = (['E', 'S', 'W', 'N'] as const)
    .map((seat) => [seat, stackTotal(pending.counts[seat]) - STACK_TOTAL] as const);
  const iConfirmed = pending.confirmed.includes(me) || justConfirmed;

  return (
    <Overlay>
      <h2 id={TITLE_ID} className="text-lg font-bold">Confirm the count</h2>
      <ul className="rounded border p-3">
        {nets.map(([seat, net]) => (
          <li key={seat} className="flex justify-between py-0.5">
            <span>{nameOf(seat)}</span>
            <span className={`font-mono ${net > 0 ? 'text-green-600' : net < 0 ? 'text-red-600' : 'opacity-50'}`}>
              {net > 0 ? '+' : ''}{net}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-sm opacity-70">{pending.confirmed.length}/4 confirmed. The fourth confirmation locks the game.</p>
      <button disabled={iConfirmed || submitting}
        onClick={async () => {
          if (submitting || iConfirmed) return;
          setSubmitting(true);
          setError(undefined);
          try {
            const res = await confirmChipResult(gameId);
            if (res.error) setError(res.error);
            else {
              setJustConfirmed(true);
              if (res.result === 'ended') router.refresh();
            }
          } catch (e) {
            // A REJECTED action promise means the phone never reached the server — say so,
            // and leave the button usable (finally). Silently stuck is the worst outcome.
            setError(e instanceof Error ? e.message : 'could not reach the table — try again');
          } finally {
            setSubmitting(false);
          }
        }}
        className="rounded-lg border px-6 py-3 font-medium disabled:opacity-40">
        {iConfirmed ? 'You confirmed — waiting for the others' : submitting ? 'Confirming…' : 'Confirm my count'}
      </button>
      <button className="rounded border px-4 py-2 text-sm opacity-70" onClick={onRecount}>
        Something is wrong — recount
      </button>
      {error && <p className="text-red-600">{error}</p>}
    </Overlay>
  );
}

export function ChipEndFlow({ gameId, players, me, onClose }: {
  gameId: string; players: P[]; me: string; onClose: () => void;
}) {
  const router = useRouter();
  const [counts, setCounts] = useState<Record<Seat, ChipCounts>>(
    { E: emptyCounts(), S: emptyCounts(), W: emptyCounts(), N: emptyCounts() });
  const [pending, setPending] = useState<Pending>(null);
  const [failure, setFailure] = useState<ConservationFailure | null>(null);
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  // Signature of the proposal this phone said "recount" to. Held rather than clearing `pending`,
  // because any games UPDATE (someone else confirming) re-runs load() and would otherwise yank
  // this phone back to the confirm view mid-recount. A genuinely NEW proposal has a new
  // signature and does pull it back — which is what should happen.
  const [recountingFrom, setRecountingFrom] = useState<string | null>(null);
  const supabase = createClient();

  // The proposal is SERVER-persisted (games.pending_counts) and mirrored to all four phones
  // via realtime; each player confirms on their own phone (spec §8.6).
  useEffect(() => {
    const load = async () => {
      const { data } = await supabase.from('games')
        .select('pending_counts, pending_confirmed, status').eq('id', gameId).single();
      if (data?.status === 'ended') { router.refresh(); return; }
      setPending(data?.pending_counts
        ? { counts: data.pending_counts as Record<Seat, ChipCounts>, confirmed: data.pending_confirmed ?? [] }
        : null);
    };
    // initial fetch on mount; the subscription below keeps it fresh thereafter
    load();
    const ch = supabase
      .channel(`chip-end-${gameId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'games', filter: `id=eq.${gameId}` }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [gameId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const name = (s: Seat) => players.find((p) => p.seat === s)?.name ?? s;

  const sig = pending ? JSON.stringify(pending.counts) : null;

  if (pending && sig !== recountingFrom) {
    return (
      <ConfirmPanel key={sig!} gameId={gameId} pending={pending}
        me={me} nameOf={name} onRecount={() => setRecountingFrom(sig)} />
    );
  }

  return (
    <Overlay>
      <div className="flex justify-between">
        <h2 id={TITLE_ID} className="text-lg font-bold">Count chips</h2>
        <button onClick={onClose} className="opacity-60">Cancel</button>
      </div>
      <p className="text-sm opacity-70">Count each stack by denomination — the app does the math.</p>
      {failure && (
        <p className="rounded border border-amber-500 p-3 text-sm">
          The count doesn&apos;t balance. Recount the{' '}
          <strong>{failure.failedDenominations.map((d) => `$${d}`).join(' and ')}</strong> chips
          {failure.grandTotalOff ? '.' : ' — the totals balance, so two stacks are miscounted against each other.'}
        </p>
      )}
      {(['E', 'S', 'W', 'N'] as const).map((seat) => (
        <fieldset key={seat} className="rounded border p-3">
          <legend className="px-1 text-sm font-medium">{name(seat)}</legend>
          <div className="grid grid-cols-4 gap-2">
            {DENOMS.map((d) => (
              <label key={d} className="flex flex-col text-xs">
                <span className="opacity-60">${d} (start {PER_PLAYER[d]})</span>
                <input type="number" min={0} inputMode="numeric"
                  className="rounded border px-2 py-2 text-right"
                  value={counts[seat][d]}
                  onChange={(e) => setCounts({ ...counts, [seat]: { ...counts[seat], [d]: Number(e.target.value) } })} />
              </label>
            ))}
          </div>
          <p className="mt-1 text-right font-mono text-sm">= {stackTotal(counts[seat])} pts</p>
        </fieldset>
      ))}
      <button disabled={submitting}
        onClick={async () => {
          if (submitting) return;
          setSubmitting(true);
          setError(undefined); setFailure(null);
          try {
            const res = await proposeChipCounts(gameId, counts);
            if (res.conservation) setFailure(res.conservation);
            else if (res.error) setError(res.error);
            // on success the realtime UPDATE flips every phone (this one included) to the confirm view
          } catch (e) {
            // Transport failure at the table: never leave the button stuck disabled.
            setError(e instanceof Error ? e.message : 'could not reach the table — try again');
          } finally {
            setSubmitting(false);
          }
        }}
        className="rounded-lg border px-6 py-3 font-medium disabled:opacity-40">
        {submitting ? 'Checking…' : <>Check &amp; propose</>}
      </button>
      {error && <p className="text-red-600">{error}</p>}
    </Overlay>
  );
}
