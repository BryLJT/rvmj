import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VARIANT,
  GAME_VARIANTS,
  isGameVariant,
  normalizeVariant,
  variantGameLabel,
} from '../src/lib/game-variant';

describe('game variants', () => {
  /**
   * The keys are stored in the database and written into addresses, so they are pinned here. The
   * titles are only what a player reads; changing one of those should fail nothing but this.
   */
  it('names the two games, with the regular one first', () => {
    expect(GAME_VARIANTS).toEqual({ regular: { title: 'Regular' }, fei: { title: '8 Fei' } });
    expect(Object.keys(GAME_VARIANTS)).toEqual(['regular', 'fei']);
    expect(DEFAULT_VARIANT).toBe('regular');
  });

  it('recognises exactly the two stored values', () => {
    expect(isGameVariant('regular')).toBe(true);
    expect(isGameVariant('fei')).toBe(true);
  });

  // `toString` and `constructor` are the ones a plain `in` check would wave through.
  it.each([undefined, null, '', 'FEI', ' fei', 'fei ', 'app', 'chips', 'toString', 'constructor', 0, {}, ['fei']])(
    'refuses %j as a variant', (raw) => {
      expect(isGameVariant(raw)).toBe(false);
    },
  );

  it('reads a known game from the address', () => {
    expect(normalizeVariant('fei')).toBe('fei');
    expect(normalizeVariant('regular')).toBe('regular');
  });

  /**
   * Same fail-soft posture the board parameter takes. A repeated parameter is malformed rather
   * than a choice, so it is the regular game instead of whichever value happened to come first.
   */
  it.each([undefined, '', 'bogus', 'toString', ['fei', 'regular'], ['fei'], []])(
    'falls back to the regular game for %j', (raw) => {
      expect(normalizeVariant(raw as string | string[] | undefined)).toBe('regular');
    },
  );

  it('says which game a finished match was', () => {
    expect(variantGameLabel('regular')).toBe('Regular game');
    expect(variantGameLabel('fei')).toBe('8 Fei game');
  });
});
