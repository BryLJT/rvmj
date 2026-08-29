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

export function standingsHref({ board, year, handIds = [] }: {
  board: BoardKey;
  year: YearSelection;
  handIds?: readonly string[];
}): string {
  const params = new URLSearchParams({ board, year: String(year) });
  for (const handId of [...new Set(handIds.filter((value): value is string => typeof value === 'string'))].sort()) {
    params.append('hand', handId);
  }
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
