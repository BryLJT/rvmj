'use client';
import { useState } from 'react';
import type { Seat } from '../../../lib/engine/types';
import { logNotable } from '../../../lib/actions/game';

type P = { playerId: string; seat: Seat; name: string };
type NH = { id: string; name: string; local_name: string | null };

export function NotableLogger({ players, notableHands, gameId, onClose }: {
  players: P[]; notableHands: NH[]; gameId: string; onClose: () => void;
}) {
  const [playerId, setPlayerId] = useState<string>();
  const [handId, setHandId] = useState<string>();
  const [error, setError] = useState<string>();
  return (
    <div className="fixed inset-0 z-10 overflow-y-auto bg-white p-6 dark:bg-neutral-900">
      <div className="mx-auto flex max-w-md flex-col gap-4">
        <div className="flex justify-between">
          <h2 className="text-lg font-bold">Log notable hand</h2>
          <button onClick={onClose} className="opacity-60">Cancel</button>
        </div>
        <span className="text-sm">Who won it?</span>
        <div className="flex flex-wrap gap-2">
          {players.map((p) => (
            <button key={p.playerId} onClick={() => setPlayerId(p.playerId)}
              className={`rounded border px-3 py-2 ${playerId === p.playerId ? 'bg-black text-white dark:bg-white dark:text-black' : ''}`}>
              {p.name}
            </button>
          ))}
        </div>
        <span className="text-sm">Which hand?</span>
        <select value={handId ?? ''} onChange={(e) => setHandId(e.target.value || undefined)} className="rounded border px-2 py-2">
          <option value="">Pick a hand…</option>
          {notableHands.map((h) => (
            <option key={h.id} value={h.id}>{h.name}{h.local_name ? ` (${h.local_name})` : ''}</option>
          ))}
        </select>
        <button disabled={!playerId || !handId}
          onClick={async () => {
            const res = await logNotable(gameId, playerId!, handId!);
            if (res.error) setError(res.error); else onClose();
          }}
          className="rounded-lg border px-6 py-3 font-medium disabled:opacity-40">
          Log it
        </button>
        {error && <p className="text-red-600">{error}</p>}
      </div>
    </div>
  );
}
