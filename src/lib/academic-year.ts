/**
 * The NUS academic year, as a rule.
 *
 * Primary source, the Office of the University Registrar's academic calendar, footnote 1
 * verbatim: "Commences on first Monday of August each year." So AY N/N+1 runs from the first
 * Monday of August in year N up to, but not including, the first Monday of August in N+1.
 *
 * Implemented as a RULE and never as a table of start dates. A table needs a new row every
 * August, and the year somebody forgets files games into the wrong bucket with nothing failing
 * and nothing logging. This file must stay computable for any year, forever.
 *
 * This is the TypeScript half of a rule that also lives in SQL (migration 0008,
 * `academic_year_start` / `academic_year_of`). The two must agree exactly: SQL files the games,
 * this decides which pill the app opens on, and a disagreement would default the board to a
 * year whose games were filed elsewhere. This file's tests and the migration's own assertions
 * deliberately check the SAME cases on both sides.
 */

/** Singapore is UTC+8 with no daylight saving, ever. */
const SGT_OFFSET_MS = 8 * 60 * 60 * 1000;

/**
 * The first Monday of August. Exactly one of 1-7 August is a Monday, so stepping back from
 * 7 August to the Monday of its week always lands on it: if the 7th is itself a Monday we stay
 * put, and if it is a Sunday we step back the full six days to the 1st.
 */
export function academicYearStart(year: number): Date {
  const seventh = new Date(Date.UTC(year, 7, 7));
  // getUTCDay is 0 for Sunday; shift so Monday is 0 and Sunday is 6.
  const daysSinceMonday = (seventh.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(year, 7, 7 - daysSinceMonday));
}

/**
 * Which academic year an instant falls in, judged in SINGAPORE. `ended_at` is stored in UTC and
 * mahjong runs late: a game finishing at 00:30 on the Monday a year opens is recorded as 16:30
 * the previous afternoon in UTC, and read naively would be filed a whole year early.
 */
export function academicYearOf(when: Date): number {
  const local = new Date(when.getTime() + SGT_OFFSET_MS);
  const year = local.getUTCFullYear();
  const localMidnight = Date.UTC(year, local.getUTCMonth(), local.getUTCDate());
  return localMidnight >= academicYearStart(year).getTime() ? year : year - 1;
}

/** 2026 to "AY26/27". The modulo is what keeps the century roll from reading AY99/100. */
export function academicYearLabel(year: number): string {
  const pad = (n: number) => String(n % 100).padStart(2, '0');
  return `AY${pad(year)}/${pad(year + 1)}`;
}

/** RVMJ's first game was August 2026; a century of headroom is more than the app will need. */
const EARLIEST_YEAR = 2020;
const LATEST_YEAR = 2120;

/**
 * `null` means "absent or unusable, apply the default" rather than "error". Same fail-soft
 * posture the `board` parameter already takes: a hand-typed address should land somewhere
 * sensible, not on an error page.
 */
export function parseYearParam(value: string | string[] | undefined): number | 'all' | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return null;
  if (raw === 'all') return 'all';
  if (!/^\d{4}$/.test(raw)) return null;
  const year = Number(raw);
  return year >= EARLIEST_YEAR && year <= LATEST_YEAR ? year : null;
}
