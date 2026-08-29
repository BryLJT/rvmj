'use client';

import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useRouter } from 'next/navigation';
import { addNotablePhoto, removeNotablePhoto } from '../lib/actions/game';
import { preparePhoto } from '../lib/image';
import { Button, LiveRegion } from './ui';

/**
 * The one interactive part of an otherwise server-rendered page: attaching a photo to a win that
 * has none, and taking one down.
 *
 * Rendered ONLY for a viewer who sat at that game, which is a matter of not drawing a control
 * nobody can use. It is not the guard: `add_notable_photo` and `clear_notable_photo` both re-check
 * participation inside the transaction that writes, so a forged prop buys a refused button.
 *
 * The camera and the library are two separate inputs rather than one. On iOS a single input with
 * `capture` set opens the camera and offers no way to reach the photo library at all — which is
 * exactly the complaint that produced the same split in the in-match logger.
 */
export function NotablePhotoControls({ claimId, hasPhoto, addedByMe }: {
  claimId: string;
  hasPhoto: boolean;
  /** Whether the viewer is the person who attached the photo, which decides the confirmation. */
  addedByMe: boolean;
}) {
  const router = useRouter();
  // The blob and its preview handle move together. Holding them as one value is what lets the
  // cleanup below release exactly the handle being replaced, with no effect that sets state.
  const [chosen, setChosen] = useState<{ blob: Blob; url: string }>();
  const [preparing, setPreparing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string>();
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);

  // An object URL is a document-lifetime handle, not a value: without the revoke the bytes stay
  // held for as long as the page lives, and picking three photos in a row would hold all three.
  // The cleanup runs with the PREVIOUS value, so choosing again releases the one being replaced
  // and leaving the page releases the last.
  useEffect(() => () => {
    if (chosen) URL.revokeObjectURL(chosen.url);
  }, [chosen]);

  const choose = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setError(undefined);
    setChosen(undefined);
    setPreparing(true);
    try {
      // Downscales, re-encodes, and — because the bytes are redrawn through a canvas — drops the
      // EXIF and GPS the phone attached. That is a privacy control, not an optimisation.
      const blob = await preparePhoto(file);
      setChosen({ blob, url: URL.createObjectURL(blob) });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not read that photo. Try another photo.');
    } finally {
      setPreparing(false);
      // Clearing the input lets the same file be chosen again after a failure; a browser fires no
      // change event when the value is unchanged.
      event.target.value = '';
    }
  };

  const discard = () => {
    setChosen(undefined);
    setError(undefined);
  };

  const save = async () => {
    if (!chosen || busy || preparing) return;
    setBusy(true);
    setError(undefined);
    const result = await addNotablePhoto(claimId, chosen.blob);
    setBusy(false);
    // The prepared photo survives a failure, so retrying does not mean finding it again. On a
    // phone at a table that difference is the difference between retrying and giving up.
    if (result.error) {
      setError(result.error);
      return;
    }
    setChosen(undefined);
    router.refresh();
  };

  const remove = async () => {
    if (busy) return;
    // Removal is permanent — the object leaves storage. Anyone who played may remove any photo of
    // that game, so somebody else's is not yours to discard on a single tap.
    if (!addedByMe && !confirming) {
      setConfirming(true);
      return;
    }
    setBusy(true);
    setError(undefined);
    const result = await removeNotablePhoto(claimId);
    setBusy(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setConfirming(false);
    router.refresh();
  };

  if (hasPhoto) {
    return (
      <div className="mt-4 flex flex-col gap-2">
        {confirming ? (
          <>
            <p className="text-sm leading-6 text-ink">
              Somebody else added this photo. Removing it deletes it for everyone, permanently.
            </p>
            <Button variant="destructive" busy={busy} busyLabel="Removing…" onClick={remove}>
              Yes, remove it
            </Button>
            <Button variant="quiet" disabled={busy} onClick={() => setConfirming(false)}>
              Keep it
            </Button>
          </>
        ) : (
          <Button variant="destructive" busy={busy} busyLabel="Removing…" onClick={remove}>
            Remove photo
          </Button>
        )}
        <LiveRegion tone="error" message={error} />
      </div>
    );
  }

  return (
    <div className="mt-4 flex flex-col gap-2">
      <input ref={cameraRef} aria-label="Take photo using camera" type="file"
        accept="image/*" capture="environment" onChange={choose} className="sr-only" />
      <input ref={libraryRef} aria-label="Choose photo from library" type="file"
        accept="image/*" onChange={choose} className="sr-only" />

      {chosen ? (
        <>
          {/* Not next/image: this is a blob handle for bytes that exist only in this tab. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={chosen.url} alt="The photo you chose"
            className="max-h-[40svh] w-full rounded-[12px] border-2 border-divider object-contain" />
          <Button variant="primary" busy={busy} busyLabel="Saving…" onClick={save}>
            Save photo
          </Button>
          <Button variant="quiet" disabled={busy} onClick={discard}>
            Choose a different one
          </Button>
        </>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" busy={preparing} busyLabel="Preparing…"
            onClick={() => cameraRef.current?.click()}>
            Take photo
          </Button>
          <Button variant="secondary" disabled={preparing}
            onClick={() => libraryRef.current?.click()}>
            Choose from library
          </Button>
        </div>
      )}
      <LiveRegion tone="error" message={error} />
    </div>
  );
}
