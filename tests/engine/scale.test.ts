import { describe, it, expect } from 'vitest';
import { taiToBase } from '../../src/lib/engine/scale';
import { DEFAULT_RULES } from '../../src/lib/engine/defaults';
import { EngineError } from '../../src/lib/engine/types';

describe('taiToBase (doubling scale, cap 5, min 1)', () => {
  it.each([[1, 1], [2, 2], [3, 4], [4, 8], [5, 16]])('%i tai → base %i', (tai, base) => {
    expect(taiToBase(tai, DEFAULT_RULES)).toEqual({ base, clampedTai: tai });
  });
  it('clamps above the cap and reports the clamp', () => {
    expect(taiToBase(9, DEFAULT_RULES)).toEqual({ base: 16, clampedTai: 5 });
  });
  it('throws below the minimum', () => {
    expect(() => taiToBase(0, DEFAULT_RULES)).toThrow(EngineError);
  });
  it('throws on non-integer tai', () => {
    expect(() => taiToBase(2.5, DEFAULT_RULES)).toThrow(EngineError);
  });
});
