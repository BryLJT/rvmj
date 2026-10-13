import Link from 'next/link';
import type { GameVariant } from '../lib/game-variant';
import {
  HOUSES, NO_HOUSE_FILTER, NO_HOUSE_FILTER_LABEL, findHouse, houseFilterLabel, type HouseFilter,
} from '../lib/houses';
import { standingsHref, type BoardKey, type YearSelection } from '../lib/standings';

/**
 * Narrows whichever board is showing to one house. Folded away until asked for, like the hand-type
 * filter: the board exists to show the ranking, and this is the detour. Bryan chose the folded
 * form over an always-open row on 2026-10-11, with "No house" as a ninth choice.
 *
 * A Server Component built from plain links, like every other board control. One house at a time,
 * so there is nothing to tick and submit: each choice IS the address it leads to. Back, a refresh
 * and a shared link all restore the same narrowed board with no JavaScript remembering anything.
 *
 * The panel is keyed on the address it represents. Every choice here soft-navigates, which keeps
 * the same `<details>` node, and a node the player opened stays open: without the key, tapping a
 * house would narrow the board behind a panel still covering it. A new key is a new, closed panel.
 *
 * The chip sits OUTSIDE the panel so a player looking at a short board can always see why it is
 * short, and undo it, without opening anything.
 *
 * Deliberately not prefetched, unlike the tabs and the year pills. Those were measured and are
 * used constantly; these are nine links most visitors never open, and forcing them would add nine
 * full renders of a force-dynamic page to every home view.
 *
 * Every choice returns to the first sheet: a different house is a different list, and sheet 3 of
 * one is not a place in another.
 */
export function HouseFilterPanel({ selected, board, year, handIds, variant }: {
  selected: HouseFilter;
  board: BoardKey;
  year: YearSelection;
  handIds: readonly string[];
  variant?: GameVariant;
}) {
  const href = (house: HouseFilter) => standingsHref({ board, year, handIds, variant, house });
  const addressKey = `${variant ?? ''}:${board}:${year}:${selected ?? 'all'}:${handIds.join(',')}`;
  const choice = 'inline-flex min-h-11 items-center justify-center rounded-[9px] border-2 px-1 text-center text-xs font-bold';
  // The two choices that are not a house: drawn in the app's own neutral pair, filled when chosen.
  const neutral = (isSelected: boolean) =>
    `${choice} border-ink ${isSelected ? 'bg-ink text-surface' : 'bg-surface text-ink'}`;
  const chosenHouse = selected !== null && selected !== NO_HOUSE_FILTER ? findHouse(selected) : null;

  return (
    <div className="mt-2 flex flex-col gap-2">
      <details key={addressKey} className="rounded-[12px] border border-divider bg-surface">
        <summary className="flex min-h-11 cursor-pointer items-center px-3 text-sm font-bold">
          Filter by house
        </summary>
        <nav aria-label="House" className="grid grid-cols-3 gap-2 border-t border-divider px-3 py-3">
          <Link href={href(null)} aria-current={selected === null ? 'page' : undefined}
            className={neutral(selected === null)}>
            All
          </Link>
          {HOUSES.map((house) => (
            // The approved fill and text pair, used as a pair. The chosen one is marked by its
            // border and a hard shadow, never by changing either colour.
            <Link key={house.id} href={href(house.id)}
              aria-current={selected === house.id ? 'page' : undefined}
              style={{ backgroundColor: house.fill, color: house.text }}
              className={`${choice} ${selected === house.id ? 'border-ink shadow-[0_3px_0_#142D37]' : 'border-ink/20'}`}>
              {house.name}
            </Link>
          ))}
          <Link href={href(NO_HOUSE_FILTER)} aria-current={selected === NO_HOUSE_FILTER ? 'page' : undefined}
            className={neutral(selected === NO_HOUSE_FILTER)}>
            {NO_HOUSE_FILTER_LABEL}
          </Link>
        </nav>
      </details>
      {selected !== null ? (
        <div className="flex flex-wrap items-center gap-2">
          <Link href={href(null)} aria-label={`Remove ${houseFilterLabel(selected)} filter`}
            style={chosenHouse ? { backgroundColor: chosenHouse.fill, color: chosenHouse.text } : undefined}
            className={`inline-flex min-h-11 items-center gap-1.5 rounded-[9px] border-2 border-ink px-3 text-xs font-bold ${chosenHouse ? '' : 'bg-surface text-ink'}`}>
            {houseFilterLabel(selected)}
            <span aria-hidden className="text-base leading-none">×</span>
          </Link>
        </div>
      ) : null}
    </div>
  );
}
