'use client';
import { useRef, useState } from 'react';
import type { Seat } from '../../../lib/engine/types';
import { logNotable } from '../../../lib/actions/game';
import { FullScreenPanel } from '../../../components/FullScreenPanel';
import { Button, LiveRegion } from '../../../components/ui';

type P = { playerId: string; seat: Seat; name: string };
type NH = { id: string; name: string; local_name: string | null };

export function NotableLogger({ players, notableHands, gameId, onClose }: {
  players: P[]; notableHands: NH[]; gameId: string; onClose: () => void;
}) {
  const [playerId, setPlayerId] = useState<string>();
  const [handId, setHandId] = useState<string>();
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);

  const submit = async () => {
    if (submittingRef.current || !playerId || !handId) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError(undefined);
    try {
      const result = await logNotable(gameId, playerId, handId);
      if (result.error) setError(result.error);
      else onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not reach the table. Try again.');
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  return (
    <FullScreenPanel title="Log notable hand" onDismiss={onClose}>
      <div className="flex max-w-xl flex-col gap-6">
        <fieldset>
          <legend className="text-sm font-bold">Who won it?</legend>
        <div className="flex flex-wrap gap-2">
          {players.map((p) => (
              <Button key={p.playerId} variant={playerId === p.playerId ? 'primary' : 'secondary'}
                aria-pressed={playerId === p.playerId} onClick={() => setPlayerId(p.playerId)}>
              {p.name}
              </Button>
          ))}
        </div>
        </fieldset>

        <div>
          <label htmlFor="notable-hand" className="block text-sm font-bold">Notable hand</label>
          <select id="notable-hand" value={handId ?? ''}
            onChange={(event) => setHandId(event.target.value || undefined)}
            className="mt-2 min-h-11 w-full rounded-[10px] border-2 border-divider bg-surface px-3 text-ink focus:border-cobalt focus:outline-2 focus:outline-offset-2 focus:outline-cobalt">
            <option value="">Pick a hand…</option>
            {notableHands.map((hand) => (
              <option key={hand.id} value={hand.id}>{hand.name}{hand.local_name ? ` (${hand.local_name})` : ''}</option>
            ))}
          </select>
        </div>

        <LiveRegion tone="error" message={error} />
        <Button className="w-full" disabled={!playerId || !handId} busy={submitting}
          busyLabel="Logging…" onClick={submit}>
          Log notable hand
        </Button>
      </div>
    </FullScreenPanel>
  );
}
