import type { RulesConfig } from './types';

/** Bryan's table, confirmed 2026-08-04; display defaults aligned to the standard chip set 2026-08-07 (spec §6.1/§6.7). */
export const DEFAULT_RULES: RulesConfig = {
  taiToPoints: [0, 1, 2, 4, 8, 16],
  minTai: 1,
  taiCap: 5,
  shooter: 'off',
  startingDisplayTotal: 400,  // = the physical starting stack
  bustLine: -1200,            // displayed; a fall of four stacks
};
