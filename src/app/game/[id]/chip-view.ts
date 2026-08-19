import type { ChipCounts } from '../../../lib/chips';
import type { Seat } from '../../../lib/engine/types';

export type ChipPlayer = { playerId: string; seat: Seat; name: string };
export type ChipCountTable = Record<Seat, ChipCounts>;
export type PendingChipProposal = { counts: ChipCountTable; confirmed: string[]; id: string };

/** Table order, not scoring order: this is the sequence the four stacks are read in. */
export const SEAT_ORDER: readonly Seat[] = ['E', 'S', 'W', 'N'];

/*
 * Both builders return INDEPENDENT nested objects on purpose. A shared denomination object
 * would make typing into East's $1 field change all four seats at once, and the conservation
 * check would then pass on a table nobody actually counted.
 */
const emptyCounts = (): ChipCounts => ({ 1: 0, 10: 0, 50: 0, 100: 0 });

export const emptyChipCountTable = (): ChipCountTable => ({
  E: emptyCounts(), S: emptyCounts(), W: emptyCounts(), N: emptyCounts(),
});

export const cloneChipCountTable = (table: ChipCountTable): ChipCountTable => ({
  E: { ...table.E }, S: { ...table.S }, W: { ...table.W }, N: { ...table.N },
});
