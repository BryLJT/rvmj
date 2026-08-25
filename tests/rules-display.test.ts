import { describe, it, expect } from 'vitest';
import { bonusRows, taiRows } from '../src/lib/rules-display';
import { DEFAULT_RULES } from '../src/lib/engine/defaults';

describe('taiRows', () => {
  it('states the points each player pushes across, per tai', () => {
    expect(taiRows(DEFAULT_RULES)).toEqual([
      { tai: 1, discarderOrSelfDraw: 2, eachOtherPlayer: 1, isCap: false },
      { tai: 2, discarderOrSelfDraw: 4, eachOtherPlayer: 2, isCap: false },
      { tai: 3, discarderOrSelfDraw: 8, eachOtherPlayer: 4, isCap: false },
      { tai: 4, discarderOrSelfDraw: 16, eachOtherPlayer: 8, isCap: false },
      { tai: 5, discarderOrSelfDraw: 32, eachOtherPlayer: 16, isCap: true },
    ]);
  });
});

/**
 * GUARD-MUST-FAIL DRILL (run 2026-08-25): replacing the loop body in taiRows with the same five
 * rows typed out by hand fails BOTH tests below, while the "states the points each player pushes
 * across" test above still passes. That is the whole point — a retyped table is correct under
 * today's rules and only these two catch it.
 */
describe('taiRows drift guard', () => {
  it('follows a changed tai ladder instead of a copy of it', () => {
    const rules = { ...DEFAULT_RULES, taiToPoints: [0, 3, 30], taiCap: 2 };
    expect(taiRows(rules)).toEqual([
      { tai: 1, discarderOrSelfDraw: 6, eachOtherPlayer: 3, isCap: false },
      { tai: 2, discarderOrSelfDraw: 60, eachOtherPlayer: 30, isCap: true },
    ]);
  });

  it('refuses to merge the column when a shooter rule splits the two payments', () => {
    expect(() => taiRows({ ...DEFAULT_RULES, shooter: 'full' })).toThrow(/cannot share a column/);
  });
});

describe('bonusRows', () => {
  it('states the flat points each player pays, taken from the bonus engine', () => {
    expect(bonusRows(DEFAULT_RULES)).toEqual([
      { kind: 'pair_dealt', label: 'Pair complete at the deal', eachPlayerPays: 2 },
      { kind: 'pair_drawn', label: 'Pair assembled during play', eachPlayerPays: 1 },
      { kind: 'kong_concealed', label: 'Concealed kong', eachPlayerPays: 2 },
      { kind: 'kong_exposed', label: 'Exposed kong', eachPlayerPays: 1 },
      { kind: 'kong_added', label: 'Added kong', eachPlayerPays: 1 },
    ]);
  });
});
