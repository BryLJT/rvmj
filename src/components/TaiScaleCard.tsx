import { DEFAULT_RULES } from '../lib/engine/defaults';
import { taiRows } from '../lib/rules-display';

/**
 * The at-the-table reference, rendered entirely from the engine via rules-display so the card
 * can never disagree with the code that settles a hand (the ChipSetCard/chips.ts pattern).
 *
 * Chip games store no rules snapshot — games.rules stays null for mode 'chips' — so the house
 * defaults ARE this game's rules, and reading them here is exact rather than approximate.
 */
export function TaiScaleCard() {
  const rows = taiRows(DEFAULT_RULES);
  return (
    <section className="overflow-hidden rounded-[14px] border border-divider bg-surface shadow-sm">
      <div className="flex items-center gap-3 border-b border-divider px-4 py-4 sm:px-5">
        <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-[9px] border-2 border-ink bg-cobalt shadow-[2px_2px_0_#142D37]">
          <span className="size-2 rounded-full bg-surface" />
        </span>
        <h2 className="text-lg font-extrabold tracking-[-0.02em]">Tai scale</h2>
      </div>
      <table aria-label="Tai scale" className="w-full text-xs sm:text-sm">
        <thead>
          <tr className="border-b border-divider text-left text-muted">
            <th className="px-3 py-3 font-bold sm:px-5">Tai</th>
            <th className="px-2 py-3 text-right font-bold">Discarder / self-draw</th>
            <th className="px-3 py-3 text-right font-bold sm:px-5">Other players</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.tai} className={`border-b border-divider last:border-b-0 ${row.isCap ? 'bg-cobalt-soft font-bold' : ''}`}>
              <td className="px-3 py-3 font-extrabold tabular-nums sm:px-5">
                {row.tai}
                {row.isCap ? <span className="ml-1.5 text-[0.68rem] font-semibold text-muted">cap</span> : null}
              </td>
              <td className="px-2 py-3 text-right font-bold tabular-nums">{row.discarderOrSelfDraw}</td>
              <td className="px-3 py-3 text-right font-bold tabular-nums sm:px-5">{row.eachOtherPlayer}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="border-t border-divider px-4 py-4 text-xs leading-5 text-muted sm:px-5">
        Points each player pushes across. On a self-draw all three pay the middle column. On a discard the
        discarder pays it and the other two pay the right. The winner collects whatever arrives.
        {' '}Minimum {DEFAULT_RULES.minTai} tai to win; anything above {DEFAULT_RULES.taiCap} still pays {DEFAULT_RULES.taiCap}.
      </p>
    </section>
  );
}
