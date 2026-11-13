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
// it would land in the previous one. The server renders in UTC and the phone in UTC+8, so an
// unpinned date would also differ between the two and break hydration.
const night = (iso: string) =>
  new Date(iso).toLocaleDateString('en-SG', {
    timeZone: 'Asia/Singapore',
    day: 'numeric', month: 'short', year: 'numeric',
  });

/**
 * The photo archive: every photographed win in ONE grid, in the order the page hands over (rarest
 * first, then most tags, then newest). Each tile carries its own date.
 *
 * It used to be grouped under a heading per night. Bryan, 2026-11-13: rarity first. Night
 * headings cannot survive that order, since a Legendary from March and one from last night now sit
 * side by side, so the date moved onto the tile.
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

  return (
    <ul className="mt-7 grid grid-cols-2 gap-3 sm:grid-cols-3">
      {photos.map((item) => (
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
              <time dateTime={item.playedAt} className="mt-1 block font-normal text-muted">
                {night(item.playedAt)}
              </time>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
