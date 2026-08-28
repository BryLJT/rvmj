import { describe, expect, it } from 'vitest';
import {
  BOARDS,
  formatPointsPerGame,
  formatSingaporeWinDate,
  normalizeBoard,
  normalizeHandFilters,
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
