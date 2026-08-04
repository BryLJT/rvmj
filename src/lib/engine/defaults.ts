import type { RulesConfig } from './types';

/** Bryan's table, confirmed 2026-08-04 (spec §6). */
export const DEFAULT_RULES: RulesConfig = {
  taiToPoints: [0, 1, 2, 4, 8, 16],
  minTai: 1,
  taiCap: 5,
  shooter: false,
  startingDisplayTotal: 1000,
  bustLine: -3000,
};
