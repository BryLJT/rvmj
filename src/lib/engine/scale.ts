import { EngineError, type RulesConfig } from './types';

export function taiToBase(tai: number, rules: RulesConfig): { base: number; clampedTai: number } {
  if (!Number.isInteger(tai)) throw new EngineError(`tai must be an integer, got ${tai}`);
  if (tai < rules.minTai) throw new EngineError(`tai ${tai} is below the minimum ${rules.minTai}`);
  const clampedTai = Math.min(tai, rules.taiCap);
  const base = rules.taiToPoints[clampedTai];
  if (base === undefined) throw new EngineError(`no point value configured for ${clampedTai} tai`);
  return { base, clampedTai };
}
