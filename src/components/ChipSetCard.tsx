import { DENOMS, PER_PLAYER, STACK_TOTAL, TABLE_QTY, TABLE_TOTAL } from '../lib/chips';

/** Spec §6.7 — rendered entirely from chips.ts so the page can never drift from the checker. */
export function ChipSetCard() {
  return (
    <section className="overflow-hidden rounded-[14px] border border-divider bg-surface shadow-sm">
      <div className="flex items-center gap-3 border-b border-divider px-4 py-4 sm:px-5">
        <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-[9px] border-2 border-ink bg-coral shadow-[2px_2px_0_#142D37]">
          <span className="size-2 rounded-full bg-surface" />
        </span>
        <h2 className="text-lg font-extrabold tracking-[-0.02em]">The standard chip set</h2>
      </div>
      <table aria-label="Standard chip set" className="w-full text-xs sm:text-sm">
        <thead>
          <tr className="border-b border-divider text-left text-muted">
            <th className="px-3 py-3 font-bold sm:px-5">Chip</th><th className="px-2 py-3 text-right font-bold">Worth</th>
            <th className="px-2 py-3 text-right font-bold">Per player</th><th className="px-3 py-3 text-right font-bold sm:px-5">Whole table</th>
          </tr>
        </thead>
        <tbody>
          {DENOMS.map((d) => (
            <tr key={d} className="border-b border-divider last:border-b-0">
              <td className="px-3 py-3 font-extrabold tabular-nums sm:px-5">${d}</td>
              <td className="px-2 py-3 text-right tabular-nums text-muted">{d} pt{d > 1 ? 's' : ''}</td>
              <td className="px-2 py-3 text-right font-bold tabular-nums">{PER_PLAYER[d]}</td>
              <td className="px-3 py-3 text-right font-bold tabular-nums sm:px-5">{TABLE_QTY[d]}</td>
            </tr>
          ))}
          <tr className="bg-cobalt-soft font-bold">
            <td className="px-3 py-3 sm:px-5">Stack</td><td />
            <td className="px-2 py-3 text-right tabular-nums">{STACK_TOTAL} pts</td>
            <td className="px-3 py-3 text-right tabular-nums sm:px-5">{TABLE_TOTAL} pts</td>
          </tr>
        </tbody>
      </table>
      <p className="border-t border-divider px-4 py-4 text-xs leading-5 text-muted sm:px-5">Chip worth = printed number. Every payment the rules can name is payable in chips.</p>
    </section>
  );
}
