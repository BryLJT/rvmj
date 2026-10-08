import { DEFAULT_VARIANT, VARIANT_PARAM, type GameVariant } from './game-variant';

export const BOARDS = {
  lifetime: { title: 'Total score' },
  form: { title: 'Pts per game' },
  skill: { title: 'Notable wins' },
} as const;

export type BoardKey = keyof typeof BOARDS;
export type YearSelection = number | 'all';

export function normalizeBoard(raw: string | string[] | undefined): BoardKey {
  if (typeof raw === 'string' && Object.prototype.hasOwnProperty.call(BOARDS, raw)) return raw as BoardKey;
  return 'lifetime';
}

export function normalizeHandFilters(
  raw: string | string[] | undefined,
  allowedIds: ReadonlySet<string>,
): string[] {
  const values = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
  return [...new Set(values.filter((value): value is string => typeof value === 'string' && allowedIds.has(value)))]
    .sort();
}

/** How many rows one sheet of a board holds. Bryan's number, set 2026-10-07. */
export const PAGE_SIZE = 50;

/**
 * Which sheet of a board an address names, counted from 1. Anything that is not a plain whole
 * number from 1 to 9999 is the first sheet: same fail-soft posture `board` and `year` take, so a
 * hand-typed address lands somewhere sensible instead of on an error page. A repeated `page` is
 * malformed rather than a choice, and is treated as absent.
 *
 * The ceiling is only there so a hand-typed number cannot ask the database to skip an absurd
 * count of rows; at fifty rows a sheet it is far past any board this app will hold.
 */
export function parsePageParam(raw: string | string[] | undefined): number {
  return typeof raw === 'string' && /^[1-9]\d{0,3}$/.test(raw) ? Number(raw) : 1;
}

/**
 * `year: null` means "this address did not carry a readable period", and OMITS the parameter rather
 * than guessing one. The board then applies its own default — the current academic year once it has
 * games — which is a better answer than pinning all time on the player's behalf.
 *
 * The hand filters still ride along in that case. They are read independently of the year, and
 * throwing away a filter the app COULD read because a different part of the address was unreadable
 * loses most of the selection for no reason.
 *
 * `page` is left out by every caller except the sheet control, on purpose: a tab, a year pill and
 * a filter each change WHICH list is ranked, and sheet 3 of one list is not a place in another.
 * The first sheet is the address without the parameter, so links written before sheets existed
 * still name the board they always did.
 *
 * `variant` is the opposite: EVERY link on a ladder carries it, because a tab, a pill or a filter
 * that forgot it would quietly move the player onto the other game's ladder. The regular game is
 * the address without the parameter, for the same reason the first sheet is: every link and
 * bookmark written before 8 Fei existed still opens exactly the board it named.
 */
export function standingsHref({ board, year, handIds = [], page = 1, variant = DEFAULT_VARIANT }: {
  board: BoardKey;
  year: YearSelection | null;
  handIds?: readonly string[];
  page?: number;
  variant?: GameVariant;
}): string {
  const params = new URLSearchParams({ board });
  if (variant !== DEFAULT_VARIANT) params.set(VARIANT_PARAM, variant);
  if (year !== null) params.set('year', String(year));
  for (const handId of [...new Set(handIds.filter((value): value is string => typeof value === 'string'))].sort()) {
    params.append('hand', handId);
  }
  if (page > 1) params.set('page', String(page));
  return `/?${params.toString()}`;
}

/**
 * One win's address, carrying the board state to come back TO — the same parts `/hands` already
 * receives, for the same reason: without them the win page's back link drops a player onto a bare
 * Notable wins board with their period and filters gone.
 *
 * The id is encoded rather than interpolated raw, so a value that is not a plain identifier
 * cannot escape its path segment.
 */
export function notableWinHref({ claimId, year, handIds = [] }: {
  claimId: string;
  year: YearSelection;
  handIds?: readonly string[];
}): string {
  const params = new URLSearchParams({ year: String(year) });
  for (const handId of [...new Set(handIds.filter((value): value is string => typeof value === 'string'))].sort()) {
    params.append('hand', handId);
  }
  return `/hands/${encodeURIComponent(claimId)}?${params.toString()}`;
}

export function formatPointsPerGame(value: number): string {
  const rounded = Number(value.toFixed(1));
  if (rounded === 0) return '0.0';
  return `${rounded > 0 ? '+' : ''}${rounded.toFixed(1)}`;
}

export function formatSingaporeWinDate(value: string): string {
  return new Intl.DateTimeFormat('en-SG', {
    timeZone: 'Asia/Singapore',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value));
}
