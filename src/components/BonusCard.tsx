import { DEFAULT_RULES } from '../lib/engine/defaults';
import { bonusRows } from '../lib/rules-display';

/**
 * Flat bonuses, settled by the engine rather than transcribed from it (see rules-display).
 * These do not scale with tai, which is the single thing most often argued about at the table.
 */
export function BonusCard() {
  const rows = bonusRows(DEFAULT_RULES);
  return (
    <section className="overflow-hidden rounded-[14px] border border-divider bg-surface shadow-sm">
      <div className="flex items-center gap-3 border-b border-divider px-4 py-4 sm:px-5">
        <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-[9px] border-2 border-ink bg-gain shadow-[2px_2px_0_#142D37]">
          <span className="size-2 rounded-full bg-surface" />
        </span>
        <h2 className="text-lg font-extrabold tracking-[-0.02em]">Bonuses</h2>
      </div>
      <table aria-label="Bonus payments" className="w-full text-xs sm:text-sm">
        <thead>
          <tr className="border-b border-divider text-left text-muted">
            <th className="px-3 py-3 font-bold sm:px-5">Bonus</th>
            <th className="px-3 py-3 text-right font-bold sm:px-5">Each player pays</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.kind} className="border-b border-divider last:border-b-0">
              <td className="px-3 py-3 sm:px-5">{row.label}</td>
              <td className="px-3 py-3 text-right font-extrabold tabular-nums sm:px-5">{row.eachPlayerPays}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="border-t border-divider px-4 py-4 text-xs leading-5 text-muted sm:px-5">
        Flat points, collected from each of the other three players. Pairs only, so a lone tile pays nothing,
        and your flower pair must match your own seat. Animals and flowers can never be thrown, so everyone
        funds them however the hand ends.
      </p>
    </section>
  );
}
