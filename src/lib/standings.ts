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
