'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { deleteNotableWin, updateNotableWinHands } from '../lib/actions/game';
import { Button, LiveRegion } from './ui';
import type { HandType } from './HandTypeFilter';

/** Same three groups, in the same order, as the in-match logger. */
const RARITIES = [
  ['uncommon', 'Uncommon'],
  ['rare', 'Rare'],
  ['legendary', 'Legendary'],
] as const;

type Mode = 'idle' | 'editing' | 'confirmingDelete';

/**
 * Correct a win after the fact: change its hand tags, or delete it.
 *
 * Rendered ONLY for a viewer who sat at that game, which is a matter of not drawing a button
 * nobody can use. It is not the guard: `update_notable_win_hands` and `delete_notable_win` both
 * re-check participation inside the transaction that writes, as the photo functions do.
 *
 * Deleting is permanent and takes the photo with it, for everyone, so it always asks first.
 * Changing tags is not destructive, so it saves in one step.
 */
export function NotableWinEditControls({ claimId, currentHandIds, catalogue, backHref }: {
  claimId: string;
  currentHandIds: string[];
  catalogue: HandType[];
  /** Where to go once the win no longer exists: its own page would be a not-found. */
  backHref: string;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('idle');
  const [selected, setSelected] = useState<string[]>(currentHandIds);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const toggle = (id: string) => setSelected((now) =>
    now.includes(id) ? now.filter((existing) => existing !== id) : [...now, id]);

  const startEditing = () => {
    // Start from what the win carries NOW, so a cancelled earlier edit leaves no stale ticks.
    setSelected(currentHandIds);
    setError(undefined);
    setMode('editing');
  };

  const cancel = () => {
    setMode('idle');
    setError(undefined);
  };

  const save = async () => {
    if (busy) return;
    if (selected.length === 0) {
      setError('Choose at least one hand type.');
      return;
    }
    setBusy(true);
    setError(undefined);
    const result = await updateNotableWinHands(claimId, selected);
    setBusy(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setMode('idle');
    router.refresh();
  };

  const confirmDelete = async () => {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    const result = await deleteNotableWin(claimId);
    if (result.error) {
      setBusy(false);
      setError(result.error);
      return;
    }
    // `busy` stays on: the page is leaving, and a second tap would hit a win that is gone.
    router.replace(backHref);
  };

  if (mode === 'editing') {
    return (
      <section aria-label="Change hand types" className="mt-6 flex flex-col gap-4 border-t-2 border-divider pt-4">
        <h3 className="text-sm font-bold">Change hand types</h3>
        {RARITIES.map(([rarity, label]) => (
          <fieldset key={rarity}>
            <legend className="text-xs font-bold uppercase tracking-[0.18em] text-muted">{label}</legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {catalogue.filter((hand) => hand.rarity === rarity).map((hand) => (
                <label key={hand.id}
                  className="flex min-h-11 cursor-pointer items-center gap-3 rounded-[10px] border-2 border-divider bg-surface px-3 py-2 text-sm font-bold text-ink has-checked:border-cobalt has-checked:bg-cobalt/10">
                  <input type="checkbox" checked={selected.includes(hand.id)}
                    onChange={() => toggle(hand.id)} className="size-5 shrink-0 accent-cobalt" />
                  <span>{hand.name}</span>
                  {hand.local_name ? <span aria-hidden className="font-normal text-muted">({hand.local_name})</span> : null}
                </label>
              ))}
            </div>
          </fieldset>
        ))}
        <Button variant="primary" busy={busy} busyLabel="Saving…" onClick={save}>Save hands</Button>
        <Button variant="quiet" disabled={busy} onClick={cancel}>Cancel</Button>
        <LiveRegion tone="error" message={error} />
      </section>
    );
  }

  if (mode === 'confirmingDelete') {
    return (
      <section aria-label="Delete this win" className="mt-6 flex flex-col gap-2 border-t-2 border-divider pt-4">
        <p className="text-sm leading-6 text-ink">
          Delete this win? It leaves the boards and the photo archive, and its photo is deleted too.
          This is permanent and applies to everyone.
        </p>
        <Button variant="destructive" busy={busy} busyLabel="Deleting…" onClick={confirmDelete}>
          Yes, delete this win
        </Button>
        <Button variant="quiet" disabled={busy} onClick={cancel}>Keep it</Button>
        <LiveRegion tone="error" message={error} />
      </section>
    );
  }

  return (
    <section aria-label="Correct this win" className="mt-6 flex flex-col gap-2 border-t-2 border-divider pt-4">
      {/* No list to tick from means no honest way to edit, so only delete stays. */}
      {catalogue.length > 0 ? <Button variant="secondary" onClick={startEditing}>Change hands</Button> : null}
      <Button variant="destructive" onClick={() => { setError(undefined); setMode('confirmingDelete'); }}>
        Delete this win
      </Button>
    </section>
  );
}
