import { describe, it, expect } from 'vitest';
import {
  DENOMS, PER_PLAYER, STACK_TOTAL, TABLE_QTY, TABLE_TOTAL,
  stackTotal, checkConservation, deriveFinalTotals, validateCounts, validateCountsTable, ChipsError,
  type ChipCounts,
} from '../src/lib/chips';
import type { Seat } from '../src/lib/engine/types';

const startAll = (): Record<Seat, ChipCounts> =>
  ({ E: { ...PER_PLAYER }, S: { ...PER_PLAYER }, W: { ...PER_PLAYER }, N: { ...PER_PLAYER } });

describe('the standard chip set (spec §6.7)', () => {
  it('derived constants pin the spec numbers: stack 400, table 1600, per-denomination 40/36/16/4', () => {
    expect(DENOMS).toEqual([1, 10, 50, 100]);
    expect(STACK_TOTAL).toBe(400);
    expect(TABLE_TOTAL).toBe(1600);
    expect(TABLE_QTY).toEqual({ 1: 40, 10: 36, 50: 16, 100: 4 });
  });
  it('stackTotal: chip worth = printed number', () => {
    expect(stackTotal(PER_PLAYER)).toBe(400);
    expect(stackTotal({ 1: 3, 10: 0, 50: 1, 100: 2 })).toBe(253);
  });
});

describe('checkConservation', () => {
  it('accepts the untouched table', () => {
    expect(checkConservation(startAll())).toEqual({ ok: true });
  });
  it('accepts any redistribution that conserves every denomination', () => {
    const c = startAll();
    c.E = { ...c.E, 100: 2 }; c.S = { ...c.S, 100: 0 };   // S paid E one $100
    c.E = { ...c.E, 10: 4 };  c.S = { ...c.S, 10: 14 };   // E paid S five $10s
    expect(checkConservation(c)).toEqual({ ok: true });
  });
  it('THE must-reject case (spec §11): grand total balances but denominations are off — and it NAMES them', () => {
    const c = startAll();
    // E "traded" ten $1 chips for a phantom extra $10: stack still totals 400, table still 1600.
    c.E = { 1: 0, 10: 10, 50: 4, 100: 1 };
    expect(stackTotal(c.E)).toBe(400); // proves a totals-only checker would wave this through
    expect(checkConservation(c)).toEqual({ ok: false, failedDenominations: [1, 10], grandTotalOff: false });
  });
  it('plain miscount: denomination named AND grand total off', () => {
    const c = startAll();
    c.N = { ...c.N, 50: 3 };
    expect(checkConservation(c)).toEqual({ ok: false, failedDenominations: [50], grandTotalOff: true });
  });
});

describe('deriveFinalTotals', () => {
  it('counted − 400 per seat; zero-sum by construction on a conserving table', () => {
    const c = startAll();
    c.E = { ...c.E, 100: 2 }; c.S = { ...c.S, 100: 0 };
    const totals = deriveFinalTotals(c);
    expect(totals).toEqual({ E: 100, S: -100, W: 0, N: 0 });
    expect(Object.values(totals).reduce((a, b) => a + b, 0)).toBe(0);
  });
  it('refuses to derive from a non-conserving table', () => {
    const c = startAll();
    c.W = { ...c.W, 1: 9 };
    expect(() => deriveFinalTotals(c)).toThrow(ChipsError);
  });
});

describe('validateCounts (trust boundary)', () => {
  it('accepts non-negative integers with all four keys', () => {
    expect(validateCounts({ 1: 0, 10: 2, 50: 0, 100: 16 })).toEqual({ 1: 0, 10: 2, 50: 0, 100: 16 });
  });
  it.each([
    ['negative', { 1: -1, 10: 9, 50: 4, 100: 1 }],
    ['float', { 1: 1.5, 10: 9, 50: 4, 100: 1 }],
    ['missing key', { 1: 10, 10: 9, 50: 4 }],
    ['non-number', { 1: '10', 10: 9, 50: 4, 100: 1 }],
    ['null', null],
  ])('rejects %s', (_label, bad) => {
    expect(() => validateCounts(bad)).toThrow(ChipsError);
  });
});

describe('validateCountsTable (seat-map shape at the trust boundary)', () => {
  it('accepts exactly the four seats and returns validated counts', () => {
    expect(validateCountsTable(startAll())).toEqual(startAll());
  });
  it('rejects a THREE-seat map instead of degrading into a misleading recount prompt', () => {
    const { E, S, W } = startAll();
    expect(() => validateCountsTable({ E, S, W })).toThrow(/missing chip counts for seat N/);
  });
  it('rejects a fifth seat', () => {
    expect(() => validateCountsTable({ ...startAll(), X: { ...PER_PLAYER } })).toThrow(/unexpected seat/);
  });
  it.each([
    ['null', null],
    ['an array', [PER_PLAYER, PER_PLAYER, PER_PLAYER, PER_PLAYER]],
    ['a string', 'E,S,W,N'],
  ])('rejects %s', (_label, bad) => {
    expect(() => validateCountsTable(bad)).toThrow(ChipsError);
  });
  it('names the offending seat when a seat carries bad counts', () => {
    expect(() => validateCountsTable({ ...startAll(), W: { 1: -1, 10: 9, 50: 4, 100: 1 } }))
      .toThrow(/seat W/);
  });
});
