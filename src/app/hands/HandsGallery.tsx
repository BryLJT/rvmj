'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { removeNotablePhoto } from '../../lib/actions/game';
import { FullScreenPanel } from '../../components/FullScreenPanel';
import { Button, LiveRegion, StatusMessage } from '../../components/ui';

export type HandPhoto = {
  claimId: string;
  url: string;
  playerName: string;
  handNames: string[];
  playedAt: string;
  /** True when the viewer logged this claim, which is who may remove its photo. */
  mine: boolean;
};

// The zone is pinned rather than left to the runtime. This component is server-rendered first
// on a Vercel function (UTC) and hydrated on a phone at the table (UTC+8), and the value is
// both the grouping key and the React key — so a hand logged at 00:30 SGT, the after-midnight
// tail of a long night, would land in a different night on each side and the server's sections
// would be thrown away on hydration. A night belongs to where it was played.
const night = (iso: string) =>
  new Date(iso).toLocaleDateString('en-SG', {
    timeZone: 'Asia/Singapore',
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });

export function HandsGallery({ photos }: { photos: HandPhoto[] }) {
  const router = useRouter();
  const [open, setOpen] = useState<HandPhoto>();
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string>();

  if (photos.length === 0) {
    return <StatusMessage tone="info">No photographed hands yet.</StatusMessage>;
  }

  // The page hands these over already sorted newest first, so walking them in order groups
  // each night without a second sort and keeps the nights themselves in that same order.
  const nights = new Map<string, HandPhoto[]>();
  for (const item of photos) {
    const key = night(item.playedAt);
    nights.set(key, [...(nights.get(key) ?? []), item]);
  }

  const remove = async () => {
    if (!open || removing) return;
    setRemoving(true);
    setError(undefined);
    const result = await removeNotablePhoto(open.claimId);
    setRemoving(false);
    // Leave the panel open on failure. Closing it would drop the only thing that explains
    // why the photo is still there.
    if (result.error) { setError(result.error); return; }
    setOpen(undefined);
    router.refresh();
  };

  return (
    <>
      {[...nights.entries()].map(([label, items]) => (
        <section key={label} className="mt-7">
          <h2 className="text-xs font-bold uppercase tracking-[0.18em] text-coral">{label}</h2>
          <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {items.map((item) => (
              <li key={item.claimId}>
                <button type="button" onClick={() => setOpen(item)}
                  aria-label={`${item.handNames.join(', ')} won by ${item.playerName}`}
                  className="block w-full overflow-hidden rounded-[10px] border-2 border-divider bg-surface">
                  {/* Not next/image: these are short-lived signed URLs on a random path, so the
                      optimizer cannot be given a remote pattern for them, and caching a private
                      table photo in it is the wrong trade anyway. The button already names the
                      hand and the winner, so an alt here would only repeat it. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={item.url} alt="" className="aspect-square w-full object-cover" />
                  <span className="block px-3 py-2 text-left text-xs font-bold">
                    {item.playerName}
                    {item.handNames.map((handName) => (
                      <span key={handName} className="block font-normal text-muted">{handName}</span>
                    ))}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {open ? (
        // The heading is the hand, and the eyebrow directly above it is already the winner, so the
        // heading no longer repeats the winner as well. The dialog still has to identify itself in
        // full to a screen reader, and that belongs ON the dialog rather than in visible text said
        // twice: `label` names the panel without printing the words again.
        <FullScreenPanel title={open.handNames.join(', ')} eyebrow={open.playerName}
          label={`${open.handNames.join(', ')} won by ${open.playerName}`}
          onDismiss={() => setOpen(undefined)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={open.url} alt={`${open.handNames.join(', ')} won by ${open.playerName}`}
            className="max-h-[70svh] w-full rounded-[12px] border-2 border-divider object-contain" />
          {/* `role="group"`: ARIA prohibits naming the implicit `generic` role, so an aria-label on
              a bare div is dropped and this list reads as loose words with nothing naming them. */}
          <div role="group" className="mt-3 text-sm font-semibold text-muted" aria-label="Hand types">
            {open.handNames.map((handName) => <p key={handName}>{handName}</p>)}
          </div>
          <LiveRegion tone="error" message={error} />
          {open.mine ? (
            <Button className="mt-5 w-full" variant="destructive" busy={removing}
              busyLabel="Removing…" onClick={remove}>
              Remove photo
            </Button>
          ) : null}
        </FullScreenPanel>
      ) : null}
    </>
  );
}
