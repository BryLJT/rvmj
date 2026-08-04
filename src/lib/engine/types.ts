export type Seat = 'E' | 'S' | 'W' | 'N';
export const SEATS: readonly Seat[] = ['E', 'S', 'W', 'N'] as const;

export interface RulesConfig {
  /** Base points per tai; index 0 unused. Doubling default: [0,1,2,4,8,16]. Length must be taiCap+1. */
  taiToPoints: number[];
  minTai: number;
  taiCap: number;
  shooter: boolean;
  startingDisplayTotal: number;
  bustLine: number;
}

export type WinKind = 'self_draw' | 'discard';
export type BonusKind = 'pair_dealt' | 'pair_drawn' | 'kong_concealed' | 'kong_added' | 'kong_exposed';

export interface WinEvent {
  type: 'win';
  winner: Seat;
  winKind: WinKind;
  discarder?: Seat;
  tai: number;
  notableHandId?: string | null;
}

export interface BonusEvent {
  type: 'bonus';
  kind: BonusKind;
  beneficiary: Seat;
  discarder?: Seat; // only valid for kong_exposed
}

export type ScoringEvent = WinEvent | BonusEvent;

/** One entry per seat, zeros included. Always sums to zero. */
export type Movements = Record<Seat, number>;

export class EngineError extends Error {}
