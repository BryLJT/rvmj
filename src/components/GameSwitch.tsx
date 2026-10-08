import Link from 'next/link';
import { GAME_VARIANTS, type GameVariant } from '../lib/game-variant';
import { standingsHref, type BoardKey, type YearSelection } from '../lib/standings';

/**
 * Which game's ladder the boards below are showing. It sits ABOVE the board tabs because it is
 * the wider choice: the tabs choose what is ranked, the year pills choose when, and this chooses
 * which matches are being counted at all. Regular and 8 Fei never share a board.
 *
 * Drawn as two outlined pills rather than as a second strip of tabs. Two identical controls
 * stacked on top of each other read as one control with six options.
 *
 * Switching keeps the board, the year and the hand filters, and returns to the first sheet. The
 * year is carried as a request, not a promise: if the other ladder has no games in it, the page
 * falls back to that ladder's own default period, the same way it treats any year with no games.
 *
 * Prefetched like the board tabs, and for the same reason: it is one of the two controls a
 * player uses to move between boards, and there is exactly one other option to fetch.
 */
export function GameSwitch({ selected, board, year, handIds }: {
  selected: GameVariant;
  board: BoardKey;
  year: YearSelection;
  handIds: readonly string[];
}) {
  return (
    <nav aria-label="Game" className="flex items-center gap-2">
      <span aria-hidden className="mr-1 text-xs font-bold uppercase tracking-[0.18em] text-muted">Game</span>
      {(Object.keys(GAME_VARIANTS) as GameVariant[]).map((variant) => (
        <Link key={variant} href={standingsHref({ board, year, handIds, variant })} prefetch
          aria-current={variant === selected ? 'page' : undefined}
          className={`inline-flex min-h-11 items-center justify-center rounded-[10px] border-2 border-ink px-4 text-sm font-bold ${
            variant === selected ? 'bg-ink text-surface' : 'bg-surface text-ink'
          }`}>
          {GAME_VARIANTS[variant].title}
        </Link>
      ))}
    </nav>
  );
}
