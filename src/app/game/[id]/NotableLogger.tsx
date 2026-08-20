'use client';
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import type { Seat } from '../../../lib/engine/types';
import { logNotable } from '../../../lib/actions/game';
import { downscaleToWebp } from '../../../lib/image';
import { FullScreenPanel } from '../../../components/FullScreenPanel';
import { Button, LiveRegion } from '../../../components/ui';

type P = { playerId: string; seat: Seat; name: string };
type NH = { id: string; name: string; local_name: string | null };

export function NotableLogger({
  players, notableHands, gameId, syncBlocked = false, isSyncBlocked, syncError, onClose,
}: {
  players: P[];
  notableHands: NH[];
  gameId: string;
  syncBlocked?: boolean;
  isSyncBlocked?: () => boolean;
  syncError?: string;
  onClose: () => void;
}) {
  const [playerId, setPlayerId] = useState<string>();
  const [handId, setHandId] = useState<string>();
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const [photo, setPhoto] = useState<Blob>();
  const [preview, setPreview] = useState<string>();
  // Revealed only when the PHOTO leg failed. A refused claim would refuse again without it.
  const [canSkipPhoto, setCanSkipPhoto] = useState(false);
  const submittingRef = useRef(false);

  // An object URL is a document-lifetime handle, not a value; without this the preview leaks
  // every time the logger is opened during a long night.
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const choosePhoto = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setError(undefined);
    try {
      const shrunk = await downscaleToWebp(file);
      setPhoto(shrunk);
      setPreview((old) => { if (old) URL.revokeObjectURL(old); return URL.createObjectURL(shrunk); });
    } catch (cause) {
      setPhoto(undefined);
      setError(cause instanceof Error ? cause.message : 'Could not read that photo. Try again.');
    }
  };

  const submit = async (withPhoto: boolean) => {
    if (submittingRef.current || isSyncBlocked?.() || !playerId || !handId) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError(undefined);
    try {
      const result = await logNotable(gameId, playerId, handId, withPhoto ? photo : undefined);
      if (result.error) {
        setError(result.error);
        // Both choices are deliberately left standing so the escape re-sends the same claim.
        if (result.photoFailed) setCanSkipPhoto(true);
      } else onClose();
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

        <div>
          <label htmlFor="notable-photo" className="block text-sm font-bold">Photo of the tiles</label>
          <p className="mt-1 text-xs text-muted">Optional. The tiles get swept fast, so take it now if you want it.</p>
          <input id="notable-photo" type="file" accept="image/*" capture="environment"
            onChange={choosePhoto}
            className="mt-2 block w-full text-sm file:mr-3 file:min-h-11 file:rounded-[10px] file:border-2 file:border-ink file:bg-surface file:px-4 file:font-bold file:text-ink" />
          {preview ? (
            // Not next/image: `preview` is a blob: object URL that exists only in this tab, which
            // the optimizer cannot fetch.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="Photo of the tiles you are about to log"
              className="mt-3 max-h-48 rounded-[10px] border-2 border-divider object-contain" />
          ) : null}
        </div>

        <LiveRegion tone="error" message={syncError ?? error} />
        <Button className="w-full" disabled={syncBlocked || !playerId || !handId} busy={submitting}
          busyLabel={photo ? 'Uploading…' : 'Logging…'} onClick={() => submit(true)}>
          Log notable hand
        </Button>
        {canSkipPhoto ? (
          <Button className="w-full" variant="secondary" disabled={syncBlocked} busy={submitting}
            busyLabel="Logging…" onClick={() => submit(false)}>
            Log it without the photo
          </Button>
        ) : null}
      </div>
    </FullScreenPanel>
  );
}
