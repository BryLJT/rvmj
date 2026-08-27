import Link from 'next/link';
import { academicYearLabel } from '../lib/academic-year';

/**
 * A second, subordinate row under the board tabs. Deliberately quieter than the tabs above it:
 * those choose WHAT is ranked, these choose WHEN, and the tabs stay the primary control.
 *
 * Renders nothing when no year has games. An empty row would read as "no years exist" rather
 * than "nothing has been played yet", and the board's own empty state already says the latter
 * properly.
 *
 * "All time" points at an EXPLICIT `year=all` rather than a bare address, because it is no
 * longer the default: a bare address now resolves to the current academic year, so a link
 * without the parameter would not reliably land on all time.
 *
 * The row scrolls inside itself so it cannot widen the page as years accumulate. The body must
 * never scroll sideways.
 */
export function YearPills({ years, selected }: { years: number[]; selected: number | 'all' }) {
  if (years.length === 0) return null;

  const pill = (key: string, href: string, label: string, isSelected: boolean) => (
    <Link key={key} href={href} prefetch
      aria-current={isSelected ? 'page' : undefined}
      className={`inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-[9px] px-3 text-xs font-bold ${
        isSelected ? 'bg-ink text-surface' : 'text-muted'
      }`}>
      {label}
    </Link>
  );

  return (
    <nav aria-label="Academic year" className="mt-2 flex gap-1 overflow-x-auto">
      {pill('all', '/?board=lifetime&year=all', 'All time', selected === 'all')}
      {[...years].sort((a, b) => b - a).map((year) =>
        pill(String(year), `/?board=lifetime&year=${year}`, academicYearLabel(year), selected === year),
      )}
    </nav>
  );
}
