import { describe, expect, it } from 'vitest';
import {
  BOARDS,
  formatPointsPerGame,
  formatSingaporeWinDate,
  normalizeBoard,
  normalizeHandFilters,
  notableWinHref,
  PAGE_SIZE,
  parsePageParam,
  standingsHref,
} from '../src/lib/standings';

describe('standings state', () => {
  const allowed = new Set(['valid-a', 'valid-b']);

  it('exposes the three stable board keys with descriptive titles', () => {
    expect(BOARDS).toEqual({
      lifetime: { title: 'Total score' },
      form: { title: 'Pts per game' },
      skill: { title: 'Notable wins' },
    });
  });

  it('accepts one valid scalar board key', () => {
    expect(normalizeBoard('skill')).toBe('skill');
  });

  it.each([undefined, 'unknown', 'toString', ['skill', 'form'], [], 42])(
    'falls back to lifetime for a malformed board value', (raw) => {
      expect(normalizeBoard(raw as string | string[] | undefined)).toBe('lifetime');
    },
  );

  it('keeps only allowed hand filters once in deterministic order', () => {
    expect(normalizeHandFilters(['valid-b', 'bad', 'valid-a', 'valid-a'], allowed))
      .toEqual(['valid-a', 'valid-b']);
  });

  it('accepts one allowed hand filter scalar', () => {
    expect(normalizeHandFilters('valid-b', allowed)).toEqual(['valid-b']);
  });

  it.each([undefined, 'bad', ['valid-b', 42, null, 'valid-a']])(
    'fails soft for missing or malformed hand filter values', (raw) => {
      expect(normalizeHandFilters(raw as string | string[] | undefined, allowed))
        .toEqual(Array.isArray(raw) ? ['valid-a', 'valid-b'] : []);
    },
  );

  it('serializes explicit board, year, and sorted unique repeated hand keys', () => {
    expect(standingsHref({ board: 'form', year: 2026, handIds: ['b', 'a', 'a'] }))
      .toBe('/?board=form&year=2026&hand=a&hand=b');
  });

  it('serializes an explicit all-time selection without an empty hand parameter', () => {
    expect(standingsHref({ board: 'skill', year: 'all' }))
      .toBe('/?board=skill&year=all');
  });

  it('formats signed averages to one decimal while keeping rounded negative zero neutral', () => {
    expect(formatPointsPerGame(8.5)).toBe('+8.5');
    expect(formatPointsPerGame(0)).toBe('0.0');
    expect(formatPointsPerGame(-3.24)).toBe('-3.2');
    expect(formatPointsPerGame(-0.04)).toBe('0.0');
  });

  it('formats a win date in Singapore even when it differs from UTC', () => {
    expect(formatSingaporeWinDate('2026-08-20T17:00:00.000Z')).toBe('21 Aug 2026');
  });
});

describe('notableWinHref', () => {
  it('addresses the win and carries the board state to come back to', () => {
    expect(notableWinHref({ claimId: 'c1', year: 2026, handIds: ['b', 'a'] }))
      .toBe('/hands/c1?year=2026&hand=a&hand=b');
  });

  it('carries an all-time selection', () => {
    expect(notableWinHref({ claimId: 'c1', year: 'all' })).toBe('/hands/c1?year=all');
  });

  /** Sorted and deduplicated, so one player's link is the same string as another's. */
  it('deduplicates and sorts the hand filters', () => {
    expect(notableWinHref({ claimId: 'c1', year: 'all', handIds: ['b', 'a', 'b'] }))
      .toBe('/hands/c1?year=all&hand=a&hand=b');
  });

  /** The id is encoded, so it can never escape the path segment it belongs to. */
  it('encodes the claim id', () => {
    expect(notableWinHref({ claimId: 'a/b?c', year: 'all' })).toBe('/hands/a%2Fb%3Fc?year=all');
  });
});

describe('board sheets', () => {
  it('holds fifty rows to a sheet', () => {
    expect(PAGE_SIZE).toBe(50);
  });

  it('reads a plain sheet number', () => {
    expect(parsePageParam('2')).toBe(2);
    expect(parsePageParam('9999')).toBe(9999);
  });

  /**
   * Same fail-soft posture as `board` and `year`: a hand-typed address lands on the first sheet
   * rather than on an error page. A repeated `page` is malformed rather than a choice, so it is
   * treated as absent instead of the page silently picking one of the two values.
   */
  it.each([undefined, '', '0', '-1', '1.5', '2e1', '02', ' 2', 'abc', '10000', ['2', '3'], []])(
    'falls back to the first sheet for an unusable value', (raw) => {
      expect(parsePageParam(raw as string | string[] | undefined)).toBe(1);
    },
  );

  it('carries a later sheet after every other part of the address', () => {
    expect(standingsHref({ board: 'skill', year: 2026, handIds: ['b', 'a'], page: 3 }))
      .toBe('/?board=skill&year=2026&hand=a&hand=b&page=3');
  });

  /**
   * The first sheet is the address WITHOUT the parameter, so every link and bookmark written
   * before sheets existed still names exactly the board it always did.
   */
  it('leaves the first sheet out of the address', () => {
    expect(standingsHref({ board: 'form', year: 'all', page: 1 })).toBe('/?board=form&year=all');
  });
});

describe('standingsHref with an unreadable period', () => {
  /**
   * Omitted, not guessed. The board applies its own default — the current academic year once it
   * has games — which is a better answer than pinning all time on the player's behalf.
   */
  it('omits the year entirely', () => {
    expect(standingsHref({ board: 'skill', year: null })).toBe('/?board=skill');
  });

  /**
   * The hand filters are read independently of the year. Dropping a filter the app COULD read
   * because a different part of the address was unreadable loses most of the selection for
   * nothing — and would return the player to a board that disagrees with the archive they just
   * filtered.
   */
  it('still carries the hand filters', () => {
    expect(standingsHref({ board: 'skill', year: null, handIds: ['b', 'a'] }))
      .toBe('/?board=skill&hand=a&hand=b');
  });
});

describe('standingsHref on a ladder', () => {
  it('puts the game straight after the board and before everything else', () => {
    expect(standingsHref({ board: 'skill', year: 2026, handIds: ['b', 'a'], page: 3, variant: 'fei' }))
      .toBe('/?board=skill&game=fei&year=2026&hand=a&hand=b&page=3');
  });

  /**
   * The regular game is the address WITHOUT the parameter, so every link and bookmark written
   * before 8 Fei existed still opens exactly the board it named.
   */
  it('leaves the regular game out of the address', () => {
    expect(standingsHref({ board: 'form', year: 'all', variant: 'regular' })).toBe('/?board=form&year=all');
    expect(standingsHref({ board: 'form', year: 'all' })).toBe('/?board=form&year=all');
  });

  it('carries the game even when the period is unreadable', () => {
    expect(standingsHref({ board: 'skill', year: null, variant: 'fei' })).toBe('/?board=skill&game=fei');
  });
});
