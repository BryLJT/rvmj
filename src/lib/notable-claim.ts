import type { HandType } from '../components/HandTypeFilter';

/**
 * PostgREST returns an embed as an object or as an array depending on how it reads the
 * relationship, and the shape is not worth guessing at each call site.
 */
export const one = <T,>(value: T | T[] | null | undefined): T | null =>
  Array.isArray(value) ? (value[0] ?? null) : (value ?? null);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A claim id reaches the win page from the address bar. Postgres answers a malformed uuid with
 * an ERROR rather than with no rows, so checking the shape here is what turns a typo into the
 * app's not-found page instead of a failed read.
 */
export const isClaimId = (value: unknown): value is string =>
  typeof value === 'string' && UUID.test(value);

const RARITIES: ReadonlySet<string> = new Set(['uncommon', 'rare', 'legendary']);

/**
 * Read one claim's labels from its embedded rows.
 *
 * Every field is checked, and `null` means "these labels cannot be read" — never "this win has
 * fewer labels than it does". The board's `parseNotableWins` takes the same position for the same
 * reason: a win rendered a label short understates what somebody did at the table. An empty list
 * is refused too, because the database groups labels per claim and cannot produce a win with none.
 *
 * Ordered by name then id, so the page agrees with the board about label order.
 */
export function parseClaimHandTypes(rows: unknown): HandType[] | null {
  if (!Array.isArray(rows) || rows.length === 0) return null;

  const handTypes: HandType[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') return null;
    const hand = one((row as { notable_hands?: unknown }).notable_hands as
      Record<string, unknown> | Record<string, unknown>[] | null);
    if (!hand || typeof hand !== 'object') return null;
    const { id, name, local_name: localName, rarity } = hand;
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
  return handTypes.sort((left, right) =>
    left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
}
