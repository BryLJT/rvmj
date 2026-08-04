import { EngineError, SEATS, type Movements, type RulesConfig, type ScoringEvent } from './types';
import { settleWin } from './win';
import { settleBonus } from './bonus';

export function assertZeroSum(m: Movements): void {
  // Summing over SEATS (never Object.values) ignores any extra key, so a movements object
  // carrying a phantom seat could balance across E,S,W,N while holding points elsewhere.
  // Pin the key set down first: exactly the four seats, no more, no fewer.
  const keys = Object.keys(m);
  if (keys.length !== SEATS.length || !keys.every((k) => (SEATS as readonly string[]).includes(k))) {
    throw new EngineError(`movements keys must be exactly ${SEATS.join(',')}; got ${keys.join(',') || '(none)'}`);
  }
  const total = SEATS.reduce((acc, s) => acc + m[s], 0);
  if (total !== 0) throw new EngineError(`movements sum to ${total}, expected 0`);
}

/** The single entry point: settle any event and guarantee the zero-sum invariant. */
export function settleEvent(event: ScoringEvent, rules: RulesConfig): Movements {
  const m = event.type === 'win' ? settleWin(event, rules) : settleBonus(event, rules);
  assertZeroSum(m);
  return m;
}
