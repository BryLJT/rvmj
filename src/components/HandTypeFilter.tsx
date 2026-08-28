import Link from 'next/link';
import { standingsHref, type YearSelection } from '../lib/standings';
import { Button } from './ui';

/**
 * The catalogue row as every part of this feature needs it. It lives here because this panel is
 * what reads the whole catalogue; the ranked row below only ever sees the labels one win carries.
 */
export type HandType = {
  id: string;
  name: string;
  local_name: string | null;
  rarity: 'uncommon' | 'rare' | 'legendary';
};

/** Same three groups, in the same order, as the in-match logger. */
const RARITIES = [
  ['uncommon', 'Uncommon'],
  ['rare', 'Rare'],
  ['legendary', 'Legendary'],
] as const;

const byName = (left: HandType, right: HandType) => left.name.localeCompare(right.name);

/**
 * The Notable wins filter: a plain `<details>` panel wrapping a plain GET form.
 *
 * A Server Component on purpose. The address IS the state of this board — board, year, and every
 * checked hand type — so the browser needs no JavaScript to remember a selection, and Back, a
 * refresh, and a shared link all restore exactly what the player was looking at. Making this
 * interactive would add a client bundle to buy back something the URL already gives for free.
 *
 * That is also why the form carries `board` and the year hidden: a GET form REPLACES the whole
 * query string, so without them applying a filter would also throw the player back to Total
 * score at the default period.
 *
 * `board=skill` is written literally rather than taken as a prop because this panel belongs to
 * one board. There is no filtered address for the other two; they only carry the values through.
 */
export function HandTypeFilter({
  handTypes,
  selectedIds,
  year,
}: {
  handTypes: HandType[];
  selectedIds: string[];
  year: YearSelection;
}) {
  const selected = handTypes.filter((hand) => selectedIds.includes(hand.id)).sort(byName);

  return (
    <div className="mb-4 flex flex-col gap-2">
      <details className="rounded-[12px] border border-divider bg-surface">
        {/* Closed until asked for. The board exists to show the ranking; the filter is the detour,
            and the chips below already say what is currently selected. */}
        <summary className="flex min-h-11 cursor-pointer items-center px-3 text-sm font-bold">
          Filter hand types
        </summary>
        <form action="/" method="get" className="border-t border-divider px-3 py-3">
          <input type="hidden" name="board" value="skill" />
          <input type="hidden" name="year" value={String(year)} />
          <div className="flex flex-col gap-4">
            {RARITIES.map(([rarity, label]) => (
              <fieldset key={rarity}>
                <legend className="text-xs font-bold uppercase tracking-[0.18em] text-muted">{label}</legend>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {/* Sorted here rather than relied on from the read, so the twelve controls sit
                      in the same places whatever order the catalogue came back in. */}
                  {handTypes.filter((hand) => hand.rarity === rarity).sort(byName).map((hand) => (
                    <label key={hand.id}
                      className="flex min-h-11 cursor-pointer items-center gap-3 rounded-[10px] border-2 border-divider bg-surface px-3 py-2 text-sm font-bold text-ink has-checked:border-cobalt has-checked:bg-cobalt/10">
                      {/* `defaultChecked`, not `checked`: the browser owns the box between page
                          loads, and the server owns it across them. Nothing in between. */}
                      <input type="checkbox" name="hand" value={hand.id}
                        defaultChecked={selectedIds.includes(hand.id)}
                        className="size-5 shrink-0 accent-cobalt" />
                      <span>{hand.name}</span>
                      {hand.local_name ? <span aria-hidden className="font-normal text-muted">({hand.local_name})</span> : null}
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}
          </div>
          <Button type="submit" className="mt-4 w-full">Show matching wins</Button>
        </form>
      </details>
      {/* Spec §10.3. Without this sentence a multi-select reads as "and", and a player who picks
          three types expects the one hand that was all three at once — then reads a board full of
          hands that were only one of them as broken. */}
      <p className="text-xs leading-5 text-muted">
        A win qualifies if it matches any selected type. Wins matching more of them rank first.
      </p>
      {selected.length > 0 ? (
        // Above the ranking and OUTSIDE the panel, so a player looking at a short board can always
        // see why it is short, and undo it, without opening anything.
        <div className="flex flex-wrap items-center gap-2">
          {selected.map((hand) => (
            <Link key={hand.id} prefetch
              href={standingsHref({ board: 'skill', year, handIds: selectedIds.filter((id) => id !== hand.id) })}
              aria-label={`Remove ${hand.name}`}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-[9px] border-2 border-ink bg-cobalt-soft px-3 text-xs font-bold text-ink">
              {hand.name}
              <span aria-hidden className="text-base leading-none">×</span>
            </Link>
          ))}
          <Link prefetch href={standingsHref({ board: 'skill', year, handIds: [] })}
            className="inline-flex min-h-11 items-center px-2 text-xs font-bold text-cobalt underline">
            Clear all
          </Link>
        </div>
      ) : null}
    </div>
  );
}
