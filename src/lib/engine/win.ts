import { EngineError, SEATS, type Movements, type RulesConfig, type WinEvent } from './types';
import { taiToBase } from './scale';

export function settleWin(event: WinEvent, rules: RulesConfig): Movements {
  const { base } = taiToBase(event.tai, rules);
  const m: Movements = { E: 0, S: 0, W: 0, N: 0 };

  if (event.winKind === 'self_draw') {
    if (event.discarder !== undefined) throw new EngineError('self-draw cannot have a discarder');
    for (const s of SEATS) if (s !== event.winner) m[s] = -2 * base;
    m[event.winner] = 6 * base;
    return m;
  }

  const d = event.discarder;
  if (!d || d === event.winner) throw new EngineError('discard win requires a discarder other than the winner');
  if (rules.shooter) {
    m[d] = -4 * base;
  } else {
    m[d] = -2 * base;
    for (const s of SEATS) if (s !== event.winner && s !== d) m[s] = -base;
  }
  m[event.winner] = 4 * base;
  return m;
}
