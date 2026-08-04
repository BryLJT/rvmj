import { describe, it, expect } from 'vitest';
import { settleBonus } from '../../src/lib/engine/bonus';
import { DEFAULT_RULES } from '../../src/lib/engine/defaults';
import { EngineError, type BonusEvent } from '../../src/lib/engine/types';

const bonus = (o: Partial<BonusEvent>): BonusEvent =>
  ({ type: 'bonus', kind: 'kong_concealed', beneficiary: 'W', ...o });
const SHOOTER = { ...DEFAULT_RULES, shooter: true };

describe('settleBonus — spec §6.3 table', () => {
  it('pair dealt: +6, 2 from each', () => {
    expect(settleBonus(bonus({ kind: 'pair_dealt' }), DEFAULT_RULES)).toEqual({ E: -2, S: -2, W: 6, N: -2 });
  });
  it('pair drawn: +3, 1 from each', () => {
    expect(settleBonus(bonus({ kind: 'pair_drawn' }), DEFAULT_RULES)).toEqual({ E: -1, S: -1, W: 3, N: -1 });
  });
  it('concealed kong: +6, 2 from each — shooter setting irrelevant', () => {
    const expected = { E: -2, S: -2, W: 6, N: -2 };
    expect(settleBonus(bonus({}), DEFAULT_RULES)).toEqual(expected);
    expect(settleBonus(bonus({}), SHOOTER)).toEqual(expected);
  });
  it('added kong (self-drawn, exposed): +3, 1 from each even with shooter on', () => {
    const expected = { E: -1, S: -1, W: 3, N: -1 };
    expect(settleBonus(bonus({ kind: 'kong_added' }), SHOOTER)).toEqual(expected);
  });
  it('exposed kong off a discard, shooter OFF: 1 from each', () => {
    expect(settleBonus(bonus({ kind: 'kong_exposed', discarder: 'N' }), DEFAULT_RULES))
      .toEqual({ E: -1, S: -1, W: 3, N: -1 });
  });
  it('exposed kong off a discard, shooter ON: discarder pays all 3', () => {
    expect(settleBonus(bonus({ kind: 'kong_exposed', discarder: 'N' }), SHOOTER))
      .toEqual({ E: 0, S: 0, W: 3, N: -3 });
  });
  it('rejects a discarder on self-drawn kinds', () => {
    expect(() => settleBonus(bonus({ kind: 'pair_dealt', discarder: 'N' }), DEFAULT_RULES)).toThrow(EngineError);
  });
  it('rejects exposed kong without a discarder, or discarder === beneficiary', () => {
    expect(() => settleBonus(bonus({ kind: 'kong_exposed' }), DEFAULT_RULES)).toThrow(EngineError);
    expect(() => settleBonus(bonus({ kind: 'kong_exposed', discarder: 'W' }), DEFAULT_RULES)).toThrow(EngineError);
  });
});
