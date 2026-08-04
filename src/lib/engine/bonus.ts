import { EngineError, SEATS, type BonusEvent, type BonusKind, type Movements, type RulesConfig } from './types';

/** Flat points per paying player, independent of the tai scale (spec §6.3). */
const BONUS_AMOUNT: Record<BonusKind, number> = {
  pair_dealt: 2,
  pair_drawn: 1,
  kong_concealed: 2,
  kong_added: 1,
  kong_exposed: 1,
};

export function settleBonus(event: BonusEvent, rules: RulesConfig): Movements {
  const amount = BONUS_AMOUNT[event.kind];
  const m: Movements = { E: 0, S: 0, W: 0, N: 0 };
  const b = event.beneficiary;

  // Amount is set by tile status; funding by whether a discarder exists (spec §6.3).
  if (event.kind === 'kong_exposed') {
    const d = event.discarder;
    if (!d || d === b) throw new EngineError('exposed kong requires a discarder other than the beneficiary');
    if (rules.shooter) {
      m[d] = -3 * amount;
    } else {
      for (const s of SEATS) if (s !== b) m[s] = -amount;
    }
  } else {
    if (event.discarder !== undefined) throw new EngineError(`${event.kind} is self-drawn and cannot have a discarder`);
    for (const s of SEATS) if (s !== b) m[s] = -amount;
  }
  m[b] = 3 * amount;
  return m;
}
