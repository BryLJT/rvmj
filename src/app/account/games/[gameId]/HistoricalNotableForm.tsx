'use client';
import { useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { saveHistoricalNotable } from '../../../../lib/actions/history';
import { formatHistoryDate, type HistoryGame, type HistoricalSave } from '../../../../lib/game-history';
import type { HandType } from '../../../../components/HandTypeFilter';
import { Button, LiveRegion } from '../../../../components/ui';
import { HistoricalPhotoPicker } from './HistoricalPhotoPicker';
export function HistoricalNotableForm({ game, catalogue, onSaved, onCancel }: {
  game: HistoryGame;
  catalogue: HandType[];
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [winnerId, setWinner] = useState(game.players[0]?.playerId ?? '');
  const [handIds, setHands] = useState<string[]>([]);
  const [photo, setPhoto] = useState<Blob>();
  const [busy, setBusy] = useState(false), [preparing, setPreparing] = useState(false);
  const [error, setError] = useState<string>(), [expired, setExpired] = useState(false);
  const pending = useRef(false);
  const request = useRef<HistoricalSave | null>(null);
  // Once submitted, the payload stays fixed while its outcome may be unknown. A new form gets
  // a new UUID, so two real wins with identical winner/labels remain separate wins.
  const [attempted, setAttempted] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending.current || preparing || !winnerId || !handIds.length)
      return;
    pending.current = true;
    setBusy(true);
    setError(undefined);
    setExpired(false);
    if (!request.current)
      request.current = { requestId: crypto.randomUUID(), gameId: game.id, winnerId, handIds: [...handIds], photo };
    setAttempted(true);
    try {
      const result = await saveHistoricalNotable(request.current);
      if (result.status === 'saved')
        onSaved();
      else if (result.status === 'expired') {
        setExpired(true);
        setError('Your sign-in expired. Sign in again, then retry this save.');
      }
      else
        setError(result.message);
    }
    catch {
      setError('Could not confirm this save. Your choices are still here. Retry the same save.');
    }
    finally {
      pending.current = false;
      setBusy(false);
    }
  };
  return <form onSubmit={submit} className="mt-6 flex flex-col gap-6 rounded-[14px] border border-divider bg-surface p-4 sm:p-5">
  <div><h3 className="text-xl font-extrabold">Add notable win</h3><p className="mt-2 text-xs text-muted">For the game on {formatHistoryDate(game.endedAt)}.</p></div>
  <div><label htmlFor="historical-winner" className="text-sm font-bold">Who won?</label><select id="historical-winner" value={winnerId} onChange={event => setWinner(event.target.value)} disabled={busy || attempted} className="mt-2 min-h-11 w-full rounded-[10px] border-2 border-ink bg-surface px-3 font-bold">{game.players.map(player => <option key={player.playerId} value={player.playerId}>{player.name}</option>)}</select></div>
  <fieldset disabled={busy || attempted}><legend className="text-sm font-bold">Hand types</legend><p className="mt-1 text-xs text-muted">Choose all that apply.</p>
   <div className="mt-3 flex flex-wrap gap-2">{catalogue.map(hand => <label key={hand.id} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-[10px] border border-divider px-3 py-2 text-xs font-semibold has-checked:border-cobalt has-checked:bg-cobalt-soft">
    <input type="checkbox" className="size-4 accent-cobalt" checked={handIds.includes(hand.id)} onChange={() => setHands(current => current.includes(hand.id) ? current.filter(id => id !== hand.id) : [...current, hand.id])}/><span>{hand.name}{hand.local_name ? <span className="ml-1 font-normal text-muted">{hand.local_name}</span> : null}</span></label>)}</div></fieldset>
  <HistoricalPhotoPicker disabled={busy || attempted} onChange={setPhoto} onPreparing={setPreparing}/>
  <p className="text-xs leading-5 text-muted">This win keeps the original game date. It does not change the game’s scores.</p>
  <LiveRegion tone="error" message={error}/>
  {expired ? <Link target="_blank" rel="noopener" className="font-bold text-cobalt" href={`/login?next=${encodeURIComponent(`/account/games/${game.id}`)}`}>Sign in in a new tab</Link> : null}
  {attempted && error ? <p className="text-xs leading-5 text-muted">Your save choices are held while you retry. Check the recorded wins before starting another save.</p> : null}
  <Button type="submit" busy={busy} busyLabel="Saving…" disabled={preparing || !winnerId || !handIds.length}>Save notable win</Button>
  <Button variant="quiet" disabled={busy} onClick={onCancel}>Cancel</Button>
 </form>;
}
