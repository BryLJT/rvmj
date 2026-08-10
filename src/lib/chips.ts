import type { Seat } from './engine/types';

export class ChipsError extends Error {}

export const DENOMS = [1, 10, 50, 100] as const;
export type Denom = (typeof DENOMS)[number];
/** Counts per denomination, keyed by printed value: { 1: n, 10: n, 50: n, 100: n }. Chip worth = printed number (spec §6.7). */
export type ChipCounts = Record<Denom, number>;

/** THE single source of truth for the standard set (spec §6.7). Everything below is derived from it. */
export const PER_PLAYER: ChipCounts = { 1: 10, 10: 9, 50: 4, 100: 1 };

export const STACK_TOTAL = DENOMS.reduce((sum, d) => sum + d * PER_PLAYER[d], 0);                                  // 400
export const TABLE_QTY = Object.fromEntries(DENOMS.map((d) => [d, PER_PLAYER[d] * 4])) as ChipCounts;              // 40/36/16/4
export const TABLE_TOTAL = STACK_TOTAL * 4;                                                                        // 1600

/** Trust boundary: raw client input → validated counts. Non-negative integers, all four denominations present. */
export function validateCounts(input: unknown): ChipCounts {
  if (typeof input !== 'object' || input === null) throw new ChipsError('chip counts must be an object');
  const rec = input as Record<string, unknown>;
  const out = {} as ChipCounts;
  for (const d of DENOMS) {
    const v = rec[String(d)];
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0)
      throw new ChipsError(`count for the $${d} chip must be a non-negative whole number`);
    out[d] = v;
  }
  return out;
}

export function stackTotal(counts: ChipCounts): number {
  return DENOMS.reduce((sum, d) => sum + d * counts[d], 0);
}

export type ConservationResult =
  | { ok: true }
  | { ok: false; failedDenominations: Denom[]; grandTotalOff: boolean };

/**
 * Two-level conservation (spec §8.6): each denomination must conserve across the table
 * (40 × $1, 36 × $10, 16 × $50, 4 × $100). Per-denomination conservation implies the
 * 1600 grand total; grandTotalOff is reported separately so the UI can say which kind
 * of miscount happened. A failure is a MISCOUNT — the only remedy is a recount (rebuy: KIV).
 */
export function checkConservation(table: Record<Seat, ChipCounts>): ConservationResult {
  const seats = Object.values(table);
  const failed = DENOMS.filter((d) => seats.reduce((s, c) => s + c[d], 0) !== TABLE_QTY[d]);
  if (failed.length === 0) return { ok: true };
  const grand = seats.reduce((s, c) => s + stackTotal(c), 0);
  return { ok: false, failedDenominations: failed, grandTotalOff: grand !== TABLE_TOTAL };
}

/** Net result per seat: counted − 400. Only defined on a conserving table, so zero-sum holds by construction. */
export function deriveFinalTotals(table: Record<Seat, ChipCounts>): Record<Seat, number> {
  const check = checkConservation(table);
  if (!check.ok)
    throw new ChipsError(`conservation failed for: ${check.failedDenominations.map((d) => `$${d}`).join(', ')} — recount`);
  return Object.fromEntries(
    (Object.entries(table) as [Seat, ChipCounts][]).map(([seat, c]) => [seat, stackTotal(c) - STACK_TOTAL]),
  ) as Record<Seat, number>;
}
