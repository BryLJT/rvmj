import { describe, it, expect } from 'vitest';
import { settleWin } from '../../src/lib/engine/win';
import { DEFAULT_RULES } from '../../src/lib/engine/defaults';
import { EngineError, type WinEvent } from '../../src/lib/engine/types';

const win = (o: Partial<WinEvent>): WinEvent =>
  ({ type: 'win', winner: 'E', winKind: 'discard', discarder: 'S', tai: 4, ...o });

describe('settleWin — spec §6.2 worked examples (4 tai, base 8)', () => {
  it('discard, shooter OFF: discarder 2×, others 1×, winner +4×', () => {
    expect(settleWin(win({}), DEFAULT_RULES)).toEqual({ E: 32, S: -16, W: -8, N: -8 });
  });
  it('discard, shooter ON: discarder funds all 4×', () => {
    expect(settleWin(win({}), { ...DEFAULT_RULES, shooter: true }))
      .toEqual({ E: 32, S: -32, W: 0, N: 0 });
  });
  it('self-draw: all three pay 2×, winner +6× (shooter irrelevant)', () => {
    const expected = { E: 48, S: -16, W: -16, N: -16 };
    expect(settleWin(win({ winKind: 'self_draw', discarder: undefined }), DEFAULT_RULES)).toEqual(expected);
    expect(settleWin(win({ winKind: 'self_draw', discarder: undefined }), { ...DEFAULT_RULES, shooter: true })).toEqual(expected);
  });
  it('cap applies: 9 tai settles as 5 tai (base 16)', () => {
    expect(settleWin(win({ tai: 9 }), DEFAULT_RULES)).toEqual({ E: 64, S: -32, W: -16, N: -16 });
  });
  it('rejects self-draw with a discarder', () => {
    expect(() => settleWin(win({ winKind: 'self_draw' }), DEFAULT_RULES)).toThrow(EngineError);
  });
  it('rejects discard win without a discarder, or discarder === winner', () => {
    expect(() => settleWin(win({ discarder: undefined }), DEFAULT_RULES)).toThrow(EngineError);
    expect(() => settleWin(win({ discarder: 'E' }), DEFAULT_RULES)).toThrow(EngineError);
  });
});
