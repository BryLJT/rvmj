import Link from 'next/link';
import type { GameVariant } from '../lib/game-variant';
import { PAGE_SIZE, standingsHref, type BoardKey, type YearSelection } from '../lib/standings';

/** Where a sheet link lands: the game switch and tab row, so what is in force sits above the new rows. */
export const STANDINGS_ANCHOR = 'standings';

/**
 * Previous and Next under a board, a sheet of fifty at a time.
 *
 * A Server Component built from plain links, like every other board control: the address IS the
 * state, so a refresh, Back, and a shared link all return to the same sheet with no JavaScript
 * remembering anything.
 *
 * Renders nothing when the whole board fits on one sheet. Most do, and a pair of dead buttons
 * under a short list is only clutter.
 *
 * `hasNext` is decided by the page, which asks the database for one row more than a sheet holds.
 * That is why there is no "sheet 2 of 3" here: knowing the total would cost a second counting
 * query on every home view, and the ranks shown say where the player is just as well.
 *
 * `shown === 0` means the address named a sheet past the end of the board. Previous would then
 * step back onto another empty sheet as often as not, so the one link offered goes to the start.
 *
 * Every link carries the anchor because it is tapped from the BOTTOM of fifty rows: without
 * somewhere to land, the next sheet would open with the player still looking at its last row.
 *
 * Deliberately not prefetched, unlike the board tabs and year pills. Those were measured and are
 * used constantly; this is a control most visitors never reach, and forcing it would add up to
 * two more full renders of a force-dynamic page to every view of a long board.
 */
export function BoardPager({ board, year, handIds, variant, page, shown, hasNext }: {
  board: BoardKey;
  year: YearSelection;
  handIds: readonly string[];
  variant?: GameVariant;
  page: number;
  shown: number;
  hasNext: boolean;
}) {
  if (page === 1 && !hasNext) return null;

  const sheetHref = (target: number) =>
    `${standingsHref({ board, year, handIds, variant, page: target })}#${STANDINGS_ANCHOR}`;
  const linkClass = 'inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[10px] border-2 border-ink bg-surface px-4 text-sm font-bold text-ink';
  const firstRank = (page - 1) * PAGE_SIZE + 1;

  return (
    <nav aria-label="Board sheets" className="mt-4 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
      <div className="justify-self-start">
        {page > 1 ? (
          shown === 0 ? (
            <Link href={sheetHref(1)} className={linkClass}>
              <span aria-hidden>←</span>First sheet
            </Link>
          ) : (
            <Link href={sheetHref(page - 1)} className={linkClass}>
              <span aria-hidden>←</span>Previous
            </Link>
          )
        ) : null}
      </div>
      {shown > 0 ? (
        <p className="text-center text-xs font-bold tabular-nums text-muted">
          Ranks {firstRank} to {firstRank + shown - 1}
        </p>
      ) : <span />}
      <div className="justify-self-end">
        {hasNext ? (
          <Link href={sheetHref(page + 1)} className={linkClass}>
            Next<span aria-hidden>→</span>
          </Link>
        ) : null}
      </div>
    </nav>
  );
}
