'use client';
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import type { Seat } from '../../../lib/engine/types';
import { logNotable } from '../../../lib/actions/game';
import { preparePhoto } from '../../../lib/image';
import { FullScreenPanel } from '../../../components/FullScreenPanel';
import { Button, LiveRegion } from '../../../components/ui';

type P = { playerId: string; seat: Seat; name: string };
type NH = {
  id: string;
  name: string;
  local_name: string | null;
  rarity: 'uncommon' | 'rare' | 'legendary';
};

const RARITIES = [
  ['uncommon', 'Uncommon'],
  ['rare', 'Rare'],
  ['legendary', 'Legendary'],
] as const;

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
  const [selectedHandIds, setSelectedHandIds] = useState<string[]>([]);
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const [photo, setPhoto] = useState<Blob>();
  const [preview, setPreview] = useState<string>();
  const [preparingPhoto, setPreparingPhoto] = useState(false);
  // Revealed only when the PHOTO leg failed. A refused claim would refuse again without it.
  const [canSkipPhoto, setCanSkipPhoto] = useState(false);
  const submittingRef = useRef(false);
  const preparingPhotoRef = useRef(false);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const libraryInputRef = useRef<HTMLInputElement>(null);

  // An object URL is a document-lifetime handle, not a value; without this the preview leaks
  // every time the logger is opened during a long night.
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const choosePhoto = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    // Browsers do not fire change when the same file is selected twice unless the input is reset.
    input.value = '';
    if (!file) return;
    setError(undefined);
    setCanSkipPhoto(false);
    setPhoto(undefined);
    setPreview(undefined);
    preparingPhotoRef.current = true;
    setPreparingPhoto(true);
    try {
      const shrunk = await preparePhoto(file);
      setPhoto(shrunk);
      setPreview(URL.createObjectURL(shrunk));
    } catch (cause) {
      setPhoto(undefined);
      setError(cause instanceof Error ? cause.message : 'Could not read that photo. Try another photo.');
    } finally {
      preparingPhotoRef.current = false;
      setPreparingPhoto(false);
    }
  };

  const removePhoto = () => {
    setPhoto(undefined);
    setPreview(undefined);
    setCanSkipPhoto(false);
    setError(undefined);
    if (cameraInputRef.current) cameraInputRef.current.value = '';
    if (libraryInputRef.current) libraryInputRef.current.value = '';
  };

  const toggleHand = (id: string) => {
    setSelectedHandIds((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  };

  const submit = async (withPhoto: boolean) => {
    if (
      submittingRef.current
      || preparingPhotoRef.current
      || isSyncBlocked?.()
      || !playerId
      || selectedHandIds.length === 0
    ) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError(undefined);
    try {
      const result = await logNotable(gameId, playerId, selectedHandIds, withPhoto ? photo : undefined);
      if (result.error) {
        setError(result.error);
        // Both choices are deliberately left standing so the escape re-sends the same claim.
        if (result.photoFailed) setCanSkipPhoto(true);
      } else onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not reach the table. Try again.');
      // A THROWN request is the dropped-connection case §8 exists for, and it is a photo
      // failure exactly when a photo was in flight. Without this the escape appears for a
      // server that answered "the upload failed" but not for a table wifi that never answered
      // at all — which is the likelier of the two by a distance.
      if (withPhoto && photo) setCanSkipPhoto(true);
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  return (
    <FullScreenPanel title="Log notable win" onDismiss={onClose}>
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

        <section aria-labelledby="hand-types-heading">
          <h3 id="hand-types-heading" className="text-sm font-bold">Hand types</h3>
          <div className="mt-2 flex flex-col gap-4">
            {RARITIES.map(([rarity, label]) => (
              <fieldset key={rarity}>
                <legend className="text-xs font-bold uppercase tracking-[0.18em] text-muted">{label}</legend>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {notableHands.filter((hand) => hand.rarity === rarity).map((hand) => (
                    <label key={hand.id}
                      className="flex min-h-11 cursor-pointer items-center gap-3 rounded-[10px] border-2 border-divider bg-surface px-3 py-2 text-sm font-bold text-ink has-checked:border-cobalt has-checked:bg-cobalt/10">
                      <input type="checkbox" checked={selectedHandIds.includes(hand.id)}
                        onChange={() => toggleHand(hand.id)} className="size-5 shrink-0 accent-cobalt" />
                      <span>{hand.name}</span>
                      {hand.local_name ? <span aria-hidden className="font-normal text-muted">({hand.local_name})</span> : null}
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}
          </div>
        </section>

        <div>
          <p className="block text-sm font-bold">Photo of the tiles</p>
          <p className="mt-1 text-xs text-muted">Optional. The tiles get swept fast, so take it now if you want it.</p>
          <input ref={cameraInputRef} aria-label="Take photo using camera" type="file"
            accept="image/*" capture="environment" onChange={choosePhoto} className="sr-only" />
          <input ref={libraryInputRef} aria-label="Choose photo from library" type="file"
            accept="image/*" onChange={choosePhoto} className="sr-only" />
          <div className="mt-2 flex flex-wrap gap-2">
            <Button variant="secondary" disabled={preparingPhoto || submitting}
              onClick={() => cameraInputRef.current?.click()}>
              Take photo
            </Button>
            <Button variant="secondary" disabled={preparingPhoto || submitting}
              onClick={() => libraryInputRef.current?.click()}>
              Choose from library
            </Button>
            {photo ? (
              <Button variant="secondary" disabled={preparingPhoto || submitting} onClick={removePhoto}>
                Remove photo
              </Button>
            ) : null}
          </div>
          {preview ? (
            // Not next/image: `preview` is a blob: object URL that exists only in this tab, which
            // the optimizer cannot fetch.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="Photo of the tiles you are about to log"
              className="mt-3 max-h-48 rounded-[10px] border-2 border-divider object-contain" />
          ) : null}
        </div>

        <LiveRegion tone={syncError || error ? 'error' : 'info'}
          message={syncError ?? error ?? (preparingPhoto ? 'Preparing photo…' : undefined)} />
        <Button className="w-full" disabled={syncBlocked || preparingPhoto || !playerId || selectedHandIds.length === 0} busy={submitting}
          busyLabel="Logging…" onClick={() => submit(true)}>
          Log notable win
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
