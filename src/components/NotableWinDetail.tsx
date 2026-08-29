import type { ReactNode } from 'react';
import { formatSingaporeWinDate } from '../lib/standings';
import { NO_HOUSE_LABEL, type House } from '../lib/houses';
import { StatusMessage } from './ui';
import type { HandType } from './HandTypeFilter';

/**
 * Three states, never two. "No photo was taken" and "the photo could not be loaded" are different
 * facts about a win, and collapsing them would misreport the second as the first — which the
 * archive can afford to do across a wall of many photos, and a page about one win cannot.
 */
export type PhotoState =
  | { kind: 'none' }
  | { kind: 'failed' }
  | { kind: 'ready'; url: string };

/**
 * The body of one win's page. A Server Component: nothing here is interactive, so it stays out of
 * the client bundle entirely.
 *
 * On a house win the colour pair is set ONCE, on the panel, and everything inherits it — which is
 * why no child in that branch carries a text-* class. The approved foreground/background pairs
 * pass contrast as pairs, and a leftover text-muted would quietly break one of them. Same rule,
 * and the same reason, as BoardRow.
 */
export function NotableWinDetail({ winnerName, house, wonAt, handTypes, photo, controls }: {
  winnerName: string;
  house: House | null;
  wonAt: string;
  handTypes: HandType[];
  photo: PhotoState;
  /** The one interactive part, when the viewer is allowed one. This component stays a Server
   *  Component; only the island passed in here runs in the browser. */
  controls?: ReactNode;
}) {
  const described = `${handTypes.map((hand) => hand.name).join(', ')} won by ${winnerName}`;
  return (
    <>
      <section
        style={house ? { backgroundColor: house.fill, color: house.text } : undefined}
        className={`rounded-[14px] px-4 py-4 ${house ? 'border-2 border-ink' : 'border border-divider bg-surface'}`}>
        <p className={`text-2xl font-extrabold tracking-[-0.03em] ${house ? '' : 'text-ink'}`}>{winnerName}</p>
        <p className={`mt-1 text-xs font-semibold ${house ? '' : 'text-muted'}`}>{house ? house.name : NO_HOUSE_LABEL}</p>
        {/* Singapore time, always. A hand logged at 01:30 is the tail of the night before, and
            the date a player recognises is the one the table was sitting in. */}
        <p className={`mt-1 text-sm ${house ? '' : 'text-muted'}`}>{formatSingaporeWinDate(wonAt)}</p>
      </section>

      {/* `role="group"` because a bare div cannot carry an accessible name: without a role that
          takes one, this reads as a loose run of words with nothing saying what they are. */}
      <div role="group" aria-label="Hand types" className="mt-4 flex flex-col gap-2">
        {handTypes.map((hand) => (
          <div key={hand.id}
            className="flex min-h-11 items-center gap-2 rounded-[10px] border-2 border-divider bg-surface px-3 py-2">
            <span className="font-bold text-ink">{hand.name}</span>
            {hand.local_name ? <span className="text-muted">{hand.local_name}</span> : null}
          </div>
        ))}
      </div>

      <div className="mt-5">
        {photo.kind === 'ready' ? (
          /* Not next/image: these are short-lived signed URLs on a random path, so the optimizer
             cannot be given a remote pattern for them, and caching a private table photo in it is
             the wrong trade anyway. */
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={photo.url} alt={described}
            className="max-h-[70svh] w-full rounded-[12px] border-2 border-divider object-contain" />
        ) : photo.kind === 'failed' ? (
          <StatusMessage tone="warning">
            This hand has a photo, but the photo couldn’t be loaded just now. Refresh to try again.
          </StatusMessage>
        ) : (
          <StatusMessage tone="info">No photo was taken of this hand.</StatusMessage>
        )}
        {controls}
      </div>
    </>
  );
}
