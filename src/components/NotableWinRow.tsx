import { formatSingaporeWinDate } from '../lib/standings';
import type { HandType } from './HandTypeFilter';

/** One physical notable win, however many labels it carries. */
export type NotableWin = {
  claimId: string;
  winnerName: string;
  wonAt: string;
  handTypes: HandType[];
};

const RARITIES: ReadonlySet<string> = new Set(['uncommon', 'rare', 'legendary']);

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

/**
 * `hand_types` arrives as one JSON value per win. jsonb normally reaches us already parsed, but
 * the text form is read too rather than assumed away — a driver handing back raw text must not
 * turn a real win into a broken board.
 *
 * Every field is checked. `null` means "these labels cannot be read", never "this win has fewer
 * labels than it does": a win rendered a label short understates what somebody actually did at
 * the table, and would also sit lower in a ranking ordered by label count. An empty array is
 * refused for the same reason — the database groups labels per win and cannot produce a win with
 * none, so an empty one is a fault, not a labelless win.
 */
function parseHandTypes(value: unknown): HandType[] | null {
  const raw = typeof value === 'string' ? parseJson(value) : value;
  if (!Array.isArray(raw) || raw.length === 0) return null;

  const handTypes: HandType[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') return null;
    const { id, name, local_name: localName, rarity } = entry as Record<string, unknown>;
    if (typeof id !== 'string' || typeof name !== 'string') return null;
    if (typeof rarity !== 'string' || !RARITIES.has(rarity)) return null;
    // A missing local name is normal; a local name that is not text is not.
    if (localName !== null && localName !== undefined && typeof localName !== 'string') return null;
    handTypes.push({
      id,
      name,
      local_name: typeof localName === 'string' ? localName : null,
      rarity: rarity as HandType['rarity'],
    });
  }
  return handTypes;
}

/**
 * Read the ranking the database returned. Order is preserved exactly: the eligibility and
 * ranking rules live next to the numbers they order, and a second opinion here could only
 * disagree with them.
 *
 * One unreadable row fails the WHOLE board. Dropping it instead would quietly delete somebody's
 * win from a ranking, which reads as "it never happened" rather than as a fault.
 */
export function parseNotableWins(rows: readonly Record<string, unknown>[]): NotableWin[] | null {
  const wins: NotableWin[] = [];
  for (const row of rows) {
    const handTypes = parseHandTypes(row.hand_types);
    if (!handTypes) return null;
    const { claim_id: claimId, display_name: winnerName, created_at: wonAt } = row;
    if (typeof claimId !== 'string' || typeof winnerName !== 'string' || typeof wonAt !== 'string') return null;
    // A string is not yet a date. `formatSingaporeWinDate` throws RangeError on an Invalid Date and
    // nothing downstream catches it, so an unparseable timestamp would 500 the whole homepage
    // instead of reaching the `Couldn’t load this board` line this function exists to produce.
    // Postgres cannot return one today; this was the one field taken on trust.
    if (Number.isNaN(new Date(wonAt).getTime())) return null;
    wins.push({ claimId, winnerName, wonAt, handTypes });
  }
  return wins;
}

/**
 * One ranked notable WIN — not a player. A Server Component: nothing here is interactive.
 *
 * No photo. The gallery remains the photo archive, and a ranking that also carried images would
 * become a second, filtered one that disagreed with it about which hands exist.
 *
 * The count is taken from the labels actually rendered rather than from the database's
 * `total_label_count`, so what the row shows and what it says it shows can never disagree.
 */
export function NotableWinRow({ rank, winnerName, wonAt, handTypes }: {
  rank: number;
  winnerName: string;
  wonAt: string;
  handTypes: HandType[];
}) {
  return (
    <li className="grid min-h-16 grid-cols-[2rem_1fr_auto] items-start gap-3 rounded-[12px] border border-divider bg-surface px-3 py-3">
      {/* `aria-label` is ignored on a bare span — ARIA prohibits naming the implicit `generic`
          role — so the context is real text instead, visually hidden. A screen reader reads
          "Rank 3"; the eye sees "3" once, not twice. */}
      <span className="text-sm font-bold tabular-nums text-muted">
        <span className="sr-only">{`Rank ${rank}`}</span>
        <span aria-hidden>{rank}</span>
      </span>
      <div className="min-w-0">
        <p className="truncate font-bold text-ink">{winnerName}</p>
        {/* Singapore time, always. A hand logged at 01:30 is the tail of the night before, and
            the date a player recognises is the one the table was sitting in. */}
        <p className="truncate text-xs text-muted">{formatSingaporeWinDate(wonAt)}</p>
        {/* `role="group"` because a bare div cannot carry an accessible name: without a role that
            takes one, this reads as a loose run of words with nothing saying what they are. */}
        <div role="group" aria-label="Hand types" className="mt-2 flex flex-wrap gap-1.5">
          {/* Rendered in the order given, which the database already settled by name then ID. */}
          {handTypes.map((hand) => (
            <span key={hand.id}
              className="inline-flex items-center rounded-[9px] border border-divider px-2 py-0.5 text-xs font-semibold text-ink">
              {hand.name}
            </span>
          ))}
        </div>
      </div>
      <span className="shrink-0 text-xs font-bold tabular-nums text-muted">
        {handTypes.length === 1 ? '1 label' : `${handTypes.length} labels`}
      </span>
    </li>
  );
}
