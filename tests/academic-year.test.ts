import { describe, expect, it } from 'vitest';
import { academicYearLabel, academicYearOf, academicYearRangeUtc, academicYearStart, parseYearParam } from '../src/lib/academic-year';

/**
 * NUS Office of the University Registrar, footnote 1, verbatim: "Commences on first Monday of
 * August each year." Implemented as a rule and asserted at both edges of that rule, because a
 * lookup table of start dates would need a row every year and the forgotten year would file
 * games into the wrong bucket with nothing failing and nothing logging.
 */
describe('academicYearStart', () => {
  it('finds the first Monday of August in an ordinary year', () => {
    expect(academicYearStart(2026).toISOString().slice(0, 10)).toBe('2026-08-03');
  });

  // The two edges of the rule. 7 August is the latest the first Monday can fall, and 1 August
  // the earliest, so these are the only two cases the arithmetic can get wrong.
  it('returns 7 August when 7 August IS the Monday', () => {
    expect(academicYearStart(2023).toISOString().slice(0, 10)).toBe('2023-08-07');
  });

  it('returns 1 August when 7 August is a Sunday', () => {
    expect(academicYearStart(2022).toISOString().slice(0, 10)).toBe('2022-08-01');
  });

  it('agrees with an independent scan of 1-7 August for forty years', () => {
    for (let y = 2020; y <= 2060; y++) {
      const start = academicYearStart(y);
      expect(start.getUTCDay()).toBe(1);
      expect(start.getUTCMonth()).toBe(7);
      expect(start.getUTCDate()).toBeLessThanOrEqual(7);
    }
  });
});

describe('academicYearOf', () => {
  it('files a game played mid-year under that year', () => {
    expect(academicYearOf(new Date('2026-11-15T12:00:00Z'))).toBe(2026);
  });

  it('files the day the year opens under the new year', () => {
    expect(academicYearOf(new Date('2026-08-03T04:00:00Z'))).toBe(2026);
  });

  it('files the day before it opens under the old year', () => {
    expect(academicYearOf(new Date('2026-08-02T04:00:00Z'))).toBe(2025);
  });

  /**
   * The trap. 16:30 UTC on 2 August is 00:30 on 3 August in Singapore, which is the first day
   * of AY26/27. Read in UTC this is the last day of AY25/26. Mahjong runs late, so this is a
   * real night of play and not a hypothetical.
   */
  it('files a late-night game by the Singapore date, not the UTC date', () => {
    expect(academicYearOf(new Date('2026-08-02T16:30:00Z'))).toBe(2026);
  });

  it('files the last instant before midnight Singapore under the old year', () => {
    expect(academicYearOf(new Date('2026-08-02T15:59:00Z'))).toBe(2025);
  });
});

describe('academicYearLabel', () => {
  it('renders the two-digit span', () => {
    expect(academicYearLabel(2026)).toBe('AY26/27');
  });

  it('pads a single-digit second year', () => {
    expect(academicYearLabel(2008)).toBe('AY08/09');
  });

  it('rolls the century without producing AY99/100', () => {
    expect(academicYearLabel(2099)).toBe('AY99/00');
  });
});

describe('parseYearParam', () => {
  it('reads a year', () => {
    expect(parseYearParam('2026')).toBe(2026);
  });

  it('reads the explicit all-time request', () => {
    expect(parseYearParam('all')).toBe('all');
  });

  it('treats an absent parameter as "apply the default"', () => {
    expect(parseYearParam(undefined)).toBeNull();
  });

  // Fail soft, exactly as `board` already does: an unusable value is not an error page.
  it.each([['junk'], ['20261'], ['-2026'], ['1999'], ['3001'], ['']])(
    'treats %s as absent rather than erroring', (value) => {
      expect(parseYearParam(value)).toBeNull();
    });

  it('reads the first value when the parameter is repeated', () => {
    expect(parseYearParam(['2026', 'all'])).toBe(2026);
  });
});

describe('academicYearRangeUtc', () => {
  /**
   * The window opens at SINGAPORE midnight, which is 16:00 UTC the day before. These are the
   * same two instants migration 0008 asserts on the SQL side: 2026-08-02 16:30Z is AY2026 and
   * 2026-08-02 15:59Z is AY2025. A window anchored to UTC midnight would put both in 2026.
   */
  it('opens at Singapore midnight of the first Monday of August', () => {
    expect(academicYearRangeUtc(2026).start).toBe('2026-08-02T16:00:00.000Z');
  });

  it('closes where the next year opens, so the two never overlap or gap', () => {
    expect(academicYearRangeUtc(2026).end).toBe(academicYearRangeUtc(2027).start);
  });

  /**
   * The window and academicYearOf are two readings of one rule and must agree exactly. An
   * instant one minute before the boundary belongs to the previous year by BOTH.
   */
  it('agrees with academicYearOf on both sides of the boundary', () => {
    const { start } = academicYearRangeUtc(2026);
    const justBefore = new Date(new Date(start).getTime() - 60_000);
    const atStart = new Date(start);
    expect(academicYearOf(justBefore)).toBe(2025);
    expect(academicYearOf(atStart)).toBe(2026);
  });
});
