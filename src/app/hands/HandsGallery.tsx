import Link from 'next/link';
import { StatusMessage } from '../../components/ui';

export type HandPhoto = {
  claimId: string;
  url: string;
  playerName: string;
  handNames: string[];
  playedAt: string;
};

// The zone is pinned rather than left to the runtime. A hand logged at 00:30 SGT is the
// after-midnight tail of a long night, and a night belongs to where it was played — read in UTC
// it would land in the previous one.
const night = (iso: string) =>
  new Date(iso).toLocaleDateString('en-SG', {
    timeZone: 'Asia/Singapore',
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });

/**
 * The photo archive: every photographed win, newest first, grouped by the night it was played.
 *
 * A Server Component since 2026-08-29. It used to open a panel over the grid carrying the only
 * Remove photo control in the app. That panel is gone: a tile is now a link to the win's own page,
 * where the photo, its labels, adding and removing all live together.
 *
 * The reason is not tidiness. Once a photo can be ADDED — and a win with no photo never appears in
 * this grid at all, so adding has to live on the win page — a panel that could still remove one
 * would put a single permission rule on two screens, kept in step by hand. That rule decides who
 * may permanently delete a file, so it lives in exactly one place.
 *
 * Losing the panel also takes this route's entire client bundle with it.
 */
export function HandsGallery({ photos, filtered = false, returnQuery = '' }: {
  photos: HandPhoto[];
  filtered?: boolean;
  /** The archive's own address parts, so a tile can send the player back HERE rather than to the
   *  board they may never have been on. */
  returnQuery?: string;
}) {
  // Two different facts. "Nothing matched what you picked" tells a player to loosen the filter;
  // "there are no photos" tells them to go and take one. Saying the second when the first is true
  // reads as the archive having lost their photos.
  if (photos.length === 0) {
    return (
      <StatusMessage tone="info">
        {filtered ? 'No photos of these hand types yet.' : 'No photographed hands yet.'}
      </StatusMessage>
    );
  }

  // `from=hands` is what tells the win page to send them back here. Appended to the archive's own
  // parts rather than handing across a whole URL, for the reason every address in this feature is
  // rebuilt: a parameter used verbatim as an href is somewhere to park any URL at all.
  const tail = returnQuery ? `${returnQuery}&from=hands` : 'from=hands';

  // The page hands these over already sorted newest first, so walking them in order groups each
  // night without a second sort and keeps the nights themselves in that same order.
  const nights = new Map<string, HandPhoto[]>();
  for (const item of photos) {
    const key = night(item.playedAt);
    nights.set(key, [...(nights.get(key) ?? []), item]);
  }

  return (
    <>
      {[...nights.entries()].map(([label, items]) => (
        <section key={label} className="mt-7">
          <h2 className="text-xs font-bold uppercase tracking-[0.18em] text-coral">{label}</h2>
          <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {items.map((item) => (
              <li key={item.claimId}>
                <Link href={`/hands/${item.claimId}?${tail}`}
                  aria-label={`${item.handNames.join(', ')} won by ${item.playerName}`}
                  className="block w-full overflow-hidden rounded-[10px] border-2 border-divider bg-surface transition-[transform,box-shadow] hover:border-cobalt active:translate-y-px">
                  {/* Not next/image: these are short-lived signed URLs on a random path, so the
                      optimizer cannot be given a remote pattern for them, and caching a private
                      table photo in it is the wrong trade anyway. The link already names the hand
                      and the winner, so an alt here would only repeat it. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={item.url} alt="" className="aspect-square w-full object-cover" />
                  <span className="block px-3 py-2 text-left text-xs font-bold">
                    {item.playerName}
                    {item.handNames.map((handName) => (
                      <span key={handName} className="block font-normal text-muted">{handName}</span>
                    ))}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}
