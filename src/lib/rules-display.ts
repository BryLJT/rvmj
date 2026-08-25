import { settleBonus } from './engine/bonus';
import { settleWin } from './engine/win';
import { EngineError, type BonusKind, type RulesConfig } from './engine/types';

/**
 * Rules-page figures, ASKED OF THE ENGINE rather than copied out of it.
 *
 * settleWin encodes 6×/2× and 4×/2×/1× as control flow, not as data, so there is nothing to
 * import. Settling one imaginary win and reading the movements recovers the real numbers from
 * the code that will actually run, which is what stops this page drifting from the engine the
 * way a retyped table always eventually does (the ChipSetCard/chips.ts arrangement, generalised).
 */
export type TaiRow = {
  tai: number;
  /** What the discarder pushes across — and, in a self-draw, what EACH player pushes. */
  discarderOrSelfDraw: number;
  /** What the two players who did not discard push across. Zero under a shooter rule. */
  eachOtherPlayer: number;
  isCap: boolean;
};

/**
 * The at-the-table reference: for each tai, the points that actually change hands.
 *
 * Deliberately NOT a base-value column. Chip play needs the amount to push, not a figure to
 * multiply, and the base is recoverable anyway — it is the "other players" column.
 *
 * The two payments merge into one column only because the discarder's 2× and the self-draw's
 * 2×-each coincide under Bryan's rules. Under a shooter rule they diverge, so this throws
 * rather than printing a column that quietly means two different things. Chip games always
 * settle on DEFAULT_RULES, so the throw is unreachable today; it exists to make a future rules
 * change fail loudly here instead of silently misinforming the table.
 */
export function taiRows(rules: RulesConfig): TaiRow[] {
  const rows: TaiRow[] = [];
  for (let tai = rules.minTai; tai <= rules.taiCap; tai += 1) {
    const selfDrawn = settleWin({ type: 'win', winner: 'E', winKind: 'self_draw', tai }, rules);
    const discarded = settleWin({ type: 'win', winner: 'E', winKind: 'discard', discarder: 'S', tai }, rules);
    const selfDrawEach = -selfDrawn.S;
    const discarderPays = -discarded.S;
    if (selfDrawEach !== discarderPays)
      throw new EngineError(
        `the discarder pays ${discarderPays} but a self-draw costs ${selfDrawEach} each at ${tai} tai, `
        + 'so they cannot share a column — split the tai table before shipping these rules',
      );
    rows.push({
      tai,
      discarderOrSelfDraw: discarderPays,
      eachOtherPlayer: -discarded.W,
      isCap: tai === rules.taiCap,
    });
  }
  return rows;
}

export type BonusRow = { kind: BonusKind; label: string; eachPlayerPays: number };

/** Reading order for the rules page: pairs first, then kongs by how they were made. */
const BONUS_LABELS: readonly (readonly [BonusKind, string])[] = [
  ['pair_dealt', 'Pair complete at the deal'],
  ['pair_drawn', 'Pair assembled during play'],
  ['kong_concealed', 'Concealed kong'],
  ['kong_exposed', 'Exposed kong'],
  ['kong_added', 'Added kong'],
];

/**
 * Flat bonus payments, settled rather than transcribed. BONUS_AMOUNT is private to the engine,
 * so asking it is the only way to show these without keeping a second copy.
 *
 * Read off West: an exposed kong is the one bonus with a discarder (seated South here), and
 * under a shooter rule that seat pays differently from the rest. West is an ordinary payer in
 * every case, which is what the column claims to describe.
 */
export function bonusRows(rules: RulesConfig): BonusRow[] {
  return BONUS_LABELS.map(([kind, label]) => {
    const movements = settleBonus(
      { type: 'bonus', kind, beneficiary: 'E', ...(kind === 'kong_exposed' ? { discarder: 'S' as const } : {}) },
      rules,
    );
    return { kind, label, eachPlayerPays: -movements.W };
  });
}
